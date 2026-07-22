package db

import (
	"context"
	"fmt"
	"time"
)

// Platform-wide traffic analytics for the admin console. The per-project
// helpers in site_analytics.go answer "how is MY site doing"; these answer
// "what is the whole platform serving" — every query aggregates across all
// projects rather than taking a project_id.
//
// Caveat worth knowing when reading these numbers: site_events is pruned per
// the owner's plan (free = 7 days), so windows longer than a week
// under-represent free-tier projects. Phase 3 rollups will fix that by
// aggregating before the prune runs.

// PlatformOverview is the headline row of the admin analytics tab.
type PlatformOverview struct {
	Pageviews    int64 `json:"pageviews"`
	Visitors     int64 `json:"visitors"`
	BotHits      int64 `json:"bot_hits"`
	BytesServed  int64 `json:"bytes_served"`
	ErrorHits    int64 `json:"error_hits"`     // status >= 400
	ActiveSites  int64 `json:"active_sites"`   // projects that served traffic
}

// PlatformTimeseriesPoint splits human and bot traffic per bucket so the chart
// can stack them — bot volume is the interesting half on a hosting platform.
type PlatformTimeseriesPoint struct {
	TS        time.Time `json:"ts"`
	Pageviews int64     `json:"pageviews"`
	Visitors  int64     `json:"visitors"`
	BotHits   int64     `json:"bot_hits"`
}

// PlatformProjectRow is one line of the "busiest projects" table.
type PlatformProjectRow struct {
	ProjectID  string `json:"project_id"`
	Name       string `json:"name"`
	Subdomain  string `json:"subdomain"`
	OwnerEmail string `json:"owner_email"`
	Pageviews  int64  `json:"pageviews"`
	Visitors   int64  `json:"visitors"`
	BotHits    int64  `json:"bot_hits"`
	Bytes      int64  `json:"bytes"`
	ErrorHits  int64  `json:"error_hits"`
}

// GetPlatformOverview returns headline traffic counts across every project.
func (d *DB) GetPlatformOverview(ctx context.Context, since time.Time) (PlatformOverview, error) {
	var o PlatformOverview
	err := d.Pool.QueryRow(ctx,
		`SELECT
		   COUNT(*) FILTER (WHERE is_bot = false),
		   COUNT(DISTINCT visitor_hash) FILTER (WHERE is_bot = false),
		   COUNT(*) FILTER (WHERE is_bot = true),
		   COALESCE(SUM(bytes), 0),
		   COUNT(*) FILTER (WHERE status >= 400),
		   COUNT(DISTINCT project_id)
		 FROM site_events
		 WHERE ts >= $1`,
		since,
	).Scan(&o.Pageviews, &o.Visitors, &o.BotHits, &o.BytesServed, &o.ErrorHits, &o.ActiveSites)
	return o, err
}

// GetPlatformTimeseries buckets platform traffic, splitting human vs bot.
// bucket is a Postgres interval literal ('1 hour', '1 day', ...) chosen by the
// handler from the requested period — never taken from raw user input.
func (d *DB) GetPlatformTimeseries(ctx context.Context, since time.Time, bucket string) ([]PlatformTimeseriesPoint, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT date_bin($2::interval, ts, TIMESTAMP '1970-01-01') AS b,
		        COUNT(*) FILTER (WHERE is_bot = false),
		        COUNT(DISTINCT visitor_hash) FILTER (WHERE is_bot = false),
		        COUNT(*) FILTER (WHERE is_bot = true)
		 FROM site_events
		 WHERE ts >= $1
		 GROUP BY b
		 ORDER BY b ASC`,
		since, bucket,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlatformTimeseriesPoint{}
	for rows.Next() {
		var p PlatformTimeseriesPoint
		if err := rows.Scan(&p.TS, &p.Pageviews, &p.Visitors, &p.BotHits); err != nil {
			return nil, fmt.Errorf("scan timeseries: %w", err)
		}
		out = append(out, p)
	}
	return out, nil
}

// GetPlatformTop returns the top N values of an allowlisted column across all
// projects. includeBots selects the traffic class: referrers/paths are more
// useful human-only, while crawler analysis wants the bot rows.
func (d *DB) GetPlatformTop(ctx context.Context, col string, since time.Time, limit int, includeBots bool) ([]SiteTopRow, error) {
	botFilter := "is_bot = false"
	if includeBots {
		botFilter = "is_bot = true"
	}
	// col is allowlisted by the handler — a column name cannot be parameterized.
	query := `SELECT ` + col + ` AS k, COUNT(*) AS c
		 FROM site_events
		 WHERE ts >= $1 AND ` + botFilter + ` AND ` + col + ` <> ''
		 GROUP BY k ORDER BY c DESC LIMIT $2`
	rows, err := d.Pool.Query(ctx, query, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SiteTopRow{}
	for rows.Next() {
		var r SiteTopRow
		if err := rows.Scan(&r.Key, &r.Count); err != nil {
			return nil, fmt.Errorf("scan top %s: %w", col, err)
		}
		out = append(out, r)
	}
	return out, nil
}

// GetPlatformTopProjects ranks projects by traffic in the window, joined to
// their owner so an operator can see who is generating platform load.
func (d *DB) GetPlatformTopProjects(ctx context.Context, since time.Time, limit int) ([]PlatformProjectRow, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT e.project_id,
		        COALESCE(p.name, '(deleted)'),
		        COALESCE(p.subdomain, ''),
		        COALESCE(u.email, ''),
		        COUNT(*) FILTER (WHERE e.is_bot = false),
		        COUNT(DISTINCT e.visitor_hash) FILTER (WHERE e.is_bot = false),
		        COUNT(*) FILTER (WHERE e.is_bot = true),
		        COALESCE(SUM(e.bytes), 0),
		        COUNT(*) FILTER (WHERE e.status >= 400)
		 FROM site_events e
		 LEFT JOIN projects p ON p.id = e.project_id
		 LEFT JOIN users u ON u.id = p.user_id
		 WHERE e.ts >= $1
		 GROUP BY e.project_id, p.name, p.subdomain, u.email
		 ORDER BY COUNT(*) DESC
		 LIMIT $2`,
		since, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlatformProjectRow{}
	for rows.Next() {
		var r PlatformProjectRow
		if err := rows.Scan(&r.ProjectID, &r.Name, &r.Subdomain, &r.OwnerEmail,
			&r.Pageviews, &r.Visitors, &r.BotHits, &r.Bytes, &r.ErrorHits); err != nil {
			return nil, fmt.Errorf("scan top projects: %w", err)
		}
		out = append(out, r)
	}
	return out, nil
}

// CrawlerRow is one line of the bot breakdown.
type CrawlerRow struct {
	Name     string `json:"name"`
	Category string `json:"category"` // ai | search | social | seo | monitoring | other
	Hits     int64  `json:"hits"`
	Sites    int64  `json:"sites"` // how many projects it crawled
}

// GetPlatformCrawlers breaks bot traffic down by crawler identity. Rows
// predating the bot_name column have an empty name (the raw user agent is
// never stored, so they can't be backfilled) and are reported as
// "Unclassified" rather than silently dropped — otherwise the breakdown
// wouldn't sum to the bot total shown in the headline tile.
func (d *DB) GetPlatformCrawlers(ctx context.Context, since time.Time, limit int) ([]CrawlerRow, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT CASE WHEN bot_name = '' THEN 'Unclassified' ELSE bot_name END AS name,
		        COUNT(*) AS hits,
		        COUNT(DISTINCT project_id) AS sites
		 FROM site_events
		 WHERE ts >= $1 AND is_bot = true
		 GROUP BY name
		 ORDER BY hits DESC
		 LIMIT $2`,
		since, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CrawlerRow{}
	for rows.Next() {
		var c CrawlerRow
		if err := rows.Scan(&c.Name, &c.Hits, &c.Sites); err != nil {
			return nil, fmt.Errorf("scan crawlers: %w", err)
		}
		out = append(out, c)
	}
	return out, nil
}
