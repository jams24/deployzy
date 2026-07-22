package analytics

import "testing"

func TestClassifyBot(t *testing.T) {
	cases := map[string]string{
		"Mozilla/5.0 AppleWebKit (compatible; GPTBot/1.2; +https://openai.com/gptbot)":       "GPTBot",
		"Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)":                  "ClaudeBot",
		"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)":           "Googlebot",
		"Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)":            "Bingbot",
		"Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)":  "PerplexityBot",
		"Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)":                 "AhrefsBot",
		"curl/8.4.0":            "curl",
		"python-requests/2.31.0": "python-requests",
		// A real browser must never be classified as a crawler.
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36": "",
	}
	for ua, want := range cases {
		if got := ClassifyBot(ua); got != want {
			t.Errorf("ClassifyBot(%.40s…) = %q, want %q", ua, got, want)
		}
	}
}

// Google-Extended must not be swallowed by the generic "googlebot" rule —
// they mean different things (Gemini training vs search indexing).
func TestSpecificBeatsGeneric(t *testing.T) {
	if got := ClassifyBot("Mozilla/5.0 (compatible; Google-Extended/1.0)"); got != "Google-Extended" {
		t.Errorf("Google-Extended misclassified as %q", got)
	}
	if BotCategory("GPTBot") != "ai" || BotCategory("Googlebot") != "search" {
		t.Error("bot categories wrong")
	}
}
