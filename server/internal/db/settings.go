package db

import (
	"context"
)

// GetSetting returns the stored value for a key, or "" if unset.
func (db *DB) GetSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := db.Pool.QueryRow(ctx, `SELECT value FROM app_settings WHERE key = $1`, key).Scan(&v)
	if err != nil {
		// Missing row is not an error for a KV lookup — an unset setting is "".
		return "", nil
	}
	return v, nil
}

// GetSettings returns the values for several keys at once (missing → "").
func (db *DB) GetSettings(ctx context.Context, keys ...string) (map[string]string, error) {
	out := make(map[string]string, len(keys))
	for _, k := range keys {
		out[k] = ""
	}
	rows, err := db.Pool.Query(ctx,
		`SELECT key, value FROM app_settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return out, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// SetSetting upserts a key/value pair.
func (db *DB) SetSetting(ctx context.Context, key, value string) error {
	_, err := db.Pool.Exec(ctx,
		`INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		key, value)
	return err
}
