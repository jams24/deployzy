package analytics

import "strings"

// Crawler identification. is_bot alone tells you 7% of your traffic was
// automated; it can't tell you whether that was Google indexing you or an AI
// company scraping you, which is the question people actually ask now.
//
// Ordered longest/most-specific first so "Google-Extended" isn't swallowed by
// "googlebot", and AI crawlers are matched before generic patterns.
var botSignatures = []struct{ match, name string }{
	// AI / LLM crawlers — the ones most people want visibility into.
	{"gptbot", "GPTBot"},                    // OpenAI training
	{"oai-searchbot", "OAI-SearchBot"},      // OpenAI search index
	{"chatgpt-user", "ChatGPT-User"},        // live browsing on user request
	{"claudebot", "ClaudeBot"},              // Anthropic training
	{"claude-web", "Claude-Web"},            // Anthropic live fetch
	{"anthropic-ai", "Anthropic-AI"},
	{"perplexitybot", "PerplexityBot"},
	{"perplexity-user", "Perplexity-User"},
	{"google-extended", "Google-Extended"},  // Gemini training opt-out token
	{"applebot-extended", "Applebot-Extended"},
	{"bytespider", "Bytespider"},            // ByteDance/TikTok
	{"ccbot", "CCBot"},                      // Common Crawl (feeds many models)
	{"meta-externalagent", "Meta-ExternalAgent"},
	{"amazonbot", "Amazonbot"},
	{"cohere-ai", "Cohere-AI"},
	{"diffbot", "Diffbot"},
	{"omgili", "Omgili"},
	{"timpibot", "TimpiBot"},

	// Search engines.
	{"googlebot", "Googlebot"},
	{"bingbot", "Bingbot"},
	{"duckduckbot", "DuckDuckBot"},
	{"yandexbot", "YandexBot"},
	{"baiduspider", "Baiduspider"},
	{"slurp", "Yahoo Slurp"},
	{"applebot", "Applebot"},
	{"petalbot", "PetalBot"},
	{"seznambot", "SeznamBot"},

	// Social / link unfurlers.
	{"facebookexternalhit", "Facebook"},
	{"twitterbot", "Twitterbot"},
	{"linkedinbot", "LinkedInBot"},
	{"slackbot", "Slackbot"},
	{"discordbot", "Discordbot"},
	{"telegrambot", "TelegramBot"},
	{"whatsapp", "WhatsApp"},
	{"redditbot", "Redditbot"},
	{"pinterest", "Pinterest"},

	// SEO / marketing crawlers — usually the ones worth blocking.
	{"ahrefsbot", "AhrefsBot"},
	{"semrushbot", "SemrushBot"},
	{"mj12bot", "MJ12bot"},
	{"dotbot", "DotBot"},
	{"screaming frog", "Screaming Frog"},
	{"barkrowler", "Barkrowler"},

	// Monitoring / tooling.
	{"uptimerobot", "UptimeRobot"},
	{"pingdom", "Pingdom"},
	{"statuscake", "StatusCake"},
	{"betteruptime", "BetterUptime"},
	{"datadog", "Datadog"},
	{"lighthouse", "Lighthouse"},
	{"headlesschrome", "HeadlessChrome"},

	// Generic clients — last, so a named bot always wins.
	{"python-requests", "python-requests"},
	{"curl/", "curl"},
	{"wget/", "wget"},
	{"go-http-client", "Go-http-client"},
	{"axios", "axios"},
	{"node-fetch", "node-fetch"},
	{"java/", "Java"},
	{"okhttp", "OkHttp"},
	{"scrapy", "Scrapy"},
}

// ClassifyBot returns a friendly crawler name for a user agent, or "" when the
// UA isn't recognised as a bot. Callers should only persist this when
// ParseUA already flagged the request as a bot; an unrecognised bot is stored
// as "Other bot" so the breakdown always sums to the bot total.
func ClassifyBot(ua string) string {
	if ua == "" {
		return ""
	}
	low := strings.ToLower(ua)
	for _, sig := range botSignatures {
		if strings.Contains(low, sig.match) {
			return sig.name
		}
	}
	return ""
}

// BotCategory groups a crawler name for the "why is this traffic here" view.
func BotCategory(name string) string {
	switch name {
	case "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web",
		"Anthropic-AI", "PerplexityBot", "Perplexity-User", "Google-Extended",
		"Applebot-Extended", "Bytespider", "CCBot", "Meta-ExternalAgent",
		"Amazonbot", "Cohere-AI", "Diffbot", "Omgili", "TimpiBot":
		return "ai"
	case "Googlebot", "Bingbot", "DuckDuckBot", "YandexBot", "Baiduspider",
		"Yahoo Slurp", "Applebot", "PetalBot", "SeznamBot":
		return "search"
	case "Facebook", "Twitterbot", "LinkedInBot", "Slackbot", "Discordbot",
		"TelegramBot", "WhatsApp", "Redditbot", "Pinterest":
		return "social"
	case "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "Screaming Frog", "Barkrowler":
		return "seo"
	case "UptimeRobot", "Pingdom", "StatusCake", "BetterUptime", "Datadog",
		"Lighthouse", "HeadlessChrome":
		return "monitoring"
	}
	return "other"
}
