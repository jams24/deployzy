-- +goose Up
-- One-time "bring your own database" import jobs. A user points us at their
-- existing DB; we dump it and restore into a freshly-created Deployzy-managed
-- service, then hand back the new connection URL. Premium-only (gated by the
-- allow_db_migration plan flag below).
--
-- We never persist the source connection string — it lives only in memory for
-- the duration of the job. This table tracks status + result only.
CREATE TABLE IF NOT EXISTS db_migrations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type       TEXT NOT NULL,                    -- postgres | mysql | mongodb
    source_host       TEXT NOT NULL DEFAULT '',         -- host only (no creds) for display
    target_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'pending',  -- pending | running | success | failed
    error             TEXT NOT NULL DEFAULT '',
    log               TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_db_migrations_user ON db_migrations(user_id, created_at DESC);

-- Premium gate: which plans may run a migration.
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_db_migration BOOLEAN NOT NULL DEFAULT false;
UPDATE plan_limits SET allow_db_migration = false WHERE plan = 'free';
UPDATE plan_limits SET allow_db_migration = true  WHERE plan IN ('hobby', 'pro', 'team', 'admin');

-- +goose Down
DROP TABLE IF EXISTS db_migrations;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_db_migration;
