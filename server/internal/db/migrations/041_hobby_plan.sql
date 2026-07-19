-- +goose Up
-- New $5/mo Hobby tier between Free and Pro — full feature set (TCP tunnels,
-- private repos, live logs, previews, release cmds, health checks, Telegram)
-- at indie-sized quotas. Upgrading to Pro buys capacity, not basic features.
INSERT INTO plan_limits (
    plan, max_subdomains, max_tunnels, max_rate,
    max_projects, max_custom_domains, max_databases, max_services, max_crons,
    max_byoc_servers, max_preview_deploys, max_memory_mb, max_cpus,
    max_bandwidth_gb, max_build_minutes_monthly,
    analytics_retention_days, metrics_retention_days, deploy_log_retention_days, backup_retention_days,
    allow_previews, allow_release_cmd, allow_health_checks, allow_private_repos,
    allow_tcp_tunnels, allow_custom_events, allow_live_logs, allow_telegram
) VALUES
    ('hobby', 8, 8, 250, 5, 2, 3, 3, 2, 2, 2, 1024, 0.50, 150, 300, 30, 3, 7, 3,
     true, true, true, true, true, true, true, true)
ON CONFLICT (plan) DO UPDATE SET
    max_subdomains = EXCLUDED.max_subdomains,
    max_tunnels = EXCLUDED.max_tunnels,
    max_rate = EXCLUDED.max_rate,
    max_projects = EXCLUDED.max_projects,
    max_custom_domains = EXCLUDED.max_custom_domains,
    max_databases = EXCLUDED.max_databases,
    max_services = EXCLUDED.max_services,
    max_crons = EXCLUDED.max_crons,
    max_byoc_servers = EXCLUDED.max_byoc_servers,
    max_preview_deploys = EXCLUDED.max_preview_deploys,
    max_memory_mb = EXCLUDED.max_memory_mb,
    max_cpus = EXCLUDED.max_cpus,
    max_bandwidth_gb = EXCLUDED.max_bandwidth_gb,
    max_build_minutes_monthly = EXCLUDED.max_build_minutes_monthly,
    analytics_retention_days = EXCLUDED.analytics_retention_days,
    allow_previews = EXCLUDED.allow_previews,
    allow_release_cmd = EXCLUDED.allow_release_cmd,
    allow_health_checks = EXCLUDED.allow_health_checks,
    allow_private_repos = EXCLUDED.allow_private_repos,
    allow_tcp_tunnels = EXCLUDED.allow_tcp_tunnels,
    allow_custom_events = EXCLUDED.allow_custom_events,
    allow_live_logs = EXCLUDED.allow_live_logs,
    allow_telegram = EXCLUDED.allow_telegram;

-- +goose Down
UPDATE users SET plan = 'free' WHERE plan = 'hobby';
DELETE FROM plan_limits WHERE plan = 'hobby';
