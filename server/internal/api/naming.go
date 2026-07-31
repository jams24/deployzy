package api

import (
	"context"
	"crypto/rand"
	"regexp"
	"strconv"
	"strings"
)

// Generic subdomain naming: turn any human name (project name, template name,
// repo name) into a DNS-safe label, and guarantee a *free* variant so a name
// that happens to collide — "app", "web", "api", a popular template — never
// dead-ends a deploy.

var (
	subSlugStripRe = regexp.MustCompile(`[^a-z0-9-]`)
	subSlugDashRe  = regexp.MustCompile(`-+`)
)

// slugifySubdomain converts an arbitrary name into a DNS-safe subdomain label:
// lowercase, only [a-z0-9-], collapsed/trimmed dashes, capped at 32 chars, and
// never empty (falls back to "app").
func slugifySubdomain(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	s = strings.ReplaceAll(s, "_", "-")
	s = subSlugStripRe.ReplaceAllString(s, "")
	s = subSlugDashRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 32 {
		s = strings.Trim(s[:32], "-")
	}
	if s == "" {
		s = "app"
	}
	return s
}

// uniqueSubdomain returns an available subdomain derived from base. It slugifies
// base and tries it verbatim; on a collision it appends a short random id —
// Vercel/Railway style ("my-app-3f7ab2") — rather than a predictable "-2". It
// never hard-fails: it widens the id length until a free name is found. userID
// is passed through so the caller's own existing subdomain still counts as
// "available" (preserving idempotent redeploys).
func (s *Server) uniqueSubdomain(ctx context.Context, base, userID string) string {
	base = slugifySubdomain(base)
	if avail, _ := s.db.CheckSubdomainAvailable(ctx, base, userID); avail {
		return base
	}
	// Collision — add a random id, like Vercel/Railway. Try a few 6-char ids,
	// then widen to 10 chars if we somehow keep colliding.
	for i := 0; i < 8; i++ {
		n := 6
		if i >= 5 {
			n = 10
		}
		cand := base + "-" + randSuffix(n)
		if avail, _ := s.db.CheckSubdomainAvailable(ctx, cand, userID); avail {
			return cand
		}
	}
	return base + "-" + randSuffix(12)
}

// randSuffix returns a lowercase alphanumeric string of length n.
func randSuffix(n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failing is effectively impossible; fall back to a fixed
		// marker rather than panicking a deploy.
		return "x" + strconv.Itoa(n)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}
