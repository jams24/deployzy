package db

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/sync/errgroup"
)

// Account analytics: the signed-in user's own traffic. The old page read only
// captured_requests, which is written solely for tunnels with the request
// inspector switched on, so it showed "No data yet" for nearly everyone and
// ignored deployed apps entirely. This combines:
//   - app traffic from site_events (hourly buckets for 24h, daily otherwise)
//   - tunnel sessions from tunnel_sessions
//   - this month's bandwidth vs the plan cap
// Note: "requests" are non-bot HTTP requests (assets included); "visitors"
// count distinct cookieless hashes, which rotate daily — so a multi-day
// window counts a returning visitor once per day.

type AccountSeriesPoint struct {
	TS       time.Time `json:"ts"`
	Requests int64     `json:"requests"`
	Visitors int64     `json:"visitors"`
	Errors   int64     `json:"errors"`
}

type AccountProjectRow struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Subdomain string `json:"subdomain"`
	Requests  int64  `json:"requests"`
	Visitors  int64  `json:"visitors"`
	Errors    int64  `json:"errors"`
	Bytes     int64  `json:"bytes"`
}

type AccountTotals struct {
	Requests int64 `json:"requests"`
	Visitors int64 `json:"visitors"`
	BotHits  int64 `json:"bot_hits"`
	Errors   int64 `json:"errors"`
	Bytes    int64 `json:"bytes"`
}

type AccountAnalytics struct {
	Range    string                  `json:"range"`
	Totals   AccountTotals           `json:"totals"`
	Previous AccountTotals           `json:"previous"` // same-length window before, for deltas
	Series   []AccountSeriesPoint    `json:"series"`
	Projects []AccountProjectRow     `json:"projects"`
	Top      map[string][]SiteTopRow `json:"top"` // country, path, referrer

	Tunnels struct {
		Sessions int64 `json:"sessions"`
		Requests int64 `json:"requests"`
		Bytes    int64 `json:"bytes"`
		Live     int64 `json:"live"`
	} `json:"tunnels"`

	BandwidthMonthBytes int64 `json:"bandwidth_month_bytes"`
	BandwidthCapGB      int64 `json:"bandwidth_cap_gb"` // 0 = uncapped
	ProjectCount        int64 `json:"project_count"`
}

// GetAccountAnalytics returns the user's analytics for rng: 24h, 7d or 30d.
// userIDs are the workspace members (one for a personal workspace); capUserID
// is whose plan sets the bandwidth cap.
func (d *DB) GetAccountAnalytics(ctx context.Context, userIDs []string, capUserID, rng string) (*AccountAnalytics, error) {
	var dur time.Duration
	switch rng {
	case "24h":
		dur = 24 * time.Hour
	case "30d":
		dur = 30 * 24 * time.Hour
	default:
		rng, dur = "7d", 7*24*time.Hour
	}
	now := time.Now().UTC()
	// Align to the chart's buckets so totals, chart and per-app rows agree.
	since := now.Add(-dur).Truncate(24 * time.Hour)
	if rng == "24h" {
		since = now.Add(-dur).Truncate(time.Hour)
	}
	prevSince := since.Add(-dur)
	a := &AccountAnalytics{Range: rng, Series: []AccountSeriesPoint{}, Projects: []AccountProjectRow{}, Top: map[string][]SiteTopRow{}}

	const mine = `SELECT id FROM projects WHERE user_id = ANY($1::uuid[])`

	// Everything reads raw site_events (kept since April, indexed on
	// (project_id, ts)). The daily rollup is missing older days, which made
	// 30d totals disagree with the per-country counts.
	bucket := "day"
	if rng == "24h" {
		bucket = "hour"
	}
	totals := func(from, to time.Time) (AccountTotals, error) {
		var t AccountTotals
		err := d.Pool.QueryRow(ctx, `
			SELECT COUNT(*) FILTER (WHERE NOT is_bot), COUNT(DISTINCT visitor_hash) FILTER (WHERE NOT is_bot),
			       COUNT(*) FILTER (WHERE is_bot), COUNT(*) FILTER (WHERE status >= 400 AND NOT is_bot), COALESCE(SUM(bytes), 0)
			  FROM site_events WHERE project_id IN (`+mine+`) AND ts >= $2 AND ts < $3`, userIDs, from, to).
			Scan(&t.Requests, &t.Visitors, &t.BotHits, &t.Errors, &t.Bytes)
		return t, err
	}
	// The sections are independent; run them concurrently (a busy account's
	// 30-day window is ~750k events, ~5s sequentially).
	g, ctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) {
		if a.Totals, err = totals(since, now.Add(time.Minute)); err != nil {
			return fmt.Errorf("account totals: %w", err)
		}
		return nil
	})
	g.Go(func() (err error) {
		if a.Previous, err = totals(prevSince, since); err != nil {
			return fmt.Errorf("account previous totals: %w", err)
		}
		return nil
	})

	// Series, zero-filled per hour (24h) or day (7d/30d).
	g.Go(func() error {
		rows, err := d.Pool.Query(ctx, `
		WITH ev AS (
			SELECT date_trunc('`+bucket+`', ts) AS t, is_bot, status, visitor_hash
			  FROM site_events WHERE project_id IN (`+mine+`) AND ts >= date_trunc('`+bucket+`', $2::timestamptz)
		)
		SELECT g.t, COUNT(ev.t) FILTER (WHERE NOT ev.is_bot), COUNT(DISTINCT ev.visitor_hash) FILTER (WHERE NOT ev.is_bot),
		       COUNT(ev.t) FILTER (WHERE ev.status >= 400 AND NOT ev.is_bot)
		  FROM generate_series(date_trunc('`+bucket+`', $2::timestamptz), date_trunc('`+bucket+`', now()), interval '1 `+bucket+`') g(t)
		  LEFT JOIN ev ON ev.t = g.t
		 GROUP BY g.t ORDER BY g.t`, userIDs, since)
		if err != nil {
			return fmt.Errorf("account series: %w", err)
		}
		for rows.Next() {
			var p AccountSeriesPoint
			if err := rows.Scan(&p.TS, &p.Requests, &p.Visitors, &p.Errors); err != nil {
				rows.Close()
				return fmt.Errorf("scan account series: %w", err)
			}
			a.Series = append(a.Series, p)
		}
		rows.Close()
		return rows.Err()
	})

	// Per-project breakdown over the same window (projects with no traffic too).
	g.Go(func() error {
		rows, err := d.Pool.Query(ctx, `
		WITH ev AS (
			SELECT project_id, COUNT(*) FILTER (WHERE NOT is_bot) AS req,
			       COUNT(DISTINCT visitor_hash) FILTER (WHERE NOT is_bot) AS vis,
			       COUNT(*) FILTER (WHERE status >= 400 AND NOT is_bot) AS err, COALESCE(SUM(bytes), 0) AS bytes
			  FROM site_events WHERE project_id IN (`+mine+`) AND ts >= $2 GROUP BY project_id
		)
		SELECT p.id::text, p.name, p.subdomain, COALESCE(ev.req, 0), COALESCE(ev.vis, 0), COALESCE(ev.err, 0), COALESCE(ev.bytes, 0)
		  FROM projects p LEFT JOIN ev ON ev.project_id = p.id
		 WHERE p.user_id = ANY($1::uuid[]) AND p.parent_project_id IS NULL
		 ORDER BY 4 DESC, p.name LIMIT 50`, userIDs, since)
		if err != nil {
			return fmt.Errorf("account projects: %w", err)
		}
		for rows.Next() {
			var p AccountProjectRow
			if err := rows.Scan(&p.ID, &p.Name, &p.Subdomain, &p.Requests, &p.Visitors, &p.Errors, &p.Bytes); err != nil {
				rows.Close()
				return fmt.Errorf("scan account project: %w", err)
			}
			a.Projects = append(a.Projects, p)
		}
		rows.Close()
		return rows.Err()
	})

	// Top countries / paths / referrers across all the user's apps (humans only).
	tops := make([][]SiteTopRow, 3)
	for ci, col := range []string{"country", "path", "referrer"} {
		g.Go(func() error {
			top := []SiteTopRow{}
			r, err := d.Pool.Query(ctx, `
			SELECT COALESCE(`+col+`, ''), COUNT(*) FROM site_events
			 WHERE project_id IN (`+mine+`) AND ts >= $2 AND NOT is_bot
			 GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, userIDs, since)
			if err != nil {
				return fmt.Errorf("account top %s: %w", col, err)
			}
			for r.Next() {
				var t SiteTopRow
				if err := r.Scan(&t.Key, &t.Count); err != nil {
					r.Close()
					return fmt.Errorf("scan account top: %w", err)
				}
				top = append(top, t)
			}
			r.Close()
			tops[ci] = top
			return r.Err()
		})
	}

	// Tunnels, monthly bandwidth vs plan cap, project count.
	g.Go(func() error {
		if err := d.Pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM tunnel_sessions WHERE user_id = ANY($1::uuid[]) AND connected_at >= $2),
		       (SELECT COALESCE(SUM(requests), 0) FROM tunnel_sessions WHERE user_id = ANY($1::uuid[]) AND connected_at >= $2),
		       (SELECT COALESCE(SUM(bytes_in + bytes_out), 0) FROM tunnel_sessions WHERE user_id = ANY($1::uuid[]) AND connected_at >= $2),
		       (SELECT count(*) FROM tunnel_sessions WHERE user_id = ANY($1::uuid[]) AND disconnected_at IS NULL AND connected_at > now() - interval '7 days'),
		       (SELECT COALESCE(SUM(bu.bytes), 0) FROM bandwidth_usage bu JOIN projects p ON p.id::text = bu.project_id
		          WHERE p.user_id = ANY($1::uuid[]) AND bu.month = date_trunc('month', now())::date),
		       COALESCE((SELECT pl.max_bandwidth_gb FROM users u JOIN plan_limits pl ON pl.plan = CASE
		          WHEN COALESCE(NULLIF(u.plan, ''), 'free') = 'free' AND u.pro_until > now() THEN 'pro'
		          ELSE COALESCE(NULLIF(u.plan, ''), 'free') END WHERE u.id = $3), 0),
		       (SELECT count(*) FROM projects WHERE user_id = ANY($1::uuid[]) AND parent_project_id IS NULL)`, userIDs, since, capUserID).
			Scan(&a.Tunnels.Sessions, &a.Tunnels.Requests, &a.Tunnels.Bytes, &a.Tunnels.Live,
				&a.BandwidthMonthBytes, &a.BandwidthCapGB, &a.ProjectCount); err != nil {
			return fmt.Errorf("account tunnels/bandwidth: %w", err)
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}
	for ci, col := range []string{"country", "path", "referrer"} {
		a.Top[col] = tops[ci]
	}
	return a, nil
}
