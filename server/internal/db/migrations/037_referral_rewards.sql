-- +goose Up
-- Referral rewards: pro_until grants temporary Pro access (1 month per 10 paid
-- referrals) that auto-expires without touching a user's real paid plan.
-- referral_months_granted tracks how many reward months were already granted so
-- crossing the same milestone twice can't double-grant.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_until               TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_months_granted INT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS referral_months_granted;
ALTER TABLE users DROP COLUMN IF EXISTS pro_until;
