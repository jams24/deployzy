-- +goose Up
-- Custom domains are now checked automatically in the background until their
-- DNS points at us. Remember when we last looked and what we found, so the
-- dashboard can say "checked 1 min ago: the record is proxied by Cloudflare"
-- instead of making the user click Verify and read an alert.
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS check_hint      TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE domains DROP COLUMN IF EXISTS last_checked_at;
ALTER TABLE domains DROP COLUMN IF EXISTS check_hint;
