-- +goose Up
CREATE TABLE IF NOT EXISTS database_backups (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_name    TEXT NOT NULL,
    file_size    BIGINT NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'completed',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_database_backups_project ON database_backups(project_id);

-- Backup schedule config per project database
ALTER TABLE project_databases ADD COLUMN IF NOT EXISTS backup_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_databases ADD COLUMN IF NOT EXISTS backup_schedule TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE project_databases ADD COLUMN IF NOT EXISTS backup_time TEXT NOT NULL DEFAULT '03:00';
ALTER TABLE project_databases ADD COLUMN IF NOT EXISTS backup_retention INT NOT NULL DEFAULT 7;
ALTER TABLE project_databases ADD COLUMN IF NOT EXISTS last_backup_at TIMESTAMPTZ;

-- +goose Down
DROP TABLE IF EXISTS database_backups;
ALTER TABLE project_databases DROP COLUMN IF EXISTS backup_enabled;
ALTER TABLE project_databases DROP COLUMN IF EXISTS backup_schedule;
ALTER TABLE project_databases DROP COLUMN IF EXISTS backup_time;
ALTER TABLE project_databases DROP COLUMN IF EXISTS backup_retention;
ALTER TABLE project_databases DROP COLUMN IF EXISTS last_backup_at;
