package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/robfig/cron/v3"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
)

// Parser matching the one the scheduler uses. Keeps user-facing validation
// aligned with what actually runs.
var cronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

func (s *Server) handleListCrons(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	crons, err := s.db.ListCrons(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list crons")
		return
	}
	if crons == nil {
		crons = []db.ProjectCron{}
	}
	writeJSON(w, http.StatusOK, crons)
}

func (s *Server) handleCreateCron(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	// Plan limit: max scheduled jobs (across all projects).
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimCron); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	var req struct {
		Name     string `json:"name"`
		Schedule string `json:"schedule"`
		Command  string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Schedule == "" || req.Command == "" {
		writeError(w, http.StatusBadRequest, "name, schedule, command required")
		return
	}
	if _, err := cronParser.Parse(req.Schedule); err != nil {
		writeError(w, http.StatusBadRequest, "invalid cron schedule: "+err.Error())
		return
	}
	if req.Name == "" {
		req.Name = "job"
	}

	c, err := s.db.CreateCron(r.Context(), projectID, req.Name, req.Schedule, req.Command)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create cron")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleUpdateCron(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	cronID := chi.URLParam(r, "cronId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	c, _ := s.db.GetCron(r.Context(), cronID)
	if c == nil || c.ProjectID != projectID {
		writeError(w, http.StatusNotFound, "cron not found")
		return
	}

	var req struct {
		Name     string `json:"name"`
		Schedule string `json:"schedule"`
		Command  string `json:"command"`
		Enabled  bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if _, err := cronParser.Parse(req.Schedule); err != nil {
		writeError(w, http.StatusBadRequest, "invalid cron schedule: "+err.Error())
		return
	}
	if err := s.db.UpdateCron(r.Context(), cronID, req.Name, req.Schedule, req.Command, req.Enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) handleDeleteCron(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	cronID := chi.URLParam(r, "cronId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	c, _ := s.db.GetCron(r.Context(), cronID)
	if c == nil || c.ProjectID != projectID {
		writeError(w, http.StatusNotFound, "cron not found")
		return
	}
	if err := s.db.DeleteCron(r.Context(), cronID); err != nil {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
