package db

import (
	"context"
	"fmt"
	"time"
)

// Admin Overview: daily series for trend cards plus a current snapshot. The
// old stats counted every deploy_logs LINE as a deploy (≈30 lines each) and
// read traffic from captured_requests, which is empty; this counts deploy
// start/success markers and daily unique app visitors from site_events_daily
// (its "pageviews" column is every non-bot request, assets included).

// OverviewDays is the series length; the UI compares the last half with the
// first half for its "vs previous period" deltas.
const OverviewDays = 28

type OverviewSeries struct {
	Days           []string `json:"days"` // YYYY-MM-DD, oldest first
	Signups        []int64  `json:"signups"`
	DeploysStarted []int64  `json:"deploys_started"`
	DeploysOK      []int64  `json:"deploys_ok"`
	TunnelSessions []int64  `json:"tunnel_sessions"`
	AppVisitors    []int64  `json:"app_visitors"` // daily unique visitors, summed over apps
}

type OverviewActivity struct {
	Kind   string    `json:"kind"` // signup | deploy
	Title  string    `json:"title"`
	Detail string    `json:"detail"`
	At     time.Time `json:"at"`
}

type AdminOverview struct {
	Series OverviewSeries `json:"series"`

	UsersTotal     int64 `json:"users_total"`
	UsersPaid      int64 `json:"users_paid"`
	UsersSuspended int64 `json:"users_suspended"`
	SignupsToday   int64 `json:"signups_today"`

	ProjectsTotal    int64            `json:"projects_total"`
	ProjectsByStatus map[string]int64 `json:"projects_by_status"` // running|sleeping|crashed|failed|stopped|building|created
	Stacks           map[string]int64 `json:"stacks"`

	DeploysToday   int64 `json:"deploys_today"`
	DeploysOKToday int64 `json:"deploys_ok_today"`

	Databases      int64 `json:"databases"`
	TunnelsLive    int64 `json:"tunnels_live"`
	BandwidthMonth int64 `json:"bandwidth_month_bytes"`
	OpenAbuse      int64 `json:"open_abuse"`
	ServersActive  int64 `json:"servers_active"` // platform servers only (BYOC excluded)
	ServersTotal   int64 `json:"servers_total"`

	Activity []OverviewActivity `json:"activity"`
}

func (d *DB) AdminOverview(ctx context.Context) (*AdminOverview, error) {
	o := &AdminOverview{ProjectsByStatus: map[string]int64{}, Stacks: map[string]int64{}}

	// ── Daily series (UTC days, zero-filled) ──
	idx := map[string]int{}
	start := time.Now().UTC().AddDate(0, 0, -(OverviewDays - 1))
	for i := 0; i < OverviewDays; i++ {
		day := start.AddDate(0, 0, i).Format("2006-01-02")
		idx[day] = i
		o.Series.Days = append(o.Series.Days, day)
	}
	zero := func() []int64 { return make([]int64, OverviewDays) }
	o.Series.Signups, o.Series.DeploysStarted, o.Series.DeploysOK = zero(), zero(), zero()
	o.Series.TunnelSessions, o.Series.AppVisitors = zero(), zero()

	rows, err := d.Pool.Query(ctx, `
		WITH since AS (SELECT (now() AT TIME ZONE 'UTC')::date - $1::int + 1 AS d)
		SELECT 'signup', to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'), count(*)
		  FROM users, since WHERE (created_at AT TIME ZONE 'UTC')::date >= since.d GROUP BY 2
		UNION ALL
		SELECT 'deploy_start', to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'), count(*)
		  FROM deploy_logs, since WHERE (created_at AT TIME ZONE 'UTC')::date >= since.d AND message LIKE 'Starting deployment%' GROUP BY 2
		UNION ALL
		SELECT 'deploy_ok', to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'), count(*)
		  FROM deploy_logs, since WHERE (created_at AT TIME ZONE 'UTC')::date >= since.d AND message LIKE 'Deployed at%' GROUP BY 2
		UNION ALL
		SELECT 'tunnel', to_char((connected_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'), count(*)
		  FROM tunnel_sessions, since WHERE (connected_at AT TIME ZONE 'UTC')::date >= since.d GROUP BY 2
		UNION ALL
		SELECT 'visitors', to_char(day, 'YYYY-MM-DD'), COALESCE(SUM(visitors), 0)
		  FROM site_events_daily, since WHERE day >= since.d GROUP BY 2`, OverviewDays)
	if err != nil {
		return nil, fmt.Errorf("overview series: %w", err)
	}
	for rows.Next() {
		var kind, day string
		var n int64
		if err := rows.Scan(&kind, &day, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan overview series: %w", err)
		}
		i, ok := idx[day]
		if !ok {
			continue
		}
		switch kind {
		case "signup":
			o.Series.Signups[i] = n
		case "deploy_start":
			o.Series.DeploysStarted[i] = n
		case "deploy_ok":
			o.Series.DeploysOK[i] = n
		case "tunnel":
			o.Series.TunnelSessions[i] = n
		case "visitors":
			o.Series.AppVisitors[i] = n
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	last := OverviewDays - 1
	o.SignupsToday = o.Series.Signups[last]
	o.DeploysToday = o.Series.DeploysStarted[last]
	o.DeploysOKToday = o.Series.DeploysOK[last]

	// ── Snapshot ──
	if err := d.Pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM users),
		       (SELECT count(*) FROM users WHERE NOT COALESCE(is_admin, false)
		          AND (COALESCE(NULLIF(plan, ''), 'free') <> 'free' OR pro_until > now())),
		       (SELECT count(*) FROM users WHERE COALESCE(blocked, false)),
		       (SELECT count(*) FROM services),
		       (SELECT count(*) FROM tunnel_sessions WHERE disconnected_at IS NULL AND connected_at > now() - interval '7 days'),
		       (SELECT COALESCE(SUM(bytes), 0) FROM bandwidth_usage WHERE month = date_trunc('month', now())::date),
		       (SELECT count(*) FROM abuse_reports WHERE status = 'open'),
		       (SELECT count(*) FROM worker_servers WHERE status = 'active' AND user_id IS NULL),
		       (SELECT count(*) FROM worker_servers WHERE user_id IS NULL)`).Scan(
		&o.UsersTotal, &o.UsersPaid, &o.UsersSuspended, &o.Databases, &o.TunnelsLive,
		&o.BandwidthMonth, &o.OpenAbuse, &o.ServersActive, &o.ServersTotal); err != nil {
		return nil, fmt.Errorf("overview snapshot: %w", err)
	}

	prow, err := d.Pool.Query(ctx, `
		SELECT 's', CASE WHEN sleeping AND status = 'running' THEN 'sleeping' ELSE COALESCE(status, 'unknown') END, count(*)
		  FROM projects WHERE parent_project_id IS NULL GROUP BY 2
		UNION ALL
		SELECT 'f', COALESCE(NULLIF(framework, ''), 'unknown'), count(*)
		  FROM projects WHERE parent_project_id IS NULL GROUP BY 2`)
	if err != nil {
		return nil, fmt.Errorf("overview projects: %w", err)
	}
	for prow.Next() {
		var kind, key string
		var n int64
		if err := prow.Scan(&kind, &key, &n); err != nil {
			prow.Close()
			return nil, fmt.Errorf("scan overview projects: %w", err)
		}
		if kind == "s" {
			o.ProjectsByStatus[key] = n
			o.ProjectsTotal += n
		} else {
			o.Stacks[key] = n
		}
	}
	prow.Close()

	// ── Recent activity: latest signups and successful deploys ──
	arow, err := d.Pool.Query(ctx, `
		(SELECT 'signup', email, COALESCE(NULLIF(plan, ''), 'free'), created_at FROM users ORDER BY created_at DESC LIMIT 6)
		UNION ALL
		(SELECT 'deploy', p.name, COALESCE(u.email, ''), dl.created_at
		   FROM deploy_logs dl JOIN projects p ON p.id = dl.project_id LEFT JOIN users u ON u.id = p.user_id
		  WHERE dl.message LIKE 'Deployed at%' ORDER BY dl.created_at DESC LIMIT 8)
		ORDER BY 4 DESC LIMIT 10`)
	if err != nil {
		return nil, fmt.Errorf("overview activity: %w", err)
	}
	defer arow.Close()
	for arow.Next() {
		var a OverviewActivity
		if err := arow.Scan(&a.Kind, &a.Title, &a.Detail, &a.At); err != nil {
			return nil, fmt.Errorf("scan overview activity: %w", err)
		}
		o.Activity = append(o.Activity, a)
	}
	if o.Activity == nil {
		o.Activity = []OverviewActivity{}
	}
	return o, arow.Err()
}
