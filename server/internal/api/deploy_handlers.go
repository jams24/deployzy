package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
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
