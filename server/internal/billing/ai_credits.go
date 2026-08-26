package billing

import (
	"context"
	"fmt"
	"math"
	"strconv"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

// AI credit enforcement for the AI builder / agent. Mirrors EnsureCanCreate:
// admin bypass, fail-open on lookup errors, and a hard master switch so the whole
// feature ships dark. 1 credit = $0.01 of model usage.

// Setting keys (in app_settings).
const (
	SettingAICreditsEnabled = "ai_credits_enabled" // "true" turns enforcement on
	SettingAIPriceInPerM    = "ai_price_in_per_m"   // USD per 1M input tokens for the active model
	SettingAIPriceOutPerM   = "ai_price_out_per_m"  // USD per 1M output tokens
)

// Default per-1M-token USD rates when the admin hasn't set them (DeepSeek-ish,
// deliberately cheap so an unset rate never over-charges).
const (
	defaultPriceInPerM  = 0.30
	defaultPriceOutPerM = 1.20
)

// CreditError is returned when a user is out of AI credits. Surfaced as HTTP 402
// so the UI shows a "top up" CTA (parallel to LimitError's upgrade CTA).
type CreditError struct {
	Plan      string
	Available float64
}

func (e *CreditError) Error() string {
	return fmt.Sprintf("out of AI credits on the %s plan — your monthly free credits are used up. Top up to keep building", e.Plan)
}

// AICreditsEnabled reports whether enforcement is switched on.
func AICreditsEnabled(ctx context.Context, database *db.DB) bool {
	v, _ := database.GetSetting(ctx, SettingAICreditsEnabled)
	return v == "true" || v == "1" || v == "on"
}

// creditsForUsage converts token usage to credits using the admin-configured
// per-model rates. credits = cost_usd * 100  (since 1 credit = $0.01).
func creditsForUsage(ctx context.Context, database *db.DB, tokensIn, tokensOut int) float64 {
	inRate, outRate := defaultPriceInPerM, defaultPriceOutPerM
	cfg, _ := database.GetSettings(ctx, SettingAIPriceInPerM, SettingAIPriceOutPerM)
	if v, err := strconv.ParseFloat(cfg[SettingAIPriceInPerM], 64); err == nil && v > 0 {
		inRate = v
	}
	if v, err := strconv.ParseFloat(cfg[SettingAIPriceOutPerM], 64); err == nil && v > 0 {
		outRate = v
	}
	costUSD := (float64(tokensIn)*inRate + float64(tokensOut)*outRate) / 1_000_000.0
	credits := costUSD * 100.0
	// Round to 4 dp to match the NUMERIC(16,6) column and avoid float noise.
	return math.Round(credits*10000) / 10000
}

// EnsureAICredits returns nil if the user may run one more AI action, or a
// *CreditError when they're out. Admins, an unset master switch, and unlimited
// plans always pass. Fails OPEN on any lookup error (never block on a hiccup).
func EnsureAICredits(ctx context.Context, database *db.DB, user *auth.AuthenticatedUser) error {
	if user == nil {
		return fmt.Errorf("unauthenticated")
	}
	if !AICreditsEnabled(ctx, database) {
		return nil // feature dark → unlimited
	}
	if isAdmin, _ := database.IsUserAdmin(ctx, user.ID); isAdmin {
		return nil
	}
	plan := currentPlan(ctx, database, user)
	limits, err := database.GetPlanLimits(ctx, plan)
	if err != nil || limits == nil {
		return nil // fail open
	}
	if limits.MonthlyAICredits < 0 {
		return nil // unlimited plan
	}
	st, err := database.GetAICreditStatus(ctx, user.ID, limits.MonthlyAICredits)
	if err != nil {
		return nil // fail open
	}
	if st.Available <= 0 {
		return &CreditError{Plan: plan, Available: st.Available}
	}
	return nil
}

// SettleAICredits charges the user for a completed AI call's token usage. No-op
// when the feature is dark, the caller is an admin, or usage is empty. Draws from
// the monthly free allotment first, then the wallet, and records the ledger row.
func SettleAICredits(ctx context.Context, database *db.DB, user *auth.AuthenticatedUser, reason, projectID, model string, tokensIn, tokensOut int) {
	if user == nil || (tokensIn == 0 && tokensOut == 0) {
		return
	}
	if !AICreditsEnabled(ctx, database) {
		return
	}
	if isAdmin, _ := database.IsUserAdmin(ctx, user.ID); isAdmin {
		return
	}
	limits, err := database.GetPlanLimits(ctx, currentPlan(ctx, database, user))
	if err != nil || limits == nil {
		return
	}
	credits := creditsForUsage(ctx, database, tokensIn, tokensOut)
	if credits <= 0 {
		return
	}
	_ = database.DebitAICredits(ctx, user.ID, credits, limits.MonthlyAICredits, reason, projectID, model, tokensIn, tokensOut)
}
