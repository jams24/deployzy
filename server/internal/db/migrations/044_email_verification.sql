-- +goose Up
-- Email verification for password signups. Google OAuth users are verified
-- implicitly (Google already proved mailbox ownership). Existing users are
-- grandfathered in as verified.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_code_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_attempts INT NOT NULL DEFAULT 0;

UPDATE users SET email_verified = true;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS verify_attempts;
ALTER TABLE users DROP COLUMN IF EXISTS verify_code_expires_at;
ALTER TABLE users DROP COLUMN IF EXISTS verify_code_hash;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified;
