-- +goose Up

CREATE TABLE IF NOT EXISTS templates (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT        UNIQUE NOT NULL,
    name         TEXT        NOT NULL,
    tagline      TEXT        NOT NULL DEFAULT '',
    description  TEXT        NOT NULL DEFAULT '',
    category     TEXT        NOT NULL DEFAULT 'other',
    tags         TEXT[]      NOT NULL DEFAULT '{}',
    icon         TEXT        NOT NULL DEFAULT '📦',
    color        TEXT        NOT NULL DEFAULT '#6366f1',
    source_repo  TEXT,
    docker_image TEXT,
    env_vars     JSONB       NOT NULL DEFAULT '[]',
    ports        INT[]       NOT NULL DEFAULT '{}',
    min_memory_mb INT        NOT NULL DEFAULT 256,
    post_deploy  TEXT        NOT NULL DEFAULT '',
    is_official  BOOLEAN     NOT NULL DEFAULT false,
    is_featured  BOOLEAN     NOT NULL DEFAULT false,
    is_active    BOOLEAN     NOT NULL DEFAULT true,
    deploy_count INT         NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_stars (
    template_id UUID        NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (template_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_templates_slug     ON templates(slug);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_active   ON templates(is_active);
CREATE INDEX IF NOT EXISTS idx_template_stars_tid ON template_stars(template_id);

-- Telegram Bot starter
INSERT INTO templates (slug, name, tagline, description, category, tags, icon, color, source_repo, env_vars, ports, min_memory_mb, post_deploy, is_official, is_featured)
VALUES (
  'telegram-bot-python',
  'Telegram Bot',
  'Deploy a Python Telegram bot in 60 seconds',
  'A production-ready Python Telegram bot using the python-telegram-bot v20 library. Supports commands, message handlers, inline keyboards, and webhook mode out of the box.',
  'bots',
  ARRAY['telegram','python','bot','webhook'],
  '🤖',
  '#2AABEE',
  'https://github.com/deployzy-templates/telegram-bot-python',
  '[
    {"key":"BOT_TOKEN","label":"Bot Token","description":"Get this from @BotFather on Telegram. Send /newbot and copy the token.","required":true,"type":"secret","placeholder":"1234567890:ABCdef..."},
    {"key":"BOT_USERNAME","label":"Bot Username","description":"Your bot username without the @ symbol (e.g. mybot)","required":true,"type":"text","placeholder":"myawesomebot"},
    {"key":"WEBHOOK_SECRET","label":"Webhook Secret","description":"A random secret string to validate incoming webhook requests. We generate one for you.","required":false,"type":"secret","placeholder":"auto-generated","default":"__AUTO__"}
  ]'::jsonb,
  ARRAY[8080],
  256,
  E'## Your Telegram Bot is live! 🎉\n\n**Set the webhook URL** so Telegram sends messages to your bot:\n\n```\nhttps://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url=https://{subdomain}.deployzy.com/webhook\n```\n\nReplace `{BOT_TOKEN}` with your token and `{subdomain}` with your app subdomain.\n\n**Test it:** Open Telegram, search for your bot by username, and send `/start`.\n\n**Customise:** Edit `bot.py` in your repo to add commands and handlers, then push to redeploy automatically.',
  true,
  true
);

-- n8n workflow automation
INSERT INTO templates (slug, name, tagline, description, category, tags, icon, color, docker_image, env_vars, ports, min_memory_mb, post_deploy, is_official, is_featured)
VALUES (
  'n8n',
  'n8n Automation',
  'Self-host your own Zapier/Make for free',
  'n8n is a powerful workflow automation tool with 400+ integrations. Connect APIs, databases, and services without code. Self-hosting saves $50+/month vs the cloud plan.',
  'automation',
  ARRAY['n8n','automation','workflow','nocode'],
  '⚡',
  '#EA4B71',
  'n8nio/n8n:latest',
  '[
    {"key":"N8N_BASIC_AUTH_ACTIVE","label":"Enable Password Protection","description":"Protect your n8n instance with a username/password","required":false,"type":"select","options":["true","false"],"default":"true"},
    {"key":"N8N_BASIC_AUTH_USER","label":"Username","description":"Admin username for n8n login","required":true,"type":"text","placeholder":"admin","default":"admin"},
    {"key":"N8N_BASIC_AUTH_PASSWORD","label":"Password","description":"Admin password — make it strong!","required":true,"type":"secret","placeholder":"strong-password-here"},
    {"key":"N8N_HOST","label":"Host","description":"Your app domain (auto-filled after deploy)","required":false,"type":"auto","default":""},
    {"key":"WEBHOOK_URL","label":"Webhook Base URL","description":"Public URL of your n8n instance (auto-filled)","required":false,"type":"auto","default":""}
  ]'::jsonb,
  ARRAY[5678],
  512,
  E'## n8n is running! ⚡\n\nOpen your app URL and log in with the username/password you set.\n\n**Important:** Go to **Settings → General** and set your **Webhook URL** to:\n```\nhttps://{subdomain}.deployzy.com\n```\n\nThis enables webhooks from external services to reach your workflows.\n\n**Persistent data:** n8n stores workflows in memory by default. For production, connect a PostgreSQL database via env vars `DB_TYPE=postgresdb` and the connection details.',
  true,
  true
);

-- Uptime Kuma
INSERT INTO templates (slug, name, tagline, description, category, tags, icon, color, docker_image, env_vars, ports, min_memory_mb, post_deploy, is_official, is_featured)
VALUES (
  'uptime-kuma',
  'Uptime Kuma',
  'Self-hosted uptime monitor with a beautiful dashboard',
  'Monitor your websites, APIs, and services with real-time alerts. Supports HTTP, TCP, ping, DNS, and more. Beautiful status pages included.',
  'monitoring',
  ARRAY['monitoring','uptime','status-page','devops'],
  '📊',
  '#5CDD8B',
  'louislam/uptime-kuma:1',
  '[
    {"key":"UPTIME_KUMA_PORT","label":"Port","description":"Internal port to run on","required":false,"type":"text","default":"3001","placeholder":"3001"}
  ]'::jsonb,
  ARRAY[3001],
  256,
  E'## Uptime Kuma is live! 📊\n\nVisit your app URL and **create an admin account** on first launch.\n\n**Add your first monitor:** Click **+ Add New Monitor**, choose HTTP(s), and enter the URL you want to watch.\n\n**Status page:** Go to **Status Pages** to create a public status page you can share with your users.',
  true,
  false
);

-- Ghost Blog
INSERT INTO templates (slug, name, tagline, description, category, tags, icon, color, docker_image, env_vars, ports, min_memory_mb, post_deploy, is_official, is_featured)
VALUES (
  'ghost-blog',
  'Ghost Blog',
  'Professional publishing platform — blog + newsletter',
  'Ghost is a powerful open-source publishing platform used by millions. Write, publish, and grow a paid newsletter audience. Self-hosting saves $25-$199/month vs Ghost Pro.',
  'cms',
  ARRAY['blog','newsletter','cms','publishing'],
  '👻',
  '#FF1A75',
  'ghost:5-alpine',
  '[
    {"key":"url","label":"Site URL","description":"The full public URL of your Ghost site (auto-filled)","required":false,"type":"auto","default":""},
    {"key":"NODE_ENV","label":"Environment","description":"Run in production mode","required":false,"type":"text","default":"production"},
    {"key":"database__client","label":"Database","description":"Database type — SQLite for simple setups","required":false,"type":"text","default":"sqlite3"},
    {"key":"mail__transport","label":"Mail Transport","description":"Set to SMTP and configure below to send emails","required":false,"type":"select","options":["Direct","SMTP"],"default":"Direct"}
  ]'::jsonb,
  ARRAY[2368],
  512,
  E'## Ghost is running! 👻\n\nVisit `{url}/ghost` to set up your admin account.\n\n**Custom domain:** Add your domain in **Settings → General** and configure DNS.\n\n**Email newsletters:** Go to **Settings → Email** and connect an email provider (Mailgun or Brevo work well).\n\n**Note:** For production Ghost, we recommend adding a persistent volume for the SQLite database so data survives redeployments.',
  true,
  false
);

-- Umami Analytics
INSERT INTO templates (slug, name, tagline, description, category, tags, icon, color, docker_image, env_vars, ports, min_memory_mb, post_deploy, is_official, is_featured)
VALUES (
  'umami-analytics',
  'Umami Analytics',
  'Privacy-first Google Analytics alternative',
  'Simple, fast, privacy-focused website analytics. No cookies, no GDPR headaches. Get pageviews, visitors, referrers, and devices — all in one clean dashboard.',
  'analytics',
  ARRAY['analytics','privacy','gdpr','stats'],
  '📈',
  '#6366F1',
  'ghcr.io/umami-software/umami:postgresql-latest',
  '[
    {"key":"DATABASE_URL","label":"PostgreSQL URL","description":"Connection string for your PostgreSQL database. Add a Deployzy Postgres service and paste the URL here.","required":true,"type":"secret","placeholder":"postgresql://user:pass@host:5432/umami"},
    {"key":"APP_SECRET","label":"App Secret","description":"Random secret for session signing — generate a long random string","required":true,"type":"secret","placeholder":"random-long-secret"}
  ]'::jsonb,
  ARRAY[3000],
  256,
  E'## Umami Analytics is live! 📈\n\n**Default login:** Username `admin`, Password `umami` — **change this immediately** in Settings.\n\n**Add your website:** Go to **Settings → Websites → Add website** and enter your site URL.\n\n**Install the tracker:** Copy the tracking script and add it to your website''s `<head>`.\n\n**Share:** Create a public share link for your analytics dashboard under Settings → Share.',
  true,
  false
);

-- Discord Bot
INSERT INTO templates (slug, name, tagline, description, category, tags, icon, color, source_repo, env_vars, ports, min_memory_mb, post_deploy, is_official, is_featured)
VALUES (
  'discord-bot-js',
  'Discord Bot',
  'Deploy a Discord bot with slash commands',
  'A Node.js Discord bot built with discord.js v14. Includes slash command registration, event handlers, and a clean project structure ready to extend.',
  'bots',
  ARRAY['discord','bot','nodejs','javascript'],
  '🎮',
  '#5865F2',
  'https://github.com/deployzy-templates/discord-bot-js',
  '[
    {"key":"DISCORD_TOKEN","label":"Bot Token","description":"From the Discord Developer Portal → Your App → Bot → Token","required":true,"type":"secret","placeholder":"your-bot-token"},
    {"key":"CLIENT_ID","label":"Application ID","description":"From the Discord Developer Portal → Your App → General → Application ID","required":true,"type":"text","placeholder":"1234567890"},
    {"key":"GUILD_ID","label":"Test Server ID (optional)","description":"For faster slash command sync during development. Leave empty for global commands.","required":false,"type":"text","placeholder":"your-server-id"}
  ]'::jsonb,
  ARRAY[3000],
  256,
  E'## Discord Bot is deploying! 🎮\n\n**Invite your bot:** Use this URL (replace CLIENT_ID):\n```\nhttps://discord.com/api/oauth2/authorize?client_id={CLIENT_ID}&permissions=8&scope=bot%20applications.commands\n```\n\n**Slash commands:** After the bot joins your server, commands register automatically on startup.\n\n**Extend:** Clone your repo and edit `src/commands/` to add new slash commands. Push to redeploy.',
  true,
  false
);

-- Vaultwarden (Bitwarden)
INSERT INTO templates (slug, name, tagline, description, category, tags, icon, color, docker_image, env_vars, ports, min_memory_mb, post_deploy, is_official, is_featured)
VALUES (
  'vaultwarden',
  'Vaultwarden',
  'Self-host your own Bitwarden password manager',
  'Vaultwarden is an unofficial Bitwarden server implementation. Use all official Bitwarden apps (iOS, Android, browser extensions) with your own self-hosted backend.',
  'security',
  ARRAY['passwords','bitwarden','security','self-hosted'],
  '🔐',
  '#175DDC',
  'vaultwarden/server:latest',
  '[
    {"key":"DOMAIN","label":"Your Domain","description":"Full HTTPS URL of your Vaultwarden instance (auto-filled)","required":false,"type":"auto","default":""},
    {"key":"SIGNUPS_ALLOWED","label":"Allow Signups","description":"Set to false after creating your account to prevent others from registering","required":false,"type":"select","options":["true","false"],"default":"true"},
    {"key":"ADMIN_TOKEN","label":"Admin Panel Token","description":"Secret token to access the /admin panel. Generate a strong random string.","required":false,"type":"secret","placeholder":"strong-random-token"}
  ]'::jsonb,
  ARRAY[80],
  256,
  E'## Vaultwarden is live! 🔐\n\n**Important — disable signups after setup:**\n1. Register your account first\n2. Set `SIGNUPS_ALLOWED=false` in env vars and redeploy\n\n**Connect Bitwarden apps:** In any Bitwarden client, go to Settings → Server URL and enter your app URL.\n\n**Admin panel:** Visit `{url}/admin` and use your ADMIN_TOKEN to manage the instance.',
  true,
  false
);

-- +goose Down
DROP TABLE IF EXISTS template_stars;
DROP TABLE IF EXISTS templates;
