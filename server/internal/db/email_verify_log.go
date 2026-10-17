package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// EmailVerifyRecord is one logged verification outcome (domain-level only).
type EmailVerifyRecord struct {
	UserID         string
	Domain         string
	Score          string
	Reason         string
	Disposable     bool
	RoleBased      bool
	HasMX          bool
	FreeProvider   bool
	MailboxChecked bool
	Source         string // single | batch | api
}

// RecordEmailVerifications batch-inserts verification outcomes. Best-effort:
// callers run it in a goroutine so logging never slows or fails a verify.
func (d *DB) RecordEmailVerifications(ctx context.Context, userID string, recs []EmailVerifyRecord) error {
	if len(recs) == 0 {
		return nil
	}
	rows := make([][]interface{}, 0, len(recs))
	var uid interface{}
	if userID != "" {
		uid = userID
	}
	for _, r := range recs {
		rows = append(rows, []interface{}{
			uid, r.Domain, r.Score, r.Reason, r.Disposable, r.RoleBased,
			r.HasMX, r.FreeProvider, r.MailboxChecked, r.Source,
		})
	}
	_, err := d.Pool.CopyFrom(ctx,
		pgx.Identifier{"email_verifications"},
		[]string{"user_id", "domain", "score", "reason", "disposable", "role_based", "has_mx", "free_provider", "mailbox_checked", "source"},
		pgx.CopyFromRows(rows))
	return err
}

// ── Admin analytics ──────────────────────────────────────────────────────────

type EmailVerifyPeriod struct {
	Total   int64 `json:"total"`
	Users   int64 `json:"users"`
	Valid   int64 `json:"valid"`
	Risky   int64 `json:"risky"`
	Invalid int64 `json:"invalid"`
	Unknown int64 `json:"unknown"`
}

type EvDay struct {
	Day     string `json:"day"`
	Total   int64  `json:"total"`
	Valid   int64  `json:"valid"`
	Invalid int64  `json:"invalid"`
	Risky   int64  `json:"risky"`
}

type EvNameCount struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

type EvTopUser struct {
	UserID   string    `json:"user_id"`
	Email    string    `json:"email"`
	Total    int64     `json:"total"`
	Invalid  int64     `json:"invalid"`
	LastUsed time.Time `json:"last_used"`
}

type EmailVerifyAnalytics struct {
	Today      EmailVerifyPeriod `json:"today"`
	Week       EmailVerifyPeriod `json:"week"`
	Month      EmailVerifyPeriod `json:"month"`
	AllTime    int64             `json:"all_time"`
	Disposable int64             `json:"disposable_30d"`
	RoleBased  int64             `json:"role_based_30d"`
	NoMX       int64             `json:"no_mx_30d"`
	SMTPProbed int64             `json:"smtp_probed_30d"`
	BatchShare int64             `json:"batch_share_30d"` // % of 30d verifications from batch
	Daily      []EvDay           `json:"daily"`
	TopUsers   []EvTopUser       `json:"top_users"`
	TopDomains []EvNameCount     `json:"top_domains"`
	TopReasons []EvNameCount     `json:"top_reasons"`
}

func (d *DB) evPeriod(ctx context.Context, since string) (EmailVerifyPeriod, error) {
	var p EmailVerifyPeriod
	err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(DISTINCT user_id),
		       COUNT(*) FILTER (WHERE score = 'valid'),
		       COUNT(*) FILTER (WHERE score = 'risky'),
		       COUNT(*) FILTER (WHERE score = 'invalid'),
		       COUNT(*) FILTER (WHERE score NOT IN ('valid','risky','invalid'))
		FROM email_verifications WHERE created_at >= `+since).
		Scan(&p.Total, &p.Users, &p.Valid, &p.Risky, &p.Invalid, &p.Unknown)
	return p, err
}

// GetEmailVerifyAnalytics aggregates product usage + list-health for admins.
func (d *DB) GetEmailVerifyAnalytics(ctx context.Context) (*EmailVerifyAnalytics, error) {
	a := &EmailVerifyAnalytics{Daily: []EvDay{}, TopUsers: []EvTopUser{}, TopDomains: []EvNameCount{}, TopReasons: []EvNameCount{}}
	var err error
	if a.Today, err = d.evPeriod(ctx, "date_trunc('day', now())"); err != nil {
		return nil, err
	}
	if a.Week, err = d.evPeriod(ctx, "now() - interval '7 days'"); err != nil {
		return nil, err
	}
	if a.Month, err = d.evPeriod(ctx, "now() - interval '30 days'"); err != nil {
		return nil, err
	}

	if err = d.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE disposable AND created_at >= now() - interval '30 days'),
		       COUNT(*) FILTER (WHERE role_based AND created_at >= now() - interval '30 days'),
		       COUNT(*) FILTER (WHERE NOT has_mx AND created_at >= now() - interval '30 days'),
		       COUNT(*) FILTER (WHERE mailbox_checked AND created_at >= now() - interval '30 days'),
		       COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE source = 'batch' AND created_at >= now() - interval '30 days')
		                 / NULLIF(COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days'), 0)), 0)
		FROM email_verifications`).
		Scan(&a.AllTime, &a.Disposable, &a.RoleBased, &a.NoMX, &a.SMTPProbed, &a.BatchShare); err != nil {
		return nil, err
	}

	rows, err := d.Pool.Query(ctx, `
		SELECT to_char(g.day, 'YYYY-MM-DD'),
		       COUNT(ev.id),
		       COUNT(ev.id) FILTER (WHERE ev.score = 'valid'),
		       COUNT(ev.id) FILTER (WHERE ev.score = 'invalid'),
		       COUNT(ev.id) FILTER (WHERE ev.score = 'risky')
		FROM generate_series(date_trunc('day', now()) - interval '29 days',
		                     date_trunc('day', now()), interval '1 day') AS g(day)
		LEFT JOIN email_verifications ev
		       ON ev.created_at >= g.day AND ev.created_at < g.day + interval '1 day'
		GROUP BY g.day ORDER BY g.day`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d EvDay
		if err := rows.Scan(&d.Day, &d.Total, &d.Valid, &d.Invalid, &d.Risky); err != nil {
			rows.Close()
			return nil, err
		}
		a.Daily = append(a.Daily, d)
	}
	rows.Close()

	rows, err = d.Pool.Query(ctx, `
		SELECT COALESCE(ev.user_id::text, ''), COALESCE(u.email, ''),
		       COUNT(*), COUNT(*) FILTER (WHERE ev.score = 'invalid'), MAX(ev.created_at)
		FROM email_verifications ev LEFT JOIN users u ON u.id = ev.user_id
		WHERE ev.created_at >= now() - interval '30 days'
		GROUP BY ev.user_id, u.email ORDER BY 3 DESC LIMIT 10`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t EvTopUser
		if err := rows.Scan(&t.UserID, &t.Email, &t.Total, &t.Invalid, &t.LastUsed); err != nil {
			rows.Close()
			return nil, err
		}
		a.TopUsers = append(a.TopUsers, t)
	}
	rows.Close()

	if a.TopDomains, err = d.evTopList(ctx, "domain", "domain <> ''"); err != nil {
		return nil, err
	}
	if a.TopReasons, err = d.evTopList(ctx, "reason", "reason <> ''"); err != nil {
		return nil, err
	}
	return a, nil
}

func (d *DB) evTopList(ctx context.Context, col, cond string) ([]EvNameCount, error) {
	out := []EvNameCount{}
	rows, err := d.Pool.Query(ctx, `
		SELECT `+col+`, COUNT(*) FROM email_verifications
		WHERE created_at >= now() - interval '30 days' AND `+cond+`
		GROUP BY `+col+` ORDER BY 2 DESC LIMIT 10`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var n EvNameCount
		if err := rows.Scan(&n.Key, &n.Count); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// EmailVerifyUserUsage is one user's own validator usage (last 30 days).
type EmailVerifyUserUsage struct {
	Month   EmailVerifyPeriod `json:"month"`
	Today   int64             `json:"today"`
	AllTime int64             `json:"all_time"`
	Daily   []EvDay           `json:"daily"`
}

func (d *DB) GetEmailVerifyUserUsage(ctx context.Context, userID string) (*EmailVerifyUserUsage, error) {
	u := &EmailVerifyUserUsage{Daily: []EvDay{}}
	if err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days'),
		       COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days' AND score = 'valid'),
		       COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days' AND score = 'risky'),
		       COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days' AND score = 'invalid'),
		       COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days' AND score NOT IN ('valid','risky','invalid')),
		       COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now())),
		       COUNT(*)
		  FROM email_verifications WHERE user_id = $1`, userID).
		Scan(&u.Month.Total, &u.Month.Valid, &u.Month.Risky, &u.Month.Invalid, &u.Month.Unknown, &u.Today, &u.AllTime); err != nil {
		return nil, err
	}
	rows, err := d.Pool.Query(ctx, `
		SELECT to_char(g.day, 'YYYY-MM-DD'), COUNT(ev.id),
		       COUNT(ev.id) FILTER (WHERE ev.score = 'valid'), COUNT(ev.id) FILTER (WHERE ev.score = 'invalid'),
		       COUNT(ev.id) FILTER (WHERE ev.score = 'risky')
		  FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') g(day)
		  LEFT JOIN email_verifications ev ON ev.user_id = $1 AND ev.created_at >= g.day AND ev.created_at < g.day + interval '1 day'
		 GROUP BY g.day ORDER BY g.day`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e EvDay
		if err := rows.Scan(&e.Day, &e.Total, &e.Valid, &e.Invalid, &e.Risky); err != nil {
			return nil, err
		}
		u.Daily = append(u.Daily, e)
	}
	return u, rows.Err()
}
