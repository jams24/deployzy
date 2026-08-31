package analytics

import "strings"

// Referrer classification for the SEO/LLM insight view: where did a human
// visitor come from? We care about two channels specifically — organic search
// engines and LLM assistants (people increasingly arrive from a ChatGPT/
// Perplexity answer rather than a Google result).

// referrerSignatures maps a substring of the referrer HOST to a friendly source
// name and a channel. Ordered so the most specific host wins.
var referrerSignatures = []struct{ match, source, channel string }{
	// LLM assistants — arriving from an AI answer.
	{"chatgpt.com", "ChatGPT", "llm"},
	{"chat.openai.com", "ChatGPT", "llm"},
	{"openai.com", "ChatGPT", "llm"},
	{"perplexity.ai", "Perplexity", "llm"},
	{"claude.ai", "Claude", "llm"},
	{"gemini.google.com", "Gemini", "llm"},
	{"bard.google.com", "Gemini", "llm"},
	{"copilot.microsoft.com", "Copilot", "llm"},
	{"you.com", "You.com", "llm"},
	{"poe.com", "Poe", "llm"},
	{"phind.com", "Phind", "llm"},

	// Search engines — organic search.
	{"google.", "Google", "search"},
	{"bing.com", "Bing", "search"},
	{"duckduckgo.com", "DuckDuckGo", "search"},
	{"yahoo.com", "Yahoo", "search"},
	{"yandex.", "Yandex", "search"},
	{"baidu.com", "Baidu", "search"},
	{"ecosia.org", "Ecosia", "search"},
	{"brave.com", "Brave Search", "search"},
	{"search.brave.com", "Brave Search", "search"},

	// Social / community.
	{"t.co", "X / Twitter", "social"},
	{"twitter.com", "X / Twitter", "social"},
	{"x.com", "X / Twitter", "social"},
	{"linkedin.com", "LinkedIn", "social"},
	{"reddit.com", "Reddit", "social"},
	{"news.ycombinator.com", "Hacker News", "social"},
	{"facebook.com", "Facebook", "social"},
	{"youtube.com", "YouTube", "social"},
	{"github.com", "GitHub", "social"},
	{"producthunt.com", "Product Hunt", "social"},
	{"dev.to", "DEV", "social"},
	{"medium.com", "Medium", "social"},
	{"discord.com", "Discord", "social"},
	{"t.me", "Telegram", "social"},
}

// ClassifyReferrer maps a referrer host to (source, channel). channel is one of
// "search", "llm", "social", or "" when unrecognised. An empty host is treated
// as direct/unknown and returns ("", "").
func ClassifyReferrer(host string) (source, channel string) {
	if host == "" {
		return "", ""
	}
	low := strings.ToLower(strings.TrimPrefix(host, "www."))
	for _, sig := range referrerSignatures {
		if strings.Contains(low, sig.match) {
			return sig.source, sig.channel
		}
	}
	return "", ""
}
