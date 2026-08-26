package api

import (
	"context"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
)

// Request-scoped AI billing. Rather than thread token usage through every LLM
// call signature, the handler attaches an *aiBill to the context; each low-level
// provider call, on success, reports its usage via chargeUsage, which settles the
// cost against the user's credits (free allotment first, then wallet).
//
// This charges ALL token usage a request consumes — the initial generation, any
// self-repair rounds, edits, and agent turns — which is the honest token-based
// model and protects the platform from repair-heavy builds. When the credit
// feature is dark (default) SettleAICredits is a no-op, so this is inert.

type aiBillKey struct{}

type aiBill struct {
	user      *auth.AuthenticatedUser
	reason    string // build|edit|agent
	projectID string
}

// withAIBill returns a context carrying billing info for downstream LLM calls.
func withAIBill(ctx context.Context, user *auth.AuthenticatedUser, reason, projectID string) context.Context {
	if user == nil {
		return ctx
	}
	return context.WithValue(ctx, aiBillKey{}, &aiBill{user: user, reason: reason, projectID: projectID})
}

// chargeUsage settles a completed provider call's token usage against the billing
// context (if any). Safe to call unconditionally — no bill on the context, empty
// usage, or the feature being dark all make it a no-op.
func (s *Server) chargeUsage(ctx context.Context, model string, tokensIn, tokensOut int) {
	b, _ := ctx.Value(aiBillKey{}).(*aiBill)
	if b == nil || b.user == nil {
		return
	}
	billing.SettleAICredits(ctx, s.db, b.user, b.reason, b.projectID, model, tokensIn, tokensOut)
}

// userFromID builds a minimal AuthenticatedUser for async flows (e.g. the
// self-repair loop) that only carry a user id. currentPlan/GetPlanLimits resolve
// the fresh plan from the DB, so ID is sufficient for billing.
func userFromID(userID string) *auth.AuthenticatedUser {
	return &auth.AuthenticatedUser{ID: userID}
}
