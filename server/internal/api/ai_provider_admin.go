package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/serverme/serverme/server/internal/billing"
)

// aiPreset is a known provider with sensible base_url + a default model, so the
// admin UI can offer a dropdown that auto-fills the fields. All are OpenAI-compatible.
type aiPreset struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	BaseURL  string `json:"base_url"`
	Model    string `json:"model"`
	KeyHint  string `json:"key_hint"`
}

var aiPresets = []aiPreset{
	{ID: "deepseek", Label: "DeepSeek", BaseURL: "https://api.deepseek.com", Model: "deepseek-chat", KeyHint: "sk-…"},
	{ID: "openai", Label: "OpenAI", BaseURL: "https://api.openai.com/v1", Model: "gpt-4o", KeyHint: "sk-…"},
	{ID: "anthropic", Label: "Anthropic (Claude)", BaseURL: "https://api.anthropic.com/v1", Model: "claude-opus-4-8", KeyHint: "sk-ant-…"},
	{ID: "moonshot", Label: "Moonshot (Kimi)", BaseURL: "https://api.moonshot.ai/v1", Model: "kimi-k2-0711-preview", KeyHint: "sk-…"},
	{ID: "groq", Label: "Groq", BaseURL: "https://api.groq.com/openai/v1", Model: "llama-3.3-70b-versatile", KeyHint: "gsk_…"},
	{ID: "openrouter", Label: "OpenRouter", BaseURL: "https://openrouter.ai/api/v1", Model: "anthropic/claude-3.5-sonnet", KeyHint: "sk-or-…"},
	{ID: "xai", Label: "xAI (Grok)", BaseURL: "https://api.x.ai/v1", Model: "grok-2-latest", KeyHint: "xai-…"},
	{ID: "mistral", Label: "Mistral", BaseURL: "https://api.mistral.ai/v1", Model: "mistral-large-latest", KeyHint: "…"},
	{ID: "together", Label: "Together AI", BaseURL: "https://api.together.xyz/v1", Model: "deepseek-ai/DeepSeek-V3", KeyHint: "…"},
	{ID: "custom", Label: "Custom (OpenAI-compatible)", BaseURL: "", Model: "", KeyHint: "any bearer token"},
}

func maskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) > 10 {
		return key[:6] + "…" + key[len(key)-2:]
	}
	return "set"
}

// GET /api/v1/admin/ai/config — never echoes the raw key back.
func (s *Server) handleAdminGetAIConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.db.GetSettings(r.Context(), settingAIProvider, settingAIBaseURL, settingAIKey, settingAIModel)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load settings")
		return
	}
	// Effective values (what the agent actually uses right now, incl. env fallback).
	eff := s.llm(r.Context())
	rates, _ := s.db.GetSettings(r.Context(), billing.SettingAIPriceInPerM, billing.SettingAIPriceOutPerM,
		"polar_credits_product")
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":       cfg[settingAIProvider],
		"base_url":       cfg[settingAIBaseURL],
		"model":          cfg[settingAIModel],
		"api_key_set":    cfg[settingAIKey] != "",
		"api_key_preview": maskKey(cfg[settingAIKey]),
		"credits_enabled": billing.AICreditsEnabled(r.Context(), s.db),
		"price_in_per_m":  rates[billing.SettingAIPriceInPerM],
		"price_out_per_m": rates[billing.SettingAIPriceOutPerM],
		"polar_credits_product": rates["polar_credits_product"],
		"card_configured":       s.polar != nil,
		"effective": map[string]any{
			"provider":     eff.Provider,
			"base_url":     eff.BaseURL,
			"model":        eff.Model,
			"key_configured": eff.Key != "",
			"using_env_fallback": cfg[settingAIKey] == "" && eff.Key != "",
		},
		"presets": aiPresets,
	})
}

// PUT /api/v1/admin/ai/config — updates whichever fields are present. An empty
// api_key keeps the existing one; send api_key:"__clear__" to remove it and fall
// back to the DEEPSEEK_API_KEY env default.
func (s *Server) handleAdminSetAIConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Provider       *string `json:"provider"`
		BaseURL        *string `json:"base_url"`
		Model          *string `json:"model"`
		APIKey         *string `json:"api_key"`
		CreditsEnabled *bool   `json:"credits_enabled"`
		PriceInPerM    *string `json:"price_in_per_m"`
		PriceOutPerM   *string `json:"price_out_per_m"`
		PolarCreditsProduct *string `json:"polar_credits_product"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	ctx := r.Context()
	if body.CreditsEnabled != nil {
		v := "false"
		if *body.CreditsEnabled {
			v = "true"
		}
		s.db.SetSetting(ctx, billing.SettingAICreditsEnabled, v)
	}
	if body.PriceInPerM != nil {
		s.db.SetSetting(ctx, billing.SettingAIPriceInPerM, strings.TrimSpace(*body.PriceInPerM))
	}
	if body.PriceOutPerM != nil {
		s.db.SetSetting(ctx, billing.SettingAIPriceOutPerM, strings.TrimSpace(*body.PriceOutPerM))
	}
	if body.PolarCreditsProduct != nil {
		s.db.SetSetting(ctx, "polar_credits_product", strings.TrimSpace(*body.PolarCreditsProduct))
	}
	if body.Provider != nil {
		s.db.SetSetting(ctx, settingAIProvider, strings.TrimSpace(*body.Provider))
	}
	if body.BaseURL != nil {
		s.db.SetSetting(ctx, settingAIBaseURL, strings.TrimSpace(*body.BaseURL))
	}
	if body.Model != nil {
		s.db.SetSetting(ctx, settingAIModel, strings.TrimSpace(*body.Model))
	}
	if body.APIKey != nil {
		k := strings.TrimSpace(*body.APIKey)
		if k == "__clear__" {
			s.db.SetSetting(ctx, settingAIKey, "")
		} else if k != "" {
			s.db.SetSetting(ctx, settingAIKey, k)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

// POST /api/v1/admin/ai/test — sends a tiny completion to the CURRENTLY-SAVED
// provider (or, if the body carries overrides, to those) to validate reachability,
// auth, and the model id before the admin commits to it.
func (s *Server) handleAdminTestAI(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BaseURL string `json:"base_url"`
		Model   string `json:"model"`
		APIKey  string `json:"api_key"`
	}
	_ = decodeJSON(r, &body)

	p := s.llm(r.Context())
	if v := strings.TrimSpace(body.BaseURL); v != "" {
		p.BaseURL = v
	}
	if v := strings.TrimSpace(body.Model); v != "" {
		p.Model = v
	}
	// A blank/placeholder key means "test what's already saved".
	if v := strings.TrimSpace(body.APIKey); v != "" && !strings.Contains(v, "…") {
		p.Key = v
	}
	if p.Key == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "No API key configured."})
		return
	}

	ok, model, errMsg := s.pingLLM(r.Context(), p)
	writeJSON(w, http.StatusOK, map[string]any{"ok": ok, "model": model, "error": errMsg})
}

// pingLLM does a minimal 1-token completion to confirm the provider works.
func (s *Server) pingLLM(ctx context.Context, p llmProvider) (bool, string, string) {
	reqBody, _ := json.Marshal(map[string]any{
		"model": p.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "ping"},
		},
		"max_tokens": 1,
	})
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	httpReq, _ := http.NewRequestWithContext(reqCtx, http.MethodPost, p.chatURL(), bytes.NewReader(reqBody))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.Key)
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return false, "", err.Error()
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2000))
	if resp.StatusCode != http.StatusOK {
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(raw, &e) == nil && e.Error.Message != "" {
			msg += ": " + e.Error.Message
		}
		return false, "", msg
	}
	var out struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(raw, &out)
	if out.Model == "" {
		out.Model = p.Model
	}
	return true, out.Model, ""
}
