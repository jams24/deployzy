-- +goose Up
-- Daily rollups of site_events. Two jobs:
--
--  1. Speed — the admin analytics tab scans the whole raw table for long
--     windows (258K rows and growing); rollups reduce that to ~1 row per
--     project per day.
--  2. Honesty — raw events are pruned per the owner's plan (free = 7 days),
--     so long-window charts silently under-represent free projects. The
--     rollup job runs BEFORE the pruner, so aggregate history survives even
--     though the raw rows don't.
--
-- visitors is DAILY-distinct. Summing it across days counts a returning
-- visitor once per day they appeared; queries spanning multiple days must
-- present it as visits, not unique people.
CREATE TABLE IF NOT EXISTS site_events_daily (
    day         DATE   NOT NULL,
    project_id  UUID   NOT NULL,
    pageviews   BIGINT NOT NULL DEFAULT 0,
    visitors    BIGINT NOT NULL DEFAULT 0,
    bot_hits    BIGINT NOT NULL DEFAULT 0,
    bytes       BIGINT NOT NULL DEFAULT 0,
    error_hits  BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, project_id)
);

CREATE INDEX IF NOT EXISTS idx_site_events_daily_day ON site_events_daily(day DESC);

-- Per-crawler daily rollup, kept separate so the main table stays one row per
-- project/day rather than exploding by bot name.
CREATE TABLE IF NOT EXISTS site_bots_daily (
    day        DATE   NOT NULL,
    bot_name   TEXT   NOT NULL,
    hits       BIGINT NOT NULL DEFAULT 0,
    sites      BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, bot_name)
);

-- Backfill everything currently in site_events so the tab has history from
-- day one rather than starting empty.
INSERT INTO site_events_daily (day, project_id, pageviews, visitors, bot_hits, bytes, error_hits)
SELECT (ts AT TIME ZONE 'UTC')::date,
       project_id,
       COUNT(*) FILTER (WHERE is_bot = false),
       COUNT(DISTINCT visitor_hash) FILTER (WHERE is_bot = false),
       COUNT(*) FILTER (WHERE is_bot = true),
       COALESCE(SUM(bytes), 0),
       COUNT(*) FILTER (WHERE status >= 400)
FROM site_events
GROUP BY 1, 2
ON CONFLICT (day, project_id) DO NOTHING;

INSERT INTO site_bots_daily (day, bot_name, hits, sites)
SELECT (ts AT TIME ZONE 'UTC')::date,
       CASE WHEN bot_name = '' THEN 'Unclassified' ELSE bot_name END,
       COUNT(*),
       COUNT(DISTINCT project_id)
FROM site_events
WHERE is_bot = true
GROUP BY 1, 2
ON CONFLICT (day, bot_name) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS site_bots_daily;
DROP TABLE IF EXISTS site_events_daily;
