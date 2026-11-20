package api

import (
	"encoding/json"
	"net/http"

	"github.com/serverme/serverme/server/internal/auth"
)

// GET /api/v1/onboarding — tour + setup-checklist state for the dashboard.
func (s *Server) handleGetOnboarding(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	o, err := s.db.GetOnboarding(r.Context(), u.ID)
	if err != nil {
		s.log.Error().Err(err).Str("user", u.ID).Msg("onboarding: load failed")
		writeError(w, http.StatusInternalServerError, "failed to load onboarding")
		return
	}
	writeJSON(w, http.StatusOK, o)
}

// POST /api/v1/onboarding — {"tour_done": bool} and/or {"checklist_dismissed": bool}.
func (s *Server) handleUpdateOnboarding(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var body struct {
		TourDone           *bool `json:"tour_done"`
		ChecklistDismissed *bool `json:"checklist_dismissed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.TourDone == nil && body.ChecklistDismissed == nil) {
		writeError(w, http.StatusBadRequest, "send tour_done and/or checklist_dismissed")
		return
	}
	if body.TourDone != nil {
		if err := s.db.SetTourDone(r.Context(), u.ID, *body.TourDone); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save")
			return
		}
	}
	if body.ChecklistDismissed != nil {
		if err := s.db.SetChecklistDismissed(r.Context(), u.ID, *body.ChecklistDismissed); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save")
			return
		}
	}
	s.handleGetOnboarding(w, r)
}
