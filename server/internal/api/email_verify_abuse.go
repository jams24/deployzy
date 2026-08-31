package api

import (
	"context"
	"strconv"
	"sync"
	"time"
)

// Abuse controls for the email verifier. The SMTP probe now runs from the
// SECONDARY server's IP, so that IP's reputation is what we protect: (1) a
// per-mail-domain throttle so a batch can't hammer one provider's MX and get us
// blocked, and (2) a per-user daily volume cap so nobody cleans a giant scraped
// list through the service. Credit metering + the admin kill switch
// (email_smtp_probe) are the other two layers.

// ── Per-mail-domain probe throttle ───────────────────────────────────────────

type domainThrottle struct {
	mu   sync.Mutex
	last map[string]time.Time
	min  time.Duration
}

var probeThrottle = &domainThrottle{last: map[string]time.Time{}, min: 1500 * time.Millisecond}

// wait blocks until it's safe to probe `domain`'s MX again, then reserves the
// next slot. Capped so a huge same-domain batch can't hang a request forever.
func (t *domainThrottle) wait(ctx context.Context, domain string) {
	t.mu.Lock()
	now := time.Now()
	slot := t.last[domain]
	if slot.Before(now) {
		slot = now
	}
	wait := slot.Sub(now)
	t.last[domain] = slot.Add(t.min)
	t.mu.Unlock()

	if wait <= 0 {
		return
	}
	if wait > 12*time.Second {
		wait = 12 * time.Second
	}
	select {
	case <-time.After(wait):
	case <-ctx.Done():
	}
}

// ── Per-user daily verification cap ──────────────────────────────────────────

type dailyCounter struct {
	mu    sync.Mutex
	day   string
	count map[string]int
}

var verifyDaily = &dailyCounter{count: map[string]int{}}

// add increments the user's count for the current UTC day (resetting at
// midnight) and returns the new total.
func (c *dailyCounter) add(userID string, n int) int {
	day := time.Now().UTC().Format("2006-01-02")
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.day != day {
		c.day = day
		c.count = map[string]int{}
	}
	c.count[userID] += n
	return c.count[userID]
}

const defaultVerifyDailyCap = 2000

// overDailyCap reports whether charging `n` more verifications would exceed the
// user's daily allowance. Admins are unlimited. Cap is admin-tunable via the
// `email_verify_daily_cap` setting.
func (s *Server) overDailyCap(ctx context.Context, userID string, n int) bool {
	if isAdmin, _ := s.db.IsUserAdmin(ctx, userID); isAdmin {
		return false
	}
	cap := defaultVerifyDailyCap
	if v, _ := s.db.GetSetting(ctx, "email_verify_daily_cap"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			cap = parsed
		}
	}
	return verifyDaily.add(userID, n) > cap
}
