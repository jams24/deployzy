-- +goose Up
-- Re-tier managed-database storage caps. Free gets 1 GB; paid tiers scale up.
-- Enforced (soft cap: writes revoked when over) by DBQuotaSweeper on Postgres
-- services. -1 = unlimited.
UPDATE plan_limits SET max_db_size_mb =  1024 WHERE plan = 'free';   -- 1 GB
UPDATE plan_limits SET max_db_size_mb =  5120 WHERE plan = 'hobby';  -- 5 GB
UPDATE plan_limits SET max_db_size_mb = 10240 WHERE plan = 'pro';    -- 10 GB
UPDATE plan_limits SET max_db_size_mb = 51200 WHERE plan = 'team';   -- 50 GB
UPDATE plan_limits SET max_db_size_mb =    -1 WHERE plan = 'admin';  -- unlimited

-- +goose Down
UPDATE plan_limits SET max_db_size_mb = 500 WHERE plan IN ('free', 'hobby');
