-- +goose Up
-- Accurate SEO/LLM aggregates. The original seo_daily counted every access-log
-- line — assets, redirects, 404 vulnerability probes, and scanners spoofing a
-- Google referrer — so "curl" looked like a top crawler and Google sign-in
-- redirects looked like search traffic. v2 counts only successful page views
-- (and crawler fetches of robots/sitemap/llms files) and keeps probes in their
-- own kind. Rebuilt from every retained log on first start (backfilled flag);
-- seo_daily is left untouched for reference.
--
-- kind: crawler  (channel ai|search|social|seo|monitoring|other)
--       referral (channel llm|search|social)  — humans from an external source
--       human    (channel pageview, name 'pageviews') — all human page views
--       probe    (channel scanner|script) — 4xx/5xx probing, generic clients
CREATE TABLE IF NOT EXISTS seo_daily2 (
    day      DATE   NOT NULL,
    kind     TEXT   NOT NULL,
    channel  TEXT   NOT NULL,
    name     TEXT   NOT NULL,
    hits     BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind, channel, name)
);
CREATE INDEX IF NOT EXISTS idx_seo_daily2_day ON seo_daily2(day DESC);

CREATE TABLE IF NOT EXISTS seo_ingest_state2 (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    log_offset  BIGINT  NOT NULL DEFAULT 0,
    log_inode   BIGINT  NOT NULL DEFAULT 0,
    backfilled  BOOLEAN NOT NULL DEFAULT false,
    since_day   DATE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seo_ingest_state2_singleton CHECK (id = 1)
);
INSERT INTO seo_ingest_state2 (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS seo_daily2;
DROP TABLE IF EXISTS seo_ingest_state2;
