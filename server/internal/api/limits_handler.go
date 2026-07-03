package api

import (
	"context"
	"net/http"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
)

// isFeatureAllowedForUser is a server-side convenience that wraps
// billing.IsFeatureAllowed for code paths (like the WebSocket auth flow) that
// only have a user ID in scope, not a full *auth.AuthenticatedUser.
func (s *Server) isFeatureAllowedForUser(ctx context.Context, userID, feature string) bool {
	user, err := s.db.GetUserByID(ctx, userID)
	if err != nil || user == nil {
		return false
	}
	return billing.IsFeatureAllowed(ctx, s.db, &auth.AuthenticatedUser{
		ID: user.ID, Email: user.Email, Plan: user.Plan,
	}, feature)
}

// handleGetMyLimits returns the user's current plan caps + their actual usage.
// Used by the frontend so it can render "X of Y used" badges and disable
// "create" buttons proactively instead of letting the request fail with 402.
func (s *Server) handleGetMyLimits(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	ctx := r.Context()

	isAdmin, _ := s.db.IsUserAdmin(ctx, u.ID)

	// Resolve the *current* plan from the DB (not the possibly-stale JWT claim),
	// and use the unlimited 'admin' row for admins so the UI reflects reality.
	plan := u.Plan
	if fresh, err := s.db.GetUserByID(ctx, u.ID); err == nil && fresh != nil && fresh.Plan != "" {
		plan = fresh.Plan
	}
	if isAdmin {
		plan = "admin"
	}

	limits, err := s.db.GetPlanLimits(ctx, plan)
	if err != nil || limits == nil {
		writeError(w, http.StatusInternalServerError, "plan lookup failed")
		return
	}

	// Counts (cheap, all single-row aggregates).
	projects, _ := s.db.CountProjectsForUser(ctx, u.ID)
	previews, _ := s.db.CountActivePreviewsForUser(ctx, u.ID)
	databases, _ := s.db.CountProjectDatabasesForUser(ctx, u.ID)
	services, _ := s.db.CountServicesForUser(ctx, u.ID)
	customDomains, _ := s.db.CountCustomDomainsForUser(ctx, u.ID)
	crons, _ := s.db.CountCronsForUser(ctx, u.ID)
	byoc, _ := s.db.CountBYOCServersForUser(ctx, u.ID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"plan":     plan,
		"is_admin": isAdmin,
		"limits":   limits,
		"usage": map[string]int{
			"projects":         projects,
			"preview_deploys":  previews,
			"databases":        databases,
			"services":         services,
			"custom_domains":   customDomains,
			"crons":            crons,
			"byoc_servers":     byoc,
		},
	})
}
