-- +goose Up
-- Per-server backup toggle: databases hosted on a server with backups_enabled=false
-- are skipped by the backup scheduler. Platform + BYOC servers default to ON.
ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS backups_enabled BOOLEAN NOT NULL DEFAULT true;

-- Backups ON by default for NEW databases going forward.
ALTER TABLE project_databases ALTER COLUMN backup_enabled SET DEFAULT true;

-- Default-on for EXISTING databases that were never configured. Guarantee a sane
-- schedule + retention so the cleanup step never deletes everything (retention 0
-- would purge all backups immediately).
UPDATE project_databases
SET backup_enabled  = true,
    backup_schedule = COALESCE(NULLIF(backup_schedule, ''), 'daily'),
    backup_time     = COALESCE(NULLIF(backup_time, ''), '03:00'),
    backup_retention = GREATEST(COALESCE(backup_retention, 0), 7)
WHERE backup_enabled = false;

-- +goose Down
ALTER TABLE worker_servers DROP COLUMN IF EXISTS backups_enabled;
ALTER TABLE project_databases ALTER COLUMN backup_enabled SET DEFAULT false;
