package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/notify"
)

func (s *Server) handleListWebhooks(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	hooks, err := s.db.ListWebhooks(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list webhooks")
		return
	}
	writeJSON(w, http.StatusOK, hooks)
}

// isValidWebhookURL requires a plain https URL with a host (no SSRF to internal
// schemes / loopback shorthands).
func isValidWebhookURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || host == "::1" {
		return false
	}
	return true
}

func (s *Server) handleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !isValidWebhookURL(req.URL) {
		writeError(w, http.StatusBadRequest, "a valid https:// webhook URL is required")
		return
	}
	wh, err := s.db.CreateWebhook(r.Context(), u.ID, strings.TrimSpace(req.URL))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create webhook")
		return
	}
	writeJSON(w, http.StatusCreated, wh)
}

func (s *Server) handleUpdateWebhook(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	id := chi.URLParam(r, "id")
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := s.db.SetWebhookEnabled(r.Context(), id, u.ID, req.Enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update webhook")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": req.Enabled})
}

func (s *Server) handleDeleteWebhook(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	id := chi.URLParam(r, "id")
	if err := s.db.DeleteWebhook(r.Context(), id, u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete webhook")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// handleTestWebhook sends a sample event to a webhook and returns the receiver's
// HTTP status so the user can confirm their endpoint works.
func (s *Server) handleTestWebhook(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	id := chi.URLParam(r, "id")
	wh, _ := s.db.GetWebhook(r.Context(), id, u.ID)
	if wh == nil {
		writeError(w, http.StatusNotFound, "webhook not found")
		return
	}
	payload := map[string]interface{}{
		"event":     "ping",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"message":   "Test event from Deployzy",
	}
	status := notify.DeliverWebhook(wh.URL, wh.Secret, payload)
	s.db.RecordWebhookDelivery(r.Context(), wh.ID, status)
	writeJSON(w, http.StatusOK, map[string]interface{}{"delivered": status > 0 && status < 400, "status": status})
}
