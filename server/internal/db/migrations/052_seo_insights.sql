-- +goose Up
-- SEO / LLM insight for our OWN site (deployzy.com). Fed by the Caddy access-log
-- ingester, which classifies each request's crawler UA and referrer. We store
-- only daily aggregates — no per-request rows, no IPs.
--
-- kind: 'crawler'  → a bot fetched a page (name = crawler, e.g. GPTBot; channel
--                     = ai|search|social|seo|monitoring|other)
--       'referral' → a human arrived from an external source (name = source,
--                     e.g. ChatGPT; channel = llm|search|social)
CREATE TABLE IF NOT EXISTS seo_daily (
    day      DATE   NOT NULL,
    kind     TEXT   NOT NULL,          -- crawler | referral
    channel  TEXT   NOT NULL,          -- ai|search|social|... (crawler) or llm|search|social (referral)
    name     TEXT   NOT NULL,          -- crawler name or referral source
    hits     BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind, channel, name)
);
CREATE INDEX IF NOT EXISTS idx_seo_daily_day ON seo_daily(day DESC);

-- Single-row ingest cursor so the log reader picks up where it left off across
-- restarts. inode + size let us detect rotation/truncation and reset the offset.
CREATE TABLE IF NOT EXISTS seo_ingest_state (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    log_offset  BIGINT  NOT NULL DEFAULT 0,
    log_inode   BIGINT  NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seo_ingest_state_singleton CHECK (id = 1)
);
INSERT INTO seo_ingest_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS seo_daily;
DROP TABLE IF EXISTS seo_ingest_state;
