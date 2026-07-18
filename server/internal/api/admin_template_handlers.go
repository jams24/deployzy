package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/db"
)

func (s *Server) handleAdminListTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := s.db.AdminListTemplates(r.Context())
	if err != nil {
		s.log.Error().Err(err).Msg("admin list templates")
		writeError(w, http.StatusInternalServerError, "failed to list templates")
		return
	}
	if templates == nil {
		templates = []db.Template{}
	}
	writeJSON(w, http.StatusOK, templates)
}

func (s *Server) handleAdminCreateTemplate(w http.ResponseWriter, r *http.Request) {
	var u db.TemplateUpsert
	if err := decodeJSON(r, &u); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if u.Slug == "" || u.Name == "" {
		writeError(w, http.StatusBadRequest, "slug and name are required")
		return
	}

	t, err := s.db.AdminCreateTemplate(r.Context(), u)
	if err != nil {
		s.log.Error().Err(err).Msg("admin create template")
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) handleAdminUpdateTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "templateId")
	var u db.TemplateUpsert
	if err := decodeJSON(r, &u); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	t, err := s.db.AdminUpdateTemplate(r.Context(), id, u)
	if err != nil {
		s.log.Error().Err(err).Msg("admin update template")
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleAdminDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "templateId")
	if err := s.db.AdminDeleteTemplate(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
