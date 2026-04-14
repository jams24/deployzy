-- +goose Up
-- GitHub tokens expire (user OAuth: 8h, app installation: 1h) but we weren't
-- tracking when. Add expiry columns so the refresh helper can check ahead.
ALTER TABLE github_connections ADD COLUMN IF NOT EXISTS access_token_expires_at  TIMESTAMPTZ;
ALTER TABLE github_connections ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE github_connections DROP COLUMN IF EXISTS refresh_token_expires_at;
ALTER TABLE github_connections DROP COLUMN IF EXISTS access_token_expires_at;
