-- +goose Up
-- Extend plan_limits to cover everything the platform now offers (deploys,
-- databases, custom domains, previews, scheduled jobs, BYOC, etc.).

ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_projects               INT NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_custom_domains         INT NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_databases              INT NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_services               INT NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_crons                  INT NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_byoc_servers           INT NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_preview_deploys        INT NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_memory_mb              INT NOT NULL DEFAULT 256;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_cpus                   NUMERIC(3,2) NOT NULL DEFAULT 0.25;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_bandwidth_gb           INT NOT NULL DEFAULT 50;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_build_minutes_monthly  INT NOT NULL DEFAULT 60;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS analytics_retention_days   INT NOT NULL DEFAULT 7;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS metrics_retention_days     INT NOT NULL DEFAULT 1;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS deploy_log_retention_days  INT NOT NULL DEFAULT 3;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS backup_retention_days      INT NOT NULL DEFAULT 0;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_previews             BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_release_cmd          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_health_checks        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_private_repos        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_tcp_tunnels          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_custom_events        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_live_logs            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS allow_telegram             BOOLEAN NOT NULL DEFAULT false;

-- Seed/replace the four real plans. -1 in any column means "unlimited" — admin
-- and the limit-check helper both treat it that way so we don't have to
-- special-case admin everywhere in code.
DELETE FROM plan_limits WHERE plan IN ('free', 'premium', 'pro', 'team', 'admin');

INSERT INTO plan_limits (
    plan, max_subdomains, max_tunnels, max_rate,
    max_projects, max_custom_domains, max_databases, max_services, max_crons,
    max_byoc_servers, max_preview_deploys, max_memory_mb, max_cpus,
    max_bandwidth_gb, max_build_minutes_monthly,
    analytics_retention_days, metrics_retention_days, deploy_log_retention_days, backup_retention_days,
    allow_previews, allow_release_cmd, allow_health_checks, allow_private_repos,
    allow_tcp_tunnels, allow_custom_events, allow_live_logs, allow_telegram
) VALUES
    ('free',  5,  5,  100,  3, 1,  2, 0, 0,  1, 0,  256, 0.25,   50,    60,   7, 1,  3, 0, false, false, false, false, false, false, false, false),
    ('pro',  10, 15,  500, 10, 5, 10, 5, 5,  5, 5, 1024, 1.00,  500,   600,  90, 7, 14, 7, true,  true,  true,  true,  true,  true,  true,  true ),
    ('team', 50, 50, 2000, 50, 25,50, 25,25, 15,25, 8192, 4.00, 1024,  1800, 365,30, 30,30, true,  true,  true,  true,  true,  true,  true,  true ),
    ('admin', -1, -1, -1,  -1, -1, -1, -1, -1, -1,-1,   -1,   -1,   -1,    -1,  -1,-1,-1,-1, true,  true,  true,  true,  true,  true,  true,  true );

-- Migrate existing users from the old 'premium' to the new 'pro' tier so they
-- aren't suddenly downgraded mid-flight.
UPDATE users SET plan = 'pro' WHERE plan = 'premium';

-- New users default to free going forward. (Old default was 'premium'.)
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'free';

-- +goose Down
-- Restore the premium → pro mapping for any rolled back deploys.
UPDATE users SET plan = 'premium' WHERE plan = 'pro';
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'premium';

ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_telegram;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_live_logs;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_custom_events;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_tcp_tunnels;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_private_repos;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_health_checks;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_release_cmd;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS allow_previews;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS backup_retention_days;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS deploy_log_retention_days;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS metrics_retention_days;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS analytics_retention_days;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_build_minutes_monthly;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_bandwidth_gb;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_cpus;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_memory_mb;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_preview_deploys;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_byoc_servers;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_crons;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_services;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_databases;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_custom_domains;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_projects;
