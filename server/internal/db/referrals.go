package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

// ReferredUser is one person the current user referred.
type ReferredUser struct {
	Name     string    `json:"name"`
	Email    string    `json:"email"` // masked before returning to the client
	Plan     string    `json:"plan"`
	Paid     bool      `json:"paid"`
	JoinedAt time.Time `json:"joined_at"`
}

// ReferralStats summarises a user's referral activity.
type ReferralStats struct {
	Code      string         `json:"code"`
	Total     int            `json:"total"`
	Paid      int            `json:"paid"`
	ProMonths int            `json:"pro_months"` // earned: 1 per 10 paid
	ProUntil  *time.Time     `json:"pro_until"`  // when an active reward expires
	People    []ReferredUser `json:"people"`
}

// isPaidPlan reports whether a plan counts as a paid referral — any paying tier
// (pro, team, legacy "premium"), but not free, empty, or the admin tier.
func isPaidPlan(plan string) bool {
	return plan != "free" && plan != "" && plan != "admin"
}

// effectivePlan upgrades a free user to "pro" while a referral reward (pro_until)
// is active. Paid users keep their own (higher) plan.
func effectivePlan(basePlan string, proUntil *time.Time) string {
	if (basePlan == "free" || basePlan == "") && proUntil != nil && proUntil.After(time.Now()) {
		return "pro"
	}
	return basePlan
}

// referralMilestone is the number of paid referrals that earns one Pro month.
const referralMilestone = 10

// GrantReferralRewards recomputes a referrer's earned reward months and extends
// their pro_until for any newly-crossed milestone (idempotent via the
// referral_months_granted counter). Safe to call repeatedly.
func (d *DB) GrantReferralRewards(ctx context.Context, referrerID string) {
	var paid, granted int
	if err := d.Pool.QueryRow(ctx,
		`SELECT
		   (SELECT count(*) FROM users WHERE referred_by = $1 AND plan NOT IN ('free', '', 'admin')),
		   COALESCE((SELECT referral_months_granted FROM users WHERE id = $1), 0)`,
		referrerID,
	).Scan(&paid, &granted); err != nil {
		return
	}
	earned := paid / referralMilestone
	if earned <= granted {
		return
	}
	delta := earned - granted
	// Extend from the later of now / current pro_until, so stacked rewards add up.
	d.Pool.Exec(ctx,
		`UPDATE users
		   SET pro_until = GREATEST(COALESCE(pro_until, now()), now()) + ($2 || ' months')::interval,
		       referral_months_granted = $3,
		       updated_at = now()
		 WHERE id = $1`,
		referrerID, delta, earned,
	)
}

// MaybeGrantReferrerReward checks whether the given (just-upgraded) user was
// referred, and if so recomputes their referrer's rewards.
func (d *DB) MaybeGrantReferrerReward(ctx context.Context, upgradedUserID string) {
	var referrer *string
	if err := d.Pool.QueryRow(ctx, `SELECT referred_by FROM users WHERE id = $1`, upgradedUserID).Scan(&referrer); err != nil {
		return
	}
	if referrer != nil && *referrer != "" {
		d.GrantReferralRewards(ctx, *referrer)
	}
}

// GetOrCreateReferralCode returns the user's referral code, generating a unique
// one on first access.
func (d *DB) GetOrCreateReferralCode(ctx context.Context, userID string) (string, error) {
	var code *string
	if err := d.Pool.QueryRow(ctx, `SELECT referral_code FROM users WHERE id = $1`, userID).Scan(&code); err != nil {
		return "", err
	}
	if code != nil && *code != "" {
		return *code, nil
	}
	// Generate a unique code (retry on the unlikely collision).
	for i := 0; i < 5; i++ {
		buf := make([]byte, 6)
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		candidate := "sm" + hex.EncodeToString(buf) // e.g. "sm3f9a1c..."
		_, err := d.Pool.Exec(ctx, `UPDATE users SET referral_code = $2 WHERE id = $1`, userID, candidate)
		if err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("could not generate referral code")
}

// ResolveReferralCode returns the user ID that owns a referral code, or "" if
// none. Used at signup to attribute the new user.
func (d *DB) ResolveReferralCode(ctx context.Context, code string) string {
	if code == "" {
		return ""
	}
	var id string
	if err := d.Pool.QueryRow(ctx, `SELECT id FROM users WHERE referral_code = $1`, code).Scan(&id); err != nil {
		return ""
	}
	return id
}

// SetReferredBy records who referred a user (no-op for self-referral).
func (d *DB) SetReferredBy(ctx context.Context, userID, referrerID string) {
	if referrerID == "" || referrerID == userID {
		return
	}
	d.Pool.Exec(ctx, `UPDATE users SET referred_by = $2 WHERE id = $1 AND referred_by IS NULL`, userID, referrerID)
}

// GetReferralStats returns totals + the list of referred users.
func (d *DB) GetReferralStats(ctx context.Context, userID string) (*ReferralStats, error) {
	code, err := d.GetOrCreateReferralCode(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := d.Pool.Query(ctx,
		`SELECT name, email, plan, created_at FROM users WHERE referred_by = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := &ReferralStats{Code: code, People: []ReferredUser{}}
	for rows.Next() {
		var ru ReferredUser
		if err := rows.Scan(&ru.Name, &ru.Email, &ru.Plan, &ru.JoinedAt); err != nil {
			return nil, err
		}
		ru.Paid = isPaidPlan(ru.Plan)
		ru.Email = maskEmail(ru.Email)
		stats.Total++
		if ru.Paid {
			stats.Paid++
		}
		stats.People = append(stats.People, ru)
	}
	stats.ProMonths = stats.Paid / referralMilestone
	// Surface an active reward window (pro_until in the future).
	var proUntil *time.Time
	if err := d.Pool.QueryRow(ctx, `SELECT pro_until FROM users WHERE id = $1`, userID).Scan(&proUntil); err == nil {
		if proUntil != nil && proUntil.After(time.Now()) {
			stats.ProUntil = proUntil
		}
	}
	return stats, nil
}

// maskEmail turns "alice@example.com" into "al***@example.com" so the referrer
// gets a sense of who joined without exposing full addresses.
func maskEmail(email string) string {
	at := -1
	for i, c := range email {
		if c == '@' {
			at = i
			break
		}
	}
	if at <= 0 {
		return email
	}
	local := email[:at]
	if len(local) <= 2 {
		return local[:1] + "***" + email[at:]
	}
	return local[:2] + "***" + email[at:]
}
