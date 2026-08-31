-- +goose Up
-- Richer author identity for blog posts: a Twitter/X handle (drives the avatar
-- via unavatar.io), an optional role/title, and an optional avatar override.
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author_twitter TEXT NOT NULL DEFAULT '';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author_role    TEXT NOT NULL DEFAULT '';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author_avatar  TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE blog_posts DROP COLUMN IF EXISTS author_twitter;
ALTER TABLE blog_posts DROP COLUMN IF EXISTS author_role;
ALTER TABLE blog_posts DROP COLUMN IF EXISTS author_avatar;
