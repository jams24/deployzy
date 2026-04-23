-- +goose Up
-- Per-plan disk cap for standalone Postgres services. Enforced by the
-- db_quota_sweeper: when a user's DB exceeds its plan cap, INSERT/UPDATE are
-- revoked from the role so the DB stops growing. Reads and deletes keep
-- working so the user can still recover. -1 = unlimited.

ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_db_size_mb INT NOT NULL DEFAULT 500;

UPDATE plan_limits SET max_db_size_mb =   500 WHERE plan = 'free';
UPDATE plan_limits SET max_db_size_mb = 10240 WHERE plan = 'pro';
UPDATE plan_limits SET max_db_size_mb = 51200 WHERE plan = 'team';
UPDATE plan_limits SET max_db_size_mb =    -1 WHERE plan = 'admin';

-- Track over-quota state so the sweeper doesn't thrash REVOKE/GRANT every run.
ALTER TABLE services ADD COLUMN IF NOT EXISTS over_quota BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS size_mb    INT     NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS size_checked_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE services DROP COLUMN IF EXISTS size_checked_at;
ALTER TABLE services DROP COLUMN IF EXISTS size_mb;
ALTER TABLE services DROP COLUMN IF EXISTS over_quota;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_db_size_mb;
