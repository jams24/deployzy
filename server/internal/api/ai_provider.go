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

// agentKey is the bearer token for the currently-configured provider (admin
// setting first, DEEPSEEK_API_KEY env as fallback). Empty means "not configured".
func (s *Server) agentKey(ctx context.Context) string { return s.llm(ctx).Key }
