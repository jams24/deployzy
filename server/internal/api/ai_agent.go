package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
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

You can both ANSWER questions about the user's account and TAKE ACTIONS using the provided tools. Always use tools to get real data — never guess about the user's projects, logs, or status. For any "how do I…" / "does Deployzy support…" / product question, call search_docs and answer from the real documentation (cite the doc URL). Think step by step: call a tool, read the result, then decide the next step. When you have enough information, give a concise, friendly answer.

Platform facts:
- Deploys are built from a Dockerfile. Logs stream to deploy_logs. A project's status is created/building/running/failed/crashed.
- You can build and deploy real TypeScript/Python apps, websites, APIs, and bots via the build_project tool, and change deployed ones via edit_project. If the user asks for a website, store, landing page, dashboard, or admin panel, use kind "web" (renders real pages at the root URL) — NOT "api" (which serves only JSON and shows "Cannot GET /" in a browser).
- Deployzy has one-click TEMPLATES (pre-built apps/services: databases, tools like n8n/WordPress, starters). Use list_templates to see them and deploy_template (by slug) to deploy one. Prefer a template when the user wants a well-known off-the-shelf app rather than custom code.
- To deploy an EXISTING GitHub repo the user links (a SOURCE deploy), use deploy_github with the repo URL — do NOT use build_project (that generates new code). Node, Next.js, Python, and static sites auto-detect and build; repos with their own Dockerfile build as-is. Deployzy does NOT have native PHP/Laravel, Ruby, Java, or .NET buildpacks — those deploy ONLY if the repo ships its own Dockerfile. If a repo is one of those with no Dockerfile, say so honestly and offer to add a Dockerfile or diagnose from the build logs rather than pretending it will work.
- Secrets are per-project environment variables. Databases (postgres/redis/mongodb/mysql) can be attached; the app reads DATABASE_URL / REDIS_URL.
- Be honest about limits. If something failed, read the logs and explain the actual cause in plain language.

Keep answers short and human. Use markdown. When you take an action, say what you did and the resulting URL.

IMPORTANT: builds take ~30-90s. After build_project or a redeploy/edit returns status "deploying", do NOT repeatedly poll get_deploy_logs waiting for it to finish — just tell the user it's deploying and give the URL. They can ask you to check on it later.

ONE PROJECT PER REQUEST: a single "build me X" request is ONE app — call build_project exactly ONCE, with everything (storefront + admin + API) in that one project. NEVER call build_project multiple times for the same request, and never split one app into several projects. If the user later asks to change it, use edit_project on that SAME project — do not build a new one.`

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
		"name": "build_project", "description": "Generate and deploy a NEW app from a description. Choose kind carefully: use 'web' for anything with a user-facing PAGE — a website, store, landing page, dashboard, or admin panel (its root URL renders HTML, not JSON); 'api' ONLY for a headless JSON API / microservice with no frontend; 'telegram-bot' / 'discord-bot' for bots; 'worker' for a background/scheduled job. Returns the live URL (or asks for required secrets/database).",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"kind":        map[string]any{"type": "string", "enum": []string{"web", "api", "telegram-bot", "discord-bot", "worker"}},
			"description": map[string]any{"type": "string", "description": "what to build, in detail"},
		}, "required": []string{"kind", "description"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "deploy_github", "description": "Deploy an existing GitHub repository (SOURCE deploy) from its URL. Use this when the user gives a github.com repo link and asks to deploy/ship it (NOT build_project, which generates new code). The build framework (Node, Next.js, Python, static, or a repo Dockerfile) is auto-detected. Auto-deploys on future pushes. Returns the live URL and streams build logs. Note: PHP/Laravel/Ruby/etc. are only supported if the repo ships its own Dockerfile.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"repo_url": map[string]any{"type": "string", "description": "the https://github.com/owner/repo URL"},
			"branch":   map[string]any{"type": "string", "description": "branch to deploy (default main)"},
		}, "required": []string{"repo_url"}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "list_templates", "description": "List Deployzy's one-click deploy templates (pre-built apps/services like databases, tools, starters). Use to answer 'what can I deploy?' or to find a template before deploying it. Optional search filters by name/tag.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"search": map[string]any{"type": "string", "description": "optional keyword to filter templates (e.g. 'postgres', 'wordpress', 'n8n')"},
		}},
	}},
	{"type": "function", "function": map[string]any{
		"name": "deploy_template", "description": "Deploy one of Deployzy's one-click templates by its slug (get slugs from list_templates). Use this when the user wants a known pre-built app/service (e.g. n8n, WordPress, a Postgres+Node starter) rather than custom-generated code. If the template needs secrets, it returns needs_setup listing them.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"slug":      map[string]any{"type": "string", "description": "the template slug from list_templates"},
			"subdomain": map[string]any{"type": "string", "description": "optional desired subdomain"},
			"env":       map[string]any{"type": "object", "description": "optional map of required env var KEY->value"},
		}, "required": []string{"slug"}},
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
	{"type": "function", "function": map[string]any{
		"name": "search_docs", "description": "Search the Deployzy documentation to answer how-to and product questions (CLI, deploys, tunnels, domains, databases, API, SDKs). Use this for any 'how do I…' or 'does Deployzy support…' question.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"query": map[string]any{"type": "string", "description": "the topic or question to look up"},
		}, "required": []string{"query"}},
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
		res, err := s.deepseekEdit(ctx, s.agentKey(ctx), instr, files, instr)
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

	case "deploy_github":
		return s.agentDeployGithub(ctx, u, str(args["repo_url"]), str(args["branch"]))

	case "list_templates":
		return s.agentListTemplates(ctx, u, str(args["search"]))

	case "deploy_template":
		env := map[string]string{}
		if m, ok := args["env"].(map[string]any); ok {
			for k, v := range m {
				env[k] = fmt.Sprintf("%v", v)
			}
		}
		return s.agentDeployTemplate(ctx, u, str(args["slug"]), str(args["subdomain"]), env)

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

	case "search_docs":
		return searchDocs(str(args["query"]), 3)

	default:
		return jsonStr(map[string]any{"error": "unknown tool"})
	}
}

// agentBuildProject: generate + deploy (or report needs_setup) synchronously
// enough to return a URL/summary the model can relay.
func (s *Server) agentBuildProject(ctx context.Context, u *auth.AuthenticatedUser, kind, desc string) string {
	g, ok := aiGenerators[kind]
	if !ok || !g.codegen {
		return jsonStr(map[string]any{"error": "kind must be web, api, telegram-bot, discord-bot, or worker"})
	}
	res, err := s.deepseekCodegen(ctx, s.agentKey(ctx), g.kind+" — "+desc)
	if err != nil {
		s.log.Error().Err(err).Str("kind", kind).Msg("agent build: generation failed")
		return jsonStr(map[string]any{"error": "generation failed: " + err.Error()})
	}
	if verr := validateCodegen(res); verr != nil {
		s.log.Error().Err(verr).Str("kind", kind).Msg("agent build: validation failed")
		return jsonStr(map[string]any{"error": "generation failed: " + verr.Error()})
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

// agentDeployGithub: SOURCE deploy of an existing GitHub repo from its URL.
// Creates the project, wires the repo (with a token for private repos + a
// webhook for auto-deploy), and deploys. The engine auto-detects the framework
// (node/nextjs/python/static, or a repo Dockerfile) at build time.
func (s *Server) agentDeployGithub(ctx context.Context, u *auth.AuthenticatedUser, repoURL, branch string) string {
	repoURL = strings.TrimSpace(repoURL)
	// Normalise a bare "owner/repo" or a URL without .git.
	if repoURL != "" && !strings.HasPrefix(repoURL, "http") && strings.Count(repoURL, "/") == 1 {
		repoURL = "https://github.com/" + repoURL
	}
	if !isSafeRepoURL(repoURL) {
		return jsonStr(map[string]any{"error": "please give a plain https://github.com/owner/repo URL"})
	}
	if branch = strings.TrimSpace(branch); branch == "" {
		branch = "main"
	}
	if !isSafeBranchName(branch) {
		return jsonStr(map[string]any{"error": "invalid branch name"})
	}
	fullName := extractRepoFullName(repoURL) // "owner/repo"
	if fullName == "" {
		return jsonStr(map[string]any{"error": "couldn't parse the repository from that URL"})
	}
	repoName := fullName
	if i := strings.LastIndex(fullName, "/"); i >= 0 {
		repoName = fullName[i+1:]
	}

	sub := s.freeSubdomain(ctx, sanitizeSubdomain(repoName))
	project, err := s.db.CreateProject(ctx, u.ID, sub, sub, "node") // engine re-detects at build
	if err != nil || project == nil {
		return jsonStr(map[string]any{"error": "could not create project"})
	}
	s.db.ReserveSubdomainAuto(ctx, u.ID, sub)

	// For private repos, embed a short-lived access token in the clone URL.
	cloneURL := repoURL
	if !strings.HasSuffix(cloneURL, ".git") {
		cloneURL += ".git"
	}
	if token, ok := s.bestUserGitHubToken(ctx, u.ID); ok {
		cloneURL = fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, fullName)
		// Register the auto-deploy webhook (best-effort).
		if s.deployer != nil && s.deployer.GitHub != nil {
			webhookURL := fmt.Sprintf("https://api.%s/api/v1/github/webhook", s.deployer.Domain)
			s.deployer.GitHub.EnsureWebhook(token, fullName, webhookURL)
		}
	}
	s.db.UpdateProjectConfig(ctx, project.ID, cloneURL, branch, "", "", nil)
	s.db.UpdateProjectGitHub(ctx, project.ID, fullName, branch, true)
	project.RepoURL = cloneURL
	project.Branch = branch
	project.DeploySource = "git"

	go func(p db.Project) { _ = s.deployer.Deploy(context.Background(), &p) }(*project)
	return jsonStr(map[string]any{"status": "deploying", "project": sub, "repo": fullName, "branch": branch,
		"url": fmt.Sprintf("https://%s.%s", sub, s.deployer.AppDomain)})
}

// agentListTemplates returns the active one-click templates (optionally filtered).
func (s *Server) agentListTemplates(ctx context.Context, u *auth.AuthenticatedUser, search string) string {
	tmpls, _, err := s.db.ListTemplates(ctx, db.TemplateFilter{Search: strings.TrimSpace(search), Sort: "popular", Limit: 40}, u.ID)
	if err != nil {
		return jsonStr(map[string]any{"error": "couldn't list templates"})
	}
	out := make([]map[string]any, 0, len(tmpls))
	for _, t := range tmpls {
		var req []string
		for _, ev := range t.EnvVars {
			if ev.Required && ev.Type != "auto" {
				req = append(req, ev.Key)
			}
		}
		out = append(out, map[string]any{"slug": t.Slug, "name": t.Name, "category": t.Category,
			"tagline": t.Tagline, "required_env": req, "required_plan": t.RequiredPlan})
	}
	return jsonStr(map[string]any{"templates": out, "count": len(out)})
}

// agentDeployTemplate deploys a one-click template by slug (mirrors
// handleDeployFromTemplate, minus the HTTP plumbing). Missing required secrets
// come back as needs_setup so the agent can ask the user for them.
func (s *Server) agentDeployTemplate(ctx context.Context, u *auth.AuthenticatedUser, slug, subdomain string, env map[string]string) string {
	slug = strings.TrimSpace(slug)
	t, err := s.db.GetTemplate(ctx, slug, u.ID)
	if err != nil || t == nil {
		return jsonStr(map[string]any{"error": "no template with that slug — call list_templates first"})
	}
	// Plan gate (admins bypass).
	if rank := templatePlanRank(t.RequiredPlan); rank > 0 {
		if isAdmin, _ := s.db.IsUserAdmin(ctx, u.ID); !isAdmin {
			user, _ := s.db.GetUserByID(ctx, u.ID)
			cur := 0
			if user != nil {
				cur = templatePlanRank(user.Plan)
			}
			if cur < rank {
				return jsonStr(map[string]any{"error": "plan_required", "note": "This template needs the " + t.RequiredPlan + " plan or higher."})
			}
		}
	}
	// Required secrets the user hasn't supplied → ask for them.
	var missing []string
	for _, ev := range t.EnvVars {
		if ev.Required && ev.Type != "auto" {
			if v, ok := env[ev.Key]; !ok || v == "" {
				missing = append(missing, ev.Key)
			}
		}
	}
	if len(missing) > 0 {
		return jsonStr(map[string]any{"status": "needs_setup", "template": t.Slug, "needs_secrets": missing,
			"note": "Ask the user for these secret value(s), then call deploy_template again with them in env."})
	}

	name := t.Name
	if subdomain == "" {
		subdomain = name
	}
	subdomain = s.uniqueSubdomain(ctx, subdomain, u.ID)
	project, err := s.db.CreateProject(ctx, u.ID, name, subdomain, "docker")
	if err != nil || project == nil {
		return jsonStr(map[string]any{"error": "could not create project"})
	}
	if t.MinMemoryMB > 0 {
		s.db.SetProjectMemory(ctx, project.ID, t.MinMemoryMB)
	}
	merged := map[string]string{}
	for _, sc := range t.EnvVars {
		if sc.Default != "" {
			merged[sc.Key] = sc.Default
		}
	}
	for k, v := range env {
		if v != "" {
			merged[k] = v
		}
	}
	// Auto-inject env vars the template declares as type "auto" — same as the
	// dashboard deploy path. The VPN-panel template needs a freshly-minted,
	// per-deployment TUNNELTWEAK_API_KEY (+ base URL); without this the panel
	// container fails its health check demanding the key.
	if templateWantsEnv(t.EnvVars, "TUNNELTWEAK_API_KEY") && merged["TUNNELTWEAK_API_KEY"] == "" {
		if key, err := s.mintPanelKey(ctx, "deployzy-"+subdomain); err == nil && key != "" {
			merged["TUNNELTWEAK_API_KEY"] = key
			if base := s.vpnBaseURL(ctx); base != "" && merged["TUNNELTWEAK_BASE_URL"] == "" {
				merged["TUNNELTWEAK_BASE_URL"] = base
			}
		} else if err != nil {
			s.log.Error().Err(err).Str("project", project.ID).Msg("agent template: vpn key mint failed")
		}
	}
	if len(merged) > 0 {
		s.db.UpdateProjectEnvVars(ctx, project.ID, merged)
		project.EnvVars = merged
	}
	if t.DockerImage != nil && *t.DockerImage != "" && isSafeImageRef(*t.DockerImage) {
		s.db.SetProjectSource(ctx, project.ID, "image", *t.DockerImage)
		project.DeploySource = "image"
		project.ImageRef = *t.DockerImage
	} else if t.SourceRepo != nil && *t.SourceRepo != "" && isSafeRepoURL(*t.SourceRepo) {
		s.db.UpdateProjectConfig(ctx, project.ID, *t.SourceRepo, "main", "", "", merged)
		project.RepoURL = *t.SourceRepo
		project.Branch = "main"
	}
	s.db.ReserveSubdomainAuto(ctx, u.ID, subdomain)
	go s.db.IncrementTemplateDeployCount(context.Background(), t.ID)
	go func(p db.Project) { _ = s.deployer.Deploy(context.Background(), &p) }(*project)
	return jsonStr(map[string]any{"status": "deploying", "project": subdomain, "template": t.Slug,
		"url": fmt.Sprintf("https://%s.%s", subdomain, s.deployer.AppDomain)})
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
	if s.agentKey(r.Context()) == "" || s.deployer == nil {
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
	// Guardrails: rate-limit + moderate the latest user message.
	if !s.checkAIRate(w, r, u.ID) {
		return
	}
	if last := lastUserMsg(req.Messages); last != "" {
		if reason := moderatePrompt(last); reason != "" {
			writeJSON(w, http.StatusOK, map[string]any{"reply": reason, "steps": []any{}})
			return
		}
	}
	if err := billing.EnsureAICredits(r.Context(), s.db, u); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}
	bctx := withAIBill(r.Context(), u, "agent", "")

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
	builtOnce := false // one new project per turn — never let the model spawn duplicates

	for i := 0; i < agentMaxSteps; i++ {
		resp, err := s.deepseekAgentCall(bctx, msgs)
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
			var result string
			creates := tc.Name == "build_project" || tc.Name == "deploy_github" || tc.Name == "deploy_template"
			if creates && builtOnce {
				// Refuse a second project-creating call in the same turn WITHOUT
				// executing it — otherwise the model spawns duplicate projects.
				result = jsonStr(map[string]any{"error": "already_built", "note": "You already created/deployed a project for this request in this turn. Do NOT call build_project or deploy_github again — a single request is ONE project. Stop and give the user the URL you already have."})
			} else {
				result = s.runAgentTool(bctx, u, tc.Name, args)
				if creates && !strings.Contains(result, `"error"`) {
					builtOnce = true
				}
			}
			steps = append(steps, step{Tool: tc.Name, Args: tc.Args, Result: result})
			msgs = append(msgs, map[string]any{"role": "tool", "tool_call_id": tc.ID, "content": result})
		}
	}
	// ran out of steps — ask model for a final summary with what it has
	msgs = append(msgs, map[string]any{"role": "user", "content": "Summarize what you found/did for me now, concisely."})
	resp, _ := s.deepseekAgentCall(bctx, msgs)
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
	p := s.llm(ctx)
	body, _ := json.Marshal(map[string]any{
		"model":       p.Model,
		"messages":    msgs,
		"tools":       agentTools,
		"temperature": 0.4,
		"max_tokens":  4000,
	})
	reqCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	httpReq, _ := http.NewRequestWithContext(reqCtx, http.MethodPost, p.chatURL(), bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.Key)
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
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("empty completion")
	}
	s.chargeUsage(ctx, p.Model, out.Usage.PromptTokens, out.Usage.CompletionTokens)
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

// lastUserMsg returns the most recent user message text from an agent request.
func lastUserMsg(msgs []struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			return msgs[i].Content
		}
	}
	return ""
}
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
