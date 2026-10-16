package db

import (
	"context"
	"time"
)

// Per-user BYOK (bring-your-own-key) storage for the AI builder / agent.

// UserAIKeyInfo is a saved key without the secret (for listing in the UI).
type UserAIKeyInfo struct {
	Provider  string    `json:"provider"`
	Preview   string    `json:"preview"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SetUserAIKey upserts a user's key for a provider (encrypted at rest).
func (d *DB) SetUserAIKey(ctx context.Context, userID, provider, key string) error {
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO user_ai_keys (user_id, provider, api_key, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, updated_at = now()`,
		userID, provider, d.encrypt(key))
	return err
}

// DeleteUserAIKey removes a user's key for a provider.
func (d *DB) DeleteUserAIKey(ctx context.Context, userID, provider string) error {
	_, err := d.Pool.Exec(ctx,
		`DELETE FROM user_ai_keys WHERE user_id = $1 AND provider = $2`, userID, provider)
	return err
}

// ListUserAIKeys returns the user's saved providers (masked previews, no secrets).
func (d *DB) ListUserAIKeys(ctx context.Context, userID string) ([]UserAIKeyInfo, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT provider, api_key, updated_at FROM user_ai_keys WHERE user_id = $1 ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserAIKeyInfo
	for rows.Next() {
		var provider, key string
		var updated time.Time
		if err := rows.Scan(&provider, &key, &updated); err != nil {
			return out, err
		}
		out = append(out, UserAIKeyInfo{Provider: provider, Preview: maskAIKey(d.decrypt(key)), UpdatedAt: updated})
	}
	return out, rows.Err()
}

// ResolveUserAIKey picks the key the user's AI calls should use. It prefers the
// key for `preferProvider` (the platform's active provider) so BYOC keeps the
// same model when possible; otherwise it falls back to the user's most-recently
// saved key. ok=false means the user has no keys (use the platform default).
func (d *DB) ResolveUserAIKey(ctx context.Context, userID, preferProvider string) (provider, key string, ok bool) {
	// 1) exact match on the preferred provider
	if preferProvider != "" {
		err := d.Pool.QueryRow(ctx,
			`SELECT provider, api_key FROM user_ai_keys WHERE user_id = $1 AND provider = $2`,
			userID, preferProvider).Scan(&provider, &key)
		if err == nil && key != "" {
			return provider, d.decrypt(key), true
		}
	}
	// 2) most recently saved key of any provider
	err := d.Pool.QueryRow(ctx,
		`SELECT provider, api_key FROM user_ai_keys WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
		userID).Scan(&provider, &key)
	if err == nil && key != "" {
		return provider, d.decrypt(key), true
	}
	return "", "", false
}

// GetUserAIKeyExact returns the user's key for exactly this provider (decrypted).
func (d *DB) GetUserAIKeyExact(ctx context.Context, userID, provider string) (string, bool) {
	var key string
	err := d.Pool.QueryRow(ctx,
		`SELECT api_key FROM user_ai_keys WHERE user_id = $1 AND provider = $2`, userID, provider).Scan(&key)
	if err != nil || key == "" {
		return "", false
	}
	return d.decrypt(key), true
}

func maskAIKey(key string) string {
	if len(key) <= 8 {
		return "••••"
	}
	return key[:5] + "…" + key[len(key)-3:]
}
