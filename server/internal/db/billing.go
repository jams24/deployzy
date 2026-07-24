package db

import (
	"context"
	"fmt"
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

// ActivationResult describes what an activation actually did, so callers can
// send the right email (new / upgrade / renewal) instead of guessing.
type ActivationResult struct {
	Activated    bool      // false when the webhook was a replay
	UserID       string
	Plan         string    // plan now active
	PreviousPlan string    // plan the user was on before
	Kind         string    // "new" | "upgrade" | "downgrade" | "renewal"
	PeriodEnd    time.Time
}

// planRank orders tiers so an activation can be classified as an upgrade,
// downgrade, or renewal. Unknown plans rank 0.
func planRank(plan string) int {
	switch plan {
	case "hobby":
		return 1
	case "pro", "premium":
		return 2
	case "team":
		return 3
	}
	return 0
}

// ActivateSubscription marks a subscription as active and upgrades the user
// to the plan stored on the subscription row. The plan name must match a row
// in plan_limits ('hobby'/'pro'/'team') — 'premium' no longer exists there.
func (d *DB) ActivateSubscription(ctx context.Context, paymentID string) error {
	_, err := d.ActivateSubscriptionDetailed(ctx, paymentID)
	return err
}

// ActivateSubscriptionDetailed is ActivateSubscription plus a description of
// what changed. Idempotent: a replayed webhook returns Activated=false.
func (d *DB) ActivateSubscriptionDetailed(ctx context.Context, paymentID string) (*ActivationResult, error) {
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
		return &ActivationResult{Activated: false}, nil // replay or unknown payment
	}
	if err != nil {
		return nil, err
	}

	// Legacy safety net: old pending rows may still say 'premium', which has
	// no plan_limits entry. Map it to 'pro' so the user gets real limits.
	if plan == "premium" || plan == "" {
		plan = "pro"
	}

	// Capture the plan being replaced so the caller can tell a first-time
	// purchase from an upgrade or a renewal.
	var previousPlan string
	d.Pool.QueryRow(ctx, `SELECT COALESCE(plan, 'free') FROM users WHERE id = $1`, userID).Scan(&previousPlan)

	// Upgrade user plan
	_, err = d.Pool.Exec(ctx,
		`UPDATE users SET plan = $2, updated_at = now() WHERE id = $1`,
		userID, plan,
	)
	if err != nil {
		return nil, err
	}
	// This user just became paid — credit whoever referred them.
	d.MaybeGrantReferrerReward(ctx, userID)

	kind := "new"
	switch {
	case previousPlan == plan:
		kind = "renewal"
	case planRank(previousPlan) == 0:
		kind = "new"
	case planRank(plan) > planRank(previousPlan):
		kind = "upgrade"
	case planRank(plan) < planRank(previousPlan):
		kind = "downgrade"
	}

	return &ActivationResult{
		Activated:    true,
		UserID:       userID,
		Plan:         plan,
		PreviousPlan: previousPlan,
		Kind:         kind,
		PeriodEnd:    end,
	}, nil
}

// DunningNotice is one email the sweep wants sent. Kind is "reminder" (renews
// soon), "grace" (lapsed, features still on during the grace window), or
// "expired" (grace exhausted, downgraded to free).
type DunningNotice struct {
	Kind      string
	Email     string
	Name      string
	Plan      string
	Amount    float64
	Currency  string
	Date      string // relevant date: renews-on / access-ends-on
	GraceDays int
}

// DunningResult groups the notices produced by one sweep so the caller (which
// owns the mailer) can send them. Downgraded is also the count for logging.
type DunningResult struct {
	Notices    []DunningNotice
	Downgraded int
}

// SweepExpiredSubscriptions runs the full dunning state machine and returns the
// emails to send. graceDays keeps paid features live for that many days past
// period_end before the user is downgraded to free.
//
//	active ──(period_end passes)──▶ grace ──(+graceDays passes)──▶ expired + downgrade
//
// Reminders fire once each (tracked by *_notified_at columns) so the hourly
// sweep never resends. Downgrade stays narrow: only non-admin users whose plan
// came from a subscription and who have no active OR in-grace subscription.
// Admin grants (no sub rows) and referral rewards (pro_until) are untouched.
func (d *DB) SweepExpiredSubscriptions(ctx context.Context, graceDays int) (*DunningResult, error) {
	if graceDays < 0 {
		graceDays = 0
	}
	res := &DunningResult{}
	const dateFmt = "Jan 2, 2006"

	// ── 1. Pre-expiry reminders: still active, renews within 3 days, not yet
	//        reminded. Collect, then mark so we don't resend.
	rows, err := d.Pool.Query(ctx,
		`SELECT s.id, u.email, COALESCE(u.name,''), s.plan, s.amount, s.currency, s.period_end
		 FROM subscriptions s JOIN users u ON u.id = s.user_id
		 WHERE s.status = 'active' AND s.period_end IS NOT NULL
		   AND s.period_end > now() AND s.period_end <= now() + interval '3 days'
		   AND s.pre_expiry_notified_at IS NULL AND u.is_admin = false`)
	if err != nil {
		return nil, err
	}
	var remindIDs []string
	for rows.Next() {
		var id string
		var n DunningNotice
		var end *time.Time
		if err := rows.Scan(&id, &n.Email, &n.Name, &n.Plan, &n.Amount, &n.Currency, &end); err != nil {
			rows.Close()
			return nil, err
		}
		n.Kind = "reminder"
		if end != nil {
			n.Date = end.Format(dateFmt)
		}
		res.Notices = append(res.Notices, n)
		remindIDs = append(remindIDs, id)
	}
	rows.Close()
	if len(remindIDs) > 0 {
		d.Pool.Exec(ctx, `UPDATE subscriptions SET pre_expiry_notified_at = now() WHERE id = ANY($1)`, remindIDs)
	}

	// ── 2. Enter grace: active subs whose period just ended. Keep the plan, flip
	//        status to 'grace', and send the "you lapsed, grace left" email once.
	rows, err = d.Pool.Query(ctx,
		`SELECT s.id, u.email, COALESCE(u.name,''), s.plan, s.amount, s.currency, s.period_end
		 FROM subscriptions s JOIN users u ON u.id = s.user_id
		 WHERE s.status = 'active' AND s.period_end IS NOT NULL AND s.period_end <= now()
		   AND u.is_admin = false`)
	if err != nil {
		return nil, err
	}
	var graceIDs []string
	for rows.Next() {
		var id string
		var n DunningNotice
		var end *time.Time
		if err := rows.Scan(&id, &n.Email, &n.Name, &n.Plan, &n.Amount, &n.Currency, &end); err != nil {
			rows.Close()
			return nil, err
		}
		n.Kind, n.GraceDays = "grace", graceDays
		if end != nil {
			n.Date = end.AddDate(0, 0, graceDays).Format(dateFmt)
		}
		res.Notices = append(res.Notices, n)
		graceIDs = append(graceIDs, id)
	}
	rows.Close()
	if len(graceIDs) > 0 {
		d.Pool.Exec(ctx,
			`UPDATE subscriptions SET status = 'grace', expiry_notified_at = now() WHERE id = ANY($1)`, graceIDs)
	}

	// ── 3. Exhaust grace: grace subs past period_end + graceDays → expired.
	if _, err := d.Pool.Exec(ctx,
		`UPDATE subscriptions SET status = 'expired'
		 WHERE status = 'grace' AND period_end IS NOT NULL
		   AND period_end + ($1 || ' days')::interval <= now()`,
		fmt.Sprintf("%d", graceDays)); err != nil {
		return nil, err
	}

	// ── 4. Downgrade users no longer protected by an active OR in-grace sub.
	//        Collect them first (for the downgrade email), then flip to free.
	rows, err = d.Pool.Query(ctx,
		`SELECT u.email, COALESCE(u.name,''), u.plan
		 FROM users u
		 WHERE u.is_admin = false
		   AND u.plan IN ('hobby', 'pro', 'team', 'premium')
		   AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
		   AND NOT EXISTS (
		         SELECT 1 FROM subscriptions s
		         WHERE s.user_id = u.id
		           AND ((s.status = 'active' AND s.period_end IS NOT NULL AND s.period_end > now())
		                OR s.status = 'grace'))`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var n DunningNotice
		if err := rows.Scan(&n.Email, &n.Name, &n.Plan); err != nil {
			rows.Close()
			return nil, err
		}
		n.Kind = "expired"
		res.Notices = append(res.Notices, n)
	}
	rows.Close()

	tag, err := d.Pool.Exec(ctx,
		`UPDATE users u SET plan = 'free', updated_at = now()
		 WHERE u.is_admin = false
		   AND u.plan IN ('hobby', 'pro', 'team', 'premium')
		   AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
		   AND NOT EXISTS (
		         SELECT 1 FROM subscriptions s
		         WHERE s.user_id = u.id
		           AND ((s.status = 'active' AND s.period_end IS NOT NULL AND s.period_end > now())
		                OR s.status = 'grace'))`)
	if err != nil {
		return nil, err
	}
	res.Downgraded = int(tag.RowsAffected())
	return res, nil
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
