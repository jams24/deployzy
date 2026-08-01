package db

import (
	"context"
	"strings"
	"time"
)

// User IP capture + IP ban list for abuse control.

// SetUserSignupIP records where an account was created from (once).
func (d *DB) SetUserSignupIP(ctx context.Context, userID, ip, country string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE users SET signup_ip = COALESCE(NULLIF(signup_ip, ''), $2),
		                   signup_country = COALESCE(NULLIF(signup_country, ''), $3),
		                   last_login_ip = $2, last_country = $3, last_seen_at = now()
		   WHERE id = $1`,
		userID, ip, country)
	return err
}

// TouchUserLogin records the most recent sign-in IP/country and time.
func (d *DB) TouchUserLogin(ctx context.Context, userID, ip, country string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE users SET last_login_ip = $2, last_country = $3, last_seen_at = now() WHERE id = $1`,
		userID, ip, country)
	return err
}

// IPBan is a single ban entry.
type IPBan struct {
	IP        string    `json:"ip"`
	Reason    string    `json:"reason"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

// BanIP adds or updates a ban. ip may be an exact address or a dotted prefix
// (e.g. "203.0.113.") to block a range.
func (d *DB) BanIP(ctx context.Context, ip, reason, by string) error {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return nil
	}
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO ip_bans (ip, reason, created_by) VALUES ($1, $2, $3)
		 ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now()`,
		ip, reason, by)
	return err
}

// UnbanIP removes a ban.
func (d *DB) UnbanIP(ctx context.Context, ip string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM ip_bans WHERE ip = $1`, strings.TrimSpace(ip))
	return err
}

// ListIPBans returns all bans, newest first.
func (d *DB) ListIPBans(ctx context.Context) ([]IPBan, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT ip, reason, created_by, created_at FROM ip_bans ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IPBan{}
	for rows.Next() {
		var b IPBan
		if err := rows.Scan(&b.IP, &b.Reason, &b.CreatedBy, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// LoadBannedIPs returns the full set of ban entries as a slice of strings, for
// the proxy/API to cache in memory and match against (exact IP or dotted
// prefix). Cheap and small; refreshed periodically by the caller.
func (d *DB) LoadBannedIPs(ctx context.Context) ([]string, error) {
	rows, err := d.Pool.Query(ctx, `SELECT ip FROM ip_bans`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var ip string
		if err := rows.Scan(&ip); err != nil {
			return nil, err
		}
		out = append(out, ip)
	}
	return out, rows.Err()
}

// IsIPBanned reports whether ip matches any ban entry (exact match, or a stored
// dotted-prefix like "203.0.113." matching "203.0.113.45").
func (d *DB) IsIPBanned(ctx context.Context, ip string) bool {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return false
	}
	var hit bool
	d.Pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM ip_bans WHERE $1 = ip OR ($1 LIKE ip || '%' AND ip LIKE '%.'))`,
		ip).Scan(&hit)
	return hit
}
