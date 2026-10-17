-- +goose Up
-- An admin-set project ceiling for a server. The primary's max_projects is
-- otherwise recomputed from RAM on every startup, which silently overwrote any
-- value typed into the admin console. When manual is true, startup leaves it.
ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS max_projects_manual BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE worker_servers DROP COLUMN IF EXISTS max_projects_manual;
