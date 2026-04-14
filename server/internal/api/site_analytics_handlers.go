package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
)

// topColAllowed restricts the `field` query param to columns we know exist and
// are safe to group by — prevents this endpoint becoming a SQL injection hole.
var topColAllowed = map[string]bool{
	"path":     true,
	"referrer": true,
	"country":  true,
	"browser":  true,
	"os":       true,
	"device":   true,
}

// handleSiteOverview: GET /projects/:id/analytics?range=24h|7d|30d
func (s *Server) handleSiteOverview(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	since, bucket := siteWindowFor(r.URL.Query().Get("range"))

	overview, _ := s.db.GetSiteOverview(r.Context(), projectID, since)
	series, _ := s.db.GetSiteTimeseries(r.Context(), projectID, since, bucket)
	realtimeV, realtimeP, _ := s.db.GetSiteRealtime(r.Context(), projectID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"overview":   overview,
		"timeseries": series,
		"realtime": map[string]int64{
			"visitors":  realtimeV,
			"pageviews": realtimeP,
		},
	})
}

// handleSiteTop: GET /projects/:id/analytics/top?field=path|referrer|country|browser|os|device
func (s *Server) handleSiteTop(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	field := r.URL.Query().Get("field")
	if !topColAllowed[field] {
		writeError(w, http.StatusBadRequest, "invalid field")
		return
	}
	since, _ := siteWindowFor(r.URL.Query().Get("range"))

	rows, err := s.db.GetSiteTop(r.Context(), projectID, field, since, 10)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch top rows")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

// siteWindowFor chooses the query window and bucket for the timeseries chart.
//
//	24h → 30-minute buckets (~48 points)
//	7d  → 3-hour buckets   (~56 points)
//	30d → 1-day buckets    (30 points)
func siteWindowFor(rng string) (time.Time, string) {
	now := time.Now()
	switch rng {
	case "7d":
		return now.Add(-7 * 24 * time.Hour), "3 hours"
	case "30d":
		return now.Add(-30 * 24 * time.Hour), "1 day"
	default:
		return now.Add(-24 * time.Hour), "30 minutes"
	}
}
