-- +goose Up
CREATE TABLE IF NOT EXISTS project_crons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    schedule        TEXT NOT NULL,   -- cron expression, e.g. "0 3 * * *"
    command         TEXT NOT NULL,   -- shell command run inside a new container from the project image
    enabled         BOOLEAN NOT NULL DEFAULT true,
    last_run_at     TIMESTAMPTZ,
    last_status     TEXT NOT NULL DEFAULT '',  -- 'success' | 'failed' | ''
    last_output     TEXT NOT NULL DEFAULT '',  -- truncated stdout/stderr
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_crons_project ON project_crons(project_id);
CREATE INDEX IF NOT EXISTS idx_project_crons_enabled ON project_crons(enabled) WHERE enabled = true;

-- +goose Down
DROP TABLE IF EXISTS project_crons;
