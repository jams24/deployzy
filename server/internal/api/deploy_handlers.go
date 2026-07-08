package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
)

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Name           string `json:"name"`
		Subdomain      string `json:"subdomain"`
		Framework      string `json:"framework"`
		RepoURL        string `json:"repo_url"`
		Branch         string `json:"branch"`
		GitHubRepo     string `json:"github_repo"`
		WorkerServerID string `json:"worker_server_id"`
		// Deploy source: "git" (default), "image" (prebuilt registry image), or
		// "upload" (tarball pushed via /upload before deploy).
		DeploySource   string `json:"deploy_source"`
		Image          string `json:"image"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.Subdomain == "" {
		writeError(w, http.StatusBadRequest, "name and subdomain required")
		return
	}

	// Resolve + validate the deploy source. An "image" ref is interpolated into
	// `docker pull`/`docker run`, so reject shell metacharacters and whitespace.
	if req.DeploySource == "" {
		if req.Image != "" {
			req.DeploySource = "image"
		} else {
			req.DeploySource = "git"
		}
	}
	switch req.DeploySource {
	case "git", "upload":
	case "image":
		if req.Image == "" {
			writeError(w, http.StatusBadRequest, "image is required when deploy_source is 'image'")
			return
		}
		if !isSafeImageRef(req.Image) {
			writeError(w, http.StatusBadRequest, "image must be a valid registry reference (e.g. nginx:alpine or ghcr.io/you/app:1.2)")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "deploy_source must be 'git', 'image', or 'upload'")
		return
	}

	if req.Framework == "" {
		req.Framework = "node"
	}
	if req.Branch == "" {
		req.Branch = "main"
	}

	// Validate repo_url so it can't be used for SSRF (file://, ssh://, ...)
	// or for git argument injection (a URL starting with '-' is parsed by git
	// as a CLI flag like --upload-pack=cmd, which is a known RCE class).
	if req.RepoURL != "" && !isSafeRepoURL(req.RepoURL) {
		writeError(w, http.StatusBadRequest, "repo_url must be a plain https:// GitHub URL")
		return
	}
	if req.Branch != "" && !isSafeBranchName(req.Branch) {
		writeError(w, http.StatusBadRequest, "branch contains invalid characters")
		return
	}

	// Plan limit: max projects.
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimProject); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}
	// Plan limit: BYOC server requires a paid plan.
	if req.WorkerServerID != "" {
		// User picked a specific BYOC server — they can only do so if they
		// already own one (which means they passed the BYOC limit check earlier).
		// No extra check needed here.
		_ = req
	}

	// Check subdomain availability
	available, reason := s.db.CheckSubdomainAvailable(r.Context(), req.Subdomain, u.ID)
	if !available {
		writeError(w, http.StatusConflict, reason)
		return
	}

	project, err := s.db.CreateProject(r.Context(), u.ID, req.Name, req.Subdomain, req.Framework)
	if err != nil {
		// If the user already has a project with this subdomain, return it
		existing, _ := s.db.GetProjectBySubdomain(r.Context(), req.Subdomain)
		if existing != nil && existing.UserID == u.ID {
			project = existing
		} else {
			writeError(w, http.StatusConflict, "subdomain already taken")
			return
		}
	}

	// If repo info was provided, set it immediately
	if req.RepoURL != "" {
		s.db.UpdateProjectConfig(r.Context(), project.ID, req.RepoURL, req.Branch, "", "", nil)
		project.RepoURL = req.RepoURL
		project.Branch = req.Branch
	}
	if req.GitHubRepo != "" {
		s.db.UpdateProjectGitHub(r.Context(), project.ID, req.GitHubRepo, req.Branch, true)
		// Auto-register webhook for auto-deploy. Webhook creation is a
		// user-scope action; installation tokens only cover repos where the
		// app is installed with admin:write, so user OAuth is more reliable.
		if s.deployer != nil && s.deployer.GitHub != nil {
			if token, ok := s.bestUserGitHubToken(r.Context(), u.ID); ok {
				webhookURL := fmt.Sprintf("https://api.%s/api/v1/github/webhook", s.deployer.Domain)
				s.deployer.GitHub.EnsureWebhook(token, req.GitHubRepo, webhookURL)
			}
		}
	}

	// Assign worker server if specified, or auto-select. Validate ownership
	// first — a user can only target their own BYOC server or a platform
	// (user_id=NULL) server. Without this check a user could drop their
	// project onto another user's BYOC box and read their env vars /
	// container filesystem.
	if req.WorkerServerID != "" {
		ws, _ := s.db.GetWorkerServer(r.Context(), req.WorkerServerID)
		if ws == nil {
			writeError(w, http.StatusBadRequest, "worker server not found")
			return
		}
		if ws.UserID != nil && *ws.UserID != u.ID {
			writeError(w, http.StatusForbidden, "you don't own that worker server")
			return
		}
		s.db.AssignProjectServer(r.Context(), project.ID, req.WorkerServerID)
		project.WorkerServerID = req.WorkerServerID
	}

	// Record the deploy source (image/upload/git). Default 'git' is already the
	// column default, so only persist when it differs or carries an image ref.
	if req.DeploySource != "git" || req.Image != "" {
		if err := s.db.SetProjectSource(r.Context(), project.ID, req.DeploySource, req.Image); err != nil {
			s.log.Error().Err(err).Str("project", project.ID).Msg("set deploy source failed")
		} else {
			project.DeploySource = req.DeploySource
			project.ImageRef = req.Image
		}
	}

	// Auto-reserve the subdomain so no tunnel can use it
	s.db.ReserveSubdomainAuto(r.Context(), u.ID, req.Subdomain)

	writeJSON(w, http.StatusCreated, project)
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	projects, err := s.db.ListProjects(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}
	if projects == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, err := s.db.GetProject(r.Context(), projectID)
	if err != nil || project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	logs, _ := s.db.GetDeployLogs(r.Context(), projectID, 50)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"project": project,
		"logs":    logs,
	})
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var req struct {
		RepoURL    string            `json:"repo_url"`
		Branch     string            `json:"branch"`
		BuildCmd   string            `json:"build_cmd"`
		StartCmd   string            `json:"start_cmd"`
		EnvVars    map[string]string `json:"env_vars"`
		GitHubRepo string            `json:"github_repo"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// Only update env vars if that's all that was sent
	if req.EnvVars != nil && req.RepoURL == "" && req.GitHubRepo == "" {
		s.db.UpdateProjectEnvVars(r.Context(), projectID, req.EnvVars)
	} else {
		// Full config update — preserve existing values for empty fields
		if req.Branch == "" {
			req.Branch = project.Branch
		}
		if req.RepoURL == "" {
			req.RepoURL = project.RepoURL
		}
		if req.EnvVars == nil {
			req.EnvVars = project.EnvVars
		}

		s.db.UpdateProjectConfig(r.Context(), projectID, req.RepoURL, req.Branch, req.BuildCmd, req.StartCmd, req.EnvVars)

		if req.GitHubRepo != "" {
			s.db.UpdateProjectGitHub(r.Context(), projectID, req.GitHubRepo, req.Branch, true)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// handleUpdateBuildConfig updates the advanced build settings for a project.
// serviceNameRe restricts service names to DNS-safe labels — they're used both
// as a sibling subdomain (<projectsub>-<name>.domain) and interpolated into the
// generated supervisor script, so anything outside [a-z0-9-] is rejected.
var serviceNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,29}$`)

const maxServices = 5

// validateServices normalises and validates the multi-service config. Returns
// the cleaned slice (never nil) and an error message ("" = ok). It enforces:
// DNS-safe unique names, unique in-range ports, and path-safe directories —
// the directory and commands are interpolated into a shell build script, so
// directories must be free of traversal / shell metacharacters.
func validateServices(in []db.ProjectService) ([]db.ProjectService, string) {
	out := make([]db.ProjectService, 0, len(in))
	if len(in) == 0 {
		return out, ""
	}
	if len(in) > maxServices {
		return nil, fmt.Sprintf("a project can have at most %d services", maxServices)
	}
	seenName := map[string]bool{}
	seenPort := map[int]bool{}
	for _, svc := range in {
		name := strings.ToLower(strings.TrimSpace(svc.Name))
		if !serviceNameRe.MatchString(name) {
			return nil, "service name must be lowercase letters, numbers, and hyphens (e.g. api)"
		}
		if seenName[name] {
			return nil, "service names must be unique"
		}
		seenName[name] = true

		if svc.Port < 1 || svc.Port > 65535 {
			return nil, "service port must be 1-65535"
		}
		if seenPort[svc.Port] {
			return nil, "service ports must be unique"
		}
		seenPort[svc.Port] = true

		dir := strings.TrimSpace(svc.RootDir)
		if strings.Contains(dir, "..") || strings.HasPrefix(dir, "/") || strings.ContainsAny(dir, ";|&`$()") {
			return nil, "service base directory must be a relative path inside the repo"
		}

		out = append(out, db.ProjectService{
			Name:         name,
			RootDir:      strings.Trim(dir, "/"),
			Port:         svc.Port,
			InstallCmd:   strings.TrimSpace(svc.InstallCmd),
			BuildCmd:     strings.TrimSpace(svc.BuildCmd),
			StartCmd:     strings.TrimSpace(svc.StartCmd),
			Framework:    strings.TrimSpace(svc.Framework),
			EnvOverrides: svc.EnvOverrides,
		})
	}
	return out, ""
}

// Distinct endpoint from handleUpdateProject so users can tweak build knobs
// without also having to re-send repo_url / branch / env_vars.
func (s *Server) handleUpdateBuildConfig(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var req struct {
		InstallCmd      string  `json:"install_cmd"`
		BuildCmd        string  `json:"build_cmd"`
		StartCmd        string  `json:"start_cmd"`
		RootDir         string  `json:"root_dir"`
		NodeVersion     string  `json:"node_version"`
		PortOverride    int     `json:"port_override"`
		MemoryMB        int     `json:"memory_mb"`
		CPUs            float64 `json:"cpus"`
		HealthCheckPath string  `json:"health_check_path"`
		ReleaseCmd      string  `json:"release_cmd"`
		BuildMode       string  `json:"build_mode"`
		DockerfilePath  string  `json:"dockerfile_path"`
		// Pointer so we can tell "not sent" (preserve existing services) from
		// "sent as []" (clear services). The per-project build editor omits this
		// field; the import/multi-service form sends it explicitly.
		Services        *[]db.ProjectService `json:"services"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	services := project.Services // preserve existing unless the request sets them
	if req.Services != nil {
		var svcErr string
		services, svcErr = validateServices(*req.Services)
		if svcErr != "" {
			writeError(w, http.StatusBadRequest, svcErr)
			return
		}
	}

	// Basic sanity clamps so a bad input can't crash docker run
	if req.PortOverride < 0 || req.PortOverride > 65535 {
		writeError(w, http.StatusBadRequest, "port_override must be 0-65535")
		return
	}
	if req.MemoryMB < 0 || req.MemoryMB > 16384 {
		writeError(w, http.StatusBadRequest, "memory_mb must be 0-16384")
		return
	}
	if req.CPUs < 0 || req.CPUs > 8 {
		writeError(w, http.StatusBadRequest, "cpus must be 0-8")
		return
	}
	// Only allow a small allowlist of node versions so users can't pass "; rm -rf /" as a tag
	if req.NodeVersion != "" {
		allowed := map[string]bool{"18": true, "20": true, "22": true}
		if !allowed[req.NodeVersion] {
			writeError(w, http.StatusBadRequest, "node_version must be 18, 20, or 22")
			return
		}
	}

	// Validate health check path: must start with / or be empty
	if req.HealthCheckPath != "" && !strings.HasPrefix(req.HealthCheckPath, "/") {
		writeError(w, http.StatusBadRequest, "health_check_path must start with /")
		return
	}
	// Validate build_mode: allowlist so the engine doesn't have to defend against junk
	if req.BuildMode != "" && req.BuildMode != "auto" && req.BuildMode != "ignore_dockerfile" {
		writeError(w, http.StatusBadRequest, "build_mode must be 'auto' or 'ignore_dockerfile'")
		return
	}
	// Prevent path traversal: dockerfile_path must be a bare filename or single-level relative path
	if req.DockerfilePath != "" {
		if strings.Contains(req.DockerfilePath, "..") || strings.HasPrefix(req.DockerfilePath, "/") || strings.ContainsAny(req.DockerfilePath, ";|&`$()") {
			writeError(w, http.StatusBadRequest, "dockerfile_path must be a relative filename (e.g. Dockerfile.bot)")
			return
		}
	}
	// Plan-gated features: only paid plans can use these.
	if req.HealthCheckPath != "" && !billing.IsFeatureAllowed(r.Context(), s.db, u, "health_checks") {
		writeError(w, http.StatusPaymentRequired, "health checks require a paid plan")
		return
	}
	if req.ReleaseCmd != "" && !billing.IsFeatureAllowed(r.Context(), s.db, u, "release_cmd") {
		writeError(w, http.StatusPaymentRequired, "release commands require a paid plan")
		return
	}

	err := s.db.UpdateProjectBuildConfig(r.Context(), projectID, db.BuildConfig{
		InstallCmd:      req.InstallCmd,
		BuildCmd:        req.BuildCmd,
		StartCmd:        req.StartCmd,
		RootDir:         req.RootDir,
		NodeVersion:     req.NodeVersion,
		PortOverride:    req.PortOverride,
		MemoryMB:        req.MemoryMB,
		CPUs:            req.CPUs,
		HealthCheckPath: req.HealthCheckPath,
		ReleaseCmd:      req.ReleaseCmd,
		BuildMode:       req.BuildMode,
		DockerfilePath:  req.DockerfilePath,
		Services:        services,
	})
	if err != nil {
		s.log.Error().Err(err).Str("project", projectID).Msg("update build config failed")
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// handleUpdateLabels sets the tag list for a project. Simple PUT with
// {"labels": ["prod","api"]} — full replacement semantics (easier to undo
// accidents than incremental add/remove).
func (s *Server) handleUpdateLabels(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var req struct {
		Labels []string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// Clean up: trim whitespace, lowercase, dedupe, cap length/count so a bad
	// client can't shove a megabyte of tags into a row.
	seen := map[string]bool{}
	cleaned := make([]string, 0, len(req.Labels))
	for _, l := range req.Labels {
		l = strings.ToLower(strings.TrimSpace(l))
		if l == "" || len(l) > 40 || seen[l] {
			continue
		}
		seen[l] = true
		cleaned = append(cleaned, l)
		if len(cleaned) >= 10 {
			break
		}
	}

	if err := s.db.UpdateProjectLabels(r.Context(), projectID, cleaned); err != nil {
		s.log.Error().Err(err).Str("project", projectID).Msg("update labels failed")
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"labels": cleaned})
}

// handleListPreviews returns all active preview deployments for a parent project.
func (s *Server) handleListPreviews(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	previews, err := s.db.ListPreviewsForParent(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list previews")
		return
	}
	if previews == nil {
		previews = []db.Project{}
	}
	writeJSON(w, http.StatusOK, previews)
}

// handleTogglePreviewEnabled flips the preview-deployments flag for a project.
// Off by default so users opt in.
func (s *Server) handleTogglePreviewEnabled(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	if err := s.db.UpdateProjectPreviewEnabled(r.Context(), projectID, req.Enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"preview_enabled": req.Enabled})
}

// isHexSHA gates commit_sha values before they reach a shell. Hex only,
// 7-64 chars (GitHub short SHAs are 7; full are 40; Git SHA-256 repos are 64).
var hexSHARe = regexp.MustCompile(`^[a-fA-F0-9]{7,64}$`)

func isHexSHA(s string) bool {
	return hexSHARe.MatchString(s)
}

// isSafeRepoURL blocks SSRF (file://, ssh://, git://) and git-flag injection
// (URL starting with '-'). Only public HTTPS URLs pointing at common git
// hosts pass. We deliberately allow any https:// for forward-compatibility
// with self-hosted GitLab/Gitea, but the leading-scheme check + no-leading-
// dash rule is the security-critical part.
var safeRepoRe = regexp.MustCompile(`^https://[a-zA-Z0-9][a-zA-Z0-9.\-/_@:]*$`)

func isSafeRepoURL(s string) bool {
	if strings.HasPrefix(s, "-") {
		return false
	}
	return safeRepoRe.MatchString(s)
}

// isSafeImageRef validates a container image reference (e.g. nginx:alpine,
// ghcr.io/you/app:1.2, registry.io:5000/ns/img@sha256:...). The ref is
// interpolated into `docker pull`/`docker run`, so only registry-safe chars
// are allowed and a leading '-' (flag injection) is rejected.
var safeImageRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]*$`)

func isSafeImageRef(s string) bool {
	if s == "" || strings.HasPrefix(s, "-") || len(s) > 255 {
		return false
	}
	return safeImageRe.MatchString(s)
}

// isSafeBranchName rejects anything that could escape into a shell context
// when the engine interpolates it into git / docker commands.
var safeBranchRe = regexp.MustCompile(`^[a-zA-Z0-9._/\-]+$`)

func isSafeBranchName(s string) bool {
	if strings.HasPrefix(s, "-") {
		return false
	}
	return len(s) <= 128 && safeBranchRe.MatchString(s)
}

// handleUploadProject stages a .tar.gz build context for an "upload" deploy
// source (used by `serverme deploy ./dir`). The body is the raw gzip'd tar.
// The next deploy untars it as the build context instead of cloning a repo.
func (s *Server) handleUploadProject(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	const maxUpload = 200 << 20 // 200 MB
	body := http.MaxBytesReader(w, r.Body, maxUpload)
	defer body.Close()

	if err := os.MkdirAll("/tmp/serverme-uploads", 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stage upload")
		return
	}
	// projectID is a validated, owned UUID (GetProject matched it), so it's safe
	// to interpolate into the staging path.
	tarPath := fmt.Sprintf("/tmp/serverme-uploads/%s.tar.gz", projectID)
	f, err := os.Create(tarPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stage upload")
		return
	}
	if _, err := io.Copy(f, body); err != nil {
		f.Close()
		os.Remove(tarPath)
		writeError(w, http.StatusBadRequest, "upload failed (too large or interrupted)")
		return
	}
	f.Close()

	if err := s.db.SetProjectSource(r.Context(), projectID, "upload", ""); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to set deploy source")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "uploaded"})
}

func (s *Server) handleDeployProject(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}

	// Optional: pin this deploy to a specific commit (for rollbacks / reverts).
	// Body is optional; ignore decode errors so existing callers that POST empty
	// bodies keep working.
	var body struct {
		CommitSHA string `json:"commit_sha"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.CommitSHA != "" {
		// Must be hex-only — the engine interpolates this into `git checkout`.
		if !isHexSHA(body.CommitSHA) {
			writeError(w, http.StatusBadRequest, "invalid commit sha")
			return
		}
		project.CommitSHA = body.CommitSHA
		// Persist so the logs show which commit is running even if the deploy crashes.
		s.db.UpdateProjectCommitSHA(r.Context(), projectID, body.CommitSHA)
	} else {
		// Clear any previous pin so we track HEAD of the branch.
		project.CommitSHA = ""
		s.db.UpdateProjectCommitSHA(r.Context(), projectID, "")
	}

	// For private repos, inject a fresh GitHub token into the clone URL.
	// bestGitHubToken auto-refreshes expired user tokens and re-uses the
	// cached installation token, so deploys don't fail the day after a
	// user connects GitHub.
	if s.deployer.GitHub != nil && project.RepoURL != "" && !strings.Contains(project.RepoURL, "@github.com") {
		repoName := extractRepoFullName(project.RepoURL)
		if repoName != "" {
			if token, ok := s.bestGitHubToken(r.Context(), u.ID); ok {
				project.RepoURL = fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repoName)
			}
		}
	}

	// Deploy async
	go func() {
		ctx := context.Background()
		if err := s.deployer.Deploy(ctx, project); err != nil {
			s.log.Error().Err(err).Str("project", projectID).Msg("deploy failed")
		}
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "deploying"})
}

// handleMoveProject moves a running project to a different server (Pro feature).
// It tears down the current container (wherever it lives), reassigns the
// project, and redeploys on the target. An empty/"platform" target moves it
// back to the shared platform.
func (s *Server) handleMoveProject(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}

	// Pro feature — admins bypass; free tier can't move running projects.
	if isAdmin, _ := s.db.IsUserAdmin(r.Context(), u.ID); !isAdmin {
		user, _ := s.db.GetUserByID(r.Context(), u.ID)
		if user == nil || user.Plan == "free" || user.Plan == "" {
			writeError(w, http.StatusForbidden, "Moving a running project to another server is a Pro feature — upgrade to Pro.")
			return
		}
	}

	var body struct {
		WorkerServerID string `json:"worker_server_id"` // "" or "platform" = platform
	}
	json.NewDecoder(r.Body).Decode(&body)
	target := body.WorkerServerID
	if target == "platform" {
		target = ""
	}
	if target == project.WorkerServerID {
		writeError(w, http.StatusBadRequest, "project is already on that server")
		return
	}

	// Validate a BYOC target belongs to the user and is active. Empty = platform.
	if target != "" {
		srv, err := s.db.GetWorkerServer(r.Context(), target)
		if err != nil || srv == nil {
			writeError(w, http.StatusBadRequest, "target server not found")
			return
		}
		if srv.UserID == nil || *srv.UserID != u.ID {
			writeError(w, http.StatusForbidden, "you don't own that server")
			return
		}
		if srv.Status != "active" {
			writeError(w, http.StatusBadRequest, "target server is offline — bring it online first")
			return
		}
	}

	// Tear down the current container (belt-and-braces removes it wherever it runs),
	// reassign, then redeploy on the target.
	s.deployer.Stop(r.Context(), project)
	s.db.AssignProjectServer(r.Context(), projectID, target)
	project.WorkerServerID = target

	// Fresh GitHub token for the rebuild on the new host.
	if s.deployer.GitHub != nil && project.RepoURL != "" && !strings.Contains(project.RepoURL, "@github.com") {
		if repoName := extractRepoFullName(project.RepoURL); repoName != "" {
			if token, ok := s.bestGitHubToken(r.Context(), u.ID); ok {
				project.RepoURL = fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repoName)
			}
		}
	}

	go func() {
		ctx := context.Background()
		if err := s.deployer.Deploy(ctx, project); err != nil {
			s.log.Error().Err(err).Str("project", projectID).Msg("move redeploy failed")
		}
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "moving"})
}

func (s *Server) handleToggleAutoDeploy(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// Must have a GitHub repo linked
	if project.GitHubRepo == "" {
		writeError(w, http.StatusBadRequest, "no GitHub repo linked to this project")
		return
	}

	if err := s.db.SetProjectAutoDeploy(r.Context(), projectID, req.Enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update auto-deploy")
		return
	}

	// Auto-register webhook on GitHub when enabling. Same reasoning as
	// handleCreateProject: this is user-scope admin, not app action.
	if req.Enabled && s.deployer != nil && s.deployer.GitHub != nil {
		if token, ok := s.bestUserGitHubToken(r.Context(), u.ID); ok {
			webhookURL := fmt.Sprintf("https://api.%s/api/v1/github/webhook", s.deployer.Domain)
			if err := s.deployer.GitHub.EnsureWebhook(token, project.GitHubRepo, webhookURL); err != nil {
				s.log.Warn().Err(err).Str("repo", project.GitHubRepo).Msg("failed to register webhook — user may need to add it manually")
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"auto_deploy": req.Enabled,
		"status":      "updated",
	})
}

func (s *Server) handleStopProject(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	if s.deployer != nil {
		s.deployer.Stop(r.Context(), project)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	subdomain := project.Subdomain

	// Stop and remove container
	if s.deployer != nil {
		s.deployer.Delete(r.Context(), project)
	}

	serverID := project.WorkerServerID

	// Drop managed database if one exists
	s.db.DeleteProjectDatabase(r.Context(), projectID)

	// Delete project (also cleans up deploy_logs)
	if err := s.db.DeleteProject(r.Context(), projectID, u.ID); err != nil {
		s.log.Error().Err(err).Str("project", projectID).Msg("failed to delete project")
		writeError(w, http.StatusInternalServerError, "failed to delete project")
		return
	}

	// Release the subdomain so it can be reused
	s.db.ReleaseSubdomain(r.Context(), u.ID, subdomain)

	// Recompute the server's allocation from what's actually left.
	if serverID != "" {
		s.db.ReconcileServerAllocation(r.Context(), serverID)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleGetDeployLogs(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	logs, _ := s.db.GetDeployLogs(r.Context(), projectID, 200)
	if logs == nil {
		writeJSON(w, http.StatusOK, []struct{}{}); return
	}
	writeJSON(w, http.StatusOK, logs)
}

// extractRepoFullName extracts "user/repo" from a GitHub URL.
func extractRepoFullName(repoURL string) string {
	// Handle https://github.com/user/repo.git
	s := repoURL
	s = strings.TrimPrefix(s, "https://github.com/")
	s = strings.TrimPrefix(s, "http://github.com/")
	s = strings.TrimSuffix(s, ".git")
	s = strings.TrimSuffix(s, "/")
	return s
}
