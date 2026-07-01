package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"
)

// Webhook is an account-level outgoing webhook endpoint.
type Webhook struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	URL            string     `json:"url"`
	Secret         string     `json:"secret"`
	Enabled        bool       `json:"enabled"`
	LastStatus     *int       `json:"last_status"`
	LastDeliveryAt *time.Time `json:"last_delivery_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

const webhookCols = `id, user_id, url, secret, enabled, last_status, last_delivery_at, created_at`

func scanWebhook(scan func(dest ...any) error) (Webhook, error) {
	var wh Webhook
	err := scan(&wh.ID, &wh.UserID, &wh.URL, &wh.Secret, &wh.Enabled, &wh.LastStatus, &wh.LastDeliveryAt, &wh.CreatedAt)
	return wh, err
}

// ListWebhooks returns a user's webhooks, newest first.
func (d *DB) ListWebhooks(ctx context.Context, userID string) ([]Webhook, error) {
	rows, err := d.Pool.Query(ctx, `SELECT `+webhookCols+` FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Webhook{}
	for rows.Next() {
		wh, err := scanWebhook(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, wh)
	}
	return out, nil
}

// GetEnabledWebhooks returns the user's enabled webhooks (for delivery).
func (d *DB) GetEnabledWebhooks(ctx context.Context, userID string) ([]Webhook, error) {
	rows, err := d.Pool.Query(ctx, `SELECT `+webhookCols+` FROM webhooks WHERE user_id = $1 AND enabled = true`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Webhook{}
	for rows.Next() {
		wh, err := scanWebhook(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, wh)
	}
	return out, nil
}

// CreateWebhook inserts a webhook with a freshly generated signing secret.
func (d *DB) CreateWebhook(ctx context.Context, userID, url string) (*Webhook, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	secret := "whsec_" + hex.EncodeToString(buf)
	wh, err := scanWebhook(d.Pool.QueryRow(ctx,
		`INSERT INTO webhooks (user_id, url, secret) VALUES ($1, $2, $3) RETURNING `+webhookCols,
		userID, url, secret,
	).Scan)
	if err != nil {
		return nil, err
	}
	return &wh, nil
}

// GetWebhook fetches one webhook owned by the user.
func (d *DB) GetWebhook(ctx context.Context, id, userID string) (*Webhook, error) {
	wh, err := scanWebhook(d.Pool.QueryRow(ctx,
		`SELECT `+webhookCols+` FROM webhooks WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan)
	if err != nil {
		return nil, nil
	}
	return &wh, nil
}

// SetWebhookEnabled toggles a webhook on/off.
func (d *DB) SetWebhookEnabled(ctx context.Context, id, userID string, enabled bool) error {
	_, err := d.Pool.Exec(ctx, `UPDATE webhooks SET enabled = $3 WHERE id = $1 AND user_id = $2`, id, userID, enabled)
	return err
}

// DeleteWebhook removes a webhook.
func (d *DB) DeleteWebhook(ctx context.Context, id, userID string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM webhooks WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// RecordWebhookDelivery stores the last HTTP status + timestamp for a webhook.
func (d *DB) RecordWebhookDelivery(ctx context.Context, id string, status int) {
	d.Pool.Exec(ctx, `UPDATE webhooks SET last_status = $2, last_delivery_at = now() WHERE id = $1`, id, status)
}
