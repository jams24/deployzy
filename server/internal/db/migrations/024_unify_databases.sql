-- +goose Up
-- Unify the "database" concept: standalone services (managed Postgres, Redis,
-- etc) are the one surface users see from the dashboard. Project-attached
-- databases via /projects/{id}/database still exist for auto-DATABASE_URL
-- injection, but they now count against max_services too (consolidated cap).
--
-- Free gets 1, pro 10, team 50. max_databases is kept for backwards compat
-- but no longer advertised — consolidate on max_services.

UPDATE plan_limits SET max_services = 1,  max_databases = 0 WHERE plan = 'free';
UPDATE plan_limits SET max_services = 10, max_databases = 0 WHERE plan = 'pro';
UPDATE plan_limits SET max_services = 50, max_databases = 0 WHERE plan = 'team';

-- +goose Down
UPDATE plan_limits SET max_services = 0,  max_databases = 2  WHERE plan = 'free';
UPDATE plan_limits SET max_services = 5,  max_databases = 10 WHERE plan = 'pro';
UPDATE plan_limits SET max_services = 25, max_databases = 50 WHERE plan = 'team';
