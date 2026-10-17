package api

import (
	"net/http"
	"sort"
	"strconv"
	"time"
)

// GET /api/v1/admin/seo — SEO & LLM insight for deployzy.com. Aggregates the
// page-view-level counts from the Caddy-log ingester (seo_daily2: successful
// page views only; scanners and scripts kept apart as probes) into a shape the
// admin UI renders directly, plus a few data-driven tips.

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
	// kind → name → aggregate. Kinds: crawler, referral, human, probe.
	groups := map[string]map[string]*seoNameCount{
		"crawler": {}, "referral": {}, "human": {}, "probe": {},
	}
	daily := map[string]*seoDay{} // day → human page views + crawls, for the trend
	for _, row := range rows {
		g := groups[row.Kind]
		if g == nil {
			continue
		}
		agg := g[row.Channel+"/"+row.Name]
		if agg == nil {
			agg = &seoNameCount{Name: row.Name, Channel: row.Channel}
			g[row.Channel+"/"+row.Name] = agg
		}
		agg.Hits += row.Hits
		if row.Day >= cutoff7 {
			agg.Recent += row.Hits
		}
		d := daily[row.Day]
		if d == nil {
			d = &seoDay{Day: row.Day}
			daily[row.Day] = d
		}
		switch row.Kind {
		case "human":
			d.Pageviews += row.Hits
		case "crawler":
			if row.Channel == "ai" {
				d.AICrawls += row.Hits
			} else if row.Channel == "search" {
				d.SearchCrawls += row.Hits
			}
		case "referral":
			d.Referrals += row.Hits
		}
	}

	crawlerList := sortedCounts(groups["crawler"])
	referralList := sortedCounts(groups["referral"])
	probeList := sortedCounts(groups["probe"])

	var aiCrawlerHits, searchCrawlerHits, llmReferralHits, searchReferralHits, pageviews, probeHits, scriptHits int64
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
	for _, ref := range referralList {
		switch ref.Channel {
		case "llm":
			llmReferralHits += ref.Hits
		case "search":
			searchReferralHits += ref.Hits
		}
	}
	for _, h := range groups["human"] {
		pageviews += h.Hits
	}
	for _, p := range probeList {
		if p.Channel == "script" {
			scriptHits += p.Hits
		} else {
			probeHits += p.Hits
		}
	}
	trend := make([]seoDay, 0, len(daily))
	for _, d := range daily {
		trend = append(trend, *d)
	}
	sort.Slice(trend, func(i, j int) bool { return trend[i].Day < trend[j].Day })

	state, _ := s.db.GetSEOIngestState(r.Context())
	tips := buildSEOTips(len(rows) == 0, aiSeen, searchSeen, aiCrawlerHits, llmReferralHits, searchReferralHits, crawlerList)
	if probeHits > 0 && pageviews > 0 && probeHits > pageviews {
		tips = append(tips, map[string]string{"tone": "info", "text": "Vulnerability scanners make more requests than real visitors (probes for /.git, /wp-admin, .env files…). They're excluded from every number above and all hit 404 — nothing to fix unless a probed path ever returns 200."})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"days":       days,
		"has_data":   len(rows) > 0,
		"data_since": state.SinceDay, // oldest day the accurate counts cover
		"crawlers":   crawlerList,
		"referrals":  referralList,
		"probes":     probeList,
		"trend":      trend,
		"totals": map[string]int64{
			"human_pageviews":      pageviews,
			"ai_crawler_hits":      aiCrawlerHits,
			"search_crawler_hits":  searchCrawlerHits,
			"llm_referral_hits":    llmReferralHits,
			"search_referral_hits": searchReferralHits,
			"probe_hits":           probeHits,
			"script_hits":          scriptHits,
		},
		"tips": tips,
	})
}

type seoDay struct {
	Day          string `json:"day"`
	Pageviews    int64  `json:"pageviews"`
	AICrawls     int64  `json:"ai_crawls"`
	SearchCrawls int64  `json:"search_crawls"`
	Referrals    int64  `json:"referrals"`
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
