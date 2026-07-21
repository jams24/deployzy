-- +goose Up
-- Measured live metrics, refreshed by the heartbeat monitor every 2 minutes.
-- Distinct from allocated_* (sum of the limits projects REQUESTED, which can
-- legitimately exceed the host — limits are caps, not reservations). The
-- admin/servers UIs were rendering allocation as if it were live usage,
-- producing nonsense like "RAM 268%".
ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS used_memory_mb INT NOT NULL DEFAULT 0;
ALTER TABLE worker_servers ADD COLUMN IF NOT EXISTS load_avg NUMERIC(6,2) NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE worker_servers DROP COLUMN IF EXISTS load_avg;
ALTER TABLE worker_servers DROP COLUMN IF EXISTS used_memory_mb;
