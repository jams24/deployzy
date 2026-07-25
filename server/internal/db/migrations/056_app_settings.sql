-- +goose Up
-- Generic key/value store for platform-wide settings the admin can edit at
-- runtime (no redeploy). First use: the TunnelTweak (TuTBot) reseller API
-- credentials that power the VPN panel — base URL + api key + shared server id.
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS app_settings;
