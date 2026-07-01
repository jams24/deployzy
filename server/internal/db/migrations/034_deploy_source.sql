-- +goose Up
-- Deploy source: where a project's container comes from.
--   'git'    → clone repo + build (default, existing behaviour)
--   'image'  → run a prebuilt image from a registry (image_ref), no build
--   'upload' → build from an uploaded directory tarball
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deploy_source TEXT NOT NULL DEFAULT 'git';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS image_ref     TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE projects DROP COLUMN IF EXISTS image_ref;
ALTER TABLE projects DROP COLUMN IF EXISTS deploy_source;
