-- +goose Up
CREATE TABLE IF NOT EXISTS site_events (
    id              BIGSERIAL PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    path            TEXT NOT NULL DEFAULT '',
    method          TEXT NOT NULL DEFAULT 'GET',
    status          INTEGER NOT NULL DEFAULT 0,
    bytes           INTEGER NOT NULL DEFAULT 0,
    referrer        TEXT NOT NULL DEFAULT '',   -- host only, not full URL (privacy + size)
    country         TEXT NOT NULL DEFAULT '',   -- 2-letter ISO code
    device          TEXT NOT NULL DEFAULT '',   -- desktop | mobile | tablet | bot
    browser         TEXT NOT NULL DEFAULT '',   -- chrome | safari | firefox | edge | other
    os              TEXT NOT NULL DEFAULT '',   -- windows | macos | linux | ios | android | other
    visitor_hash    TEXT NOT NULL DEFAULT '',   -- daily-rotating sha256(salt+ip+ua), cannot be linked across days
    is_bot          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_site_events_project_ts ON site_events(project_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_site_events_project_visitor ON site_events(project_id, visitor_hash);

-- +goose Down
DROP TABLE IF EXISTS site_events;
