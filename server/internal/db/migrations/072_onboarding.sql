-- +goose Up
-- Dashboard onboarding: when the user finished (or skipped) the product tour,
-- and when they hid the setup checklist. Stored server-side so neither comes
-- back on another device.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tour_done_at           TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS checklist_dismissed_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS tour_done_at;
ALTER TABLE users DROP COLUMN IF EXISTS checklist_dismissed_at;
