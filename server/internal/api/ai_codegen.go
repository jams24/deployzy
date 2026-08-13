package api

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
)

// ── Full code-generation path ────────────────────────────────────────────────
// Unlike the schema-fill generators (portfolio/landing), these ask DeepSeek to
// write REAL, unique TypeScript/Python code (APIs, microservices, bots), then
// deploy it via the app's Dockerfile and — the key feature — self-repair from
// the build logs if it fails.

const maxCodegenFiles = 30
const maxCodegenBytes = 220 * 1024 // total generated source budget
const maxRepairRounds = 2

type codegenFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}
type codegenEnv struct {
	Key         string `json:"key"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}
type codegenResult struct {
	Language     string        `json:"language"`
	Name         string        `json:"name"`
	Summary      string        `json:"summary"`
	Port         int           `json:"port"`
	EnvVars      []codegenEnv  `json:"env_vars"`
	Files        []codegenFile `json:"files"`
	NeedsDatabase bool         `json:"needs_database"`
	DatabaseType  string       `json:"database_type"` // postgres|redis|mongodb|mysql
}

// The contract DeepSeek MUST follow. Grounds it in how Deployzy builds and runs
// things, restricts the language surface, and forbids hardcoded secrets.
const codegenContract = `You are Deployzy's senior engineer. Build a SMALL, COMPLETE, WORKING backend service or bot that deploys on Deployzy with zero manual steps.

OUTPUT: return ONLY one JSON object, no markdown, no code fences, with EXACTLY this shape:
{
  "language": "typescript" | "python",
  "name": "short-kebab-name",
  "summary": "one sentence describing what it does",
  "port": 3000,
  "needs_database": false,
  "database_type": "postgres",
  "env_vars": [ { "key": "SOME_KEY", "description": "what it's for", "required": true } ],
  "files": [ { "path": "relative/path", "content": "full file contents" } ]
}

HARD RULES:
- Language MUST be "typescript" (Node) or "python". Pick the best fit. Default TypeScript for HTTP APIs/microservices; Python is great for data/trading/ML; either for bots.
- You MUST include a Dockerfile in files that builds and runs the app with no manual steps, using a slim base (node:20-slim or python:3.12-slim). Keep the toolchain simple and reliable.
- Include a real dependency manifest: package.json (TypeScript) or requirements.txt (Python), with REAL, existing, pinned versions. Do not invent packages.
- HTTP APIs / microservices: listen on 0.0.0.0, read the PORT env var, default 3000, and EXPOSE 3000 in the Dockerfile.
- Bots (Telegram/Discord) and workers: no HTTP port needed; the Dockerfile just runs the long-lived process (use polling for bots, not webhooks).
- ALL secrets and third-party API keys come from environment variables and MUST be declared in env_vars (e.g. TELEGRAM_BOT_TOKEN, DISCORD_TOKEN, OPENAI_API_KEY). NEVER hardcode a secret or invent a fake key. Read them with process.env / os.environ.
- DATABASE: if the app needs persistent storage, set "needs_database": true and pick "database_type" (default "postgres"; or "redis"/"mongodb"/"mysql"). Read the connection string from the DATABASE_URL env var (or REDIS_URL for redis) — the platform provisions the database and injects that variable for you. Do NOT declare DATABASE_URL/REDIS_URL in env_vars, and do NOT hardcode a connection string. If no storage is needed, set "needs_database": false.
- Only relative file paths (e.g. "src/index.ts", "Dockerfile", "requirements.txt"). No absolute paths, no "..".
- Write complete, runnable code. No TODOs, no "// implement this", no placeholders that break the build.
- Do NOT do anything privileged, no host mounts, no crypto mining, no spam/abuse tooling. Refuse (return an empty files array with a summary explaining why) if the request is for phishing, spam, malware, or a bot that places real financial trades — for trading, build SIGNALS/ALERTS (read-only), never order execution.

DEPLOYZY RUNTIME:
- We build your Dockerfile exactly as written and run the container on a worker.
- The env_vars you declare are injected at runtime.
- HTTP services become available at https://<name>.deployzy.app once they listen on the port.
- stdout/stderr are streamed to the user as logs.`

// deepseekCodegen asks DeepSeek to generate the project. temperature is low for
// code determinism; the output is validated by the caller.
func (s *Server) deepseekCodegen(ctx context.Context, key, userPrompt string) (*codegenResult, error) {
	return s.deepseekCodeCall(ctx, key, []map[string]string{
		{"role": "system", "content": codegenContract},
		{"role": "user", "content": userPrompt},
	})
}

// deepseekRepair sends the failing build logs + current files back and asks for
// a corrected file set. This is the self-debugging loop.
func (s *Server) deepseekRepair(ctx context.Context, key, userPrompt string, files map[string]string, logs string) (*codegenResult, error) {
	var b strings.Builder
	b.WriteString("The build or run FAILED. Fix it. Here are the current files, then the build logs.\n\nCURRENT FILES:\n")
	for p, c := range files {
		b.WriteString("=== " + p + " ===\n" + c + "\n\n")
	}
	b.WriteString("BUILD LOGS (most recent):\n" + logs + "\n\nReturn the SAME JSON shape with corrected files that fix the error. Change only what's needed. Keep all working files.")
	return s.deepseekCodeCall(ctx, key, []map[string]string{
		{"role": "system", "content": codegenContract},
		{"role": "user", "content": "Original request: " + userPrompt},
		{"role": "assistant", "content": "(previous attempt failed)"},
		{"role": "user", "content": b.String()},
	})
}

// deepseekEdit sends the current files + a change request and asks for the
// updated file set. This is how the AI edits an already-deployed project.
func (s *Server) deepseekEdit(ctx context.Context, key, origPrompt string, files map[string]string, instruction string) (*codegenResult, error) {
	var b strings.Builder
	b.WriteString("Here are the CURRENT files of a working, already-deployed app:\n\n")
	for p, c := range files {
		b.WriteString("=== " + p + " ===\n" + c + "\n\n")
	}
	b.WriteString("The user wants this change:\n" + instruction + "\n\nReturn the SAME JSON shape with the FULL updated file set. Keep everything that still works, change only what's needed for this request. If the change needs a new secret, declare it in env_vars; if it needs storage, set needs_database.")
	return s.deepseekCodeCall(ctx, key, []map[string]string{
		{"role": "system", "content": codegenContract},
		{"role": "user", "content": "This app was originally: " + origPrompt},
		{"role": "user", "content": b.String()},
	})
}

func (s *Server) deepseekCodeCall(ctx context.Context, key string, messages []map[string]string) (*codegenResult, error) {
	body, _ := json.Marshal(map[string]any{
		"model":           "deepseek-chat",
		"messages":        messages,
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0.3,
		"max_tokens":      8000,
	})
	reqCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	httpReq, _ := http.NewRequestWithContext(reqCtx, http.MethodPost, "https://api.deepseek.com/chat/completions", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+key)
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
			Message struct{ Content string `json:"content"` } `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("empty completion")
	}
	var res codegenResult
	if err := json.Unmarshal([]byte(out.Choices[0].Message.Content), &res); err != nil {
		return nil, fmt.Errorf("model returned invalid JSON: %w", err)
	}
	return &res, nil
}

// validateCodegen enforces the guardrails on generated output.
func validateCodegen(res *codegenResult) error {
	if res.Language != "typescript" && res.Language != "python" {
		return fmt.Errorf("unsupported language %q (only typescript or python)", res.Language)
	}
	if len(res.Files) == 0 {
		return fmt.Errorf("the request was refused or produced no files: %s", res.Summary)
	}
	if len(res.Files) > maxCodegenFiles {
		return fmt.Errorf("too many files (%d)", len(res.Files))
	}
	total := 0
	hasDockerfile := false
	for _, f := range res.Files {
		p := strings.TrimSpace(f.Path)
		if p == "" || strings.HasPrefix(p, "/") || strings.Contains(p, "..") {
			return fmt.Errorf("unsafe file path: %q", f.Path)
		}
		if p == "Dockerfile" {
			hasDockerfile = true
		}
		total += len(f.Content)
	}
	if !hasDockerfile {
		return fmt.Errorf("generated project has no Dockerfile")
	}
	if total > maxCodegenBytes {
		return fmt.Errorf("generated source too large (%d bytes)", total)
	}
	return nil
}

// stageCodegenFiles writes an arbitrary file set as the upload build context.
func stageCodegenFiles(projectID string, files []codegenFile) error {
	if err := os.MkdirAll("/tmp/serverme-uploads", 0o755); err != nil {
		return err
	}
	f, err := os.Create(fmt.Sprintf("/tmp/serverme-uploads/%s.tar.gz", projectID))
	if err != nil {
		return err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	for _, file := range files {
		data := []byte(file.Content)
		if err := tw.WriteHeader(&tar.Header{Name: file.Path, Mode: 0o644, Size: int64(len(data)), ModTime: time.Now()}); err != nil {
			return err
		}
		if _, err := tw.Write(data); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

// readStagedFiles reads the currently-staged build context back into memory
// (used by the repair loop after a needs-env deploy).
func readStagedFiles(projectID string) (map[string]string, error) {
	f, err := os.Open(fmt.Sprintf("/tmp/serverme-uploads/%s.tar.gz", projectID))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	tr := tar.NewReader(gz)
	out := map[string]string{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		data, _ := io.ReadAll(tr)
		out[h.Name] = string(data)
	}
	return out, nil
}

// buildCodegen runs the full code-gen flow. Called from handleAIBuild when the
// generator is a code-gen kind.
func (s *Server) buildCodegen(w http.ResponseWriter, r *http.Request, u *auth.AuthenticatedUser, kind, prompt string, providedEnv map[string]string, wantSub string) {
	key := os.Getenv("DEEPSEEK_API_KEY")

	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimProject); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	// 1) generate code
	res, err := s.deepseekCodegen(r.Context(), key, kind+" — "+prompt)
	if err != nil {
		s.log.Error().Err(err).Msg("codegen: generation failed")
		writeError(w, http.StatusBadGateway, "code generation failed, please try again")
		return
	}
	if err := validateCodegen(res); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "couldn't build that: "+err.Error())
		return
	}

	// 2) which required env vars is the user missing?
	var missing []codegenEnv
	for _, ev := range res.EnvVars {
		if ev.Required && strings.TrimSpace(providedEnv[ev.Key]) == "" {
			missing = append(missing, ev)
		}
	}

	// 3) create project + stage the generated files
	sub := wantSub
	if sub == "" {
		sub = res.Name
	}
	if sanitizeSubdomain(sub) == "site" { // model gave no usable name — derive from the summary
		words := strings.Fields(strings.ToLower(res.Summary))
		if len(words) > 3 {
			words = words[:3]
		}
		if len(words) > 0 {
			sub = strings.Join(words, "-")
		}
	}
	sub = s.freeSubdomain(r.Context(), sub)
	project, err := s.db.CreateProject(r.Context(), u.ID, sub, sub, "docker")
	if err != nil || project == nil {
		s.log.Error().Err(err).Str("sub", sub).Str("name", res.Name).Msg("codegen: CreateProject failed")
		writeError(w, http.StatusInternalServerError, "could not create project")
		return
	}
	s.db.SetProjectSource(r.Context(), project.ID, "upload", "")
	project.DeploySource = "upload"
	s.db.ReserveSubdomainAuto(r.Context(), u.ID, sub)
	if len(providedEnv) > 0 {
		s.db.UpdateProjectEnvVars(r.Context(), project.ID, providedEnv)
		if fresh, _ := s.db.GetProject(r.Context(), project.ID); fresh != nil {
			project = fresh
		}
	}
	if err := stageCodegenFiles(project.ID, res.Files); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stage build")
		return
	}

	url := fmt.Sprintf("https://%s.%s", sub, s.deployer.AppDomain)

	// 4) if the service needs secrets or a database, pause and ask the user
	//    (permission-request style). Nothing deploys until they confirm.
	if len(missing) > 0 || res.NeedsDatabase {
		dbType := ""
		if res.NeedsDatabase {
			dbType = res.DatabaseType
			if dbType == "" {
				dbType = "postgres"
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "needs_setup",
			"project":       project,
			"url":           url,
			"language":      res.Language,
			"summary":       res.Summary,
			"env_vars":      missing,
			"needs_database": res.NeedsDatabase,
			"database_type": dbType,
		})
		return
	}

	// 5) deploy + self-repair in the background
	files := map[string]string{}
	for _, f := range res.Files {
		files[f.Path] = f.Content
	}
	go s.deployWithRepair(project, files, prompt)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":   "deploying",
		"project":  project,
		"url":      url,
		"language": res.Language,
		"summary":  res.Summary,
	})
}

// handleAIDeploy finishes a needs_env code-gen build: sets the env the user
// supplied, then deploys the already-staged files with the repair loop.
func (s *Server) handleAIDeploy(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var req struct {
		ProjectID string            `json:"project_id"`
		Prompt    string            `json:"prompt"`
		Env       map[string]string `json:"env"`
		Database  string            `json:"database"` // "", "postgres", "redis", "mongodb", "mysql"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ProjectID == "" {
		writeError(w, http.StatusBadRequest, "project_id required")
		return
	}
	project, _ := s.db.GetProject(r.Context(), req.ProjectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	env := map[string]string{}
	for k, v := range req.Env {
		env[k] = v
	}
	// Provision a database if requested, and inject its connection URL so the
	// generated app (which reads DATABASE_URL/REDIS_URL) just works.
	if req.Database != "" {
		key, url, err := s.provisionDBForBuild(r.Context(), project, req.Database)
		if err != nil {
			s.log.Error().Err(err).Str("project", project.ID).Msg("ai deploy: db provision failed")
			writeError(w, http.StatusBadGateway, "couldn't create the database: "+err.Error())
			return
		}
		env[key] = url
		s.db.AddDeployLog(r.Context(), project.ID, fmt.Sprintf("🗄️  Provisioned a %s database and injected %s", req.Database, key), "deploy")
	}
	if len(env) > 0 {
		s.db.UpdateProjectEnvVars(r.Context(), project.ID, env)
		// Reload so project.EnvVars is fresh — the deploy engine injects env from
		// the struct, not a re-fetch, so a stale struct would drop DATABASE_URL etc.
		if fresh, _ := s.db.GetProject(r.Context(), project.ID); fresh != nil {
			project = fresh
		}
	}
	files, err := readStagedFiles(project.ID)
	if err != nil {
		writeError(w, http.StatusConflict, "no staged build found — generate again")
		return
	}
	go s.deployWithRepair(project, files, req.Prompt)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "deploying"})
}

// provisionDBForBuild creates a managed database for a code-gen project and
// returns the env var (DATABASE_URL / REDIS_URL) + connection string to inject.
// It co-locates the DB on the same worker the app will run on so the connection
// works (co-located reachability is opened by the UFW rule on DB provision).
func (s *Server) provisionDBForBuild(ctx context.Context, project *db.Project, dbType string) (string, string, error) {
	valid := map[string]bool{"postgres": true, "redis": true, "mongodb": true, "mysql": true}
	if !valid[dbType] {
		return "", "", fmt.Errorf("unsupported database %q", dbType)
	}
	// Ensure the project has a server, then put the DB on that same server.
	if project.WorkerServerID == "" {
		if srv, _ := s.db.SelectServerForProject(ctx, nil); srv != nil {
			s.db.AssignProjectServer(ctx, project.ID, srv.ID)
			project.WorkerServerID = srv.ID
		}
	}
	name := project.Subdomain + "-db"
	var svc *db.Service
	var err error
	if project.WorkerServerID != "" {
		server, gerr := s.db.GetWorkerServer(ctx, project.WorkerServerID)
		if gerr != nil || server == nil {
			return "", "", fmt.Errorf("server unavailable")
		}
		if server.IsLocal && dbType == "postgres" {
			svc, err = s.db.CreateService(ctx, project.UserID, name, "postgres")
		} else {
			svc, err = s.provisionServiceContainerOn(ctx, project.UserID, name, dbType, server)
		}
	} else if dbType == "postgres" {
		svc, err = s.db.CreateService(ctx, project.UserID, name, "postgres")
	} else {
		svc, err = s.provisionPlatformContainer(ctx, project.UserID, name, dbType)
	}
	if err != nil {
		return "", "", err
	}
	key := "DATABASE_URL"
	if dbType == "redis" {
		key = "REDIS_URL"
	}
	return key, svc.ConnectionURL(), nil
}

// handleAIEdit lets the AI modify an already-deployed code-gen project: load its
// current files, apply the requested change, restage, and redeploy (with repair).
func (s *Server) handleAIEdit(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var req struct {
		ProjectID   string `json:"project_id"`
		Instruction string `json:"instruction"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ProjectID == "" || strings.TrimSpace(req.Instruction) == "" {
		writeError(w, http.StatusBadRequest, "project_id and instruction are required")
		return
	}
	if len(req.Instruction) > 1500 {
		writeError(w, http.StatusBadRequest, "instruction too long")
		return
	}
	project, _ := s.db.GetProject(r.Context(), req.ProjectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	key := os.Getenv("DEEPSEEK_API_KEY")
	if key == "" || s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "AI builder isn't available")
		return
	}
	files, err := readStagedFiles(project.ID)
	if err != nil || len(files) == 0 {
		writeError(w, http.StatusConflict, "this project has no AI-editable source")
		return
	}
	res, err := s.deepseekEdit(r.Context(), key, req.Instruction, files, req.Instruction)
	if err != nil {
		s.log.Error().Err(err).Msg("ai edit: generation failed")
		writeError(w, http.StatusBadGateway, "couldn't apply that change, please try again")
		return
	}
	if err := validateCodegen(res); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "couldn't apply that: "+err.Error())
		return
	}
	if err := stageCodegenFiles(project.ID, res.Files); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stage the change")
		return
	}
	newFiles := map[string]string{}
	for _, f := range res.Files {
		newFiles[f.Path] = f.Content
	}
	s.db.AddDeployLog(r.Context(), project.ID, "🤖 Applying your change and redeploying…", "build")
	go s.deployWithRepair(project, newFiles, req.Instruction)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":  "deploying",
		"project": project,
		"summary": res.Summary,
		"url":     fmt.Sprintf("https://%s.%s", project.Subdomain, s.deployer.AppDomain),
	})
}

// deployWithRepair deploys and, if the build fails, sends the logs + files back
// to DeepSeek for a fix, up to maxRepairRounds. This is the self-debugging loop.
func (s *Server) deployWithRepair(project *db.Project, files map[string]string, prompt string) {
	key := os.Getenv("DEEPSEEK_API_KEY")
	ctx := context.Background()

	for round := 0; ; round++ {
		err := s.deployer.Deploy(ctx, project)
		if err == nil {
			return // success
		}
		if round >= maxRepairRounds || key == "" {
			s.log.Error().Err(err).Str("project", project.ID).Msg("codegen: deploy failed, out of repair rounds")
			return
		}
		s.db.AddDeployLog(ctx, project.ID, fmt.Sprintf("🤖 Build failed — AI is analysing the logs and attempting a fix (attempt %d/%d)…", round+1, maxRepairRounds), "build")

		// gather recent logs (the streamed build output lives in deploy_logs)
		logs, _ := s.db.GetDeployLogs(ctx, project.ID, 60)
		var lb strings.Builder
		for i := len(logs) - 1; i >= 0; i-- { // oldest first
			lb.WriteString(logs[i].Message + "\n")
		}

		repaired, rerr := s.deepseekRepair(ctx, key, prompt, files, tailString(lb.String(), 6000))
		if rerr != nil || validateCodegen(repaired) != nil {
			s.log.Error().Err(rerr).Str("project", project.ID).Msg("codegen: repair generation failed")
			return
		}
		newFiles := map[string]string{}
		for _, f := range repaired.Files {
			newFiles[f.Path] = f.Content
		}
		files = newFiles
		if err := stageCodegenFiles(project.ID, repaired.Files); err != nil {
			return
		}
		s.db.AddDeployLog(ctx, project.ID, "🤖 Applied a fix — redeploying…", "build")
	}
}

func tailString(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "…\n" + s[len(s)-n:]
}
