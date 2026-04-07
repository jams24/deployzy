-- +goose Up
CREATE TABLE IF NOT EXISTS worker_servers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = platform server, set = BYOC user server
    label           TEXT NOT NULL,
    host            TEXT NOT NULL,
    port            INT NOT NULL DEFAULT 22,
    ssh_user        TEXT NOT NULL DEFAULT 'root',
    ssh_password    TEXT,
    ssh_key         TEXT,
    region          TEXT NOT NULL DEFAULT 'default',
    total_cpu       NUMERIC(4,1) NOT NULL DEFAULT 2.0,
    total_memory_mb INT NOT NULL DEFAULT 4096,
    allocated_cpu   NUMERIC(4,1) NOT NULL DEFAULT 0,
    allocated_memory_mb INT NOT NULL DEFAULT 0,
    max_projects    INT NOT NULL DEFAULT 10,
    current_projects INT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active',  -- active, draining, offline
    last_heartbeat  TIMESTAMPTZ,
    docker_installed BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_servers_user ON worker_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_worker_servers_status ON worker_servers(status);

-- Link projects to their worker server
ALTER TABLE projects ADD COLUMN IF NOT EXISTS worker_server_id UUID REFERENCES worker_servers(id);

-- +goose Down
ALTER TABLE projects DROP COLUMN IF EXISTS worker_server_id;
DROP TABLE IF EXISTS worker_servers;
