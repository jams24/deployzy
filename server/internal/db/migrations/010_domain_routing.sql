-- +goose Up
ALTER TABLE domains ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT '';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS target_subdomain TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_domains_verified_lookup ON domains(domain) WHERE verified = true AND target_subdomain != '';

-- +goose Down
DROP INDEX IF EXISTS idx_domains_verified_lookup;
ALTER TABLE domains DROP COLUMN IF EXISTS target_subdomain;
ALTER TABLE domains DROP COLUMN IF EXISTS target_type;
