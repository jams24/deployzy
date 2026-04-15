package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// ipRateLimiter is a tiny in-memory sliding-window limiter keyed by client IP.
// Tuned for the auth endpoints where we want to block brute-force attempts
// without a full external redis. Scales to tens of thousands of distinct IPs
// per hour before the map becomes noticeable.
type ipRateLimiter struct {
	mu       sync.Mutex
	buckets  map[string][]time.Time
	window   time.Duration
	maxHits  int
	cleanAt  time.Time
}

func newIPRateLimiter(maxHits int, window time.Duration) *ipRateLimiter {
	return &ipRateLimiter{
		buckets: map[string][]time.Time{},
		window:  window,
		maxHits: maxHits,
	}
}

// allow returns true if the caller IP is under the cap.
func (l *ipRateLimiter) allow(ip string) bool {
	if ip == "" {
		return true
	}
	now := time.Now()
	cutoff := now.Add(-l.window)

	l.mu.Lock()
	defer l.mu.Unlock()

	// Opportunistic cleanup — every 5 minutes, purge stale buckets.
	if now.After(l.cleanAt) {
		for k, ts := range l.buckets {
			fresh := ts[:0]
			for _, t := range ts {
				if t.After(cutoff) {
					fresh = append(fresh, t)
				}
			}
			if len(fresh) == 0 {
				delete(l.buckets, k)
			} else {
				l.buckets[k] = fresh
			}
		}
		l.cleanAt = now.Add(5 * time.Minute)
	}

	// Drop timestamps older than the window for this key.
	hits := l.buckets[ip]
	fresh := hits[:0]
	for _, t := range hits {
		if t.After(cutoff) {
			fresh = append(fresh, t)
		}
	}
	if len(fresh) >= l.maxHits {
		l.buckets[ip] = fresh
		return false
	}
	l.buckets[ip] = append(fresh, now)
	return true
}

// rateLimitMiddleware wraps an http.Handler and short-circuits with 429 when
// the caller's IP exceeds the given rate. Meant for auth endpoints.
func rateLimitMiddleware(lim *ipRateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := rateLimitIP(r)
			if !lim.allow(ip) {
				w.Header().Set("Retry-After", "60")
				http.Error(w, "rate limit exceeded — try again in a minute", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// rateLimitIP extracts the client IP, trusting X-Forwarded-For's first hop
// (set by Caddy in front of us).
func rateLimitIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// first entry is the original client
		for i, c := range xff {
			if c == ',' {
				return xff[:i]
			}
		}
		return xff
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	return ip
}
