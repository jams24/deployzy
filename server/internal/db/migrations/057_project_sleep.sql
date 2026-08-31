-- +goose Up
-- Idle sleep/wake for free-tier apps. An eligible project whose container has
-- received no HTTP traffic for a while is stopped (container kept, just not
-- running) to free real CPU/RAM; the next request wakes it via `docker start`.
--
--   sleep_enabled   – per-project opt-out (default on). Only *eligible* projects
--                     (free plan, platform-local, HTTP-serving) are ever slept.
--   sleeping        – true while the container is stopped for idleness. Survives
--                     restarts so the sweeper/proxy can rehydrate their state.
--   last_request_at – last time the proxy forwarded a request here. NULL means
--                     "never received HTTP" — which protects workers/bots that
--                     never get inbound requests from being slept.
--   slept_at        – when it was last put to sleep (for observability).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sleep_enabled   BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sleeping        BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_request_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slept_at        TIMESTAMPTZ;

-- +goose Down
ALTER TABLE projects DROP COLUMN IF EXISTS sleep_enabled;
ALTER TABLE projects DROP COLUMN IF EXISTS sleeping;
ALTER TABLE projects DROP COLUMN IF EXISTS last_request_at;
ALTER TABLE projects DROP COLUMN IF EXISTS slept_at;
