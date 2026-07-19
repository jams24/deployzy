package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Subscription represents a user's billing subscription.
type Subscription struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	Plan        string     `json:"plan"`
	Status      string     `json:"status"`
	PaymentID   string     `json:"payment_id"`
	Amount      float64    `json:"amount"`
	Currency    string     `json:"currency"`
	PeriodStart *time.Time `json:"period_start"`
	PeriodEnd   *time.Time `json:"period_end"`
	CreatedAt   time.Time  `json:"created_at"`
}

// CreateSubscription creates a pending subscription.
func (d *DB) CreateSubscription(ctx context.Context, userID, plan, paymentID string, amount float64, currency string) (*Subscription, error) {
	var s Subscription
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO subscriptions (user_id, plan, payment_id, amount, currency)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, user_id, plan, status, payment_id, amount, currency, period_start, period_end, created_at`,
		userID, plan, paymentID, amount, currency,
	).Scan(&s.ID, &s.UserID, &s.Plan, &s.Status, &s.PaymentID, &s.Amount, &s.Currency, &s.PeriodStart, &s.PeriodEnd, &s.CreatedAt)
	return &s, err
}

// ActivateSubscription marks a subscription as active and upgrades the user
// to the plan stored on the subscription row. The plan name must match a row
// in plan_limits ('pro' or 'team') — 'premium' no longer exists there.
func (d *DB) ActivateSubscription(ctx context.Context, paymentID string) error {
	now := time.Now()
	end := now.AddDate(0, 1, 0) // 1 month

	// Activate the subscription and read back who + which plan was purchased.
	var userID, plan string
	err := d.Pool.QueryRow(ctx,
		`UPDATE subscriptions SET status = 'active', period_start = $2, period_end = $3
		 WHERE payment_id = $1 AND status = 'pending'
		 RETURNING user_id, plan`,
		paymentID, now, end,
	).Scan(&userID, &plan)
	if err == pgx.ErrNoRows {
		return nil // Already activated or not found
	}
	if err != nil {
		return err
	}

	// Legacy safety net: old pending rows may still say 'premium', which has
	// no plan_limits entry. Map it to 'pro' so the user gets real limits.
	if plan == "premium" || plan == "" {
		plan = "pro"
	}

	// Upgrade user plan
	_, err = d.Pool.Exec(ctx,
		`UPDATE users SET plan = $2, updated_at = now() WHERE id = $1`,
		userID, plan,
	)
	if err == nil {
		// This user just became paid — credit whoever referred them.
		d.MaybeGrantReferrerReward(ctx, userID)
	}
	return err
}

// SweepExpiredSubscriptions marks lapsed subscriptions as expired and
// downgrades users whose paid period has ended back to the free plan.
//
// Downgrade is deliberately narrow: it only touches non-admin users whose
// plan came from a subscription (EXISTS check) and who no longer have ANY
// active, unexpired subscription. Users upgraded manually by an admin (no
// subscription rows) and referral-reward users (pro_until is applied at
// read time by effectivePlan, independent of users.plan) are untouched.
func (d *DB) SweepExpiredSubscriptions(ctx context.Context) (int64, error) {
	// 1. Flag subscriptions whose period has ended.
	if _, err := d.Pool.Exec(ctx,
		`UPDATE subscriptions SET status = 'expired'
		 WHERE status = 'active' AND period_end IS NOT NULL AND period_end <= now()`,
	); err != nil {
		return 0, err
	}

	// 2. Downgrade users left without an active subscription.
	tag, err := d.Pool.Exec(ctx,
		`UPDATE users u SET plan = 'free', updated_at = now()
		 WHERE u.is_admin = false
		   AND u.plan IN ('pro', 'team', 'premium')
		   AND EXISTS (
		         SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
		   AND NOT EXISTS (
		         SELECT 1 FROM subscriptions s
		         WHERE s.user_id = u.id AND s.status = 'active'
		           AND s.period_end IS NOT NULL AND s.period_end > now())`,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// GetSubscriptionByPaymentID returns the subscription tied to a payment.
func (d *DB) GetSubscriptionByPaymentID(ctx context.Context, paymentID string) (*Subscription, error) {
	var s Subscription
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, plan, status, payment_id, amount, currency, period_start, period_end, created_at
		 FROM subscriptions WHERE payment_id = $1 LIMIT 1`,
		paymentID,
	).Scan(&s.ID, &s.UserID, &s.Plan, &s.Status, &s.PaymentID, &s.Amount, &s.Currency, &s.PeriodStart, &s.PeriodEnd, &s.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

// GetActiveSubscription returns the user's active subscription.
func (d *DB) GetActiveSubscription(ctx context.Context, userID string) (*Subscription, error) {
	var s Subscription
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, plan, status, payment_id, amount, currency, period_start, period_end, created_at
		 FROM subscriptions WHERE user_id = $1 AND status = 'active' AND period_end > now()
		 ORDER BY period_end DESC LIMIT 1`,
		userID,
	).Scan(&s.ID, &s.UserID, &s.Plan, &s.Status, &s.PaymentID, &s.Amount, &s.Currency, &s.PeriodStart, &s.PeriodEnd, &s.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

// ListSubscriptions returns all subscriptions for a user.
func (d *DB) ListSubscriptions(ctx context.Context, userID string) ([]Subscription, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, plan, status, payment_id, amount, currency, period_start, period_end, created_at
		 FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []Subscription
	for rows.Next() {
		var s Subscription
		rows.Scan(&s.ID, &s.UserID, &s.Plan, &s.Status, &s.PaymentID, &s.Amount, &s.Currency, &s.PeriodStart, &s.PeriodEnd, &s.CreatedAt)
		subs = append(subs, s)
	}
	return subs, nil
}
