package api

import (
	"net/http"
	"sort"
	"strconv"
	"time"
)

// GET /api/v1/admin/seo — SEO & LLM insight for deployzy.com. Aggregates the
// crawler + referral data collected by the Caddy-log ingester into a shape the
// admin UI can render directly, plus a few data-driven tips.

type seoNameCount struct {
	Name    string `json:"name"`
	Channel string `json:"channel"`
	Hits    int64  `json:"hits"`
	Recent  int64  `json:"recent"` // hits in the last 7 days
}

func (s *Server) handleAdminSEO(w http.ResponseWriter, r *http.Request) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days <= 0 {
		days = 30
	}
	rows, err := s.db.GetSEODaily(r.Context(), days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load seo data")
		return
	}

	cutoff7 := time.Now().AddDate(0, 0, -7).Format("2006-01-02")
	crawlers := map[string]*seoNameCount{}   // name → agg
	referrals := map[string]*seoNameCount{}  // name → agg
	channelTotals := map[string]int64{}      // channel → hits (crawlers + referrals)
	var totalCrawler, totalReferral int64

	for _, row := range rows {
		target := crawlers
		if row.Kind == "referral" {
			target = referrals
			totalReferral += row.Hits
		} else {
			totalCrawler += row.Hits
		}
		agg := target[row.Name]
		if agg == nil {
			agg = &seoNameCount{Name: row.Name, Channel: row.Channel}
			target[row.Name] = agg
		}
		agg.Hits += row.Hits
		if row.Day >= cutoff7 {
			agg.Recent += row.Hits
		}
		channelTotals[row.Kind+":"+row.Channel] += row.Hits
	}

	crawlerList := sortedCounts(crawlers)
	referralList := sortedCounts(referrals)

	// Split crawlers into AI vs search vs other for the headline cards.
	var aiCrawlerHits, searchCrawlerHits int64
	aiSeen, searchSeen := map[string]bool{}, map[string]bool{}
	for _, c := range crawlerList {
		switch c.Channel {
		case "ai":
			aiCrawlerHits += c.Hits
			aiSeen[c.Name] = true
		case "search":
			searchCrawlerHits += c.Hits
			searchSeen[c.Name] = true
		}
	}
	var llmReferralHits, searchReferralHits int64
	for _, ref := range referralList {
		switch ref.Channel {
		case "llm":
			llmReferralHits += ref.Hits
		case "search":
			searchReferralHits += ref.Hits
		}
	}

	tips := buildSEOTips(len(rows) == 0, aiSeen, searchSeen, aiCrawlerHits, llmReferralHits, searchReferralHits, crawlerList)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"days":          days,
		"has_data":      len(rows) > 0,
		"crawlers":      crawlerList,
		"referrals":     referralList,
		"totals": map[string]int64{
			"crawler_hits":         totalCrawler,
			"referral_hits":        totalReferral,
			"ai_crawler_hits":      aiCrawlerHits,
			"search_crawler_hits":  searchCrawlerHits,
			"llm_referral_hits":    llmReferralHits,
			"search_referral_hits": searchReferralHits,
		},
		"tips": tips,
	})
}

func sortedCounts(m map[string]*seoNameCount) []seoNameCount {
	out := make([]seoNameCount, 0, len(m))
	for _, v := range m {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Hits > out[j].Hits })
	return out
}

// buildSEOTips turns the aggregates into actionable, mostly data-driven advice.
func buildSEOTips(noData bool, aiSeen, searchSeen map[string]bool, aiCrawlerHits, llmReferralHits, searchReferralHits int64, crawlers []seoNameCount) []map[string]string {
	tip := func(tone, text string) map[string]string { return map[string]string{"tone": tone, "text": text} }
	var tips []map[string]string

	if noData {
		tips = append(tips, tip("info", "No data yet — the ingester started collecting from the Caddy access log. Crawler hits and referrals will appear here as traffic comes in (usually within a day)."))
		return tips
	}

	// Search engine indexing.
	if !searchSeen["Googlebot"] {
		tips = append(tips, tip("warn", "Googlebot hasn't fetched deployzy.com in this window. Check that robots.txt isn't blocking it and submit your sitemap in Google Search Console."))
	} else {
		tips = append(tips, tip("good", "Googlebot is actively crawling you — you're being indexed. Keep your sitemap fresh and page titles/descriptions unique."))
	}

	// AI / LLM crawler exposure.
	if aiCrawlerHits == 0 {
		tips = append(tips, tip("warn", "No AI crawlers (GPTBot, ClaudeBot, PerplexityBot…) have fetched you yet. To be cited by LLMs, make sure you're NOT blocking them in robots.txt and publish clear, factual docs pages they can quote."))
	} else {
		names := []string{}
		for _, c := range crawlers {
			if c.Channel == "ai" {
				names = append(names, c.Name)
			}
		}
		tips = append(tips, tip("good", "AI crawlers are fetching your content ("+joinTop(names, 3)+") — your pages are eligible to be cited in LLM answers. Keep facts explicit and up to date so they're quoted accurately."))
	}

	// LLM referral traffic.
	if llmReferralHits == 0 {
		tips = append(tips, tip("info", "No human visits from LLM assistants (ChatGPT, Perplexity, Claude) yet. As LLMs index you, clicks from their citations will show up here — a growing traffic channel worth watching."))
	} else {
		tips = append(tips, tip("good", "You're getting real traffic from LLM answers — people are clicking through from AI assistants. This is a signal your content is being surfaced as an authoritative source."))
	}

	// Organic search referral traffic.
	if searchReferralHits == 0 {
		tips = append(tips, tip("info", "No organic search clicks recorded yet in this window. New sites take weeks to rank — focus on a few high-intent keywords (e.g. 'railway alternative', 'self-host deploy') and one solid landing page each."))
	}

	return tips
}

func joinTop(names []string, n int) string {
	if len(names) > n {
		names = names[:n]
	}
	out := ""
	for i, s := range names {
		if i > 0 {
			out += ", "
		}
		out += s
	}
	return out
}
