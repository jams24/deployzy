package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

// ── Deployzy Agent ───────────────────────────────────────────────────────────
// A DeepSeek-powered agentic loop (OpenAI-compatible function calling) grounded
// in the platform. It can answer questions about the user's account AND take
// actions (build+deploy, edit, redeploy) by calling real platform tools. Unlike
// the one-shot generators, this reasons in a loop: think → call tool → observe →
// repeat → answer.

const agentMaxSteps = 8

// agentSystem grounds the model in Deployzy + how to behave.
const agentSystem = `You are the Deployzy Agent — a helpful, precise assistant built into the Deployzy dashboard (an open-source platform to deploy apps from GitHub, run managed databases, tunnel localhost, and bring your own VPS; user apps are served at *.deployzy.app).

You can both ANSWER questions about the user's account and TAKE ACTIONS using the provided tools. Always use tools to get real data — never guess about the user's projects, logs, or status. Think step by step: call a tool, read the result, then decide the next step. When you have enough information, give a concise, friendly answer.

Platform facts:
- Deploys are built from a Dockerfile. Logs stream to deploy_logs. A project's status is created/building/running/failed/crashed.
- You can build and deploy real TypeScript/Python apps, APIs, and bots via the build_project tool, and change deployed ones via edit_project.
- Secrets are per-project environment variables. Databases (postgres/redis/mongodb/mysql) can be attached; the app reads DATABASE_URL / REDIS_URL.
- Be honest about limits. If something failed, read the logs and explain the actual cause in plain language.

Keep answers short and human. Use markdown. When you take an action, say what you did and the resulting URL.

IMPORTANT: builds take ~30-90s. After build_project or a redeploy/edit returns status "deploying", do NOT repeatedly poll get_deploy_logs waiting for it to finish — just tell the user it's deploying and give the URL. They can ask you to check on it later.`

// agentTools is the OpenAI-format tool schema advertised to DeepSeek.
var agentTools = []map[string]any{
	{"type": "function", "function": map[string]any{
		"name": "list_projects", "description": "List the current user's projects with status and URL.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "get_deploy_logs", "description": "Get recent deploy/build logs for one of the user's projects, to diagnose failures.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"project": map[string]any{"type": "string", "description": "project name, subdomain, or id"},
			"lines":   map[string]any{"type": "integer", "description": "how many recent log lines (default 40)"},
		}, "required": []string{"project"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "account_status", "description": "Get the user's plan, project count, build usage, and whether GitHub is connected.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "redeploy_project", "description": "Trigger a redeploy of one of the user's projects (e.g. after fixing config).",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"project": map[string]any{"type": "string"},
		}, "required": []string{"project"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "build_project", "description": "Generate and deploy a NEW app/API/bot from a description. kind is one of: api, telegram-bot, discord-bot, worker. Returns the live URL (or asks for required secrets/database).",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"kind":        map[string]any{"type": "string", "enum": []string{"api", "telegram-bot", "discord-bot", "worker"}},
			"description": map[string]any{"type": "string", "description": "what to build, in detail"},
		}, "required": []string{"kind", "description"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "edit_project", "description": "Change an already-deployed code-gen project (add a feature, fix a bug) and redeploy it.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"project":     map[string]any{"type": "string"},
			"instruction": map[string]any{"type": "string", "description": "the change to make"},
		}, "required": []string{"project", "instruction"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "get_env", "description": "List a project's environment variable KEYS (values are masked for safety).",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"project": map[string]any{"type": "string"},
		}, "required": []string{"project"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "set_env", "description": "Set/update an environment variable on a project (e.g. a missing token). Redeploy afterwards for it to take effect.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"project": map[string]any{"type": "string"},
			"key":     map[string]any{"type": "string"},
			"value":   map[string]any{"type": "string"},
		}, "required": []string{"project", "key", "value"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "attach_database", "description": "Provision a managed database (postgres/redis/mongodb/mysql) and inject its connection URL (DATABASE_URL or REDIS_URL) into a project. Redeploy afterwards.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"project": map[string]any{"type": "string"},
			"type":    map[string]any{"type": "string", "enum": []string{"postgres", "redis", "mongodb", "mysql"}},
		}, "required": []string{"project", "type"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "stop_project", "description": "Stop a running project (takes it offline).",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"project": map[string]any{"type": "string"},
		}, "required": []string{"project"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "list_databases", "description": "List the user's managed databases with type and status.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{}},
	}},
}

// ── tool execution ──

func (s *Server) findUserProject(ctx context.Context, userID, ref string) *db.Project {
	ref = strings.TrimSpace(ref)
	if p, _ := s.db.GetProject(ctx, ref); p != nil && p.UserID == userID {
		return p
	}
	projects, _ := s.db.ListProjects(ctx, userID)
	for i := range projects {
		if strings.EqualFold(projects[i].Subdomain, ref) || strings.EqualFold(projects[i].Name, ref) {
			return &projects[i]
		}
	}
	// fuzzy contains
	for i := range projects {
		if strings.Contains(strings.ToLower(projects[i].Subdomain), strings.ToLower(ref)) {
			return &projects[i]
		}
	}
	return nil
}

// runAgentTool executes one tool call and returns a JSON string result plus an
// optional side-effect note surfaced to the UI (e.g. "needs_setup").
func (s *Server) runAgentTool(ctx context.Context, u *auth.AuthenticatedUser, name string, args map[string]any) string {
	switch name {
	case "list_projects":
		projects, _ := s.db.ListProjects(ctx, u.ID)
		out := []map[string]any{}
		for _, p := range projects {
			out = append(out, map[string]any{"name": p.Name, "subdomain": p.Subdomain, "status": p.Status,
				"url": fmt.Sprintf("https://%s.%s", p.Subdomain, s.deployer.AppDomain), "framework": p.Framework})
		}
		return jsonStr(map[string]any{"projects": out, "count": len(out)})

	case "get_deploy_logs":
		p := s.findUserProject(ctx, u.ID, str(args["project"]))
		if p == nil {
			return jsonStr(map[string]any{"error": "no project matched that name"})
		}
		n := 40
		if v, ok := args["lines"].(float64); ok && v > 0 {
			n = int(v)
		}
		logs, _ := s.db.GetDeployLogs(ctx, p.ID, n)
		lines := []string{}
		for i := len(logs) - 1; i >= 0; i-- {
			lines = append(lines, "["+logs[i].Level+"] "+logs[i].Message)
		}
		return jsonStr(map[string]any{"project": p.Subdomain, "status": p.Status, "logs": strings.Join(lines, "\n")})

	case "account_status":
		plan := u.Plan
		if fresh, _ := s.db.GetUserByID(ctx, u.ID); fresh != nil && fresh.Plan != "" {
			plan = fresh.Plan
		}
		count, _ := s.db.CountProjectsForUser(ctx, u.ID)
		gh, _ := s.db.GetGitHubConnection(ctx, u.ID)
		limits, _ := s.db.GetPlanLimits(ctx, plan)
		maxProjects := 0
		if limits != nil {
			maxProjects = limits.MaxProjects
		}
		return jsonStr(map[string]any{"plan": plan, "projects_used": count, "projects_limit": maxProjects,
			"github_connected": gh != nil, "github_username": ghUsername(gh)})

	case "redeploy_project":
		p := s.findUserProject(ctx, u.ID, str(args["project"]))
		if p == nil {
			return jsonStr(map[string]any{"error": "no project matched that name"})
		}
		go func(proj db.Project) { _ = s.deployer.Deploy(context.Background(), &proj) }(*p)
		return jsonStr(map[string]any{"status": "redeploying", "project": p.Subdomain})

	case "edit_project":
		p := s.findUserProject(ctx, u.ID, str(args["project"]))
		if p == nil {
			return jsonStr(map[string]any{"error": "no project matched that name"})
		}
		files, err := readStagedFiles(p.ID)
		if err != nil || len(files) == 0 {
			return jsonStr(map[string]any{"error": "this project has no AI-editable source"})
		}
		instr := str(args["instruction"])
		res, err := s.deepseekEdit(ctx, agentKey(), instr, files, instr)
		if err != nil || validateCodegen(res) != nil {
			return jsonStr(map[string]any{"error": "couldn't generate that change"})
		}
		_ = stageCodegenFiles(p.ID, res.Files)
		nf := map[string]string{}
		for _, f := range res.Files {
			nf[f.Path] = f.Content
		}
		go s.deployWithRepair(p, nf, instr)
		return jsonStr(map[string]any{"status": "editing_and_redeploying", "project": p.Subdomain,
			"url": fmt.Sprintf("https://%s.%s", p.Subdomain, s.deployer.AppDomain)})

	case "build_project":
		return s.agentBuildProject(ctx, u, str(args["kind"]), str(args["description"]))

	case "get_env":
		p := s.findUserProject(ctx, u.ID, str(args["project"]))
		if p == nil {
			return jsonStr(map[string]any{"error": "no project matched that name"})
		}
		keys := []string{}
		for k := range p.EnvVars {
			keys = append(keys, k)
		}
		return jsonStr(map[string]any{"project": p.Subdomain, "env_keys": keys, "note": "values are hidden"})

	case "set_env":
		p := s.findUserProject(ctx, u.ID, str(args["project"]))
		if p == nil {
			return jsonStr(map[string]any{"error": "no project matched that name"})
		}
		k, v := str(args["key"]), str(args["value"])
		if k == "" {
			return jsonStr(map[string]any{"error": "key is required"})
		}
		envs := p.EnvVars
		if envs == nil {
			envs = map[string]string{}
		}
		envs[k] = v
		if err := s.db.UpdateProjectEnvVars(ctx, p.ID, envs); err != nil {
			return jsonStr(map[string]any{"error": "failed to set env var"})
		}
		return jsonStr(map[string]any{"status": "set", "project": p.Subdomain, "key": k, "note": "redeploy the project for this to take effect"})

	case "attach_database":
		p := s.findUserProject(ctx, u.ID, str(args["project"]))
		if p == nil {
			return jsonStr(map[string]any{"error": "no project matched that name"})
		}
		dbType := str(args["type"])
		if dbType == "" {
			dbType = "postgres"
		}
		envKey, connURL, err := s.provisionDBForBuild(ctx, p, dbType)
		if err != nil {
			return jsonStr(map[string]any{"error": "couldn't provision the database: " + err.Error()})
		}
		envs := p.EnvVars
		if envs == nil {
			envs = map[string]string{}
		}
		envs[envKey] = connURL
		s.db.UpdateProjectEnvVars(ctx, p.ID, envs)
		return jsonStr(map[string]any{"status": "attached", "project": p.Subdomain, "type": dbType, "injected_env": envKey, "note": "redeploy the project for it to use the database"})

	case "stop_project":
		p := s.findUserProject(ctx, u.ID, str(args["project"]))
		if p == nil {
			return jsonStr(map[string]any{"error": "no project matched that name"})
		}
		go func(proj db.Project) { _ = s.deployer.Stop(context.Background(), &proj) }(*p)
		return jsonStr(map[string]any{"status": "stopping", "project": p.Subdomain})

	case "list_databases":
		svcs, _ := s.db.ListServices(ctx, u.ID)
		out := []map[string]any{}
		for _, sv := range svcs {
			out = append(out, map[string]any{"name": sv.Name, "type": sv.Type, "status": sv.Status})
		}
		return jsonStr(map[string]any{"databases": out, "count": len(out)})

	default:
		return jsonStr(map[string]any{"error": "unknown tool"})
	}
}

// agentBuildProject: generate + deploy (or report needs_setup) synchronously
// enough to return a URL/summary the model can relay.
func (s *Server) agentBuildProject(ctx context.Context, u *auth.AuthenticatedUser, kind, desc string) string {
	g, ok := aiGenerators[kind]
	if !ok || !g.codegen {
		return jsonStr(map[string]any{"error": "kind must be api, telegram-bot, discord-bot, or worker"})
	}
	res, err := s.deepseekCodegen(ctx, agentKey(), g.kind+" — "+desc)
	if err != nil || validateCodegen(res) != nil {
		return jsonStr(map[string]any{"error": "generation failed"})
	}
	sub := s.freeSubdomain(ctx, res.Name)
	project, err := s.db.CreateProject(ctx, u.ID, sub, sub, "docker")
	if err != nil || project == nil {
		return jsonStr(map[string]any{"error": "could not create project"})
	}
	s.db.SetProjectSource(ctx, project.ID, "upload", "")
	project.DeploySource = "upload"
	s.db.ReserveSubdomainAuto(ctx, u.ID, sub)
	_ = stageCodegenFiles(project.ID, res.Files)
	url := fmt.Sprintf("https://%s.%s", sub, s.deployer.AppDomain)

	var missing []string
	for _, ev := range res.EnvVars {
		if ev.Required {
			missing = append(missing, ev.Key)
		}
	}
	if len(missing) > 0 || res.NeedsDatabase {
		return jsonStr(map[string]any{"status": "needs_setup", "project": sub, "url": url,
			"summary": res.Summary, "needs_secrets": missing, "needs_database": res.NeedsDatabase,
			"note": "Tell the user this project is staged but needs setup; they must add the secret(s)/database on the project page (or a future setup step) before it can run."})
	}
	files := map[string]string{}
	for _, f := range res.Files {
		files[f.Path] = f.Content
	}
	go s.deployWithRepair(project, files, desc)
	return jsonStr(map[string]any{"status": "deploying", "project": sub, "url": url, "summary": res.Summary})
}

// ── the agentic loop endpoint ──

type agentMessage struct {
	Role       string          `json:"role"`
	Content    string          `json:"content"`
	ToolCalls  json.RawMessage `json:"tool_calls,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
	Name       string          `json:"name,omitempty"`
}

// handleAIAgent runs the tool-calling loop. Request: {messages:[{role,content}]}.
// Response: {reply, steps:[{tool,args,result}]} — the full trace so the UI can
// show "N tool calls" like Railway/Brimble.
func (s *Server) handleAIAgent(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	if agentKey() == "" || s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "agent isn't available")
		return
	}
	var req struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Messages) == 0 {
		writeError(w, http.StatusBadRequest, "messages required")
		return
	}

	// Build the running message list for DeepSeek.
	msgs := []map[string]any{{"role": "system", "content": agentSystem}}
	for _, m := range req.Messages {
		if m.Role == "user" || m.Role == "assistant" {
			msgs = append(msgs, map[string]any{"role": m.Role, "content": m.Content})
		}
	}

	type step struct {
		Tool   string `json:"tool"`
		Args   string `json:"args"`
		Result string `json:"result"`
	}
	var steps []step

	for i := 0; i < agentMaxSteps; i++ {
		resp, err := s.deepseekAgentCall(r.Context(), msgs)
		if err != nil {
			s.log.Error().Err(err).Msg("agent: deepseek call failed")
			writeError(w, http.StatusBadGateway, "agent had a problem, please try again")
			return
		}
		// no tool calls → final answer
		if len(resp.ToolCalls) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"reply": resp.Content, "steps": steps})
			return
		}
		// record the assistant tool-call message verbatim, then execute each call
		msgs = append(msgs, map[string]any{"role": "assistant", "content": resp.Content, "tool_calls": resp.ToolCallsRaw})
		for _, tc := range resp.ToolCalls {
			var args map[string]any
			json.Unmarshal([]byte(tc.Args), &args)
			result := s.runAgentTool(r.Context(), u, tc.Name, args)
			steps = append(steps, step{Tool: tc.Name, Args: tc.Args, Result: result})
			msgs = append(msgs, map[string]any{"role": "tool", "tool_call_id": tc.ID, "content": result})
		}
	}
	// ran out of steps — ask model for a final summary with what it has
	msgs = append(msgs, map[string]any{"role": "user", "content": "Summarize what you found/did for me now, concisely."})
	resp, _ := s.deepseekAgentCall(r.Context(), msgs)
	reply := "I did a few steps but couldn't fully finish — try narrowing the request."
	if resp != nil && resp.Content != "" {
		reply = resp.Content
	}
	writeJSON(w, http.StatusOK, map[string]any{"reply": reply, "steps": steps})
}

// ── deepseek plumbing for the agent ──

type agentToolCall struct {
	ID   string
	Name string
	Args string
}
type agentResp struct {
	Content      string
	ToolCalls    []agentToolCall
	ToolCallsRaw json.RawMessage
}

func (s *Server) deepseekAgentCall(ctx context.Context, msgs []map[string]any) (*agentResp, error) {
	body, _ := json.Marshal(map[string]any{
		"model":       "deepseek-chat",
		"messages":    msgs,
		"tools":       agentTools,
		"temperature": 0.4,
		"max_tokens":  4000,
	})
	reqCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	httpReq, _ := http.NewRequestWithContext(reqCtx, http.MethodPost, "https://api.deepseek.com/chat/completions", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+agentKey())
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("deepseek status %d", resp.StatusCode)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content   string          `json:"content"`
				ToolCalls json.RawMessage `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("empty completion")
	}
	m := out.Choices[0].Message
	ar := &agentResp{Content: m.Content, ToolCallsRaw: m.ToolCalls}
	if len(m.ToolCalls) > 0 {
		var raw []struct {
			ID       string `json:"id"`
			Function struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			} `json:"function"`
		}
		json.Unmarshal(m.ToolCalls, &raw)
		for _, c := range raw {
			ar.ToolCalls = append(ar.ToolCalls, agentToolCall{ID: c.ID, Name: c.Function.Name, Args: c.Function.Arguments})
		}
	}
	return ar, nil
}

// ── helpers ──
func agentKey() string { return os.Getenv("DEEPSEEK_API_KEY") }
func jsonStr(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func ghUsername(g *db.GitHubConnection) string {
	if g == nil {
		return ""
	}
	return g.GitHubUsername
}
