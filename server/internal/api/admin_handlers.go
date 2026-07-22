package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

// adminOnly middleware checks if the user is an admin.
func (s *Server) adminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := auth.GetUser(r)
		if u == nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		isAdmin, err := s.db.IsUserAdmin(r.Context(), u.ID)
		if err != nil || !isAdmin {
			writeError(w, http.StatusForbidden, "admin access required")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.db.AdminGetStats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get stats")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("search")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 50
	}

	users, total, err := s.db.AdminListUsers(r.Context(), search, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	if users == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"users": []interface{}{}, "total": total, "limit": limit, "offset": offset}); return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"users": users,
		"total": total,
		"limit": limit,
		"offset": offset,
	})
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")

	var req struct {
		Plan    *string `json:"plan"`
		IsAdmin *bool   `json:"is_admin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	if err := s.db.AdminUpdateUser(r.Context(), userID, req.Plan, req.IsAdmin); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")

	// Same teardown as self-service deletion: stop their containers before
	// the rows vanish, otherwise the workloads are orphaned on the hosts.
	s.purgeUserResources(r.Context(), userID)

	if err := s.db.AdminDeleteUser(r.Context(), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete user")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// handleAdminRedeployAll triggers a deploy on every project that has a
// github_repo set. Built for disaster-recovery: after restoring a pg dump
// onto a fresh VPS, every project row points at a container_id that no
// longer exists. This fans out redeploys so each project rebuilds its
// container from source.
//
// Body (optional):
//
//	{ "status": "running" }  // restrict to projects currently in that status
//
// Defaults to "all projects with a github_repo" if status is omitted.
// Deploys are staggered by 2s to avoid hammering Docker/CPU on the host.
func (s *Server) handleAdminRedeployAll(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}

	var body struct {
		Status string `json:"status"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	body.Status = strings.TrimSpace(body.Status)

	projects, err := s.db.ListProjectsWithGitHub(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}

	queued := 0
	skipped := 0
	queueIDs := []string{}
	for _, project := range projects {
		if body.Status != "" && project.Status != body.Status {
			skipped++
			continue
		}
		// Clear stale SHA + container so the deploy tracks branch HEAD and
		// the engine allocates a fresh container port. Matches the semantics
		// of the manual Redeploy button in /projects.
		s.db.UpdateProjectCommitSHA(r.Context(), project.ID, "")
		project.CommitSHA = ""

		// Inject a fresh GitHub token (same pattern as handleDeployProject).
		if s.deployer.GitHub != nil && project.RepoURL != "" && !strings.Contains(project.RepoURL, "@github.com") {
			repoName := extractRepoFullName(project.RepoURL)
			if repoName != "" {
				if token, ok := s.bestGitHubToken(r.Context(), project.UserID); ok {
					project.RepoURL = fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repoName)
				}
			}
		}

		p := project // capture
		queueIDs = append(queueIDs, p.ID)
		queued++
		go func(idx int, proj db.Project) {
			// Stagger so a restore with 50 projects doesn't pin every CPU
			// core on build simultaneously. 2s apart is enough headroom.
			time.Sleep(time.Duration(idx) * 2 * time.Second)
			ctx := context.Background()
			if err := s.deployer.Deploy(ctx, &proj); err != nil {
				s.log.Error().Err(err).Str("project", proj.ID).Msg("admin redeploy-all: deploy failed")
			}
		}(queued-1, p)
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"status":   "deploying",
		"queued":   queued,
		"skipped":  skipped,
		"total":    len(projects),
		"projects": queueIDs,
	})
}

func (s *Server) handleAdminListProjects(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("search")
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 50
	}

	projects, total, err := s.db.AdminListProjects(r.Context(), search, status, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}
	if projects == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"projects": []interface{}{}, "total": total})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"projects": projects, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) handleAdminStopProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	p, err := s.db.GetProject(r.Context(), projectID)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if err := s.deployer.Stop(r.Context(), p); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

func (s *Server) handleAdminDeleteProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	p, err := s.db.GetProject(r.Context(), projectID)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if err := s.deployer.Delete(r.Context(), p); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.db.DeleteProject(r.Context(), projectID, p.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "container removed but DB delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleAdminRedeployProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	p, err := s.db.GetProject(r.Context(), projectID)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	// context.Background(), not r.Context(): the request context dies with the
	// response, which would abort the build seconds after it started. A deploy
	// outlives the HTTP call by minutes.
	go func(proj *db.Project) {
		if err := s.deployer.Deploy(context.Background(), proj); err != nil {
			s.log.Error().Err(err).Str("project", proj.Name).Msg("admin redeploy failed")
		}
	}(p)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "deploying"})
}

type sessionTunnelInfo struct {
	URL       string `json:"url"`
	Protocol  string `json:"protocol"`
	LocalAddr string `json:"local_addr"`
	Name      string `json:"name"`
	Inspect   bool   `json:"inspect"`
}

type sessionInfo struct {
	ClientID    string              `json:"client_id"`
	UserID      string              `json:"user_id"`
	UserEmail   string              `json:"user_email"`
	RemoteAddr  string              `json:"remote_addr"`
	ConnectedAt time.Time           `json:"connected_at"`
	Tunnels     []sessionTunnelInfo `json:"tunnels"`
}

func (s *Server) handleAdminListSessions(w http.ResponseWriter, r *http.Request) {
	if s.ctrlManager == nil {
		writeJSON(w, http.StatusOK, []sessionInfo{})
		return
	}

	conns := s.ctrlManager.List()
	sessions := make([]sessionInfo, 0, len(conns))

	for _, conn := range conns {
		email := ""
		if conn.UserID() != "" {
			if u, err := s.db.GetUserByID(r.Context(), conn.UserID()); err == nil && u != nil {
				email = u.Email
			}
		}

		var tunnels []sessionTunnelInfo
		for _, url := range conn.TunnelURLs() {
			t := s.registry.LookupByURL(url)
			if t != nil {
				tunnels = append(tunnels, sessionTunnelInfo{
					URL:       t.URL,
					Protocol:  t.Protocol,
					LocalAddr: t.LocalAddr,
					Name:      t.Name,
					Inspect:   t.Inspect,
				})
			} else {
				tunnels = append(tunnels, sessionTunnelInfo{URL: url})
			}
		}
		if tunnels == nil {
			tunnels = []sessionTunnelInfo{}
		}

		sessions = append(sessions, sessionInfo{
			ClientID:    conn.ID(),
			UserID:      conn.UserID(),
			UserEmail:   email,
			RemoteAddr:  conn.RemoteAddr().String(),
			ConnectedAt: conn.ConnectedAt(),
			Tunnels:     tunnels,
		})
	}

	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) handleAdminKillSession(w http.ResponseWriter, r *http.Request) {
	clientID := chi.URLParam(r, "clientId")
	if s.ctrlManager == nil || !s.ctrlManager.CloseConn(clientID) {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}

func (s *Server) handleAdminKillTunnel(w http.ResponseWriter, r *http.Request) {
	encoded := chi.URLParam(r, "encodedURL")
	tunnelURL, err := base64.URLEncoding.DecodeString(encoded)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid tunnel URL encoding")
		return
	}
	s.registry.RemoveByURL(string(tunnelURL))
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

// handleAdminProjectDiagnostics returns a live container snapshot plus recent
// deploy logs for ANY user's project, so an operator can answer "why is this
// crashing?" from the console instead of SSHing into the host.
func (s *Server) handleAdminProjectDiagnostics(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")

	project, err := s.db.GetProject(r.Context(), projectID)
	if err != nil || project == nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine unavailable")
		return
	}

	// Bound the whole probe: an unreachable BYOC host must not hang the console.
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	diag := s.deployer.Diagnose(ctx, project, 200)
	deployLogs, _ := s.db.GetDeployLogs(r.Context(), projectID, 100)
	if deployLogs == nil {
		deployLogs = []db.DeployLog{}
	}

	var ownerEmail string
	if owner, _ := s.db.GetUserByID(r.Context(), project.UserID); owner != nil {
		ownerEmail = owner.Email
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"project": map[string]interface{}{
			"id":             project.ID,
			"name":           project.Name,
			"subdomain":      project.Subdomain,
			"status":         project.Status,
			"framework":      project.Framework,
			"repo_url":       project.RepoURL,
			"branch":         project.Branch,
			"memory_mb":      project.MemoryMB,
			"cpus":           project.CPUs,
			"container_port": project.ContainerPort,
			"last_deploy_at": project.LastDeployAt,
			"owner_email":    ownerEmail,
			"owner_id":       project.UserID,
		},
		"container":   diag,
		"deploy_logs": deployLogs,
	})
}
