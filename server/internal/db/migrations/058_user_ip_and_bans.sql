-- +goose Up
-- Capture where accounts sign up / sign in from, and add an IP ban list for
-- abuse control. Country comes from Cloudflare's CF-IPCountry header (2-letter
-- ISO); IPs are the client address (CF-Connecting-IP behind the proxy).
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_country   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at   TIMESTAMPTZ;

-- Banned IPs (or CIDR prefixes). Blocks signup/login and all proxied traffic.
CREATE TABLE IF NOT EXISTS ip_bans (
    ip         TEXT PRIMARY KEY,          -- exact IP or "1.2.3." prefix match
    reason     TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',  -- admin user id/email
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS signup_ip;
ALTER TABLE users DROP COLUMN IF EXISTS signup_country;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_ip;
ALTER TABLE users DROP COLUMN IF EXISTS last_country;
ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;
DROP TABLE IF EXISTS ip_bans;
