-- +goose Up
-- Prod had drifted to max_databases=1 for free while the pricing page (and
-- migration 022) promise 2. Restore the advertised allowance. Databases and
-- standalone services are now enforced as separate caps (code change in the
-- same release), matching how the pricing page sells them.
UPDATE plan_limits SET max_databases = 2 WHERE plan = 'free' AND max_databases < 2;

-- +goose Down
UPDATE plan_limits SET max_databases = 1 WHERE plan = 'free';
