package analytics

import (
	"regexp"
	"strings"
)

// Referrer classification for the SEO/LLM insight view: where did a human
// visitor come from? We care about two channels specifically — organic search
// engines and LLM assistants (people increasingly arrive from a ChatGPT/
// Perplexity answer rather than a Google result).

// referrerSignatures maps a referrer DOMAIN to a friendly source and channel.
// Matching is on domain boundaries (host == domain or host ends in
// "."+domain) — never a bare substring, which made "x.com" match netflix.com
// and "t.co" match any host containing those letters.
var referrerSignatures = []struct{ domain, source, channel string }{
	// LLM assistants — arriving from an AI answer.
	{"chatgpt.com", "ChatGPT", "llm"},
	{"chat.openai.com", "ChatGPT", "llm"},
	{"perplexity.ai", "Perplexity", "llm"},
	{"claude.ai", "Claude", "llm"},
	{"gemini.google.com", "Gemini", "llm"},
	{"bard.google.com", "Gemini", "llm"},
	{"copilot.microsoft.com", "Copilot", "llm"},
	{"you.com", "You.com", "llm"},
	{"poe.com", "Poe", "llm"},
	{"phind.com", "Phind", "llm"},
	{"chat.deepseek.com", "DeepSeek", "llm"},
	{"grok.com", "Grok", "llm"},

	// Search engines — organic search. Google and Yandex use many country
	// domains and are matched by searchHost below.
	{"bing.com", "Bing", "search"},
	{"duckduckgo.com", "DuckDuckGo", "search"},
	{"search.yahoo.com", "Yahoo", "search"},
	{"baidu.com", "Baidu", "search"},
	{"ecosia.org", "Ecosia", "search"},
	{"search.brave.com", "Brave Search", "search"},
	{"startpage.com", "Startpage", "search"},

	// Social / community.
	{"t.co", "X / Twitter", "social"},
	{"twitter.com", "X / Twitter", "social"},
	{"x.com", "X / Twitter", "social"},
	{"linkedin.com", "LinkedIn", "social"},
	{"lnkd.in", "LinkedIn", "social"},
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
	{"web.telegram.org", "Telegram", "social"},
}

// searchHost matches the search front-ends of engines with per-country
// domains: www.google.com, google.co.uk, google.com.br, yandex.ru, ...
// accounts./mail./docs.google.com are deliberately NOT search (an OAuth
// sign-in redirect is a login, not an organic visit).
var searchHost = regexp.MustCompile(`^(www\.)?(google|yandex)\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$`)

func domainMatch(host, domain string) bool {
	return host == domain || strings.HasSuffix(host, "."+domain)
}

// ClassifyReferrer maps a referrer host to (source, channel). channel is one of
// "search", "llm", "social", or "" when unrecognised. An empty host is treated
// as direct/unknown and returns ("", "").
func ClassifyReferrer(host string) (source, channel string) {
	if host == "" {
		return "", ""
	}
	low := strings.ToLower(strings.TrimPrefix(host, "www."))
	if i := strings.IndexByte(low, ':'); i >= 0 {
		low = low[:i]
	}
	if m := searchHost.FindStringSubmatch(low); m != nil {
		if m[2] == "google" {
			return "Google", "search"
		}
		return "Yandex", "search"
	}
	for _, sig := range referrerSignatures {
		if domainMatch(low, sig.domain) {
			return sig.source, sig.channel
		}
	}
	return "", ""
}
