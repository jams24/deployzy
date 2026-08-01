-- +goose Up
-- Block (suspend) a user account: they can't sign in, deploy, or create
-- resources, but the account + data are preserved (unlike deletion). Used for
-- abuse handling alongside IP bans.
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at      TIMESTAMPTZ;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS blocked;
ALTER TABLE users DROP COLUMN IF EXISTS blocked_reason;
ALTER TABLE users DROP COLUMN IF EXISTS blocked_at;
