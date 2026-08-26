package db

import (
	"context"
	"time"
)

// AI credit accounting. 1 credit = $0.01 of model usage. Two buckets:
//   - monthly free allotment (ai_credit_monthly, resets each calendar month)
//   - persistent top-up wallet (ai_credit_wallet, only used after free runs out)
// The append-only ai_credit_ledger records every debit/grant for audit + history.

// AICreditStatus is a user's current AI-credit position.
type AICreditStatus struct {
	FreeAllotment int     `json:"free_allotment"` // per-month, -1 = unlimited
	FreeUsed      float64 `json:"free_used"`      // credits spent from free this month
	FreeRemaining float64 `json:"free_remaining"` // -1 when unlimited
	Wallet        float64 `json:"wallet"`         // persistent top-up balance
	Available     float64 `json:"available"`      // free_remaining + wallet (huge sentinel when unlimited)
	Unlimited     bool    `json:"unlimited"`
}

const aiUnlimitedSentinel = 1e12

// GetAICreditStatus returns the user's free + wallet position for the current month.
func (d *DB) GetAICreditStatus(ctx context.Context, userID string, freeAllotment int) (AICreditStatus, error) {
	st := AICreditStatus{FreeAllotment: freeAllotment}

	var wallet float64
	// Wallet row may not exist yet — that's a zero balance, not an error.
	d.Pool.QueryRow(ctx, `SELECT COALESCE(balance, 0) FROM ai_credit_wallet WHERE user_id = $1`, userID).Scan(&wallet)
	st.Wallet = wallet

	var used float64
	d.Pool.QueryRow(ctx,
		`SELECT COALESCE(used, 0) FROM ai_credit_monthly
		 WHERE user_id = $1 AND month = date_trunc('month', now())::date`, userID,
	).Scan(&used)
	st.FreeUsed = used

	if freeAllotment < 0 {
		st.Unlimited = true
		st.FreeRemaining = -1
		st.Available = aiUnlimitedSentinel
		return st, nil
	}
	st.FreeRemaining = float64(freeAllotment) - used
	if st.FreeRemaining < 0 {
		st.FreeRemaining = 0
	}
	st.Available = st.FreeRemaining + wallet
	return st, nil
}

// DebitAICredits spends `amount` credits, drawing from the monthly free allotment
// first and the top-up wallet for the remainder. Writes a ledger row. Returns the
// portions taken and the resulting wallet balance. `amount` is assumed already
// checked against availability by the caller (billing.EnsureAICredits); a wallet
// short-fall is clamped so we never push the wallet negative.
func (d *DB) DebitAICredits(ctx context.Context, userID string, amount float64, freeAllotment int, reason, projectID, model string, tokensIn, tokensOut int) error {
	if amount <= 0 {
		return nil
	}
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	fromFree := 0.0
	if freeAllotment < 0 {
		// Unlimited free — still record consumption for analytics, no wallet touch.
		fromFree = amount
	} else {
		var used float64
		tx.QueryRow(ctx,
			`SELECT COALESCE(used, 0) FROM ai_credit_monthly
			 WHERE user_id = $1 AND month = date_trunc('month', now())::date`, userID).Scan(&used)
		remaining := float64(freeAllotment) - used
		if remaining < 0 {
			remaining = 0
		}
		if remaining >= amount {
			fromFree = amount
		} else {
			fromFree = remaining
		}
	}
	fromWallet := amount - fromFree

	if fromFree > 0 {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ai_credit_monthly (user_id, month, used)
			 VALUES ($1, date_trunc('month', now())::date, $2)
			 ON CONFLICT (user_id, month) DO UPDATE SET used = ai_credit_monthly.used + EXCLUDED.used`,
			userID, fromFree); err != nil {
			return err
		}
	}

	var walletAfter float64
	if fromWallet > 0 {
		// Clamp so a race can't push the wallet negative.
		if err := tx.QueryRow(ctx,
			`UPDATE ai_credit_wallet SET balance = GREATEST(balance - $2, 0), updated_at = now()
			 WHERE user_id = $1 RETURNING balance`,
			userID, fromWallet).Scan(&walletAfter); err != nil {
			// No wallet row → treat as zero; the free bucket covered what it could.
			walletAfter = 0
		}
	} else {
		d.Pool.QueryRow(ctx, `SELECT COALESCE(balance,0) FROM ai_credit_wallet WHERE user_id=$1`, userID).Scan(&walletAfter)
	}

	source := "free"
	if fromWallet > 0 && fromFree > 0 {
		source = "mixed"
	} else if fromWallet > 0 {
		source = "wallet"
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO ai_credit_ledger (user_id, delta, reason, source, project_id, model, tokens_in, tokens_out, balance_after)
		 VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''), $7, $8, $9)`,
		userID, -amount, reason, source, projectID, model, tokensIn, tokensOut, walletAfter); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// GrantAICredits adds credits to the persistent wallet (top-up, refund, admin
// adjustment) and records a ledger row. Idempotency (for replayed webhooks) is
// the caller's responsibility.
func (d *DB) GrantAICredits(ctx context.Context, userID string, amount float64, reason string) error {
	if amount == 0 {
		return nil
	}
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var balance float64
	if err := tx.QueryRow(ctx,
		`INSERT INTO ai_credit_wallet (user_id, balance, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (user_id) DO UPDATE SET balance = ai_credit_wallet.balance + EXCLUDED.balance, updated_at = now()
		 RETURNING balance`,
		userID, amount).Scan(&balance); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO ai_credit_ledger (user_id, delta, reason, source, balance_after)
		 VALUES ($1, $2, $3, 'wallet', $4)`,
		userID, amount, reason, balance); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CreateCreditPurchase records a pending credit-pack purchase keyed by payment id.
func (d *DB) CreateCreditPurchase(ctx context.Context, userID, paymentID string, credits, usd float64) error {
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO ai_credit_purchases (payment_id, user_id, credits, usd, status)
		 VALUES ($1, $2, $3, $4, 'pending')
		 ON CONFLICT (payment_id) DO NOTHING`,
		paymentID, userID, credits, usd)
	return err
}

// ActivateCreditPurchase flips a pending purchase to paid and returns what to
// grant. ok=false means "no pending purchase for this payment id" (an unknown or
// already-processed id) — callers use that to fall through to other payment
// types and to stay idempotent against replayed webhooks.
func (d *DB) ActivateCreditPurchase(ctx context.Context, paymentID string) (userID string, credits float64, ok bool, err error) {
	err = d.Pool.QueryRow(ctx,
		`UPDATE ai_credit_purchases SET status = 'paid'
		 WHERE payment_id = $1 AND status = 'pending'
		 RETURNING user_id, credits`, paymentID,
	).Scan(&userID, &credits)
	if err != nil {
		return "", 0, false, nil // no row → not a (pending) credit purchase
	}
	return userID, credits, true, nil
}

// AILedgerEntry is one row of a user's credit history.
type AILedgerEntry struct {
	Delta     float64   `json:"delta"`
	Reason    string    `json:"reason"`
	Source    string    `json:"source"`
	ProjectID string    `json:"project_id"`
	Model     string    `json:"model"`
	TokensIn  int       `json:"tokens_in"`
	TokensOut int       `json:"tokens_out"`
	CreatedAt time.Time `json:"created_at"`
}

// GetAILedger returns the user's most recent credit-history rows.
func (d *DB) GetAILedger(ctx context.Context, userID string, limit int) ([]AILedgerEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := d.Pool.Query(ctx,
		`SELECT delta, reason, source, COALESCE(project_id,''), COALESCE(model,''), tokens_in, tokens_out, created_at
		 FROM ai_credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AILedgerEntry
	for rows.Next() {
		var e AILedgerEntry
		if err := rows.Scan(&e.Delta, &e.Reason, &e.Source, &e.ProjectID, &e.Model, &e.TokensIn, &e.TokensOut, &e.CreatedAt); err != nil {
			return out, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
