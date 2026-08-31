-- +goose Up
-- Platform-wide analytics filters on ts alone (no project_id), which the
-- existing (project_id, ts) index can't serve efficiently — Postgres would
-- fall back to a full scan of site_events on every admin page load.
-- CONCURRENTLY so building it doesn't lock writes from the analytics collector.

-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_site_events_ts ON site_events(ts DESC);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_site_events_ts;
