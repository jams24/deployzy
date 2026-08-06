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

// requireVerifiedEmail blocks unverified accounts from mutating/deploy actions.
// The register + login flows already gate on verification when email is
// configured; this is defense-in-depth so that even a credential obtained via
// the email-unconfigured fallback (or any future path) can't deploy resources
// until the address is confirmed. One indexed PK lookup — negligible on the
// infrequent create/deploy path.
func (s *Server) requireVerifiedEmail(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := auth.GetUser(r)
		if u == nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		// Suspended accounts can't perform deploy/create actions even with a
		// still-valid token.
		if s.db.IsUserBlocked(r.Context(), u.ID) {
			writeError(w, http.StatusForbidden, "This account has been suspended. Contact support@deployzy.com if you believe this is a mistake.")
			return
		}
		verified, err := s.db.IsEmailVerified(r.Context(), u.ID)
		if err != nil {
			// Fail open on a lookup error so a transient DB blip doesn't wall off
			// legitimate verified users; the register/login gates still apply.
			next.ServeHTTP(w, r)
			return
		}
		if !verified {
			writeError(w, http.StatusForbidden, "Please verify your email address before deploying. Check your inbox (and spam) for the verification code.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// handleAdminSleepProject force-sleeps a platform-local project (admin/ops).
func (s *Server) handleAdminSleepProject(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	if err := s.deployer.ForceSleep(r.Context(), chi.URLParam(r, "projectId")); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sleeping"})
}

// handleAdminWakeProject wakes a slept project (admin/ops).
func (s *Server) handleAdminWakeProject(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	if err := s.deployer.ForceWake(r.Context(), chi.URLParam(r, "projectId")); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "awake"})
}

// --- IP bans (admin) ---

func (s *Server) handleAdminListIPBans(w http.ResponseWriter, r *http.Request) {
	bans, err := s.db.ListIPBans(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list bans")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"bans": bans})
}

func (s *Server) handleAdminBanIP(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var req struct {
		IP     string `json:"ip"`
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.IP) == "" {
		writeError(w, http.StatusBadRequest, "ip is required")
		return
	}
	if err := s.db.BanIP(r.Context(), req.IP, req.Reason, u.Email); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to ban ip")
		return
	}
	if s.deployer != nil {
		s.deployer.RefreshBannedIPs(r.Context())
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "banned", "ip": req.IP})
}

func (s *Server) handleAdminUnbanIP(w http.ResponseWriter, r *http.Request) {
	ip := chi.URLParam(r, "ip")
	if err := s.db.UnbanIP(r.Context(), ip); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to unban ip")
		return
	}
	if s.deployer != nil {
		s.deployer.RefreshBannedIPs(r.Context())
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unbanned", "ip": ip})
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
		Plan          *string `json:"plan"`
		IsAdmin       *bool   `json:"is_admin"`
		Blocked       *bool   `json:"blocked"`
		BlockedReason string  `json:"blocked_reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	if err := s.db.AdminUpdateUser(r.Context(), userID, req.Plan, req.IsAdmin); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}
	if req.Blocked != nil {
		if err := s.db.SetUserBlocked(r.Context(), userID, *req.Blocked, req.BlockedReason); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update block status")
			return
		}
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
	// Teardown failure (unreachable BYOC host) shouldn't block the delete — the
	// row still comes out — but we surface it so the admin knows a container may
	// be orphaned on that server.
	var teardownWarning string
	if err := s.deployer.Delete(r.Context(), p); err != nil {
		s.log.Warn().Err(err).Str("project", projectID).Msg("admin delete: container teardown could not be confirmed")
		teardownWarning = "Project removed, but the server was unreachable — the container may still be running there."
	}
	if err := s.db.DeleteProject(r.Context(), projectID, p.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "container removed but DB delete failed")
		return
	}
	resp := map[string]string{"status": "deleted"}
	if teardownWarning != "" {
		resp["warning"] = teardownWarning
	}
	writeJSON(w, http.StatusOK, resp)
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

// handleAdminMoveProject moves ANY project to a chosen platform/BYOC server (or
// clears the assignment for auto-select). Admin-only. Tears the current
// container down, reassigns, and redeploys on the target. Note: cross-host
// moves incur a short rebuild window of downtime (the old container is stopped
// before the new one is built on the target).
func (s *Server) handleAdminMoveProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var body struct {
		WorkerServerID string `json:"worker_server_id"` // "" / "auto" = auto-select platform
	}
	json.NewDecoder(r.Body).Decode(&body)
	target := strings.TrimSpace(body.WorkerServerID)
	if target == "auto" || target == "platform" {
		target = ""
	}
	if target == project.WorkerServerID {
		writeError(w, http.StatusBadRequest, "project is already on that server")
		return
	}

	// Validate an explicit target exists and is active. Empty = auto-select.
	var targetLabel = "auto-select"
	if target != "" {
		srv, err := s.db.GetWorkerServer(r.Context(), target)
		if err != nil || srv == nil {
			writeError(w, http.StatusBadRequest, "target server not found")
			return
		}
		if srv.Status != "active" {
			writeError(w, http.StatusBadRequest, "target server is not active")
			return
		}
		targetLabel = srv.Label
	}

	// Tear down the current container wherever it runs, reassign, redeploy.
	s.deployer.Stop(r.Context(), project)
	s.db.AssignProjectServer(r.Context(), projectID, target)
	project.WorkerServerID = target

	// If the project has a central database, repoint DATABASE_URL so it stays
	// reachable from the new host. Project DBs live in the platform's central
	// Postgres — internal (localhost) works only on the primary; from any other
	// server the app must use the external host. This is what makes DB-backed
	// projects movable without touching the data.
	if pdb, _ := s.db.GetProjectDatabase(r.Context(), projectID); pdb != nil {
		targetLocal := false
		if target != "" {
			if srv, _ := s.db.GetWorkerServer(r.Context(), target); srv != nil && srv.IsLocal {
				targetLocal = true
			}
		}
		var dbURL string
		if targetLocal {
			dbURL = pdb.ConnectionURL() // localhost — fastest on the primary
		} else {
			publicHost := "database.deployzy.com"
			if s.deployer != nil && s.deployer.ServiceHost != "" {
				publicHost = s.deployer.ServiceHost
			}
			dbURL = pdb.ExternalConnectionURL(publicHost)
		}
		env := project.EnvVars
		if env == nil {
			env = map[string]string{}
		}
		env["DATABASE_URL"] = dbURL
		s.db.UpdateProjectEnvVars(r.Context(), projectID, env)
		project.EnvVars = env
	}

	// Fresh GitHub token for the rebuild on the new host (use the project owner's).
	if s.deployer.GitHub != nil && project.RepoURL != "" && !strings.Contains(project.RepoURL, "@github.com") {
		if repoName := extractRepoFullName(project.RepoURL); repoName != "" {
			if token, ok := s.bestGitHubToken(r.Context(), project.UserID); ok {
				project.RepoURL = fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repoName)
			}
		}
	}

	go func(p *db.Project) {
		if err := s.deployer.Deploy(context.Background(), p); err != nil {
			s.log.Error().Err(err).Str("project", p.ID).Msg("admin move redeploy failed")
		}
	}(project)

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status": "moving", "target": targetLabel,
	})
}
