-- +goose Up
-- Account-level outgoing webhooks: Deployzy POSTs deploy events to each enabled
-- URL, signed with the webhook's secret (HMAC-SHA256).
CREATE TABLE IF NOT EXISTS webhooks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url              TEXT NOT NULL,
    secret           TEXT NOT NULL,
    enabled          BOOLEAN NOT NULL DEFAULT true,
    last_status      INT,
    last_delivery_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);

-- +goose Down
DROP TABLE IF EXISTS webhooks;
