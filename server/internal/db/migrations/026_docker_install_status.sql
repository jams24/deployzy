-- +goose Up
-- Track async Docker-install state so the UI can show progress and we don't
-- lose track of an install that outlived a browser tab.

ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS docker_install_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS docker_install_error  TEXT;
ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS docker_install_started_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE worker_servers DROP COLUMN IF EXISTS docker_install_started_at;
ALTER TABLE worker_servers DROP COLUMN IF EXISTS docker_install_error;
ALTER TABLE worker_servers DROP COLUMN IF EXISTS docker_install_status;
