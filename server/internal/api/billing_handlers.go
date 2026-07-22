package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/notify"
)

// planPricing is the single source of truth for what each plan costs.
// Keep in sync with the marketing page (web/src/app/(marketing)/page.tsx)
// and the Polar product prices in the Polar dashboard.
var planPricing = map[string]float64{
	"hobby": 5,
	"pro":   12,
	"team":  35,
}

// checkoutRequest selects which plan to buy and how to pay for it.
type checkoutRequest struct {
	Plan   string `json:"plan"`   // "pro" (default) or "team"
	Method string `json:"method"` // "crypto" (default, InventPay) or "card" (Polar)
}

// handleCreateCheckout creates a payment for a plan upgrade — an InventPay
// USDT invoice or a Polar card checkout, depending on the requested method.
func (s *Server) handleCreateCheckout(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req checkoutRequest
	// Body is optional for backward compatibility (old dashboard sends none).
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Plan == "" {
		req.Plan = "pro"
	}
	if req.Method == "" {
		req.Method = "crypto"
	}

	amount, ok := planPricing[req.Plan]
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown plan (want hobby, pro, or team)")
		return
	}

	// Already on an active paid subscription — block double-charging.
	sub, _ := s.db.GetActiveSubscription(r.Context(), u.ID)
	if sub != nil {
		writeError(w, http.StatusConflict, "you already have an active subscription")
		return
	}

	switch req.Method {
	case "card":
		if s.polar == nil || !s.polar.HasPlan(req.Plan) {
			writeError(w, http.StatusServiceUnavailable, "card payments not configured")
			return
		}
		checkout, err := s.polar.CreateCheckout(req.Plan, u.ID, u.Email,
			"https://deployzy.com/billing?status=success")
		if err != nil {
			s.log.Error().Err(err).Str("plan", req.Plan).Msg("polar checkout failed")
			writeError(w, http.StatusInternalServerError, "failed to create card checkout")
			return
		}
		// Pending row keyed by the Polar checkout ID; the webhook activates it.
		s.db.CreateSubscription(r.Context(), u.ID, req.Plan, checkout.ID, amount, "USD")
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"payment_id":  checkout.ID,
			"invoice_url": checkout.URL,
			"amount":      amount,
			"currency":    "USD",
			"method":      "card",
		})

	case "crypto":
		if s.billing == nil {
			writeError(w, http.StatusServiceUnavailable, "billing not configured")
			return
		}
		invoice, err := s.billing.CreateInvoice(&billing.CreateInvoiceRequest{
			Amount:            amount,
			AmountCurrency:    "USDT",
			OrderID:           "dz_" + req.Plan + "_" + u.ID,
			Description:       "Deployzy " + req.Plan + " — 1 Month",
			CallbackURL:       "https://api.deployzy.com/api/v1/billing/webhook",
			ExpirationMinutes: 30,
		})
		if err != nil {
			s.log.Error().Err(err).Str("plan", req.Plan).Msg("inventpay invoice failed")
			writeError(w, http.StatusInternalServerError, "failed to create payment")
			return
		}
		// Save pending subscription (ignore duplicate — user may have retried)
		s.db.CreateSubscription(r.Context(), u.ID, req.Plan, invoice.PaymentID, amount, "USDT")
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"payment_id":  invoice.PaymentID,
			"invoice_url": invoice.InvoiceURL,
			"amount":      amount,
			"currency":    "USDT",
			"method":      "crypto",
			"expires_at":  invoice.ExpiresAt,
		})

	default:
		writeError(w, http.StatusBadRequest, "unknown payment method (want crypto or card)")
	}
}

// handleBillingStatus returns the user's subscription status.
func (s *Server) handleBillingStatus(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	sub, _ := s.db.GetActiveSubscription(r.Context(), u.ID)
	subs, _ := s.db.ListSubscriptions(r.Context(), u.ID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"active_subscription": sub,
		"history":             subs,
	})
}

// handleBillingWebhook processes InventPay payment webhooks.
// The signature is mandatory: unsigned or badly signed payloads are dropped.
func (s *Server) handleBillingWebhook(w http.ResponseWriter, r *http.Request) {
	if s.billing == nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	signature := r.Header.Get("X-Webhook-Signature")
	if signature == "" || !s.billing.VerifyWebhook(body, signature) {
		s.log.Warn().Bool("signed", signature != "").Msg("rejected inventpay webhook: bad or missing signature")
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	var payload billing.WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	s.log.Info().
		Str("event", payload.Event).
		Str("payment_id", payload.PaymentID).
		Str("status", payload.Status).
		Float64("amount", payload.BaseAmount).
		Msg("billing webhook received")

	switch payload.Event {
	case "payment.completed", "payment.confirmed":
		s.activatePaidSubscription(r, payload.PaymentID)
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success": true}`))
}

// handlePolarWebhook processes Polar card-payment webhooks. Signature is
// verified per the Standard Webhooks scheme; unsigned payloads are dropped.
// Activation happens on order.paid ONLY — order.created fires before payment.
func (s *Server) handlePolarWebhook(w http.ResponseWriter, r *http.Request) {
	if s.polar == nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	if !s.polar.VerifyWebhook(body, r.Header) {
		s.log.Warn().Msg("rejected polar webhook: bad or missing signature")
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	var event billing.PolarWebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	s.log.Info().Str("event", event.Type).Msg("polar webhook received")

	// order.paid is the only event that grants value. checkout_id in metadata
	// isn't guaranteed, so we match the pending subscription via the checkout
	// ID we stored at checkout time (order carries it as checkout_id) or fall
	// back to metadata.
	if event.Type == "order.paid" {
		var order struct {
			billing.PolarOrder
			CheckoutID string `json:"checkout_id"`
		}
		if err := json.Unmarshal(event.Data, &order); err != nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		paymentID := order.CheckoutID
		if paymentID == "" {
			paymentID = order.Metadata["checkout_id"]
		}
		if paymentID != "" {
			s.activatePaidSubscription(r, paymentID)
		} else {
			s.log.Warn().Str("order", order.ID).Msg("polar order.paid without checkout_id — cannot attribute")
		}
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success": true}`))
}

// activatePaidSubscription flips a pending subscription to active and
// upgrades the user (idempotent — replayed webhooks are no-ops), then fires
// the Telegram notification if the user connected one.
func (s *Server) activatePaidSubscription(r *http.Request, paymentID string) {
	res, err := s.db.ActivateSubscriptionDetailed(r.Context(), paymentID)
	if err != nil {
		s.log.Error().Err(err).Str("payment_id", paymentID).Msg("failed to activate subscription")
		return
	}
	if res == nil || !res.Activated {
		// Replayed webhook or unknown payment — nothing to do, and crucially
		// no duplicate confirmation email.
		return
	}
	s.log.Info().
		Str("payment_id", paymentID).
		Str("plan", res.Plan).
		Str("kind", res.Kind).
		Msg("subscription activated")

	sub, _ := s.db.GetSubscriptionByPaymentID(r.Context(), paymentID)
	user, _ := s.db.GetUserByID(r.Context(), res.UserID)

	// Billing confirmation email — new purchase, upgrade, or renewal.
	if s.emailSvc != nil && user != nil {
		amount, currency := 0.0, "USD"
		if sub != nil {
			amount, currency = sub.Amount, sub.Currency
		}
		subject := "Your Deployzy " + res.Plan + " subscription is active"
		switch res.Kind {
		case "upgrade":
			subject = "Upgraded to Deployzy " + res.Plan + " 🚀"
		case "renewal":
			subject = "Your Deployzy " + res.Plan + " subscription renewed"
		}
		body := notify.SubscriptionEmail(user.Name, res.Plan, res.Kind, amount, currency,
			res.PeriodEnd.Format("2 January 2006"))
		go func(email, subject, body string) {
			if err := s.emailSvc.SendOne(email, subject, body); err != nil {
				s.log.Warn().Err(err).Str("email", email).Msg("failed to send subscription email")
			}
		}(user.Email, subject, body)
	}

	if s.telegram != nil {
		tc, _ := s.db.GetTelegramConnection(r.Context(), res.UserID)
		if tc != nil {
			verb := "activated"
			if res.Kind == "renewal" {
				verb = "renewed"
			} else if res.Kind == "upgrade" {
				verb = "upgraded"
			}
			s.telegram.SendMarkdown(tc.ChatID,
				"🎉 *Subscription "+verb+"!*\n\nYour Deployzy "+res.Plan+" plan is now active. Enjoy!")
		}
	}
}

// handleCheckPayment checks the status of a payment.
func (s *Server) handleCheckPayment(w http.ResponseWriter, r *http.Request) {
	if s.billing == nil {
		writeError(w, http.StatusServiceUnavailable, "billing not configured")
		return
	}

	paymentID := r.URL.Query().Get("payment_id")
	if paymentID == "" {
		writeError(w, http.StatusBadRequest, "payment_id required")
		return
	}

	status, err := s.billing.GetPaymentStatus(paymentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check status")
		return
	}

	writeJSON(w, http.StatusOK, status)
}
