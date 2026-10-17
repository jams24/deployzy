package deploy

import (
	"context"
	"sync"
	"time"
)

// In-memory set of projects whose OWNER has used their plan's monthly
// bandwidth. The proxy checks it on every request, so it must be a map lookup —
// never a DB query per request. Refreshed on startup and every 60s.
//
// Bandwidth is metered per account (all of a user's projects together), the
// same way the dashboard's "X of Y GB" meter computes it, and resets with the
// calendar month (bandwidth_usage.month).

type bwCache struct {
	mu      sync.RWMutex
	blocked map[string]bool // project ID -> over its owner's cap
}

var bwBlocked = &bwCache{blocked: map[string]bool{}}

// RefreshBandwidthBlocks recomputes which projects belong to over-cap accounts.
// Admins and unlimited (<0) or uncapped (0) plans are never blocked. The plan is
// resolved like db.effectivePlan (an active referral reward counts as Pro).
func (e *Engine) RefreshBandwidthBlocks(ctx context.Context) {
	rows, err := e.db.Pool.Query(ctx, `
		WITH usage AS (
			SELECT pr.user_id, SUM(bu.bytes) AS bytes
			FROM bandwidth_usage bu
			JOIN projects pr ON pr.id::text = bu.project_id
			WHERE bu.month = date_trunc('month', now())::date
			GROUP BY pr.user_id
		), over AS (
			SELECT us.id AS user_id
			FROM usage
			JOIN users us ON us.id = usage.user_id
			JOIN plan_limits pl ON pl.plan = CASE
				WHEN (us.plan = 'free' OR us.plan = '') AND us.pro_until > now() THEN 'pro'
				ELSE us.plan END
			WHERE NOT COALESCE(us.is_admin, false)
			  AND pl.max_bandwidth_gb > 0
			  AND usage.bytes >= pl.max_bandwidth_gb::bigint * 1024 * 1024 * 1024
		)
		SELECT p.id::text FROM projects p JOIN over ON over.user_id = p.user_id`)
	if err != nil {
		e.log.Warn().Err(err).Msg("refresh bandwidth blocks")
		return // keep the previous set rather than unblocking everyone on a hiccup
	}
	defer rows.Close()
	next := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			e.log.Warn().Err(err).Msg("scan bandwidth block")
			return
		}
		next[id] = true
	}
	if rows.Err() != nil {
		return
	}
	bwBlocked.mu.Lock()
	changed := len(next) != len(bwBlocked.blocked)
	bwBlocked.blocked = next
	bwBlocked.mu.Unlock()
	if changed {
		e.log.Info().Int("projects", len(next)).Msg("bandwidth cap: blocked project set updated")
	}
}

// IsBandwidthBlocked reports whether a project's owner is over their monthly
// bandwidth cap. Hot-path safe. Implements the proxy's BandwidthGate interface.
func (e *Engine) IsBandwidthBlocked(projectID string) bool {
	if projectID == "" {
		return false
	}
	bwBlocked.mu.RLock()
	defer bwBlocked.mu.RUnlock()
	return bwBlocked.blocked[projectID]
}

// StartBandwidthGate loads the blocked set now and refreshes it every minute.
func (e *Engine) StartBandwidthGate(ctx context.Context) {
	e.RefreshBandwidthBlocks(ctx)
	go func() {
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				e.RefreshBandwidthBlocks(ctx)
			}
		}
	}()
}
