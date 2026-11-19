package api

import (
	"context"
	"encoding/json"
	"fmt"
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
// subscriptionGraceDays mirrors the --subscription-grace-days flag so the
// billing status can compute when grace-period access ends. Set from main.
var subscriptionGraceDays = 3

// SetSubscriptionGraceDays wires the configured grace window into the billing
// status handler (avoids threading it through NewRouter's long signature).
func SetSubscriptionGraceDays(n int) {
	if n >= 0 {
		subscriptionGraceDays = n
	}
}

func (s *Server) handleBillingStatus(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	sub, _ := s.db.GetActiveSubscription(r.Context(), u.ID)
	subs, _ := s.db.ListSubscriptions(r.Context(), u.ID)

	resp := map[string]interface{}{
		"active_subscription": sub,
		"history":             subs,
	}

	// If there's no active sub but the user is in the grace window, surface it
	// so the billing page can show "grace period — renew by X" instead of
	// looking like they have nothing (they still keep their paid features).
	if sub == nil {
		if grace, _ := s.db.GetGraceSubscription(r.Context(), u.ID); grace != nil && grace.PeriodEnd != nil {
			resp["grace"] = map[string]interface{}{
				"plan":        grace.Plan,
				"access_ends": grace.PeriodEnd.AddDate(0, 0, subscriptionGraceDays),
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
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
		// Only a request that carries a signature looks like a real delivery;
		// unsigned junk from scanners must not flip the health to "failing".
		if signature != "" {
			s.noteRejectedWebhook("inventpay")
		}
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	var payload billing.WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		s.recordPaymentEvent("inventpay", "unparseable", paymentOutcome{Outcome: "error", Detail: "body is not valid JSON"})
		w.WriteHeader(http.StatusOK)
		return
	}

	s.log.Info().
		Str("event", payload.Event).
		Str("payment_id", payload.PaymentID).
		Str("status", payload.Status).
		Float64("amount", payload.BaseAmount).
		Msg("billing webhook received")

	out := paymentOutcome{Outcome: "received", PaymentID: payload.PaymentID, Detail: payload.Status}
	switch payload.Event {
	case "payment.completed", "payment.confirmed":
		out = s.activatePaidSubscription(r.Context(), payload.PaymentID)
	}
	s.recordPaymentEvent("inventpay", payload.Event, out)

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
		if r.Header.Get("webhook-id") != "" && r.Header.Get("webhook-signature") != "" {
			s.noteRejectedWebhook("polar")
		}
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	var event billing.PolarWebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		s.recordPaymentEvent("polar", "unparseable", paymentOutcome{Outcome: "error", Detail: "body is not valid JSON"})
		w.WriteHeader(http.StatusOK)
		return
	}

	s.log.Info().Str("event", event.Type).Msg("polar webhook received")

	// Every Polar event we subscribe to carries the customer, so even the
	// ones we don't act on are attributed in the event log.
	var order billing.PolarOrder
	_ = json.Unmarshal(event.Data, &order)
	out := paymentOutcome{Outcome: "received", UserID: uuidOrEmpty(order.Customer.ExternalID), PaymentID: order.CheckoutID}

	// order.paid is the only event that grants value.
	if event.Type == "order.paid" {
		if order.ID == "" {
			out = paymentOutcome{Outcome: "error", Detail: "order.paid without an order"}
		} else {
			out = s.applyPolarOrder(r.Context(), order)
		}
	}
	s.recordPaymentEvent("polar", event.Type, out)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success": true}`))
}

// paymentOutcome is what applying one payment did. It becomes one row in
// billing_events and drives the admin alerts.
type paymentOutcome struct {
	Outcome   string // activated | credits | replay | unknown | error | received
	UserID    string
	PaymentID string
	Amount    float64
	Currency  string
	Detail    string
}

// applyPolarOrder grants whatever a paid Polar order bought. Used by the
// webhook and by the admin "Apply" action (which re-fetches the order from
// Polar first), so both paths behave identically. Idempotent.
func (s *Server) applyPolarOrder(ctx context.Context, order billing.PolarOrder) paymentOutcome {
	// Monthly renewal charges have no checkout of their own (or reuse the
	// first one, which is already active), so they need their own row.
	if order.BillingReason == "subscription_cycle" {
		return s.renewPolarSubscription(ctx, order)
	}
	paymentID := order.CheckoutID
	if paymentID == "" {
		paymentID = order.Metadata["checkout_id"]
	}
	if paymentID == "" {
		s.log.Warn().Str("order", order.ID).Msg("polar order.paid without checkout_id — cannot attribute")
		return paymentOutcome{Outcome: "unknown", UserID: uuidOrEmpty(order.Customer.ExternalID),
			Amount: float64(order.NetAmount) / 100, Currency: "USD",
			Detail: "order " + order.ID + " has no checkout id"}
	}
	out := s.activatePaidSubscription(ctx, paymentID)
	if out.UserID == "" {
		out.UserID = uuidOrEmpty(order.Customer.ExternalID)
	}
	if out.Amount == 0 {
		out.Amount, out.Currency = float64(order.NetAmount)/100, "USD"
	}
	return out
}

// renewPolarSubscription records a Polar renewal charge as a new subscription
// row and activates it, which extends the user's paid period by a month and
// sends the "renewed" email. Keyed on the order ID, so a replayed webhook hits
// the unique payment_id and activation is a no-op.
func (s *Server) renewPolarSubscription(ctx context.Context, order billing.PolarOrder) paymentOutcome {
	userID := uuidOrEmpty(order.Customer.ExternalID)
	if userID == "" {
		userID = uuidOrEmpty(order.Metadata["user_id"])
	}
	plan := s.polar.PlanForProduct(order.ProductID)
	if plan == "" {
		plan = order.Metadata["plan"]
	}
	amount := float64(order.NetAmount) / 100
	if userID == "" || plan == "" {
		s.log.Warn().Str("order", order.ID).Str("product", order.ProductID).
			Msg("polar renewal: cannot attribute user or plan")
		return paymentOutcome{Outcome: "unknown", UserID: userID, Amount: amount, Currency: "USD",
			Detail: "renewal order " + order.ID + ": unknown user or plan"}
	}
	paymentID := "polar_order_" + order.ID
	if _, err := s.db.CreateSubscription(ctx, userID, plan, paymentID, amount, "USD"); err != nil {
		// Most likely a replay (payment_id is unique); activation below is
		// idempotent either way, so log and carry on.
		s.log.Info().Err(err).Str("order", order.ID).Msg("polar renewal: subscription row not created")
	}
	return s.activatePaidSubscription(ctx, paymentID)
}

// activatePaidSubscription flips a pending subscription (or AI credit pack)
// to paid and upgrades the user. Idempotent — replayed webhooks are no-ops and
// never send a second email. Sends the billing email + user Telegram note.
func (s *Server) activatePaidSubscription(ctx context.Context, paymentID string) paymentOutcome {
	// A payment id is either a plan subscription OR an AI credit-pack purchase.
	// Try credits first; a match short-circuits (and stays idempotent via the
	// status flip), otherwise we fall through to plan-subscription activation.
	if uid, credits, ok, _ := s.db.ActivateCreditPurchase(ctx, paymentID); ok {
		if err := s.db.GrantAICredits(ctx, uid, credits, "topup"); err != nil {
			s.log.Error().Err(err).Str("payment_id", paymentID).Msg("failed to grant AI credits")
			s.alertAdmins("credits-error", "❗ A credit pack was paid but granting the credits failed. Check Admin → Payments.")
			return paymentOutcome{Outcome: "error", UserID: uid, PaymentID: paymentID,
				Detail: "paid, but granting credits failed: " + err.Error()}
		}
		s.log.Info().Str("payment_id", paymentID).Float64("credits", credits).Str("user", uid).Msg("AI credits topped up")
		return paymentOutcome{Outcome: "credits", UserID: uid, PaymentID: paymentID,
			Detail: fmt.Sprintf("%.0f AI credits", credits)}
	}

	res, err := s.db.ActivateSubscriptionDetailed(ctx, paymentID)
	if err != nil {
		s.log.Error().Err(err).Str("payment_id", paymentID).Msg("failed to activate subscription")
		s.alertAdmins("activate-error", "❗ A payment arrived but activating the plan failed. Check Admin → Payments.")
		return paymentOutcome{Outcome: "error", PaymentID: paymentID, Detail: "activation failed: " + err.Error()}
	}
	if res == nil || !res.Activated {
		// Replayed webhook, or a payment we have no checkout for.
		kind, status, _ := s.db.PaymentStatus(ctx, paymentID)
		if kind == "" {
			s.alertAdmins("unknown-payment", "❓ A paid order matched no checkout here. Check Admin → Payments.")
			return paymentOutcome{Outcome: "unknown", PaymentID: paymentID, Detail: "no checkout with this id"}
		}
		return paymentOutcome{Outcome: "replay", PaymentID: paymentID, Detail: kind + " already " + status}
	}
	s.log.Info().
		Str("payment_id", paymentID).
		Str("plan", res.Plan).
		Str("kind", res.Kind).
		Msg("subscription activated")

	sub, _ := s.db.GetSubscriptionByPaymentID(ctx, paymentID)
	user, _ := s.db.GetUserByID(ctx, res.UserID)
	amount, currency := 0.0, "USD"
	if sub != nil {
		amount, currency = sub.Amount, sub.Currency
	}

	// Billing confirmation email — new purchase, upgrade, or renewal.
	if s.emailSvc != nil && user != nil {
		subject := "Your Deployzy " + res.Plan + " subscription is active"
		switch res.Kind {
		case "upgrade":
			subject = "Upgraded to Deployzy " + res.Plan + " 🚀"
		case "renewal":
			subject = "Your Deployzy " + res.Plan + " subscription renewed"
		}
		body := notify.SubscriptionEmail(user.Name, res.Plan, res.Kind, amount, currency,
			res.PeriodEnd.Format("2 January 2006"))
		go func(userID, email, subject, body string) {
			ev := paymentOutcome{Outcome: "sent", UserID: userID, PaymentID: paymentID, Detail: subject}
			if err := s.emailSvc.SendOne(email, subject, body); err != nil {
				s.log.Warn().Err(err).Str("email", email).Msg("failed to send subscription email")
				ev.Outcome, ev.Detail = "failed", subject+" — "+err.Error()
				s.alertAdmins("email-failed", "📭 A subscription email failed to send. Check Admin → Payments.")
			}
			s.recordPaymentEvent("email", "subscription_email", ev)
		}(user.ID, user.Email, subject, body)
	}

	if s.telegram != nil {
		tc, _ := s.db.GetTelegramConnection(ctx, res.UserID)
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

	return paymentOutcome{Outcome: "activated", UserID: res.UserID, PaymentID: paymentID,
		Amount: amount, Currency: currency, Detail: res.Kind + " · " + res.Plan}
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
