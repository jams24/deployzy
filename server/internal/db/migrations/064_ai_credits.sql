-- +goose Up
-- Token-based AI credit system for the AI builder / agent.
-- 1 credit = $0.01 of model usage. Balances are stored as exact NUMERIC credits.
-- Enforcement is gated behind the app_settings flag `ai_credits_enabled`
-- (absent/false = disabled), so this ships dark and is flipped on deliberately.

-- Per-plan MONTHLY free allotment (resets each calendar month). -1 = unlimited.
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS monthly_ai_credits INT NOT NULL DEFAULT 20;
UPDATE plan_limits SET monthly_ai_credits = 20  WHERE plan = 'free';
UPDATE plan_limits SET monthly_ai_credits = 100 WHERE plan = 'hobby';
UPDATE plan_limits SET monthly_ai_credits = 500 WHERE plan = 'pro';
UPDATE plan_limits SET monthly_ai_credits = -1  WHERE plan = 'team';

-- Persistent top-up wallet (never resets; only touched after monthly free runs out).
CREATE TABLE IF NOT EXISTS ai_credit_wallet (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance    NUMERIC(16,6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Monthly free-credit consumption (mirrors build_usage). used = credits spent
-- from the plan's free allotment this month.
CREATE TABLE IF NOT EXISTS ai_credit_monthly (
    user_id UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month   DATE          NOT NULL,
    used    NUMERIC(16,6) NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, month)
);

-- Append-only ledger — audit trail + history UI + refunds.
-- delta < 0 = debit (usage), delta > 0 = grant (top-up / monthly / refund).
CREATE TABLE IF NOT EXISTS ai_credit_ledger (
    id            BIGSERIAL PRIMARY KEY,
    user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta         NUMERIC(16,6) NOT NULL,
    reason        TEXT          NOT NULL,          -- build|edit|agent|topup|monthly_free|refund|admin
    source        TEXT          NOT NULL DEFAULT '', -- free|wallet|mixed for debits
    project_id    TEXT,
    model         TEXT,
    tokens_in     INT           NOT NULL DEFAULT 0,
    tokens_out    INT           NOT NULL DEFAULT 0,
    balance_after NUMERIC(16,6) NOT NULL DEFAULT 0, -- wallet balance snapshot
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_user ON ai_credit_ledger(user_id, created_at DESC);

-- Pending credit-pack purchases. Keyed by the payment/checkout id so the shared
-- payment webhook can grant credits on order.paid (idempotent via status flip).
CREATE TABLE IF NOT EXISTS ai_credit_purchases (
    payment_id TEXT PRIMARY KEY,
    user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credits    NUMERIC(16,6) NOT NULL,
    usd        NUMERIC(10,2) NOT NULL DEFAULT 0,
    status     TEXT          NOT NULL DEFAULT 'pending', -- pending|paid
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS ai_credit_purchases;
DROP TABLE IF EXISTS ai_credit_ledger;
DROP TABLE IF EXISTS ai_credit_monthly;
DROP TABLE IF EXISTS ai_credit_wallet;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS monthly_ai_credits;
