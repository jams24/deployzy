package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
)

// Top-up economics. 1 credit = $0.01, so $1 buys 100 credits. Amounts are
// arbitrary (like Brimble's "credits per $1"), bounded to sane min/max.
const (
	creditsPerDollar = 100.0
	minTopupUSD      = 5.0
	maxTopupUSD      = 1000.0
)

// suggested quick-pick amounts for the buy modal.
var topupPresets = []float64{5, 10, 20, 50}

// GET /api/v1/ai/credits — the caller's AI credit position, packs, and history.
func (s *Server) handleGetAICredits(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	enabled := billing.AICreditsEnabled(r.Context(), s.db)

	allotment := 20
	if limits, err := s.db.GetPlanLimits(r.Context(), u.Plan); err == nil && limits != nil {
		allotment = limits.MonthlyAICredits
	}
	isAdmin, _ := s.db.IsUserAdmin(r.Context(), u.ID)

	st, _ := s.db.GetAICreditStatus(r.Context(), u.ID, allotment)
	le, _ := s.db.GetAILedger(r.Context(), u.ID, 30)
	var ledger any = le
	if le == nil {
		ledger = []any{} // keep JSON as [] not null
	}

	// Which payment methods can actually complete a top-up right now.
	cryptoOK := s.billing != nil
	cardOK := false
	if s.polar != nil {
		if v, _ := s.db.GetSetting(r.Context(), "polar_credits_product"); v != "" {
			cardOK = true
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":           enabled, // when false, credits are not enforced (unlimited)
		"unlimited":         isAdmin || st.Unlimited || !enabled,
		"status":            st,
		"ledger":            ledger,
		"methods":           map[string]bool{"crypto": cryptoOK, "card": cardOK},
		"credits_per_dollar": creditsPerDollar,
		"presets":           topupPresets,
		"min_usd":           minTopupUSD,
		"max_usd":           maxTopupUSD,
	})
}

// POST /api/v1/ai/credits/topup — buy an arbitrary dollar amount of credits.
// Body: {amount: number (USD), method: "card"|"crypto"}. The shared webhook
// grants the credits on payment.
func (s *Server) handleCreateCreditTopup(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var req struct {
		Amount float64 `json:"amount"`
		Method string  `json:"method"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Method == "" {
		req.Method = "crypto"
	}
	// Round to whole dollars and validate bounds.
	usd := math.Round(req.Amount)
	if usd < minTopupUSD || usd > maxTopupUSD {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("amount must be between $%d and $%d", int(minTopupUSD), int(maxTopupUSD)))
		return
	}
	credits := usd * creditsPerDollar
	desc := fmt.Sprintf("Deployzy AI credits — $%d (%s credits)", int(usd), humanInt(credits))

	switch req.Method {
	case "crypto":
		if s.billing == nil {
			writeError(w, http.StatusServiceUnavailable, "crypto payments not configured")
			return
		}
		invoice, err := s.billing.CreateInvoice(&billing.CreateInvoiceRequest{
			Amount:            usd,
			AmountCurrency:    "USDT",
			OrderID:           fmt.Sprintf("dzc_%d_%s", int(usd), u.ID),
			Description:       desc,
			CallbackURL:       "https://api.deployzy.com/api/v1/billing/webhook",
			ExpirationMinutes: 30,
		})
		if err != nil {
			s.log.Error().Err(err).Msg("credit topup invoice failed")
			writeError(w, http.StatusInternalServerError, "failed to create payment")
			return
		}
		s.db.CreateCreditPurchase(r.Context(), u.ID, invoice.PaymentID, credits, usd)
		writeJSON(w, http.StatusOK, map[string]any{
			"payment_id": invoice.PaymentID, "invoice_url": invoice.InvoiceURL,
			"credits": credits, "amount": usd, "currency": "USDT", "method": "crypto",
			"expires_at": invoice.ExpiresAt,
		})

	case "card":
		if s.polar == nil {
			writeError(w, http.StatusServiceUnavailable, "card payments not configured")
			return
		}
		productID, _ := s.db.GetSetting(r.Context(), "polar_credits_product")
		if productID == "" {
			writeError(w, http.StatusServiceUnavailable, "card top-ups aren't set up yet — use crypto (USDT), or ask an admin to add the Polar credits product")
			return
		}
		checkout, err := s.polar.CreateProductCheckout(productID, u.ID, u.Email,
			"https://deployzy.com/billing?status=success", int(usd*100),
			map[string]string{"kind": "credits"})
		if err != nil {
			s.log.Error().Err(err).Msg("credit topup: polar checkout failed")
			writeError(w, http.StatusInternalServerError, "failed to create card checkout")
			return
		}
		s.db.CreateCreditPurchase(r.Context(), u.ID, checkout.ID, credits, usd)
		writeJSON(w, http.StatusOK, map[string]any{
			"payment_id": checkout.ID, "invoice_url": checkout.URL,
			"credits": credits, "amount": usd, "currency": "USD", "method": "card",
		})

	default:
		writeError(w, http.StatusBadRequest, "unknown payment method (want crypto or card)")
	}
}

// humanInt formats a credit count with thousands separators.
func humanInt(n float64) string {
	s := strconv.FormatInt(int64(n), 10)
	out := ""
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out += ","
		}
		out += string(c)
	}
	return out
}

// ── Admin: per-user credit view + manual adjustment ──────────────────────────

// GET /api/v1/admin/users/{userId}/credits — a user's AI credit position + history.
func (s *Server) handleAdminGetUserCredits(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "userId")
	if uid == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}
	user, err := s.db.GetUserByID(r.Context(), uid)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	allotment := 20
	if limits, err := s.db.GetPlanLimits(r.Context(), user.Plan); err == nil && limits != nil {
		allotment = limits.MonthlyAICredits
	}
	st, _ := s.db.GetAICreditStatus(r.Context(), uid, allotment)
	le, _ := s.db.GetAILedger(r.Context(), uid, 100)
	var ledger any = le
	if le == nil {
		ledger = []any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":         uid,
		"plan":            user.Plan,
		"free_allotment":  allotment,
		"credits_enabled": billing.AICreditsEnabled(r.Context(), s.db),
		"status":          st,
		"ledger":          ledger,
	})
}

// POST /api/v1/admin/users/{userId}/credits — manually grant (or deduct, with a
// negative amount) wallet credits. Body: {credits: number, reason?: string}.
func (s *Server) handleAdminAdjustUserCredits(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "userId")
	if uid == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}
	var body struct {
		Credits float64 `json:"credits"`
		Reason  string  `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Credits == 0 {
		writeError(w, http.StatusBadRequest, "credits (non-zero) required")
		return
	}
	reason := body.Reason
	if reason == "" {
		reason = "admin"
	}
	if err := s.db.GrantAICredits(r.Context(), uid, body.Credits, reason); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to adjust credits")
		return
	}
	allotment := 20
	if user, err := s.db.GetUserByID(r.Context(), uid); err == nil && user != nil {
		if limits, err := s.db.GetPlanLimits(r.Context(), user.Plan); err == nil && limits != nil {
			allotment = limits.MonthlyAICredits
		}
	}
	st, _ := s.db.GetAICreditStatus(r.Context(), uid, allotment)
	writeJSON(w, http.StatusOK, map[string]any{"status": st})
}
