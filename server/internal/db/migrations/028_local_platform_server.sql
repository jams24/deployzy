-- +goose Up
-- Make the platform's own host part of the worker_servers pool so allocation
-- tracking + the overflow scheduler include it. priority lets us model
-- "primary fills first, overflow second" without changing handler code.

ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100;
ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS is_local BOOLEAN NOT NULL DEFAULT false;

-- Idempotent self-registration. Capacity values are placeholders — the server
-- updates them to real probe values (nproc / /proc/meminfo) on every startup.
INSERT INTO worker_servers
    (label, host, port, ssh_user, ssh_password, region, total_cpu, total_memory_mb,
     max_projects, status, docker_installed, priority, is_local, user_id)
SELECT 'serverme-prod', 'localhost', 22, 'root', '', 'primary',
       1, 1024, 1000, 'active', true, 1, true, NULL
WHERE NOT EXISTS (SELECT 1 FROM worker_servers WHERE is_local = true);

-- Backfill: projects without an assigned server are running on local Docker
-- today, so point them at the new local row. Narrow WHERE — only projects
-- with NULL worker_server_id are touched; BYOC (user_id-owned) projects
-- always have worker_server_id set by the original deploy path, so they're
-- untouched.
WITH local_srv AS (SELECT id FROM worker_servers WHERE is_local = true LIMIT 1)
UPDATE projects SET worker_server_id = (SELECT id FROM local_srv)
WHERE worker_server_id IS NULL;

-- +goose Down
-- Detach projects from the local row so we can drop it cleanly.
WITH local_srv AS (SELECT id FROM worker_servers WHERE is_local = true LIMIT 1)
UPDATE projects SET worker_server_id = NULL
WHERE worker_server_id = (SELECT id FROM local_srv);

DELETE FROM worker_servers WHERE is_local = true;

ALTER TABLE worker_servers DROP COLUMN IF EXISTS is_local;
ALTER TABLE worker_servers DROP COLUMN IF EXISTS priority;
