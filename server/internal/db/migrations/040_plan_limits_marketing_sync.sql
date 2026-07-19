-- +goose Up
-- Reconcile plan_limits with what the marketing/pricing page promises.
-- Direction: always the MORE generous of the two values, so nobody who
-- signed up under either claim is downgraded.
--
--   free: page said 512 MB RAM / 120 build min / 1 standalone service,
--         DB enforced 256 MB / 60 min / 0 services → raise DB.
--         (DB already allows 2 databases vs page's 1 — page copy updated.)
--   pro:  page said 10 services, DB enforced 5 → raise DB.

UPDATE plan_limits SET
    max_memory_mb             = 512,
    max_build_minutes_monthly = 120,
    max_services              = 1
WHERE plan = 'free';

UPDATE plan_limits SET
    max_services = 10
WHERE plan = 'pro';

-- +goose Down
UPDATE plan_limits SET
    max_memory_mb             = 256,
    max_build_minutes_monthly = 60,
    max_services              = 0
WHERE plan = 'free';

UPDATE plan_limits SET
    max_services = 5
WHERE plan = 'pro';
