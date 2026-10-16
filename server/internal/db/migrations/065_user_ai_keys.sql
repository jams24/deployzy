-- +goose Up
-- Per-user "bring your own key" (BYOK) for the AI builder / agent. One key per
-- provider per user. When a user has a key, their AI calls use it (and bypass
-- credit metering — they pay the provider directly). Stored server-side; never
-- returned in full to the client.
CREATE TABLE IF NOT EXISTS user_ai_keys (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider   TEXT NOT NULL,       -- deepseek|openai|anthropic|xai|google|moonshot|…
    api_key    TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider)
);

-- +goose Down
DROP TABLE IF EXISTS user_ai_keys;
