-- +goose Up
-- seo_daily2 is a cache derived from the access logs. When the classifier
-- changes, the ingester compares this version with its own, clears the cache
-- and rebuilds it from every retained log.
ALTER TABLE seo_ingest_state2 ADD COLUMN IF NOT EXISTS classifier_version INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE seo_ingest_state2 DROP COLUMN IF EXISTS classifier_version;
