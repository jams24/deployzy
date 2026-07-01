package api

import (
	"fmt"
	"net/http"

	"github.com/serverme/serverme/server/internal/auth"
)

// handleGetReferrals returns the user's referral link, code, stats, and the
// list of people they've referred.
func (s *Server) handleGetReferrals(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	stats, err := s.db.GetReferralStats(r.Context(), u.ID)
	if err != nil {
		s.log.Error().Err(err).Msg("get referral stats")
		writeError(w, http.StatusInternalServerError, "failed to load referrals")
		return
	}

	domain := "deployzy.com"
	if s.deployer != nil && s.deployer.Domain != "" {
		domain = s.deployer.Domain
	}
	link := fmt.Sprintf("https://%s/sign-up?ref=%s", domain, stats.Code)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"code":       stats.Code,
		"link":       link,
		"total":      stats.Total,
		"paid":       stats.Paid,
		"pro_months": stats.ProMonths,
		"pro_until":  stats.ProUntil,
		"milestone":  10, // paid referrals per Pro month
		"people":     stats.People,
	})
}
