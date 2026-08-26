package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/serverme/serverme/server/internal/analytics"
)

// selfAnalyticsSubdomain is the reserved project slug that first-party
// (deployzy.com) pageviews are recorded under, so the existing per-project
// analytics UI can display them with zero new query code.
const selfAnalyticsSubdomain = "deployzy-web"

// handleCollectSelfAnalytics ingests a cookieless pageview beacon from the
// Deployzy marketing site. Same derivation as the proxy path (country from
// Cloudflare, device/browser/OS from the UA, a daily-rotating visitor hash),
// recorded under the reserved self-analytics project.
func (s *Server) handleCollectSelfAnalytics(w http.ResponseWriter, r *http.Request) {
	if s.analytics == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var body struct {
		Path     string `json:"path"`
		Referrer string `json:"referrer"`
		Name     string `json:"name"` // optional custom event name
		Type     string `json:"type"` // "pageview" (default) | "event"
	}
	// sendBeacon delivers a small JSON blob; ignore parse errors quietly.
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)

	pid := s.selfAnalyticsProjectID(r.Context())
	if pid == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	ua := r.Header.Get("User-Agent")
	device, browser, os, isBot := analytics.ParseUA(ua)
	botName := ""
	if isBot {
		if botName = analytics.ClassifyBot(ua); botName == "" {
			botName = "Other bot"
		}
	}
	ip := requestIP(r)

	path := truncate(strings.TrimSpace(body.Path), 200)
	if path == "" {
		path = "/"
	}
	if body.Type == "event" && body.Name != "" {
		path = "event:" + truncate(body.Name, 190)
	}

	s.analytics.Collect(analytics.Event{
		ProjectID:   pid,
		TS:          time.Now(),
		Path:        path,
		Method:      "JS",
		Status:      200,
		RefererHost: analytics.RefererHost(body.Referrer),
		Country:     requestCountry(r),
		IP:          ip,
		Device:      device,
		Browser:     browser,
		OS:          os,
		VisitorHash: s.analytics.HashVisitor(ip, ua),
		IsBot:       isBot,
		BotName:     botName,
	})
	w.WriteHeader(http.StatusNoContent)
}

// handleWebsiteAnalytics returns overview + timeseries + realtime for the
// first-party (deployzy.com) analytics project. Admin-only; resolves the
// reserved project internally so it works for any admin regardless of ownership.
func (s *Server) handleWebsiteAnalytics(w http.ResponseWriter, r *http.Request) {
	pid := s.selfAnalyticsProjectID(r.Context())
	if pid == "" {
		writeJSON(w, http.StatusOK, map[string]any{"overview": nil, "timeseries": []any{}, "realtime": map[string]int64{"visitors": 0, "pageviews": 0}})
		return
	}
	since, bucket := siteWindowFor(r.URL.Query().Get("range"))
	overview, _ := s.db.GetSiteOverview(r.Context(), pid, since)
	series, _ := s.db.GetSiteTimeseries(r.Context(), pid, since, bucket)
	rv, rp, _ := s.db.GetSiteRealtime(r.Context(), pid)
	writeJSON(w, http.StatusOK, map[string]any{
		"overview":   overview,
		"timeseries": series,
		"realtime":   map[string]int64{"visitors": rv, "pageviews": rp},
	})
}

// handleWebsiteTop returns a top-N breakdown (path|referrer|country|browser|os|device)
// for the first-party analytics project. Admin-only.
func (s *Server) handleWebsiteTop(w http.ResponseWriter, r *http.Request) {
	field := r.URL.Query().Get("field")
	if !topColAllowed[field] {
		writeError(w, http.StatusBadRequest, "invalid field")
		return
	}
	pid := s.selfAnalyticsProjectID(r.Context())
	if pid == "" {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	since, _ := siteWindowFor(r.URL.Query().Get("range"))
	rows, err := s.db.GetSiteTop(r.Context(), pid, field, since, 10)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch top rows")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// selfAnalyticsProjectID returns (find-or-create, cached) the reserved project
// row that first-party pageviews are stored under. Created lazily under the
// oldest admin account so the existing dashboard can surface it.
func (s *Server) selfAnalyticsProjectID(ctx context.Context) string {
	if v, ok := s.selfProjectID.Load().(string); ok && v != "" {
		return v
	}
	// Already exists?
	if p, _ := s.db.GetProjectBySubdomain(ctx, selfAnalyticsSubdomain); p != nil {
		s.selfProjectID.Store(p.ID)
		return p.ID
	}
	// Create under the oldest admin.
	var adminID string
	_ = s.db.Pool.QueryRow(ctx,
		`SELECT id FROM users WHERE COALESCE(is_admin,false) = true ORDER BY created_at ASC LIMIT 1`,
	).Scan(&adminID)
	if adminID == "" {
		return ""
	}
	p, err := s.db.CreateProject(ctx, adminID, "Deployzy Website", selfAnalyticsSubdomain, "static")
	if err != nil || p == nil {
		// A concurrent create may have won — re-read.
		if existing, _ := s.db.GetProjectBySubdomain(ctx, selfAnalyticsSubdomain); existing != nil {
			s.selfProjectID.Store(existing.ID)
			return existing.ID
		}
		return ""
	}
	s.selfProjectID.Store(p.ID)
	return p.ID
}
