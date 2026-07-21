package db

import (
	"context"
	"time"
)

// SiteAnalyticsOverview is the headline numbers for a project dashboard.
type SiteAnalyticsOverview struct {
	Pageviews int64 `json:"pageviews"`
	Visitors  int64 `json:"visitors"`
	Bots      int64 `json:"bots"`
}

// SiteTimeseriesPoint is one bucketed point for the pageviews/visitors chart.
type SiteTimeseriesPoint struct {
	TS        time.Time `json:"ts"`
	Pageviews int64     `json:"pageviews"`
	Visitors  int64     `json:"visitors"`
}

// SiteTopRow is a top-N list row (pages, referrers, countries, browsers, etc.).
type SiteTopRow struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

// GetSiteOverview returns the high-level counts for a window.
func (d *DB) GetSiteOverview(ctx context.Context, projectID string, since time.Time) (SiteAnalyticsOverview, error) {
	var o SiteAnalyticsOverview
	err := d.Pool.QueryRow(ctx,
		`SELECT
		   COUNT(*) FILTER (WHERE is_bot = false),
		   COUNT(DISTINCT visitor_hash) FILTER (WHERE is_bot = false),
		   COUNT(*) FILTER (WHERE is_bot = true)
		 FROM site_events
		 WHERE project_id = $1 AND ts >= $2`,
		projectID, since,
	).Scan(&o.Pageviews, &o.Visitors, &o.Bots)
	return o, err
}

// GetSiteTimeseries returns bucketed pageview + visitor counts.
func (d *DB) GetSiteTimeseries(ctx context.Context, projectID string, since time.Time, bucket string) ([]SiteTimeseriesPoint, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT date_bin($3::interval, ts, TIMESTAMP '1970-01-01') AS b,
		        COUNT(*) FILTER (WHERE is_bot = false),
		        COUNT(DISTINCT visitor_hash) FILTER (WHERE is_bot = false)
		 FROM site_events
		 WHERE project_id = $1 AND ts >= $2
		 GROUP BY b
		 ORDER BY b ASC`,
		projectID, since, bucket,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SiteTimeseriesPoint
	for rows.Next() {
		var p SiteTimeseriesPoint
		if err := rows.Scan(&p.TS, &p.Pageviews, &p.Visitors); err != nil {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

// GetSiteTop returns the top N values of `col` by pageview count for the window.
// Caller passes an allowlisted column name — enforced in the handler so this
// function can't be coerced into SQL injection.
func (d *DB) GetSiteTop(ctx context.Context, projectID, col string, since time.Time, limit int) ([]SiteTopRow, error) {
	// col must be pre-validated by the caller. We can't parameterize a column name.
	query := `SELECT ` + col + ` AS k, COUNT(*) AS c
		 FROM site_events
		 WHERE project_id = $1 AND ts >= $2 AND is_bot = false AND ` + col + ` <> ''
		 GROUP BY k
		 ORDER BY c DESC
		 LIMIT $3`
	rows, err := d.Pool.Query(ctx, query, projectID, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SiteTopRow
	for rows.Next() {
		var r SiteTopRow
		if err := rows.Scan(&r.Key, &r.Count); err != nil {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

// GetSiteRealtime returns the number of distinct visitors and pageviews in the
// last 5 minutes. Used for the "live visitors" counter.
func (d *DB) GetSiteRealtime(ctx context.Context, projectID string) (visitors int64, pageviews int64, err error) {
	err = d.Pool.QueryRow(ctx,
		`SELECT COUNT(DISTINCT visitor_hash) FILTER (WHERE is_bot = false),
		        COUNT(*) FILTER (WHERE is_bot = false)
		 FROM site_events
		 WHERE project_id = $1 AND ts >= now() - interval '5 minutes'`,
		projectID,
	).Scan(&visitors, &pageviews)
	return
}

// PruneOldSiteEvents drops rows older than cutoff. Keeps the table bounded.
func (d *DB) PruneOldSiteEvents(ctx context.Context, cutoff time.Time) error {
	_, err := d.Pool.Exec(ctx,
		`DELETE FROM site_events WHERE ts < $1`, cutoff,
	)
	return err
}

// PruneSiteEventsPerPlan deletes analytics events older than each project
// owner's plan retention (plan_limits.analytics_retention_days). -1 keeps
// forever; admins are never pruned; orphaned rows fall back to the free tier.
func (d *DB) PruneSiteEventsPerPlan(ctx context.Context) error {
	if _, err := d.Pool.Exec(ctx, `
		DELETE FROM site_events se
		USING projects p, users u, plan_limits pl
		WHERE se.project_id = p.id
		  AND u.id = p.user_id
		  AND pl.plan = u.plan
		  AND u.is_admin = false
		  AND pl.analytics_retention_days >= 0
		  AND se.ts < now() - make_interval(days => pl.analytics_retention_days)`); err != nil {
		return err
	}
	_, err := d.Pool.Exec(ctx, `
		DELETE FROM site_events se
		WHERE se.ts < now() - make_interval(days =>
		        (SELECT analytics_retention_days FROM plan_limits WHERE plan = 'free'))
		  AND NOT EXISTS (
		        SELECT 1 FROM projects p JOIN users u ON u.id = p.user_id
		        JOIN plan_limits pl ON pl.plan = u.plan
		        WHERE p.id = se.project_id)`)
	return err
}
