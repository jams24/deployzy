-- +goose Up
CREATE TABLE IF NOT EXISTS project_databases (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    db_name      TEXT NOT NULL,
    db_user      TEXT NOT NULL,
    db_password  TEXT NOT NULL,
    host         TEXT NOT NULL DEFAULT '172.17.0.1',
    port         INT NOT NULL DEFAULT 5432,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_databases_project ON project_databases(project_id);

-- +goose Down
DROP TABLE IF EXISTS project_databases;
