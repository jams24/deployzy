package api

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
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

	// Plan limit: project-attached databases now share the standalone-service
	// cap (DimService) so users can't bypass the limit by creating them via
	// projects. DimDatabase is kept as a secondary check for older callers.
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimService); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
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

// handleListAllDatabases returns a unified list of every database the user owns —
// both standalone services and per-project databases — for the Services page.
// Shape: {kind: "service"|"project", id, project_id, project_name, ...}
// This lets us remove the per-project database UI and have one place to manage
// everything, without moving any existing backend data.
func (s *Server) handleListAllDatabases(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	ctx := r.Context()

	out := []map[string]interface{}{}

	// Standalone services
	svcs, _ := s.db.ListServices(ctx, u.ID)
	publicHost := ""
	if s.deployer != nil && s.deployer.Domain != "" {
		publicHost = s.deployer.Domain
	} else {
		publicHost = "localhost"
	}
	for _, svc := range svcs {
		svc := svc
		dbName, dbUser, dbPass := "", "", ""
		if svc.DBName != nil {
			dbName = *svc.DBName
		}
		if svc.DBUser != nil {
			dbUser = *svc.DBUser
		}
		if svc.DBPassword != nil {
			dbPass = *svc.DBPassword
		}
		out = append(out, map[string]interface{}{
			"kind":                    "service",
			"id":                      svc.ID,
			"project_id":              nil,
			"project_name":            nil,
			"name":                    svc.Name,
			"type":                    svc.Type,
			"status":                  svc.Status,
			"db_name":                 dbName,
			"db_user":                 dbUser,
			"db_password":             dbPass,
			"host":                    svc.Host,
			"port":                    svc.Port,
			"connection_url":          svc.ConnectionURL(),
			"external_connection_url": svc.ExternalConnectionURL(publicHost),
			"created_at":              svc.CreatedAt,
		})
	}

	// Per-project databases
	projects, _ := s.db.ListProjects(ctx, u.ID)
	for _, p := range projects {
		p := p
		pdb, _ := s.db.GetProjectDatabase(ctx, p.ID)
		if pdb == nil {
			continue
		}
		ph := s.resolveDBPublicHost(ctx, &p)
		out = append(out, map[string]interface{}{
			"kind":                    "project",
			"id":                      pdb.ID,
			"project_id":              p.ID,
			"project_name":            p.Name,
			"project_subdomain":       p.Subdomain,
			"name":                    p.Name + " database",
			"type":                    "postgres",
			"status":                  "running",
			"db_name":                 pdb.DBName,
			"db_user":                 pdb.DBUser,
			"db_password":             pdb.DBPassword,
			"host":                    pdb.Host,
			"port":                    pdb.Port,
			"connection_url":          pdb.ConnectionURL(),
			"external_connection_url": pdb.ExternalConnectionURL(ph),
			"created_at":              pdb.CreatedAt,
		})
	}

	writeJSON(w, http.StatusOK, out)
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
