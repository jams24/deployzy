package api

import (
	"net/http"
	"strconv"
)

const settingMaxConcurrentBuilds = "max_concurrent_builds"

// GET /api/v1/admin/build-config — platform-wide build settings.
func (s *Server) handleAdminGetBuildConfig(w http.ResponseWriter, r *http.Request) {
	v, _ := s.db.GetSetting(r.Context(), settingMaxConcurrentBuilds)
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		n = 1
	}
	writeJSON(w, http.StatusOK, map[string]any{"max_concurrent_builds": n})
}

// PUT /api/v1/admin/build-config — set how many docker builds run at once
// across the whole platform (protects the host; default 1).
func (s *Server) handleAdminSetBuildConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MaxConcurrentBuilds int `json:"max_concurrent_builds"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	n := body.MaxConcurrentBuilds
	if n < 1 {
		n = 1
	}
	if n > 16 {
		n = 16 // sanity cap
	}
	if err := s.db.SetSetting(r.Context(), settingMaxConcurrentBuilds, strconv.Itoa(n)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"max_concurrent_builds": n})
}
