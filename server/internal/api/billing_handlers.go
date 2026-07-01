package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
)

// handleCreateCheckout creates a payment invoice for Premium upgrade.
func (s *Server) handleCreateCheckout(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	if s.billing == nil {
		writeError(w, http.StatusServiceUnavailable, "billing not configured")
		return
	}

	// Check if already premium
	sub, _ := s.db.GetActiveSubscription(r.Context(), u.ID)
	if sub != nil {
		writeError(w, http.StatusConflict, "already subscribed to premium")
		return
	}

	// Create InventPay invoice for $10/month
	invoice, err := s.billing.CreateInvoice(&billing.CreateInvoiceRequest{
		Amount:            10,
		AmountCurrency:    "USDT",
		OrderID:           "sm_premium_" + u.ID,
		Description:       "Deployzy Premium - 1 Month",
		CallbackURL:       "https://api.deployzy.com/api/v1/billing/webhook",
		ExpirationMinutes: 30,
	})
	if err != nil {
		s.log.Error().Err(err).Msg("failed to create invoice")
		writeError(w, http.StatusInternalServerError, "failed to create payment")
		return
	}

	// Save pending subscription (ignore duplicate — user may have retried)
	s.db.CreateSubscription(r.Context(), u.ID, "premium", invoice.PaymentID, 10, "USDT")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"payment_id":  invoice.PaymentID,
		"invoice_url": invoice.InvoiceURL,
		"amount":      10,
		"currency":    "USDT",
		"expires_at":  invoice.ExpiresAt,
	})
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
func (s *Server) handleBillingWebhook(w http.ResponseWriter, r *http.Request) {
	if s.billing == nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Verify signature
	signature := r.Header.Get("X-Webhook-Signature")
	if signature != "" && !s.billing.VerifyWebhook(body, signature) {
		s.log.Warn().Msg("invalid webhook signature")
		w.WriteHeader(http.StatusOK)
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
		// Activate the subscription
		if err := s.db.ActivateSubscription(r.Context(), payload.PaymentID); err != nil {
			s.log.Error().Err(err).Str("payment_id", payload.PaymentID).Msg("failed to activate subscription")
		} else {
			s.log.Info().Str("payment_id", payload.PaymentID).Msg("subscription activated")

			// Send Telegram notification if connected
			if s.telegram != nil {
				// Find the user
				subs, _ := s.db.ListSubscriptions(r.Context(), "")
				for _, sub := range subs {
					if sub.PaymentID == payload.PaymentID {
						tc, _ := s.db.GetTelegramConnection(r.Context(), sub.UserID)
						if tc != nil {
							s.telegram.SendMarkdown(tc.ChatID,
								"🎉 *Premium Activated!*\n\nYour Deployzy Premium subscription is now active. Enjoy all premium features!")
						}
						break
					}
				}
			}
		}
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success": true}`))
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
