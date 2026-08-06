-- +goose Up
-- Gate a template behind a subscription plan. Empty string / 'free' = available
-- to everyone; 'hobby' or 'pro' require at least that plan to deploy.
ALTER TABLE templates ADD COLUMN IF NOT EXISTS required_plan TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE templates DROP COLUMN IF EXISTS required_plan;
