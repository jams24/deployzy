-- +goose Up
-- Dunning support: a grace period + reminder emails before/after a paid plan
-- lapses. We track which notices have been sent so the hourly sweep doesn't
-- resend them every run.
--
-- New status value 'grace': the paid period has ended but the user keeps their
-- plan (and all paid features) until period_end + grace_days passes. Only then
-- are they downgraded to free.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pre_expiry_notified_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expiry_notified_at    TIMESTAMPTZ;

-- +goose Down
ALTER TABLE subscriptions DROP COLUMN IF EXISTS pre_expiry_notified_at;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS expiry_notified_at;
