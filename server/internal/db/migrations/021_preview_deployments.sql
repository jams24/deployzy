-- +goose Up
-- Preview deployments: each open PR becomes its own ephemeral project linked
-- back to the parent via parent_project_id. Reusing the existing projects
-- table means we inherit deploy engine, metrics, analytics, logs, env vars,
-- health checks, build config — everything — for free.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pr_number       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pr_title        TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS preview_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pr_comment_id   BIGINT  NOT NULL DEFAULT 0;

-- Fast lookup from webhook payload (repo + pr number)
CREATE INDEX IF NOT EXISTS idx_projects_parent_pr ON projects(parent_project_id, pr_number) WHERE parent_project_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_projects_parent_pr;
ALTER TABLE projects DROP COLUMN IF EXISTS pr_comment_id;
ALTER TABLE projects DROP COLUMN IF EXISTS preview_enabled;
ALTER TABLE projects DROP COLUMN IF EXISTS pr_title;
ALTER TABLE projects DROP COLUMN IF EXISTS pr_number;
ALTER TABLE projects DROP COLUMN IF EXISTS parent_project_id;
