package db

import (
	"context"
	"fmt"
	"time"
)

// StartTunnelSession records a newly authenticated CLI control connection and
// returns its row id. userID may be empty (static dev token).
func (d *DB) StartTunnelSession(ctx context.Context, clientID, userID, remoteIP, version, osName string) (int64, error) {
	var uid interface{}
	if userID != "" {
		uid = userID
	}
	var id int64
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO tunnel_sessions (client_id, user_id, remote_ip, client_version, os)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		clientID, uid, remoteIP, version, osName).Scan(&id)
	return id, err
}

// UpdateTunnelSession flushes the running totals of a live session (called
// periodically so a server restart doesn't lose a long session's traffic).
func (d *DB) UpdateTunnelSession(ctx context.Context, id int64, urls []string, requests, bytesIn, bytesOut int64) error {
	if urls == nil {
		urls = []string{}
	}
	_, err := d.Pool.Exec(ctx,
		`UPDATE tunnel_sessions SET tunnel_urls = $2, requests = $3, bytes_in = $4, bytes_out = $5 WHERE id = $1`,
		id, urls, requests, bytesIn, bytesOut)
	return err
}

// EndTunnelSession stamps the disconnect time and final totals.
func (d *DB) EndTunnelSession(ctx context.Context, id int64, urls []string, requests, bytesIn, bytesOut int64) error {
	if urls == nil {
		urls = []string{}
	}
	_, err := d.Pool.Exec(ctx,
		`UPDATE tunnel_sessions SET disconnected_at = now(), tunnel_urls = $2,
		        requests = $3, bytes_in = $4, bytes_out = $5
		 WHERE id = $1`,
		id, urls, requests, bytesIn, bytesOut)
	return err
}

// CloseOrphanTunnelSessions ends sessions left open by a server restart (the
// process died before the disconnect handler ran). Called once at startup,
// before any new client can connect, so it never touches a live session.
func (d *DB) CloseOrphanTunnelSessions(ctx context.Context) (int64, error) {
	tag, err := d.Pool.Exec(ctx,
		`UPDATE tunnel_sessions SET disconnected_at = now() WHERE disconnected_at IS NULL`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ── Admin overview ──────────────────────────────────────────────────────────

type TunnelPeriodStats struct {
	Sessions    int64 `json:"sessions"`
	UniqueUsers int64 `json:"unique_users"`
	Requests    int64 `json:"requests"`
	Bytes       int64 `json:"bytes"`
}

type TunnelDay struct {
	Day      string `json:"day"` // YYYY-MM-DD
	Sessions int64  `json:"sessions"`
	Users    int64  `json:"users"`
	Bytes    int64  `json:"bytes"`
}

type TunnelTopUser struct {
	UserID   string    `json:"user_id"`
	Email    string    `json:"email"`
	Sessions int64     `json:"sessions"`
	Requests int64     `json:"requests"`
	Bytes    int64     `json:"bytes"`
	LastSeen time.Time `json:"last_seen"`
}

type TunnelSessionRow struct {
	ID             int64      `json:"id"`
	UserID         string     `json:"user_id"`
	Email          string     `json:"email"`
	RemoteIP       string     `json:"remote_ip"`
	ClientVersion  string     `json:"client_version"`
	OS             string     `json:"os"`
	ConnectedAt    time.Time  `json:"connected_at"`
	DisconnectedAt *time.Time `json:"disconnected_at"`
	TunnelURLs     []string   `json:"tunnel_urls"`
	Requests       int64      `json:"requests"`
	BytesIn        int64      `json:"bytes_in"`
	BytesOut       int64      `json:"bytes_out"`
}

type TunnelOverview struct {
	Today    TunnelPeriodStats  `json:"today"`
	Week     TunnelPeriodStats  `json:"week"`
	Daily    []TunnelDay        `json:"daily"`
	TopUsers []TunnelTopUser    `json:"top_users"`
	Recent   []TunnelSessionRow `json:"recent"`
}

func (d *DB) periodStats(ctx context.Context, since string) (TunnelPeriodStats, error) {
	var p TunnelPeriodStats
	err := d.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT COUNT(*), COUNT(DISTINCT user_id),
		       COALESCE(SUM(requests), 0), COALESCE(SUM(bytes_in + bytes_out), 0)
		FROM tunnel_sessions WHERE connected_at >= %s`, since)).
		Scan(&p.Sessions, &p.UniqueUsers, &p.Requests, &p.Bytes)
	return p, err
}

// GetTunnelOverview aggregates session history for the admin monitor.
func (d *DB) GetTunnelOverview(ctx context.Context, recentLimit int) (*TunnelOverview, error) {
	o := &TunnelOverview{Daily: []TunnelDay{}, TopUsers: []TunnelTopUser{}, Recent: []TunnelSessionRow{}}
	var err error
	if o.Today, err = d.periodStats(ctx, "date_trunc('day', now())"); err != nil {
		return nil, fmt.Errorf("today: %w", err)
	}
	if o.Week, err = d.periodStats(ctx, "now() - interval '7 days'"); err != nil {
		return nil, fmt.Errorf("week: %w", err)
	}

	// 14-day series, zero-filled so the chart has no gaps.
	rows, err := d.Pool.Query(ctx, `
		SELECT to_char(g.day, 'YYYY-MM-DD'),
		       COUNT(ts.id), COUNT(DISTINCT ts.user_id),
		       COALESCE(SUM(ts.bytes_in + ts.bytes_out), 0)
		FROM generate_series(date_trunc('day', now()) - interval '13 days',
		                     date_trunc('day', now()), interval '1 day') AS g(day)
		LEFT JOIN tunnel_sessions ts
		       ON ts.connected_at >= g.day AND ts.connected_at < g.day + interval '1 day'
		GROUP BY g.day ORDER BY g.day`)
	if err != nil {
		return nil, fmt.Errorf("daily: %w", err)
	}
	for rows.Next() {
		var day TunnelDay
		if err := rows.Scan(&day.Day, &day.Sessions, &day.Users, &day.Bytes); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan daily: %w", err)
		}
		o.Daily = append(o.Daily, day)
	}
	rows.Close()

	rows, err = d.Pool.Query(ctx, `
		SELECT COALESCE(ts.user_id::text, ''), COALESCE(u.email, ''),
		       COUNT(*), COALESCE(SUM(ts.requests), 0),
		       COALESCE(SUM(ts.bytes_in + ts.bytes_out), 0), MAX(ts.connected_at)
		FROM tunnel_sessions ts
		LEFT JOIN users u ON u.id = ts.user_id
		WHERE ts.connected_at >= now() - interval '7 days'
		GROUP BY ts.user_id, u.email
		ORDER BY 5 DESC, 3 DESC
		LIMIT 10`)
	if err != nil {
		return nil, fmt.Errorf("top users: %w", err)
	}
	for rows.Next() {
		var t TunnelTopUser
		if err := rows.Scan(&t.UserID, &t.Email, &t.Sessions, &t.Requests, &t.Bytes, &t.LastSeen); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan top user: %w", err)
		}
		o.TopUsers = append(o.TopUsers, t)
	}
	rows.Close()

	rows, err = d.Pool.Query(ctx, `
		SELECT ts.id, COALESCE(ts.user_id::text, ''), COALESCE(u.email, ''),
		       ts.remote_ip, ts.client_version, ts.os, ts.connected_at, ts.disconnected_at,
		       ts.tunnel_urls, ts.requests, ts.bytes_in, ts.bytes_out
		FROM tunnel_sessions ts
		LEFT JOIN users u ON u.id = ts.user_id
		ORDER BY ts.connected_at DESC
		LIMIT $1`, recentLimit)
	if err != nil {
		return nil, fmt.Errorf("recent: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var r TunnelSessionRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.Email, &r.RemoteIP, &r.ClientVersion, &r.OS,
			&r.ConnectedAt, &r.DisconnectedAt, &r.TunnelURLs, &r.Requests, &r.BytesIn, &r.BytesOut); err != nil {
			return nil, fmt.Errorf("scan recent: %w", err)
		}
		if r.TunnelURLs == nil {
			r.TunnelURLs = []string{}
		}
		o.Recent = append(o.Recent, r)
	}
	return o, rows.Err()
}
