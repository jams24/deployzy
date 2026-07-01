-- +goose Up
-- Multiple Services: deploy several directories from one repo as separate
-- services inside a single container. Stored as a JSON array on the project;
-- each entry has name, root_dir, port, install/build/start commands, detected
-- framework, and per-service env overrides. Empty array = single-service (default).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS services JSONB NOT NULL DEFAULT '[]';

-- +goose Down
ALTER TABLE projects DROP COLUMN IF EXISTS services;
