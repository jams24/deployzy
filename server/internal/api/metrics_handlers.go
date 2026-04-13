package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

// handleGetMetrics returns CPU / memory / network samples for a project.
// Query param: ?range=1h|6h|24h|7d (default 1h). Samples are auto-downsampled
// for wider ranges so the response is always a few hundred points tops.
func (s *Server) handleGetMetrics(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	rng := r.URL.Query().Get("range")
	since, bucket := windowFor(rng)

	samples, err := s.db.GetMetrics(r.Context(), projectID, since, bucket)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch metrics")
		return
	}
	if samples == nil {
		samples = []db.MetricSample{} //nolint:staticcheck
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"range":   rng,
		"samples": samples,
	})
}

// windowFor returns the start time and the bucketing interval for a range key.
// Bucketing keeps the response under ~300 points regardless of range:
//
//	1h  → raw 30s samples (~120 points)
//	6h  → 2-minute buckets (~180 points)
//	24h → 10-minute buckets (~144 points)
//	7d  → 1-hour buckets   (~168 points)
func windowFor(rng string) (time.Time, string) {
	now := time.Now()
	switch rng {
	case "6h":
		return now.Add(-6 * time.Hour), "2 minutes"
	case "24h":
		return now.Add(-24 * time.Hour), "10 minutes"
	case "7d":
		return now.Add(-7 * 24 * time.Hour), "1 hour"
	default: // "1h" or anything unknown
		return now.Add(-1 * time.Hour), ""
	}
}
