package db

import (
	"context"
	"time"
)

// Build-minute accounting. max_build_minutes_monthly has been on the pricing
// page since launch but nothing measured it, so every plan effectively had
// unlimited build time.

// RecordBuildTime adds a completed build's duration to the user's monthly
// total. Called on every build regardless of outcome — a failed build consumes
// the same CPU as a successful one, and not counting failures would let a
// broken Dockerfile burn the host for free.
func (d *DB) RecordBuildTime(ctx context.Context, userID string, d2 time.Duration) error {
	secs := int64(d2.Seconds())
	if secs <= 0 {
		return nil
	}
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO build_usage (user_id, month, seconds, builds)
		VALUES ($1, date_trunc('month', now())::date, $2, 1)
		ON CONFLICT (user_id, month) DO UPDATE
		SET seconds = build_usage.seconds + EXCLUDED.seconds,
		    builds  = build_usage.builds + 1`,
		userID, secs)
	return err
}

// BuildUsage is a user's build consumption for the current month.
type BuildUsage struct {
	MinutesUsed  int  `json:"minutes_used"`
	MinutesLimit int  `json:"minutes_limit"` // -1 = unlimited
	Builds       int  `json:"builds"`
	Exceeded     bool `json:"exceeded"`
}

// GetBuildUsage returns this month's usage against the user's plan allowance.
// Admins and plans with -1 are always unlimited.
func (d *DB) GetBuildUsage(ctx context.Context, userID string) (BuildUsage, error) {
	var u BuildUsage

	var isAdmin bool
	var plan string
	if err := d.Pool.QueryRow(ctx,
		`SELECT COALESCE(is_admin, false), COALESCE(plan, 'free') FROM users WHERE id = $1`, userID,
	).Scan(&isAdmin, &plan); err != nil {
		return u, err
	}

	var secs int64
	d.Pool.QueryRow(ctx,
		`SELECT COALESCE(seconds, 0), COALESCE(builds, 0) FROM build_usage
		 WHERE user_id = $1 AND month = date_trunc('month', now())::date`, userID,
	).Scan(&secs, &u.Builds)
	u.MinutesUsed = int(secs / 60)

	if isAdmin {
		u.MinutesLimit = -1
		return u, nil
	}
	limits, err := d.GetPlanLimits(ctx, plan)
	if err != nil || limits == nil {
		u.MinutesLimit = -1 // fail open: never block a deploy on a lookup error
		return u, nil
	}
	u.MinutesLimit = limits.MaxBuildMinutesMonthly
	u.Exceeded = u.MinutesLimit >= 0 && u.MinutesUsed >= u.MinutesLimit
	return u, nil
}
