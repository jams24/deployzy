// Package billing centralises plan-limit enforcement so handlers don't each
// reimplement the same "is this user allowed to create another X?" check.
//
// All public entry points follow the same shape:
//
//	if err := billing.EnsureCanCreate(ctx, db, user, billing.DimProject); err != nil {
//	    writeError(w, http.StatusPaymentRequired, err.Error())
//	    return
//	}
//
// Admin users (is_admin = true) bypass every check.
package billing

import (
	"context"
	"fmt"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

// Dimension identifies which numeric quota to check.
type Dimension string

const (
	DimProject       Dimension = "project"
	DimDatabase      Dimension = "database"
	DimService       Dimension = "service"
	DimCustomDomain  Dimension = "custom_domain"
	DimCron          Dimension = "cron"
	DimBYOCServer    Dimension = "byoc_server"
	DimSubdomain     Dimension = "subdomain"
	DimPreviewDeploy Dimension = "preview_deploy"
)

// LimitError is returned when a user has hit their plan cap. Designed so the
// handler can surface a clean message and the upgrade path to the UI.
type LimitError struct {
	Plan      string    // user's current plan
	Dimension Dimension // what they hit the cap on
	Limit     int       // the cap value
	Current   int       // their current count
}

func (e *LimitError) Error() string {
	return fmt.Sprintf("plan limit reached: %s (%d/%d on %s plan) — upgrade to add more",
		e.Dimension, e.Current, e.Limit, e.Plan)
}

// EnsureCanCreate returns nil if the user is allowed to add one more of the
// given dimension, or a *LimitError if they're at the cap. Admins always get nil.
func EnsureCanCreate(ctx context.Context, database *db.DB, user *auth.AuthenticatedUser, dim Dimension) error {
	if user == nil {
		return fmt.Errorf("unauthenticated")
	}
	// Admin bypass — single source of truth so we don't sprinkle is_admin
	// checks throughout the codebase.
	if isAdmin, _ := database.IsUserAdmin(ctx, user.ID); isAdmin {
		return nil
	}

	plan := currentPlan(ctx, database, user)
	limits, err := database.GetPlanLimits(ctx, plan)
	if err != nil || limits == nil {
		return fmt.Errorf("plan lookup failed")
	}

	limit, current, err := lookup(ctx, database, user.ID, dim, limits)
	if err != nil {
		return err
	}
	if db.Unlimited(limit) {
		return nil
	}
	if current >= limit {
		return &LimitError{Plan: plan, Dimension: dim, Limit: limit, Current: current}
	}
	return nil
}

// currentPlan returns the user's up-to-date plan from the database rather than
// the (possibly stale) JWT claim, so a plan change takes effect immediately
// without the user re-logging in. Falls back to the token's plan on error.
// GetUserByID also applies effectivePlan (referral-reward upgrades).
func currentPlan(ctx context.Context, database *db.DB, user *auth.AuthenticatedUser) string {
	if fresh, err := database.GetUserByID(ctx, user.ID); err == nil && fresh != nil && fresh.Plan != "" {
		return fresh.Plan
	}
	return user.Plan
}

// IsFeatureAllowed checks a boolean per-plan feature flag. Returns true for admins.
func IsFeatureAllowed(ctx context.Context, database *db.DB, user *auth.AuthenticatedUser, feature string) bool {
	if user == nil {
		return false
	}
	if isAdmin, _ := database.IsUserAdmin(ctx, user.ID); isAdmin {
		return true
	}
	limits, err := database.GetPlanLimits(ctx, currentPlan(ctx, database, user))
	if err != nil || limits == nil {
		return false
	}
	switch feature {
	case "previews":
		return limits.AllowPreviews
	case "release_cmd":
		return limits.AllowReleaseCmd
	case "health_checks":
		return limits.AllowHealthChecks
	case "private_repos":
		return limits.AllowPrivateRepos
	case "tcp_tunnels":
		return limits.AllowTCPTunnels
	case "custom_events":
		return limits.AllowCustomEvents
	case "live_logs":
		return limits.AllowLiveLogs
	case "telegram":
		return limits.AllowTelegram
	}
	return false
}

// lookup runs the DB count + returns the matching plan limit for a dimension.
func lookup(ctx context.Context, database *db.DB, userID string, dim Dimension, limits *db.PlanLimit) (int, int, error) {
	switch dim {
	case DimProject:
		n, err := database.CountProjectsForUser(ctx, userID)
		return limits.MaxProjects, n, err
	case DimDatabase:
		n, err := database.CountProjectDatabasesForUser(ctx, userID)
		return limits.MaxDatabases, n, err
	case DimService:
		n, err := database.CountServicesForUser(ctx, userID)
		return limits.MaxServices, n, err
	case DimCustomDomain:
		n, err := database.CountCustomDomainsForUser(ctx, userID)
		return limits.MaxCustomDomains, n, err
	case DimCron:
		n, err := database.CountCronsForUser(ctx, userID)
		return limits.MaxCrons, n, err
	case DimBYOCServer:
		n, err := database.CountBYOCServersForUser(ctx, userID)
		return limits.MaxBYOCServers, n, err
	case DimPreviewDeploy:
		n, err := database.CountActivePreviewsForUser(ctx, userID)
		return limits.MaxPreviewDeploys, n, err
	case DimSubdomain:
		// Subdomain reservations were tracked by the legacy CheckSubdomainAvailable
		// flow (which already counted reserved_subdomains). Wire it here too so
		// the new framework can be the single enforcement entry point.
		var n int
		err := database.Pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM reserved_subdomains WHERE user_id = $1`, userID,
		).Scan(&n)
		return limits.MaxSubdomains, n, err
	}
	return 0, 0, fmt.Errorf("unknown dimension: %s", dim)
}
