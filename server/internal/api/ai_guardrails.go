package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// ── AI guardrails ────────────────────────────────────────────────────────────
// Shared protections for every AI endpoint (build, edit, agent): per-account
// rate limiting (cost + abuse control), prompt moderation (reject obvious
// phishing/spam/malware before spending tokens), and Google Safe Browsing on
// generated hostnames (key-gated). Admins bypass the rate limit.

// aiRateLimiter is a per-user sliding-window limiter for AI actions.
type aiRateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	max    int
	window time.Duration
}

func newAIRateLimiter(max int, window time.Duration) *aiRateLimiter {
	return &aiRateLimiter{hits: map[string][]time.Time{}, max: max, window: window}
}

// allow reports whether userID may perform another AI action now, and how long
// until the window frees up if not.
func (l *aiRateLimiter) allow(userID string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	kept := l.hits[userID][:0]
	for _, t := range l.hits[userID] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.max {
		retry := kept[0].Add(l.window).Sub(now)
		l.hits[userID] = kept
		return false, retry
	}
	l.hits[userID] = append(kept, now)
	return true, 0
}

// aiLimiter caps AI actions per user per hour. Env-overridable; admins bypass at
// the call site. Generous enough for real use, tight enough to stop a runaway
// script (each action can trigger a build = real container + token spend).
var aiLimiter = newAIRateLimiter(aiRateMax(), time.Hour)

func aiRateMax() int {
	if v := os.Getenv("AI_RATE_PER_HOUR"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 30
}

// checkAIRate enforces the per-user limit (admins bypass). Returns true if the
// request may proceed; otherwise writes a 429 and returns false.
func (s *Server) checkAIRate(w http.ResponseWriter, r *http.Request, userID string) bool {
	if isAdmin, _ := s.db.IsUserAdmin(r.Context(), userID); isAdmin {
		return true
	}
	ok, retry := aiLimiter.allow(userID)
	if !ok {
		mins := int(retry.Minutes()) + 1
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())))
		writeError(w, http.StatusTooManyRequests,
			"You're building a lot right now — please wait ~"+strconv.Itoa(mins)+" min before the next AI action.")
		return false
	}
	return true
}

// ── prompt moderation ──

// A conservative block-list of intents we won't build. The codegen contract also
// refuses these, but rejecting here is cheaper (no tokens) and covers the agent.
var bannedIntent = regexp.MustCompile(`(?i)\b(phish(ing)?|carding|credential[\s-]?steal|steal(er)? (cred|password|login|seed|wallet)|fake (login|bank|paypal|coinbase|metamask) (page|site|clone)|clone .{0,20}(login|bank|paypal)|keylog(ger)?|ransomware|malware|botnet|ddos|denial[\s-]of[\s-]service|spam(bot| sender| blast)?|mass (email|dm|sms)|otp[\s-]?bypass|bypass (2fa|captcha)|scam (page|site|bot))\b`)

// moderatePrompt returns a user-facing reason if the prompt should be refused,
// or "" if it's fine.
func moderatePrompt(prompt string) string {
	if bannedIntent.MatchString(prompt) {
		return "I can't build that — it looks like it could be used for phishing, spam, or abuse. Deployzy only builds legitimate apps and services."
	}
	return ""
}

// ── Google Safe Browsing (key-gated) ──

// checkSafeBrowsing returns true if the URL is flagged as unsafe. No-op (returns
// false) unless GOOGLE_SAFE_BROWSING_KEY is set, so it activates the moment a key
// is added without any code change.
func checkSafeBrowsing(ctx context.Context, rawURL string) bool {
	key := os.Getenv("GOOGLE_SAFE_BROWSING_KEY")
	if key == "" || rawURL == "" {
		return false
	}
	body, _ := json.Marshal(map[string]any{
		"client": map[string]string{"clientId": "deployzy", "clientVersion": "1.0"},
		"threatInfo": map[string]any{
			"threatTypes":      []string{"MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"},
			"platformTypes":    []string{"ANY_PLATFORM"},
			"threatEntryTypes": []string{"URL"},
			"threatEntries":    []map[string]string{{"url": rawURL}},
		},
	})
	reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(reqCtx, http.MethodPost,
		"https://safebrowsing.googleapis.com/v4/threatMatches:find?key="+key, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false // fail-open: don't block deploys if the check is down
	}
	defer resp.Body.Close()
	var out struct {
		Matches []any `json:"matches"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	return len(out.Matches) > 0
}
