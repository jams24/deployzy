package api

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

func (s *Server) resolveDBPublicHost(ctx context.Context, project *db.Project) string {
	if project.WorkerServerID != "" {
		if server, _ := s.db.GetWorkerServer(ctx, project.WorkerServerID); server != nil {
			return server.Host
		}
	}
	// Fallback: use the deployer's domain or platform host
	if s.deployer != nil && s.deployer.Domain != "" {
		return s.deployer.Domain
	}
	return "localhost"
}

func (s *Server) handleCreateProjectDatabase(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	pdb, err := s.db.CreateProjectDatabase(r.Context(), projectID)
	if err != nil {
		s.log.Error().Err(err).Str("project", projectID).Msg("failed to create database")
		writeError(w, http.StatusInternalServerError, "failed to create database: "+err.Error())
		return
	}

	// Auto-inject DATABASE_URL into project env vars
	envVars := project.EnvVars
	if envVars == nil {
		envVars = make(map[string]string)
	}
	envVars["DATABASE_URL"] = pdb.ConnectionURL()
	s.db.UpdateProjectEnvVars(r.Context(), projectID, envVars)

	publicHost := s.resolveDBPublicHost(r.Context(), project)
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"database":                pdb,
		"connection_url":          pdb.ConnectionURL(),
		"external_connection_url": pdb.ExternalConnectionURL(publicHost),
	})
}

func (s *Server) handleGetProjectDatabase(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	pdb, err := s.db.GetProjectDatabase(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get database info")
		return
	}
	if pdb == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"database": nil})
		return
	}

	publicHost := s.resolveDBPublicHost(r.Context(), project)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"database":                pdb,
		"connection_url":          pdb.ConnectionURL(),
		"external_connection_url": pdb.ExternalConnectionURL(publicHost),
	})
}

func (s *Server) handleDeleteProjectDatabase(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	if err := s.db.DeleteProjectDatabase(r.Context(), projectID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete database")
		return
	}

	// Remove DATABASE_URL from env vars
	envVars := project.EnvVars
	if envVars != nil {
		delete(envVars, "DATABASE_URL")
		s.db.UpdateProjectEnvVars(r.Context(), projectID, envVars)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
