-- +goose Up
-- Scoped API keys: read < deploy < full. Existing keys default to 'full' so no
-- behaviour change for keys created before this migration.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full';

-- +goose Down
ALTER TABLE api_keys DROP COLUMN IF EXISTS scope;
