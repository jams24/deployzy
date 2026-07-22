package analytics

import "testing"

func TestBotDetectionCatchesAICrawlers(t *testing.T) {
	uas := []string{
		"Mozilla/5.0 AppleWebKit (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
		"Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
		"Mozilla/5.0 (compatible; PerplexityBot/1.0)",
		"Mozilla/5.0 (compatible; Bytespider)",
		"Mozilla/5.0 (compatible; AhrefsBot/7.0)",
	}
	for _, ua := range uas {
		if _, _, _, isBot := ParseUA(ua); !isBot {
			t.Errorf("NOT detected as bot: %s", ua)
		}
	}
}
