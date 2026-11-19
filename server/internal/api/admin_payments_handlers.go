package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
)

// ── Recording ──────────────────────────────────────────────────────────────

var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// uuidOrEmpty keeps a value only if it is a UUID (billing_events.user_id is
// a uuid column; a stray external id must not make the insert fail).
func uuidOrEmpty(s string) string {
	if uuidRE.MatchString(s) {
		return s
	}
	return ""
}

// recordPaymentEvent writes one billing_events row. It never blocks the
// webhook response for long and never fails it.
func (s *Server) recordPaymentEvent(provider, eventType string, o paymentOutcome) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if len(o.Detail) > 500 {
		o.Detail = o.Detail[:500]
	}
	err := s.db.InsertBillingEvent(ctx, db.BillingEvent{
		Provider: provider, EventType: eventType, Outcome: o.Outcome,
		UserID: uuidOrEmpty(o.UserID), PaymentID: o.PaymentID,
		Amount: o.Amount, Currency: o.Currency, Detail: o.Detail,
	})
	if err != nil {
		s.log.Warn().Err(err).Str("provider", provider).Str("event", eventType).Msg("could not record billing event")
	}
}

// Rejected deliveries are throttled to one row per provider per 30s (with a
// count of the ones folded in), so a burst of forged requests can't flood the
// table. Admins get a Telegram alert at most hourly.
var rejectedLog = struct {
	sync.Mutex
	last       map[string]time.Time
	suppressed map[string]int
}{last: map[string]time.Time{}, suppressed: map[string]int{}}

func (s *Server) noteRejectedWebhook(provider string) {
	rejectedLog.Lock()
	if time.Since(rejectedLog.last[provider]) < 30*time.Second {
		rejectedLog.suppressed[provider]++
		rejectedLog.Unlock()
		return
	}
	folded := rejectedLog.suppressed[provider]
	rejectedLog.last[provider] = time.Now()
	rejectedLog.suppressed[provider] = 0
	rejectedLog.Unlock()

	detail := "signature did not verify"
	if folded > 0 {
		detail += fmt.Sprintf(" (+%d more since the last row)", folded)
	}
	s.recordPaymentEvent(provider, "webhook", paymentOutcome{Outcome: "rejected", Detail: detail})
	name := map[string]string{"polar": "Polar (card)", "inventpay": "InventPay (crypto)"}[provider]
	s.alertAdmins("rejected-"+provider, "🚨 "+name+" webhooks are being rejected (bad signature). "+
		"Payments will NOT activate until this is fixed. Check Admin → Payments.")
}

var adminAlerts = struct {
	sync.Mutex
	last map[string]time.Time
}{last: map[string]time.Time{}}

// alertAdmins sends a Telegram message to every admin who linked Telegram,
// at most once per key per hour. Text must be plain (no Markdown entities).
func (s *Server) alertAdmins(key, text string) {
	if s.telegram == nil {
		return
	}
	adminAlerts.Lock()
	if time.Since(adminAlerts.last[key]) < time.Hour {
		adminAlerts.Unlock()
		return
	}
	adminAlerts.last[key] = time.Now()
	adminAlerts.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		chats, err := s.db.AdminTelegramChats(ctx)
		if err != nil {
			s.log.Warn().Err(err).Msg("admin alert: could not load admin chats")
			return
		}
		for _, id := range chats {
			if err := s.telegram.SendMessage(id, text, ""); err != nil {
				s.log.Warn().Err(err).Int64("chat", id).Msg("admin alert: send failed")
			}
		}
	}()
}

// ── Admin endpoints ────────────────────────────────────────────────────────

// GET /admin/payments/summary?days=30
func (s *Server) handleAdminPaymentsSummary(w http.ResponseWriter, r *http.Request) {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days != 7 && days != 30 && days != 90 {
		days = 30
	}
	sum, err := s.db.PaymentsSummary(r.Context(), days)
	if err != nil {
		s.log.Error().Err(err).Msg("payments summary")
		writeError(w, http.StatusInternalServerError, "failed to load payments summary")
		return
	}
	for i := range sum.Health {
		switch sum.Health[i].Provider {
		case "polar":
			sum.Health[i].Configured = s.polar != nil
		case "inventpay":
			sum.Health[i].Configured = s.billing != nil
		}
		if !sum.Health[i].Configured {
			sum.Health[i].Status = "off"
		}
	}
	writeJSON(w, http.StatusOK, sum)
}

func pageParams(r *http.Request) (limit, offset int) {
	limit, _ = strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ = strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}
	return
}

// GET /admin/payments/events?filter=problems&limit=25&offset=0
func (s *Server) handleAdminPaymentEvents(w http.ResponseWriter, r *http.Request) {
	limit, offset := pageParams(r)
	items, total, err := s.db.ListBillingEvents(r.Context(), r.URL.Query().Get("filter"), limit, offset)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

// GET /admin/payments/subscriptions?status=pending&q=&limit=25&offset=0
func (s *Server) handleAdminPaymentSubscriptions(w http.ResponseWriter, r *http.Request) {
	limit, offset := pageParams(r)
	status := r.URL.Query().Get("status")
	switch status {
	case "", "pending", "active", "grace", "expired":
	default:
		writeError(w, http.StatusBadRequest, "unknown status")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	items, total, err := s.db.ListAdminSubscriptions(r.Context(), status, q, limit, offset)
	if err != nil {
		s.log.Error().Err(err).Msg("admin subscriptions")
		writeError(w, http.StatusInternalServerError, "failed to load subscriptions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

// reconciledOrder is a Polar order next to what we hold for it.
type reconciledOrder struct {
	ID            string    `json:"id"`
	CreatedAt     time.Time `json:"created_at"`
	Status        string    `json:"status"`
	BillingReason string    `json:"billing_reason"`
	Product       string    `json:"product"`
	Email         string    `json:"email"`
	UserID        string    `json:"user_id"`
	Amount        float64   `json:"amount"`
	PaymentID     string    `json:"payment_id"`
	Local         string    `json:"local"` // what we have: "active", "pending", "missing", …
	NeedsApply    bool      `json:"needs_apply"`
}

type failedEvent struct {
	EventID     string    `json:"event_id"`
	Type        string    `json:"type"`
	CreatedAt   time.Time `json:"created_at"`
	Attempts    int       `json:"attempts"`
	LastCode    int       `json:"last_code"`
	LastAttempt time.Time `json:"last_attempt"`
}

// expectedPaymentID is the payment_id our DB uses for a Polar order.
func expectedPaymentID(o billing.PolarOrder) string {
	if o.BillingReason == "subscription_cycle" {
		return "polar_order_" + o.ID
	}
	if o.CheckoutID != "" {
		return o.CheckoutID
	}
	return o.Metadata["checkout_id"]
}

func polarOrderPaid(o billing.PolarOrder) bool {
	return o.Paid && o.Status == "paid"
}

// reconcilePolarOrders compares Polar's newest orders with our records.
func (s *Server) reconcilePolarOrders(ctx context.Context, limit int) ([]reconciledOrder, error) {
	orders, err := s.polar.ListOrders(ctx, limit)
	if err != nil {
		return nil, err
	}
	out := make([]reconciledOrder, 0, len(orders))
	for _, o := range orders {
		ro := reconciledOrder{
			ID: o.ID, CreatedAt: o.CreatedAt, Status: o.Status, BillingReason: o.BillingReason,
			Product: o.Product.Name, Email: o.Customer.Email, UserID: uuidOrEmpty(o.Customer.ExternalID),
			Amount: float64(o.NetAmount) / 100, PaymentID: expectedPaymentID(o),
		}
		_, status, err := s.db.PaymentStatus(ctx, ro.PaymentID)
		if err != nil {
			return nil, err
		}
		ro.Local = status
		if ro.Local == "" {
			ro.Local = "missing"
		}
		// A paid order is settled once we hold it as anything but pending.
		ro.NeedsApply = polarOrderPaid(o) && (ro.Local == "missing" || ro.Local == "pending")
		out = append(out, ro)
	}
	return out, nil
}

// failedPolarEvents groups delivery attempts (newest first) by event and keeps
// the events whose newest attempt failed — a later successful redelivery
// clears an event.
func failedPolarEvents(deliveries []billing.PolarDelivery) []failedEvent {
	failed := []failedEvent{}
	byEvent := map[string]int{} // event id → index in failed
	settled := map[string]bool{}
	for _, d := range deliveries {
		id := d.Event.ID
		if settled[id] {
			continue
		}
		i, seen := byEvent[id]
		if !seen {
			if d.Succeeded {
				settled[id] = true
				continue
			}
			code := 0
			if d.HTTPCode != nil {
				code = *d.HTTPCode
			}
			failed = append(failed, failedEvent{EventID: id, Type: d.Event.Type, CreatedAt: d.Event.CreatedAt,
				LastCode: code, LastAttempt: d.CreatedAt})
			i = len(failed) - 1
			byEvent[id] = i
		}
		failed[i].Attempts++
	}
	return failed
}

// GET /admin/payments/polar — reconciliation + failed deliveries + endpoints.
func (s *Server) handleAdminPolarStatus(w http.ResponseWriter, r *http.Request) {
	if s.polar == nil {
		writeJSON(w, http.StatusOK, map[string]any{"configured": false})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	resp := map[string]any{"configured": true}
	errs := []string{}

	if orders, err := s.reconcilePolarOrders(ctx, 50); err != nil {
		errs = append(errs, "orders: "+err.Error())
		resp["orders"] = []reconciledOrder{}
	} else {
		resp["orders"] = orders
	}

	failed := []failedEvent{}
	if deliveries, err := s.polar.ListDeliveries(ctx, 100); err != nil {
		errs = append(errs, "deliveries: "+err.Error())
	} else {
		failed = failedPolarEvents(deliveries)
	}
	resp["failed_events"] = failed

	if eps, err := s.polar.ListEndpoints(ctx); err != nil {
		errs = append(errs, "endpoints: "+err.Error())
	} else {
		resp["endpoints"] = eps
	}
	resp["errors"] = errs
	writeJSON(w, http.StatusOK, resp)
}

// POST /admin/payments/polar/orders/{orderId}/apply — re-fetches the order
// from Polar and, only if Polar says it is paid, applies it exactly like the
// webhook would (activation, email, Telegram). Safe to repeat.
func (s *Server) handleAdminApplyPolarOrder(w http.ResponseWriter, r *http.Request) {
	if s.polar == nil {
		writeError(w, http.StatusServiceUnavailable, "Polar is not configured")
		return
	}
	order, err := s.polar.GetOrder(r.Context(), chi.URLParam(r, "orderId"))
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not load the order from Polar")
		return
	}
	if !polarOrderPaid(*order) {
		writeError(w, http.StatusConflict, "Polar does not show this order as paid ("+order.Status+")")
		return
	}
	out := s.applyPolarOrder(r.Context(), *order)
	out.Detail = strings.TrimSpace("applied by an admin · " + out.Detail)
	s.recordPaymentEvent("polar", "order.paid (manual)", out)
	writeJSON(w, http.StatusOK, map[string]any{"outcome": out.Outcome, "detail": out.Detail})
}

// POST /admin/payments/polar/events/{eventId}/redeliver
func (s *Server) handleAdminRedeliverPolarEvent(w http.ResponseWriter, r *http.Request) {
	if s.polar == nil {
		writeError(w, http.StatusServiceUnavailable, "Polar is not configured")
		return
	}
	if err := s.polar.Redeliver(r.Context(), chi.URLParam(r, "eventId")); err != nil {
		s.log.Warn().Err(err).Msg("polar redeliver")
		writeError(w, http.StatusBadGateway, "Polar refused the redelivery")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "queued"})
}

// ── Safety net ─────────────────────────────────────────────────────────────

// runPolarReconciler checks Polar every 15 minutes for paid orders we never
// applied (webhook lost, rejected, or our server down) and applies them —
// the same idempotent path as the webhook — then tells the admins.
func (s *Server) runPolarReconciler() {
	applied := map[string]bool{}
	check := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		orders, err := s.reconcilePolarOrders(ctx, 25)
		if err != nil {
			s.log.Warn().Err(err).Msg("polar reconciler: could not list orders")
			return
		}
		for _, ro := range orders {
			// Give the webhook 10 minutes to do its job first.
			if !ro.NeedsApply || applied[ro.ID] || time.Since(ro.CreatedAt) < 10*time.Minute ||
				time.Since(ro.CreatedAt) > 30*24*time.Hour {
				continue
			}
			applied[ro.ID] = true
			order, err := s.polar.GetOrder(ctx, ro.ID)
			if err != nil || !polarOrderPaid(*order) {
				continue
			}
			out := s.applyPolarOrder(ctx, *order)
			out.Detail = strings.TrimSpace("auto-applied by the reconciler · " + out.Detail)
			s.recordPaymentEvent("polar", "order.paid (reconciled)", out)
			s.log.Warn().Str("order", ro.ID).Str("outcome", out.Outcome).Msg("polar reconciler applied a missed order")
			s.alertAdmins("reconciled-"+ro.ID, fmt.Sprintf(
				"🧾 A paid Polar order (%s, $%.2f) had not been applied, so the reconciler applied it (%s). "+
					"Webhooks may be failing — check Admin → Payments.", ro.Product, ro.Amount, out.Outcome))
		}
	}
	time.Sleep(2 * time.Minute) // let the server settle after a restart
	check()
	t := time.NewTicker(15 * time.Minute)
	defer t.Stop()
	for range t.C {
		check()
	}
}
