-- +goose Up
-- Brand logos were keyed by template slug in the frontend, so adding a
-- template with a real logo required a code change and a deploy. logo_slug
-- decouples the two: set the brand from the admin UI and the frontend picks
-- it up immediately.
--
-- The value is a Simple Icons slug (simpleicons.org), which is also what the
-- bundled logo set is generated from. Empty = fall back to a lettermark.
ALTER TABLE templates ADD COLUMN IF NOT EXISTS logo_slug TEXT NOT NULL DEFAULT '';

-- Seed the existing curated templates so nothing regresses to lettermarks.
UPDATE templates SET logo_slug = 'n8n'         WHERE slug = 'n8n'                 AND logo_slug = '';
UPDATE templates SET logo_slug = 'telegram'    WHERE slug = 'telegram-bot-python' AND logo_slug = '';
UPDATE templates SET logo_slug = 'umami'       WHERE slug = 'umami-analytics'     AND logo_slug = '';
UPDATE templates SET logo_slug = 'vaultwarden' WHERE slug = 'vaultwarden'         AND logo_slug = '';
UPDATE templates SET logo_slug = 'uptimekuma'  WHERE slug = 'uptime-kuma'         AND logo_slug = '';
UPDATE templates SET logo_slug = 'ghost'       WHERE slug = 'ghost-blog'          AND logo_slug = '';
UPDATE templates SET logo_slug = 'discord'     WHERE slug = 'discord-bot-js'      AND logo_slug = '';

-- +goose Down
ALTER TABLE templates DROP COLUMN IF EXISTS logo_slug;
