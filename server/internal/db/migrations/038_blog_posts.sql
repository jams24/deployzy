-- +goose Up
CREATE TABLE IF NOT EXISTS blog_posts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT        UNIQUE NOT NULL,
    title       TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    excerpt     TEXT        NOT NULL DEFAULT '',
    content     JSONB       NOT NULL DEFAULT '[]',
    cover_image TEXT,
    category    TEXT        NOT NULL DEFAULT 'General',
    tags        TEXT[]      NOT NULL DEFAULT '{}',
    author      TEXT        NOT NULL DEFAULT 'Deployzy Team',
    read_time   TEXT        NOT NULL DEFAULT '5 min read',
    status      TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    published_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug   ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);

-- +goose Down
DROP TABLE IF EXISTS blog_posts;
