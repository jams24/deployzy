package deploy

import (
	"fmt"
	"testing"

	"github.com/serverme/serverme/server/internal/db"
)

func seoLine(uri, ua, ref string, status int) []byte {
	return []byte(fmt.Sprintf(`{"ts":1760700000,"request":{"host":"deployzy.com","method":"GET","uri":%q,"headers":{"User-Agent":[%q],"Referer":[%q]}},"status":%d}`, uri, ua, ref, status))
}

const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"

func TestSEOClassifyLine(t *testing.T) {
	s := &SEOIngester{}
	c := map[db.SEOCountKey]int64{}
	day := "2025-10-17"
	k := func(kind, ch, name string) int64 {
		return c[db.SEOCountKey{Day: day, Kind: kind, Channel: ch, Name: name}]
	}

	// Real visit from Google search: 1 page view + 1 search referral; its assets don't count.
	s.classifyLine(seoLine("/", chrome, "https://www.google.com/", 200), c)
	s.classifyLine(seoLine("/_next/static/chunks/a.js", chrome, "https://deployzy.com/", 200), c)
	s.classifyLine(seoLine("/logo.png", chrome, "https://deployzy.com/", 200), c)
	// Scanner spoofing a Google referrer on a 404 probe → probe, not search.
	s.classifyLine(seoLine("//images/cache.php", chrome, "https://www.google.com/", 404), c)
	// Google sign-in redirect back to us → not search, and /auth isn't a page.
	s.classifyLine(seoLine("/auth/callback", chrome, "https://accounts.google.com/", 200), c)
	// curl hammering 404s → probe/scanner; curl getting a 200 → probe/script.
	s.classifyLine(seoLine("/.git/config", "curl/8.4.0", "", 404), c)
	s.classifyLine(seoLine("/", "curl/8.4.0", "", 200), c)
	// Crawlers: page and llms.txt count; their asset fetches and 404s don't.
	s.classifyLine(seoLine("/blog/x", "Mozilla/5.0 (compatible; GPTBot/1.2)", "", 200), c)
	s.classifyLine(seoLine("/llms.txt", "Mozilla/5.0 (compatible; GPTBot/1.2)", "", 200), c)
	s.classifyLine(seoLine("/_next/static/x.css", "Mozilla/5.0 (compatible; GPTBot/1.2)", "", 200), c)
	s.classifyLine(seoLine("/gone", "Mozilla/5.0 (compatible; Googlebot/2.1)", "", 404), c)
	// Next.js RSC navigation / prefetch: not a page load.
	s.classifyLine(seoLine("/projects?_rsc=abc", chrome, "https://deployzy.com/", 200), c)
	// ChatGPT referral.
	s.classifyLine(seoLine("/projects", chrome, "https://chatgpt.com/", 200), c)

	checks := []struct {
		kind, ch, name string
		want           int64
	}{
		{"human", "pageview", "pageviews", 2},
		{"referral", "search", "Google", 1},
		{"referral", "llm", "ChatGPT", 1},
		{"probe", "scanner", "Browser-like", 1},
		{"probe", "scanner", "curl", 1},
		{"probe", "script", "curl", 1},
		{"crawler", "ai", "GPTBot", 2},
		{"crawler", "search", "Googlebot", 0},
	}
	for _, ch := range checks {
		if got := k(ch.kind, ch.ch, ch.name); got != ch.want {
			t.Errorf("%s/%s/%s = %d, want %d", ch.kind, ch.ch, ch.name, got, ch.want)
		}
	}
}
