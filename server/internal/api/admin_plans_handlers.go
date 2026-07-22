package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/db"
)

// handleAdminListPlans returns every plan_limits row for the plan editor.
func (s *Server) handleAdminListPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := s.db.ListPlanLimits(r.Context())
	if err != nil {
		s.log.Error().Err(err).Msg("admin: list plan limits")
		writeError(w, http.StatusInternalServerError, "failed to load plans")
		return
	}
	writeJSON(w, http.StatusOK, plans)
}

// handleAdminUpdatePlan edits a single plan's limits. Every numeric field
// accepts -1 for unlimited, matching the convention the limit checker already
// uses. Changes take effect on the next check — no restart, no redeploy.
func (s *Server) handleAdminUpdatePlan(w http.ResponseWriter, r *http.Request) {
	plan := chi.URLParam(r, "plan")
	if plan == "" {
		writeError(w, http.StatusBadRequest, "plan required")
		return
	}
	// The admin row is the unlimited escape hatch used by the limit checker;
	// letting it be edited to finite values would silently cap admins.
	if plan == "admin" {
		writeError(w, http.StatusForbidden, "the admin plan is unlimited by design and cannot be edited")
		return
	}

	var pl db.PlanLimit
	if err := json.NewDecoder(r.Body).Decode(&pl); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	pl.Plan = plan

	if err := s.db.UpdatePlanLimits(r.Context(), &pl); err != nil {
		s.log.Error().Err(err).Str("plan", plan).Msg("admin: update plan limits")
		writeError(w, http.StatusInternalServerError, "failed to update plan: "+err.Error())
		return
	}
	s.log.Info().Str("plan", plan).Msg("plan limits updated by admin")

	updated, _ := s.db.GetPlanLimits(r.Context(), plan)
	writeJSON(w, http.StatusOK, updated)
}
