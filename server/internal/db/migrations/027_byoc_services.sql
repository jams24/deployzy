-- +goose Up
-- Allow standalone services (Postgres, Redis, etc) to be placed on a user's
-- BYOC server instead of only on the platform's shared Postgres. When
-- worker_server_id is set, the service runs as a Docker container on that
-- remote host; when null, it falls back to the shared platform Postgres.

ALTER TABLE services ADD COLUMN IF NOT EXISTS worker_server_id UUID REFERENCES worker_servers(id) ON DELETE SET NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS container_name TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS public_host     TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS public_port     INT;

-- +goose Down
ALTER TABLE services DROP COLUMN IF EXISTS public_port;
ALTER TABLE services DROP COLUMN IF EXISTS public_host;
ALTER TABLE services DROP COLUMN IF EXISTS container_name;
ALTER TABLE services DROP COLUMN IF EXISTS worker_server_id;
