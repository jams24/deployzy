package api

import (
	"net/http"
	"time"

	"github.com/serverme/serverme/server/internal/analytics"
	"github.com/serverme/serverme/server/internal/db"
)

// periodWindow maps a UI period to (since, bucket). Bucket sizes keep every
// chart around 24-60 points: fine enough to see shape, small enough that the
// payload and the GROUP BY stay cheap.
func periodWindow(period string) (time.Time, string, string) {
	now := time.Now()
	switch period {
	case "day":
		return now.Add(-24 * time.Hour), "1 hour", "day"
	case "week":
		return now.AddDate(0, 0, -7), "6 hours", "week"
	case "month":
		return now.AddDate(0, -1, 0), "1 day", "month"
	case "year":
		return now.AddDate(-1, 0, 0), "1 week", "year"
	case "all":
		// site_events started 2026-04; anything earlier is empty anyway.
		return time.Unix(0, 0), "1 week", "all"
	}
	return now.AddDate(0, 0, -7), "6 hours", "week"
}

// topColumns is the allowlist for GetPlatformTop. A column name can't be
// parameterized, so nothing outside this map ever reaches the query builder.
var topColumns = map[string]bool{
	"path": true, "referrer": true, "country": true,
	"device": true, "browser": true, "os": true,
}

// handleAdminAnalytics returns platform-wide traffic for the admin console:
// headline counts, a human-vs-bot timeseries, top breakdowns, and the busiest
// projects. One endpoint rather than six so the tab renders in a single fetch.
func (s *Server) handleAdminAnalytics(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	since, bucket, resolved := periodWindow(period)

	// Long windows read daily rollups: fast, and complete even where raw
	// events have already been pruned for free-tier projects.
	useRollups := db.UseRollups(since)

	var overview db.PlatformOverview
	var err error
	if useRollups {
		overview, err = s.db.GetPlatformOverviewRollup(r.Context(), since)
	} else {
		overview, err = s.db.GetPlatformOverview(r.Context(), since)
	}
	if err != nil {
		s.log.Error().Err(err).Msg("admin analytics: overview")
		writeError(w, http.StatusInternalServerError, "failed to load analytics")
		return
	}

	var series []db.PlatformTimeseriesPoint
	if useRollups {
		series, err = s.db.GetPlatformTimeseriesRollup(r.Context(), since)
	} else {
		series, err = s.db.GetPlatformTimeseries(r.Context(), since, bucket)
	}
	if err != nil {
		s.log.Error().Err(err).Msg("admin analytics: timeseries")
		writeError(w, http.StatusInternalServerError, "failed to load analytics")
		return
	}

	topSince := since
	if cutoff := time.Now().AddDate(0, 0, -30); topSince.Before(cutoff) {
		topSince = cutoff
	}
	tops := map[string][]interface{}{}
	top := func(col string, includeBots bool, limit int) []interface{} {
		if !topColumns[col] {
			return nil
		}
		rows, err := s.db.GetPlatformTop(r.Context(), col, topSince, limit, includeBots)
		if err != nil {
			s.log.Warn().Err(err).Str("col", col).Msg("admin analytics: top query failed")
			return []interface{}{}
		}
		out := make([]interface{}, 0, len(rows))
		for _, row := range rows {
			out = append(out, row)
		}
		return out
	}
	// Breakdown lists always read raw events — the rollups intentionally don't
	// store path/referrer/country dimensions (that would multiply row count by
	// cardinality). Cap their lookback at 30 days: scanning the full table five
	// times is what made long windows slow, and a year-old referrer list is far
	// less useful than a recent one anyway.
	tops["referrers"] = top("referrer", false, 10)
	tops["paths"] = top("path", false, 10)
	tops["countries"] = top("country", false, 10)
	tops["devices"] = top("device", false, 6)
	tops["browsers"] = top("browser", false, 6)

	var crawlers []db.CrawlerRow
	if useRollups {
		crawlers, err = s.db.GetPlatformCrawlersRollup(r.Context(), since, 12)
	} else {
		crawlers, err = s.db.GetPlatformCrawlers(r.Context(), since, 12)
	}
	if err != nil {
		s.log.Error().Err(err).Msg("admin analytics: crawlers")
		writeError(w, http.StatusInternalServerError, "failed to load analytics")
		return
	}
	// Category is derived in Go so the taxonomy lives next to the signature
	// list rather than being duplicated in SQL.
	crawlerRows := make([]map[string]interface{}, 0, len(crawlers))
	for _, c := range crawlers {
		crawlerRows = append(crawlerRows, map[string]interface{}{
			"name":     c.Name,
			"category": analytics.BotCategory(c.Name),
			"hits":     c.Hits,
			"sites":    c.Sites,
		})
	}

	var projects []db.PlatformProjectRow
	if useRollups {
		projects, err = s.db.GetPlatformTopProjectsRollup(r.Context(), since, 15)
	} else {
		projects, err = s.db.GetPlatformTopProjects(r.Context(), since, 15)
	}
	if err != nil {
		s.log.Error().Err(err).Msg("admin analytics: top projects")
		writeError(w, http.StatusInternalServerError, "failed to load analytics")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"period":       resolved,
		"since":        since,
		"overview":     overview,
		"timeseries":   series,
		"top":          tops,
		"top_from_raw": true,
		"top_since":    topSince,
		"crawlers":     crawlerRows,
		"projects":     projects,
		// Surfaced in the UI so nobody reads long windows as complete: free-tier
		// events are pruned after 7 days.
		"source":         map[bool]string{true: "rollup", false: "raw"}[useRollups],
		"visitors_exact": !useRollups,
		"retention_note": map[bool]string{
			true:  "Long windows are served from daily rollups, so history survives retention pruning. Visitors is the sum of daily uniques — someone returning on three days counts three times.",
			false: "Served from raw events: visitor counts are exact unique people for this window.",
		}[useRollups],
	})
}
