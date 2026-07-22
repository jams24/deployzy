-- +goose Up
-- is_bot tells you traffic was automated; bot_name tells you WHO — Googlebot
-- indexing vs GPTBot scraping are very different facts for a site owner.
-- Backfill isn't possible: the raw user agent is never stored (privacy), so
-- existing rows stay unclassified and the breakdown covers traffic from here on.
ALTER TABLE site_events ADD COLUMN IF NOT EXISTS bot_name TEXT NOT NULL DEFAULT '';

-- Partial index: bot rows are ~7% of the table, and the crawler breakdown only
-- ever queries those.
CREATE INDEX IF NOT EXISTS idx_site_events_bot_name
    ON site_events(bot_name, ts DESC) WHERE is_bot = true;

-- +goose Down
DROP INDEX IF EXISTS idx_site_events_bot_name;
ALTER TABLE site_events DROP COLUMN IF EXISTS bot_name;
