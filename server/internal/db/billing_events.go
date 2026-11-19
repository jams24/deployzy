package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// BillingEvent is one row of the billing audit trail (see migration 071).
type BillingEvent struct {
	ID        int64     `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	Provider  string    `json:"provider"`
	EventType string    `json:"event_type"`
	Outcome   string    `json:"outcome"`
	UserID    string    `json:"user_id"`
	UserEmail string    `json:"user_email"`
	PaymentID string    `json:"payment_id"`
	Amount    float64   `json:"amount"`
	Currency  string    `json:"currency"`
	Detail    string    `json:"detail"`
}

// InsertBillingEvent records one event. user_id may be empty.
func (d *DB) InsertBillingEvent(ctx context.Context, e BillingEvent) error {
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO billing_events (provider, event_type, outcome, user_id, payment_id, amount, currency, detail)
		 VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, $6, $7, $8)`,
		e.Provider, e.EventType, e.Outcome, e.UserID, e.PaymentID, e.Amount, e.Currency, e.Detail)
	return err
}

// billingEventFilters maps the console's filter chips to WHERE clauses.
var billingEventFilters = map[string]string{
	"":            "TRUE",
	"problems":    "e.outcome IN ('rejected','error','unknown','failed')",
	"activations": "e.outcome IN ('activated','credits')",
	"emails":      "e.provider = 'email'",
	"polar":       "e.provider = 'polar'",
	"inventpay":   "e.provider = 'inventpay'",
}

// ListBillingEvents returns the newest events matching filter, plus the total.
func (d *DB) ListBillingEvents(ctx context.Context, filter string, limit, offset int) ([]BillingEvent, int, error) {
	where, ok := billingEventFilters[filter]
	if !ok {
		return nil, 0, fmt.Errorf("unknown filter %q", filter)
	}
	var total int
	if err := d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM billing_events e WHERE `+where).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := d.Pool.Query(ctx,
		`SELECT e.id, e.created_at, e.provider, e.event_type, e.outcome,
		        COALESCE(e.user_id::text, ''), COALESCE(u.email, ''), e.payment_id,
		        e.amount::float8, e.currency, e.detail
		   FROM billing_events e LEFT JOIN users u ON u.id = e.user_id
		  WHERE `+where+`
		  ORDER BY e.id DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []BillingEvent{}
	for rows.Next() {
		var e BillingEvent
		if err := rows.Scan(&e.ID, &e.CreatedAt, &e.Provider, &e.EventType, &e.Outcome,
			&e.UserID, &e.UserEmail, &e.PaymentID, &e.Amount, &e.Currency, &e.Detail); err != nil {
			return nil, 0, err
		}
		out = append(out, e)
	}
	return out, total, rows.Err()
}

// ── Summary ────────────────────────────────────────────────────────────────

type PaymentsDay struct {
	Day     string  `json:"day"`
	Card    float64 `json:"card"`    // Polar plan payments (USD)
	Crypto  float64 `json:"crypto"`  // InventPay plan payments (USDT)
	Credits float64 `json:"credits"` // AI credit packs (USD)
}

type ProviderHealth struct {
	Provider       string     `json:"provider"`
	Configured     bool       `json:"configured"`
	Status         string     `json:"status"` // ok | failing | warning | quiet | off
	LastOKAt       *time.Time `json:"last_ok_at"`
	LastRejectedAt *time.Time `json:"last_rejected_at"`
	Rejected24h    int        `json:"rejected_24h"`
	Errors24h      int        `json:"errors_24h"`
	Events24h      int        `json:"events_24h"`
}

type PaymentsSummary struct {
	Days             int              `json:"days"`
	Revenue          float64          `json:"revenue"`
	RevenuePrev      float64          `json:"revenue_prev"`
	RevenueCard      float64          `json:"revenue_card"`
	RevenueCrypto    float64          `json:"revenue_crypto"`
	RevenueCredits   float64          `json:"revenue_credits"`
	MRR              float64          `json:"mrr"`
	PayingUsers      int              `json:"paying_users"`
	InGrace          int              `json:"in_grace"`
	PlanMix          map[string]int   `json:"plan_mix"`
	CheckoutsStarted int              `json:"checkouts_started"`
	CheckoutsPaid    int              `json:"checkouts_paid"`
	PendingStale     int              `json:"pending_stale"` // pending > 1h, last 7 days
	CreditPacksPaid  int              `json:"credit_packs_paid"`
	EmailsSent       int              `json:"emails_sent"`
	EmailsFailed     int              `json:"emails_failed"`
	ProblemEvents    int              `json:"problem_events"`
	Daily            []PaymentsDay    `json:"daily"`
	Health           []ProviderHealth `json:"health"`
}

// PaymentsSummary aggregates billing for the last `days` days. Card means
// Polar (USD rows), crypto means InventPay (USDT rows). Amounts are what the
// subscription row recorded at checkout (net of tax).
func (d *DB) PaymentsSummary(ctx context.Context, days int) (*PaymentsSummary, error) {
	s := &PaymentsSummary{Days: days, PlanMix: map[string]int{}, Daily: []PaymentsDay{}}
	since := time.Now().AddDate(0, 0, -days)
	prevSince := since.AddDate(0, 0, -days)

	// Daily revenue, with every day present so the chart has no gaps.
	rows, err := d.Pool.Query(ctx, `
		WITH days AS (
		  SELECT generate_series(date_trunc('day', $1::timestamptz), date_trunc('day', now()), '1 day')::date AS day
		), subs AS (
		  SELECT date_trunc('day', period_start)::date AS day,
		         SUM(amount) FILTER (WHERE currency = 'USD')  AS card,
		         SUM(amount) FILTER (WHERE currency <> 'USD') AS crypto
		    FROM subscriptions
		   WHERE status <> 'pending' AND period_start >= $1
		   GROUP BY 1
		), credits AS (
		  SELECT date_trunc('day', COALESCE(paid_at, created_at))::date AS day, SUM(usd) AS usd
		    FROM ai_credit_purchases
		   WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= $1
		   GROUP BY 1
		)
		SELECT to_char(days.day, 'YYYY-MM-DD'),
		       COALESCE(subs.card, 0)::float8, COALESCE(subs.crypto, 0)::float8, COALESCE(credits.usd, 0)::float8
		  FROM days LEFT JOIN subs ON subs.day = days.day LEFT JOIN credits ON credits.day = days.day
		 ORDER BY days.day`, since)
	if err != nil {
		return nil, fmt.Errorf("daily revenue: %w", err)
	}
	for rows.Next() {
		var p PaymentsDay
		if err := rows.Scan(&p.Day, &p.Card, &p.Crypto, &p.Credits); err != nil {
			rows.Close()
			return nil, fmt.Errorf("daily revenue scan: %w", err)
		}
		s.Daily = append(s.Daily, p)
		s.RevenueCard += p.Card
		s.RevenueCrypto += p.Crypto
		s.RevenueCredits += p.Credits
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	s.Revenue = s.RevenueCard + s.RevenueCrypto + s.RevenueCredits

	if err := d.Pool.QueryRow(ctx, `
		SELECT COALESCE((SELECT SUM(amount) FROM subscriptions
		                  WHERE status <> 'pending' AND period_start >= $1 AND period_start < $2), 0)::float8
		     + COALESCE((SELECT SUM(usd) FROM ai_credit_purchases
		                  WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= $1
		                    AND COALESCE(paid_at, created_at) < $2), 0)::float8`,
		prevSince, since).Scan(&s.RevenuePrev); err != nil {
		return nil, fmt.Errorf("previous revenue: %w", err)
	}

	// Paying users: each user's latest live subscription.
	rows, err = d.Pool.Query(ctx, `
		SELECT plan, amount::float8, status FROM (
		  SELECT DISTINCT ON (user_id) plan, amount, status
		    FROM subscriptions
		   WHERE (status = 'active' AND period_end > now()) OR status = 'grace'
		   ORDER BY user_id, period_end DESC NULLS LAST
		) live`)
	if err != nil {
		return nil, fmt.Errorf("paying users: %w", err)
	}
	for rows.Next() {
		var plan, status string
		var amount float64
		if err := rows.Scan(&plan, &amount, &status); err != nil {
			rows.Close()
			return nil, fmt.Errorf("paying users scan: %w", err)
		}
		if status == "grace" {
			s.InGrace++
			continue
		}
		s.PayingUsers++
		s.MRR += amount
		s.PlanMix[plan]++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE created_at >= $1),
		       COUNT(*) FILTER (WHERE created_at >= $1 AND status <> 'pending'),
		       COUNT(*) FILTER (WHERE status = 'pending' AND created_at < now() - interval '1 hour'
		                          AND created_at >= now() - interval '7 days')
		  FROM subscriptions`, since).Scan(&s.CheckoutsStarted, &s.CheckoutsPaid, &s.PendingStale); err != nil {
		return nil, fmt.Errorf("checkouts: %w", err)
	}
	if err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM ai_credit_purchases
		 WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= $1`, since).Scan(&s.CreditPacksPaid); err != nil {
		return nil, fmt.Errorf("credit packs: %w", err)
	}
	if err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE provider = 'email' AND outcome = 'sent'),
		       COUNT(*) FILTER (WHERE provider = 'email' AND outcome = 'failed'),
		       COUNT(*) FILTER (WHERE outcome IN ('rejected','error','unknown','failed'))
		  FROM billing_events WHERE created_at >= $1`, since).Scan(&s.EmailsSent, &s.EmailsFailed, &s.ProblemEvents); err != nil {
		return nil, fmt.Errorf("billing events: %w", err)
	}

	for _, p := range []string{"polar", "inventpay"} {
		h, err := d.providerHealth(ctx, p)
		if err != nil {
			return nil, err
		}
		s.Health = append(s.Health, h)
	}
	return s, nil
}

func (d *DB) providerHealth(ctx context.Context, provider string) (ProviderHealth, error) {
	h := ProviderHealth{Provider: provider}
	err := d.Pool.QueryRow(ctx, `
		SELECT MAX(created_at) FILTER (WHERE outcome <> 'rejected'),
		       MAX(created_at) FILTER (WHERE outcome = 'rejected'),
		       COUNT(*) FILTER (WHERE outcome = 'rejected' AND created_at >= now() - interval '24 hours'),
		       COUNT(*) FILTER (WHERE outcome IN ('error','unknown') AND created_at >= now() - interval '24 hours'),
		       COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')
		  FROM billing_events WHERE provider = $1`, provider).
		Scan(&h.LastOKAt, &h.LastRejectedAt, &h.Rejected24h, &h.Errors24h, &h.Events24h)
	if err != nil {
		return h, fmt.Errorf("%s health: %w", provider, err)
	}
	switch {
	case h.LastRejectedAt != nil && (h.LastOKAt == nil || h.LastRejectedAt.After(*h.LastOKAt)) &&
		time.Since(*h.LastRejectedAt) < 24*time.Hour:
		h.Status = "failing" // the most recent delivery was refused
	case h.Rejected24h > 0 || h.Errors24h > 0:
		h.Status = "warning"
	case h.LastOKAt == nil:
		h.Status = "quiet"
	default:
		h.Status = "ok"
	}
	return h, nil
}

// ── Subscriptions list ─────────────────────────────────────────────────────

type AdminSubscription struct {
	Subscription
	UserEmail string `json:"user_email"`
	UserName  string `json:"user_name"`
	UserPlan  string `json:"user_plan"`
}

// ListAdminSubscriptions lists subscriptions newest first. status "" = all.
func (d *DB) ListAdminSubscriptions(ctx context.Context, status, q string, limit, offset int) ([]AdminSubscription, int, error) {
	const where = `($1 = '' OR s.status = $1) AND ($2 = '' OR u.email ILIKE '%' || $2 || '%' OR s.payment_id = $2)`
	var total int
	if err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id WHERE `+where,
		status, q).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := d.Pool.Query(ctx, `
		SELECT s.id, s.user_id, s.plan, s.status, COALESCE(s.payment_id, ''), s.amount, s.currency,
		       s.period_start, s.period_end, s.created_at,
		       COALESCE(u.email, ''), COALESCE(u.name, ''), COALESCE(u.plan, '')
		  FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
		 WHERE `+where+`
		 ORDER BY s.created_at DESC LIMIT $3 OFFSET $4`, status, q, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AdminSubscription{}
	for rows.Next() {
		var a AdminSubscription
		if err := rows.Scan(&a.ID, &a.UserID, &a.Plan, &a.Status, &a.PaymentID, &a.Amount, &a.Currency,
			&a.PeriodStart, &a.PeriodEnd, &a.CreatedAt, &a.UserEmail, &a.UserName, &a.UserPlan); err != nil {
			return nil, 0, err
		}
		out = append(out, a)
	}
	return out, total, rows.Err()
}

// PaymentStatus reports what we hold for a provider payment id: the status of
// a subscription row, or of an AI credit purchase, or "" when we have neither.
func (d *DB) PaymentStatus(ctx context.Context, paymentID string) (kind, status string, err error) {
	err = d.Pool.QueryRow(ctx, `
		SELECT 'subscription', status FROM subscriptions WHERE payment_id = $1
		UNION ALL
		SELECT 'credits', status FROM ai_credit_purchases WHERE payment_id = $1
		LIMIT 1`, paymentID).Scan(&kind, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	return kind, status, err
}

// AdminTelegramChats returns the Telegram chat ids of admins who linked one.
func (d *DB) AdminTelegramChats(ctx context.Context) ([]int64, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT t.chat_id FROM telegram_connections t
		  JOIN users u ON u.id = t.user_id
		 WHERE u.is_admin = true`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
