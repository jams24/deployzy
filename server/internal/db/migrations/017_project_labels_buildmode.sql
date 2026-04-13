-- +goose Up
ALTER TABLE projects ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_mode TEXT NOT NULL DEFAULT 'auto';

-- GIN index on labels for fast tag filtering as projects scale
CREATE INDEX IF NOT EXISTS idx_projects_labels ON projects USING GIN (labels);

-- +goose Down
DROP INDEX IF EXISTS idx_projects_labels;
ALTER TABLE projects DROP COLUMN IF EXISTS labels;
ALTER TABLE projects DROP COLUMN IF EXISTS build_mode;
