package api

import (
	"context"
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
