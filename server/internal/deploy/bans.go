package deploy

import (
	"context"
	"strings"
	"sync"
	"time"
)

// In-memory banned-IP cache. The proxy checks every request against this on the
// hot path, so it must be a lock-guarded map lookup — never a DB hit per request.
// Refreshed on startup, every 60s, and immediately after an admin ban/unban.

type banCache struct {
	mu       sync.RWMutex
	exact    map[string]bool // exact IP matches
	prefixes []string        // dotted-prefix matches, e.g. "203.0.113."
}

var bans = &banCache{exact: map[string]bool{}}

// RefreshBannedIPs reloads the ban set from the database into memory.
func (e *Engine) RefreshBannedIPs(ctx context.Context) {
	list, err := e.db.LoadBannedIPs(ctx)
	if err != nil {
		e.log.Warn().Err(err).Msg("failed to refresh banned IPs")
		return
	}
	exact := make(map[string]bool, len(list))
	var prefixes []string
	for _, ip := range list {
		ip = strings.TrimSpace(ip)
		if ip == "" {
			continue
		}
		if strings.HasSuffix(ip, ".") {
			prefixes = append(prefixes, ip)
		} else {
			exact[ip] = true
		}
	}
	bans.mu.Lock()
	bans.exact = exact
	bans.prefixes = prefixes
	bans.mu.Unlock()
}

// IsIPBanned reports whether an IP is banned (exact or prefix match). Safe for
// the hot path — pure in-memory. Implements the proxy's ban-check interface.
func (e *Engine) IsIPBanned(ip string) bool {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return false
	}
	bans.mu.RLock()
	defer bans.mu.RUnlock()
	if bans.exact[ip] {
		return true
	}
	for _, p := range bans.prefixes {
		if strings.HasPrefix(ip, p) {
			return true
		}
	}
	return false
}

// StartBanRefresher loads the ban set now and refreshes it periodically.
func (e *Engine) StartBanRefresher(ctx context.Context) {
	e.RefreshBannedIPs(ctx)
	go func() {
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				e.RefreshBannedIPs(ctx)
			}
		}
	}()
}
