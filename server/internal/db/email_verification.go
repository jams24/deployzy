package db

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Email verification for password signups. Google OAuth users are verified
// implicitly — Google already proved mailbox ownership.
const (
	verifyCodeTTL      = 15 * time.Minute
	verifyMaxAttempts  = 5
	verifyResendWindow = 60 * time.Second
)

// GenerateVerifyCode creates a 6-digit code, stores its bcrypt hash on the
// user with an expiry, and returns the plaintext code for emailing. Attempt
// counter resets so a fresh code always gets a full allowance.
func (d *DB) GenerateVerifyCode(ctx context.Context, userID string) (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", fmt.Errorf("generate code: %w", err)
	}
	code := fmt.Sprintf("%06d", n.Int64())

	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash code: %w", err)
	}

	if _, err := d.Pool.Exec(ctx,
		`UPDATE users
		 SET verify_code_hash = $2, verify_code_expires_at = $3, verify_attempts = 0
		 WHERE id = $1`,
		userID, string(hash), time.Now().Add(verifyCodeTTL),
	); err != nil {
		return "", fmt.Errorf("store code: %w", err)
	}
	return code, nil
}

// VerifyEmailResult explains why a verification attempt failed so handlers can
// return an accurate message without leaking which emails exist.
type VerifyEmailResult int

const (
	VerifyOK VerifyEmailResult = iota
	VerifyBadCode
	VerifyExpired
	VerifyTooManyAttempts
	VerifyAlreadyVerified
	VerifyNoCode
)

// CheckVerifyCode validates a submitted code and, on success, marks the user
// verified and clears the code. Wrong codes burn an attempt; after
// verifyMaxAttempts the code is dead and the user must request a new one.
func (d *DB) CheckVerifyCode(ctx context.Context, userID, code string) (VerifyEmailResult, error) {
	var (
		verified  bool
		hash      *string
		expiresAt *time.Time
		attempts  int
	)
	err := d.Pool.QueryRow(ctx,
		`SELECT COALESCE(email_verified, false), verify_code_hash, verify_code_expires_at, COALESCE(verify_attempts, 0)
		 FROM users WHERE id = $1`, userID,
	).Scan(&verified, &hash, &expiresAt, &attempts)
	if err != nil {
		return VerifyBadCode, err
	}
	if verified {
		return VerifyAlreadyVerified, nil
	}
	if hash == nil || expiresAt == nil {
		return VerifyNoCode, nil
	}
	if time.Now().After(*expiresAt) {
		return VerifyExpired, nil
	}
	if attempts >= verifyMaxAttempts {
		return VerifyTooManyAttempts, nil
	}

	if bcrypt.CompareHashAndPassword([]byte(*hash), []byte(code)) != nil {
		// Burn an attempt so a 6-digit code can't be brute-forced.
		d.Pool.Exec(ctx, `UPDATE users SET verify_attempts = COALESCE(verify_attempts, 0) + 1 WHERE id = $1`, userID)
		return VerifyBadCode, nil
	}

	if _, err := d.Pool.Exec(ctx,
		`UPDATE users
		 SET email_verified = true, verify_code_hash = NULL,
		     verify_code_expires_at = NULL, verify_attempts = 0, updated_at = now()
		 WHERE id = $1`, userID,
	); err != nil {
		return VerifyBadCode, err
	}
	return VerifyOK, nil
}

// IsEmailVerified reports whether the user has confirmed their address.
func (d *DB) IsEmailVerified(ctx context.Context, userID string) (bool, error) {
	var verified bool
	err := d.Pool.QueryRow(ctx,
		`SELECT COALESCE(email_verified, false) FROM users WHERE id = $1`, userID,
	).Scan(&verified)
	return verified, err
}

// MarkEmailVerified flags an address as confirmed without a code — used by the
// Google OAuth path, where the provider has already verified the mailbox.
func (d *DB) MarkEmailVerified(ctx context.Context, userID string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE users SET email_verified = true, verify_code_hash = NULL,
		 verify_code_expires_at = NULL WHERE id = $1`, userID)
	return err
}

// CanResendVerifyCode rate-limits resends to one per verifyResendWindow by
// checking how recently the current code was issued.
func (d *DB) CanResendVerifyCode(ctx context.Context, userID string) (bool, error) {
	var expiresAt *time.Time
	err := d.Pool.QueryRow(ctx,
		`SELECT verify_code_expires_at FROM users WHERE id = $1`, userID,
	).Scan(&expiresAt)
	if err != nil {
		return false, err
	}
	if expiresAt == nil {
		return true, nil
	}
	// Code was issued at (expiry - TTL); allow a resend once the window passed.
	issuedAt := expiresAt.Add(-verifyCodeTTL)
	return time.Since(issuedAt) >= verifyResendWindow, nil
}

// DeleteUnverifiedStaleUsers removes password signups that never confirmed
// their address within the grace period. Keeps the users table (and the email
// namespace) clean so an abandoned signup doesn't permanently squat an address.
func (d *DB) DeleteUnverifiedStaleUsers(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := d.Pool.Exec(ctx,
		`DELETE FROM users
		 WHERE COALESCE(email_verified, false) = false
		   AND password_hash IS NOT NULL
		   AND created_at < now() - $1::interval`,
		fmt.Sprintf("%d seconds", int(olderThan.Seconds())),
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
