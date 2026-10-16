package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
)

// Per-user BYOK (bring-your-own-key) handlers. A user can save one AI provider
// key; their AI builder/agent calls then run on that key and are NOT metered
// against their plan/balance. Without a key, Deployzy's key + plan limits apply.

// byokProvider is a provider the user can bring a key for.
type byokProvider struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	KeyHint string `json:"key_hint"`
}

// The mainstream providers we offer for BYOK (OpenAI-compatible endpoints).
var byokProviders = []byokProvider{
	{ID: "anthropic", Label: "Anthropic (Claude)", KeyHint: "sk-ant-…"},
	{ID: "openai", Label: "OpenAI", KeyHint: "sk-…"},
	{ID: "google", Label: "Google (Gemini)", KeyHint: "AIza…"},
	{ID: "xai", Label: "xAI (Grok)", KeyHint: "xai-…"},
	{ID: "deepseek", Label: "DeepSeek", KeyHint: "sk-…"},
	{ID: "moonshot", Label: "Moonshot (Kimi)", KeyHint: "sk-…"},
	{ID: "groq", Label: "Groq", KeyHint: "gsk_…"},
	{ID: "mistral", Label: "Mistral", KeyHint: "…"},
}

func isBYOKProvider(id string) bool {
	for _, p := range byokProviders {
		if p.ID == id {
			return true
		}
	}
	return false
}

// GET /api/v1/ai/keys — the caller's saved BYOK keys (masked) + the provider list.
func (s *Server) handleGetUserAIKeys(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	keys, _ := s.db.ListUserAIKeys(r.Context(), u.ID)
	if keys == nil {
		keys = nil
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"providers":       byokProviders,
		"keys":            keys,
		"metering_on":     billing.AICreditsEnabled(r.Context(), s.db),
		"has_key":         len(keys) > 0,
	})
}

// PUT /api/v1/ai/keys — save/replace the caller's key for a provider.
// Body: {provider, api_key}.
func (s *Server) handleSetUserAIKey(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var body struct {
		Provider string `json:"provider"`
		APIKey   string `json:"api_key"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	provider := strings.TrimSpace(strings.ToLower(body.Provider))
	key := strings.TrimSpace(body.APIKey)
	if !isBYOKProvider(provider) {
		writeError(w, http.StatusBadRequest, "unsupported provider")
		return
	}
	if key == "" {
		writeError(w, http.StatusBadRequest, "api key is required")
		return
	}
	if err := s.db.SetUserAIKey(r.Context(), u.ID, provider, key); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save key")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

// DELETE /api/v1/ai/keys/{provider} — remove the caller's key for a provider.
func (s *Server) handleDeleteUserAIKey(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	provider := strings.TrimSpace(strings.ToLower(chi.URLParam(r, "provider")))
	if provider == "" {
		writeError(w, http.StatusBadRequest, "provider required")
		return
	}
	if err := s.db.DeleteUserAIKey(r.Context(), u.ID, provider); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove key")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}
