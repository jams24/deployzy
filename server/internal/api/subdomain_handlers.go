package api

import (
	"encoding/json"
	"net/http"

	"github.com/serverme/serverme/server/internal/auth"
)

func (s *Server) handleListSubdomains(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	subs, err := s.db.ListUserSubdomains(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list subdomains")
		return
	}

	count, _ := s.db.CountUserSubdomains(r.Context(), u.ID)

	user, _ := s.db.GetUserByID(r.Context(), u.ID)
	plan := "free"
	if user != nil {
		plan = user.Plan
	}
	limits, _ := s.db.GetPlanLimits(r.Context(), plan)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subdomains": subs,
		"count":      count,
		"limit":      limits.MaxSubdomains,
		"plan":       plan,
	})
}

func (s *Server) handleAddSubdomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Subdomain string `json:"subdomain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Subdomain == "" {
		writeError(w, http.StatusBadRequest, "subdomain required")
		return
	}

	available, reason := s.db.CheckSubdomainAvailable(r.Context(), req.Subdomain, u.ID)
	if !available {
		writeError(w, http.StatusConflict, reason)
		return
	}

	if err := s.db.ReserveSubdomainAuto(r.Context(), u.ID, req.Subdomain); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reserve subdomain")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"subdomain": req.Subdomain,
		"url":       "https://" + req.Subdomain + ".deployzy.com",
	})
}

func (s *Server) handleReleaseSubdomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Subdomain string `json:"subdomain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Subdomain == "" {
		writeError(w, http.StatusBadRequest, "subdomain required")
		return
	}

	if err := s.db.ReleaseSubdomain(r.Context(), u.ID, req.Subdomain); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "released"})
}

func (s *Server) handleCheckSubdomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	subdomain := r.URL.Query().Get("subdomain")
	if subdomain == "" {
		writeError(w, http.StatusBadRequest, "subdomain required")
		return
	}

	available, reason := s.db.CheckSubdomainAvailable(r.Context(), subdomain, u.ID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subdomain": subdomain,
		"available": available,
		"reason":    reason,
	})
}
