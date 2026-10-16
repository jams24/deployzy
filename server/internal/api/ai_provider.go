package api

import (
	"context"
	"os"
	"strings"
)

// Admin-configurable LLM provider for the AI builder / agent. Everything speaks
// the OpenAI-compatible /chat/completions shape, so a single code path serves
// DeepSeek, OpenAI, Moonshot (Kimi), Groq, OpenRouter, xAI, Mistral, Together,
// a local Ollama, and Anthropic (via its OpenAI-compatible endpoint). The admin
// just picks base_url + model + api_key from the dashboard.
const (
	settingAIProvider = "ai_provider"  // label only: deepseek|openai|anthropic|moonshot|groq|openrouter|xai|custom
	settingAIBaseURL  = "ai_base_url"  // API root WITHOUT /chat/completions, e.g. https://api.deepseek.com
	settingAIKey      = "ai_api_key"   // secret bearer token
	settingAIModel    = "ai_model"     // e.g. deepseek-chat, claude-opus-4-8, kimi-k2-0711-preview
)

// llmProvider is a resolved provider config.
type llmProvider struct {
	Provider string
	BaseURL  string
	Key      string
	Model    string
	BYOK     bool // resolved from the user's own key → don't meter credits
}

// chatURL is the OpenAI-compatible completions endpoint for this provider.
func (p llmProvider) chatURL() string {
	base := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	// Tolerate an admin who pasted the full /chat/completions URL.
	if strings.HasSuffix(base, "/chat/completions") {
		return base
	}
	return base + "/chat/completions"
}

// llm resolves the active LLM provider. Admin-configured DB settings win;
// otherwise it falls back to the built-in DeepSeek defaults + the DEEPSEEK_API_KEY
// env var, so existing deployments keep working with no configuration at all.
func (s *Server) llm(ctx context.Context) llmProvider {
	cfg, _ := s.db.GetSettings(ctx, settingAIProvider, settingAIBaseURL, settingAIKey, settingAIModel)
	p := llmProvider{
		Provider: strings.TrimSpace(cfg[settingAIProvider]),
		BaseURL:  strings.TrimSpace(cfg[settingAIBaseURL]),
		Key:      strings.TrimSpace(cfg[settingAIKey]),
		Model:    strings.TrimSpace(cfg[settingAIModel]),
	}
	if p.BaseURL == "" {
		p.BaseURL = "https://api.deepseek.com"
	}
	if p.Key == "" {
		p.Key = strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY"))
	}
	if p.Model == "" {
		p.Model = "deepseek-chat"
	}
	if p.Provider == "" {
		p.Provider = "deepseek"
	}
	return p
}

// presetByID returns the base URL + default model for a known provider (used to
// resolve a user's BYOK provider into a usable config).
func presetByID(id string) *aiPreset {
	for i := range aiPresets {
		if aiPresets[i].ID == id {
			return &aiPresets[i]
		}
	}
	return nil
}

// llmForCtx resolves the provider for the request, honoring the caller's own key
// (BYOK) when present. It starts from the admin config, then — if a billing
// context with a user is attached and that user has a saved key — switches to the
// user's provider/model (from the preset) with their key and marks BYOK so the
// call is NOT metered. Falls back to the admin config otherwise.
func (s *Server) llmForCtx(ctx context.Context) llmProvider {
	p := s.llm(ctx)
	b, _ := ctx.Value(aiBillKey{}).(*aiBill)
	if b == nil || b.user == nil {
		return p
	}

	// If the user explicitly picked an engine in the composer:
	//   - "deployzy" (or "") → platform default, meter normally.
	//   - a provider id → use that provider's saved key (BYOK), no metering.
	if b.engine != "" {
		if b.engine == "deployzy" || b.engine == "platform" {
			return p // explicit platform default
		}
		key, ok := s.db.GetUserAIKeyExact(ctx, b.user.ID, b.engine)
		if !ok || key == "" {
			return p // picked a provider with no key → fall back to platform
		}
		if pre := presetByID(b.engine); pre != nil && pre.BaseURL != "" {
			p.Provider, p.BaseURL, p.Model = pre.ID, pre.BaseURL, pre.Model
		}
		p.Key, p.BYOK = key, true
		return p
	}

	// No explicit choice: auto-use a saved key if the user has one.
	provider, key, ok := s.db.ResolveUserAIKey(ctx, b.user.ID, p.Provider)
	if !ok || key == "" {
		return p
	}
	if provider != p.Provider {
		if pre := presetByID(provider); pre != nil && pre.BaseURL != "" {
			p.Provider, p.BaseURL, p.Model = pre.ID, pre.BaseURL, pre.Model
		}
	}
	p.Key, p.BYOK = key, true
	return p
}

// billIsBYOK reports whether the resolved call for this billing context will run
// on the user's own key (so the credit gate + metering are skipped). Mirrors
// llmForCtx's decision without making the HTTP call.
func (s *Server) billIsBYOK(ctx context.Context) bool {
	b, _ := ctx.Value(aiBillKey{}).(*aiBill)
	if b == nil || b.user == nil {
		return false
	}
	if b.engine != "" {
		if b.engine == "deployzy" || b.engine == "platform" {
			return false
		}
		_, ok := s.db.GetUserAIKeyExact(ctx, b.user.ID, b.engine)
		return ok
	}
	_, key, ok := s.db.ResolveUserAIKey(ctx, b.user.ID, s.llm(ctx).Provider)
	return ok && key != ""
}

// userHasBYOK reports whether the user has ANY usable saved key (used at the gate
// before a billing context with an engine is attached).
func (s *Server) userHasBYOK(ctx context.Context, userID string) bool {
	active := s.llm(ctx).Provider
	_, key, ok := s.db.ResolveUserAIKey(ctx, userID, active)
	return ok && key != ""
}

// agentKey is the bearer token for the currently-configured provider (admin
// setting first, DEEPSEEK_API_KEY env as fallback). Empty means "not configured".
func (s *Server) agentKey(ctx context.Context) string { return s.llm(ctx).Key }
