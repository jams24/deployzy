package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.Subdomain == "" {
		writeError(w, http.StatusBadRequest, "name and subdomain required")
		return
	}

	if req.Framework == "" {
		req.Framework = "node"
	}
	if req.Branch == "" {
		req.Branch = "main"
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
		// Auto-register webhook for auto-deploy
		if s.deployer != nil && s.deployer.GitHub != nil {
			gc, _ := s.db.GetGitHubConnection(r.Context(), u.ID)
			if gc != nil {
				webhookURL := fmt.Sprintf("https://api.%s/api/v1/github/webhook", s.deployer.Domain)
				s.deployer.GitHub.EnsureWebhook(gc.AccessToken, req.GitHubRepo, webhookURL)
			}
		}
	}

	// Assign worker server if specified, or auto-select
	if req.WorkerServerID != "" {
		s.db.AssignProjectServer(r.Context(), project.ID, req.WorkerServerID)
		project.WorkerServerID = req.WorkerServerID
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
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
		project.CommitSHA = body.CommitSHA
		// Persist so the logs show which commit is running even if the deploy crashes.
		s.db.UpdateProjectCommitSHA(r.Context(), projectID, body.CommitSHA)
	} else {
		// Clear any previous pin so we track HEAD of the branch.
		project.CommitSHA = ""
		s.db.UpdateProjectCommitSHA(r.Context(), projectID, "")
	}

	// For private repos, inject GitHub token into clone URL
	if s.deployer.GitHub != nil && project.RepoURL != "" && !strings.Contains(project.RepoURL, "@github.com") {
		gc, _ := s.db.GetGitHubConnection(r.Context(), u.ID)
		if gc != nil {
			repoName := extractRepoFullName(project.RepoURL)
			if repoName != "" {
				// Try installation token first (auto-refreshes), fall back to user token
				token := gc.AccessToken
				if gc.InstallationID > 0 {
					if instToken, err := s.deployer.GitHub.GetInstallationToken(gc.InstallationID); err == nil && instToken != "" {
						token = instToken
					}
				}
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

	// Auto-register webhook on GitHub when enabling
	if req.Enabled && s.deployer != nil && s.deployer.GitHub != nil {
		gc, _ := s.db.GetGitHubConnection(r.Context(), u.ID)
		if gc != nil {
			webhookURL := fmt.Sprintf("https://api.%s/api/v1/github/webhook", s.deployer.Domain)
			if err := s.deployer.GitHub.EnsureWebhook(gc.AccessToken, project.GitHubRepo, webhookURL); err != nil {
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

	// Release server resources if assigned to a worker
	if project.WorkerServerID != "" {
		s.db.ReleaseServerResources(r.Context(), project.WorkerServerID, 0.5, 512)
	}

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
