-- +goose Up
-- Let users pick which platform server (region) their project deploys to,
-- instead of the scheduler always auto-assigning. user_selectable controls
-- whether a server appears in that picker — separate from status so an admin
-- can, e.g., keep the busy primary active as an auto-fallback but hide it from
-- self-serve selection, or offer a fast new box without making it the default.
ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS user_selectable BOOLEAN NOT NULL DEFAULT true;

-- The local primary stays available but is not offered by default — new users
-- shouldn't pile onto the control-plane host unless the admin opts it in.
UPDATE worker_servers SET user_selectable = false WHERE COALESCE(is_local, false) = true;

-- +goose Down
ALTER TABLE worker_servers DROP COLUMN IF EXISTS user_selectable;
