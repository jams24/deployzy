-- +goose Up
-- One row per billing webhook, activation, reconciliation fix and billing
-- email, so the admin Payments console can show what happened and spot a
-- broken pipeline (e.g. every Polar webhook failing its signature check).
CREATE TABLE IF NOT EXISTS billing_events (
    id          BIGSERIAL     PRIMARY KEY,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    provider    TEXT          NOT NULL,             -- polar | inventpay | email | admin
    event_type  TEXT          NOT NULL,             -- order.paid, payment.completed, subscription_email…
    outcome     TEXT          NOT NULL,             -- activated|credits|received|replay|unknown|rejected|error|sent|failed
    user_id     UUID,
    payment_id  TEXT          NOT NULL DEFAULT '',
    amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency    TEXT          NOT NULL DEFAULT '',
    detail      TEXT          NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_billing_events_created ON billing_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_provider ON billing_events (provider, created_at DESC);

-- When a credit pack was actually paid (created_at is when checkout began).
ALTER TABLE ai_credit_purchases ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE ai_credit_purchases DROP COLUMN IF EXISTS paid_at;
DROP TABLE IF EXISTS billing_events;
