package proxy

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Per-tunnel request rate limit from the owner's plan (plan_limits.max_rate,
// requests per second). Until 2026-10-17 this limit was stored and editable
// but never applied: main.go built a limiter and discarded it.
//
// Hot path: one map lookup + a token-bucket check per request. The owner's
// rate is resolved through RateLookup at most once per minute per user.

// RateLookup returns a user's per-tunnel request rate (req/s); <= 0 means
// unlimited (admins, or a -1 plan value).
type RateLookup func(userID string) int

type cachedRate struct {
	rps     int
	fetched time.Time
}

type tunnelRateLimiter struct {
	lookup RateLookup

	mu       sync.Mutex
	rates    map[string]cachedRate    // userID → plan rate
	limiters map[string]*rate.Limiter // tunnel URL → bucket
}

const rateCacheTTL = time.Minute

func newTunnelRateLimiter(lookup RateLookup) *tunnelRateLimiter {
	return &tunnelRateLimiter{lookup: lookup, rates: map[string]cachedRate{}, limiters: map[string]*rate.Limiter{}}
}

// allow reports whether one more request to tunnelURL (owned by userID) fits
// the owner's plan rate. Bursts up to two seconds' worth are absorbed.
func (l *tunnelRateLimiter) allow(tunnelURL, userID string) bool {
	if l == nil || l.lookup == nil || userID == "" {
		return true
	}
	l.mu.Lock()
	cr, ok := l.rates[userID]
	l.mu.Unlock()
	if !ok || time.Since(cr.fetched) > rateCacheTTL {
		cr = cachedRate{rps: l.lookup(userID), fetched: time.Now()}
		l.mu.Lock()
		l.rates[userID] = cr
		l.mu.Unlock()
	}
	if cr.rps <= 0 {
		return true
	}
	l.mu.Lock()
	lim := l.limiters[tunnelURL]
	if lim == nil {
		lim = rate.NewLimiter(rate.Limit(cr.rps), cr.rps*2)
		l.limiters[tunnelURL] = lim
	} else if int(lim.Limit()) != cr.rps { // plan changed
		lim.SetLimit(rate.Limit(cr.rps))
		lim.SetBurst(cr.rps * 2)
	}
	l.mu.Unlock()
	return lim.Allow()
}

// prune drops buckets for tunnels that are no longer live, so random
// subdomains from short-lived tunnels don't accumulate forever.
func (l *tunnelRateLimiter) prune(isLive func(url string) bool) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for u := range l.limiters {
		if !isLive(u) {
			delete(l.limiters, u)
			n++
		}
	}
	return n
}

// SetTunnelRateLookup enables per-plan tunnel rate limiting and starts the
// janitor that forgets closed tunnels' buckets.
func (p *HTTPProxy) SetTunnelRateLookup(lookup RateLookup) {
	l := newTunnelRateLimiter(lookup)
	p.tunnelRates = l
	go func() {
		t := time.NewTicker(10 * time.Minute)
		defer t.Stop()
		for range t.C {
			l.prune(func(u string) bool { return p.registry.LookupByURL(u) != nil })
		}
	}()
}
