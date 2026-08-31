-- +goose Up
-- Free plan gets Postgres only (one database). Redis / MongoDB / MySQL are a
-- paid feature — the create UI shows "Upgrade to access" on those engines.
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_advanced_databases BOOLEAN NOT NULL DEFAULT true;

UPDATE plan_limits SET allow_advanced_databases = false WHERE plan = 'free';
UPDATE plan_limits SET allow_advanced_databases = true  WHERE plan IN ('hobby', 'pro', 'team', 'admin');

-- Also cap free at a single database to match the pricing change.
UPDATE plan_limits SET max_databases = 1, max_services = 1 WHERE plan = 'free';

-- +goose Down
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_advanced_databases;
