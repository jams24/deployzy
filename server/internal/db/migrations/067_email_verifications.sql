-- +goose Up
-- Per-verification log for the email-validator product, so admins can see how
-- the product is used and how healthy the checked lists are. The credit ledger
-- records the *charge*; this records the *outcome*.
--
-- Privacy: we deliberately store only the DOMAIN (plus the verdict/flags), never
-- the full address — the product checks third parties' contact lists and we do
-- not warehouse them.
CREATE TABLE IF NOT EXISTS email_verifications (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
    domain       TEXT        NOT NULL DEFAULT '',
    score        TEXT        NOT NULL DEFAULT '',  -- valid | risky | invalid | unknown
    reason       TEXT        NOT NULL DEFAULT '',  -- machine-readable
    disposable   BOOLEAN     NOT NULL DEFAULT false,
    role_based   BOOLEAN     NOT NULL DEFAULT false,
    has_mx       BOOLEAN     NOT NULL DEFAULT false,
    free_provider BOOLEAN    NOT NULL DEFAULT false,
    mailbox_checked BOOLEAN  NOT NULL DEFAULT false,
    source       TEXT        NOT NULL DEFAULT 'single', -- single | batch | api
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_created ON email_verifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_verifications_score ON email_verifications (score);

-- +goose Down
DROP TABLE IF EXISTS email_verifications;
