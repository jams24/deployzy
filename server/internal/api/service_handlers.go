package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

func (s *Server) handleCreateService(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Name string `json:"name"`
		Type string `json:"type"` // postgres, redis
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.Type == "" {
		writeError(w, http.StatusBadRequest, "name and type required")
		return
	}

	valid := map[string]bool{"postgres": true}
	if !valid[req.Type] {
		writeError(w, http.StatusBadRequest, "unsupported service type — available: postgres")
		return
	}

	svc, err := s.db.CreateService(r.Context(), u.ID, req.Name, req.Type)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to create service")
		writeError(w, http.StatusInternalServerError, "failed to create service: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"service":        svc,
		"connection_url": svc.ConnectionURL(),
	})
}

func (s *Server) handleListServices(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	svcs, err := s.db.ListServices(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list services")
		return
	}
	if svcs == nil {
		svcs = []db.Service{}
	}

	// Add connection URLs
	type svcWithURL struct {
		db.Service
		ConnectionURL string `json:"connection_url"`
	}
	result := make([]svcWithURL, len(svcs))
	for i, svc := range svcs {
		result[i] = svcWithURL{Service: svc, ConnectionURL: svc.ConnectionURL()}
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGetService(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	id := chi.URLParam(r, "serviceId")

	svc, _ := s.db.GetService(r.Context(), id)
	if svc == nil || svc.UserID != u.ID {
		writeError(w, http.StatusNotFound, "service not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"service":        svc,
		"connection_url": svc.ConnectionURL(),
	})
}

func (s *Server) handleDeleteService(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	id := chi.URLParam(r, "serviceId")

	if err := s.db.DeleteService(r.Context(), id, u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete service")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
