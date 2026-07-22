-- +goose Up
-- Build resources become plan levers instead of "whatever the host has spare".
--
-- max_build_memory_mb is a CEILING, not a reservation: the engine still takes
-- the smaller of (plan ceiling, host free RAM − reserve). Forcing 4 GB on a
-- host with 1 GB free would just OOM the build and its neighbours.
--
-- Defaults deliberately match today's behaviour (2048 everywhere) so no
-- existing user's build starts failing on deploy day; paid tiers get more
-- headroom and the admin can tune from the UI.
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS max_build_memory_mb INT NOT NULL DEFAULT 2048;

UPDATE plan_limits SET max_build_memory_mb = 2048 WHERE plan = 'free';
UPDATE plan_limits SET max_build_memory_mb = 2048 WHERE plan = 'hobby';
UPDATE plan_limits SET max_build_memory_mb = 3072 WHERE plan = 'pro';
UPDATE plan_limits SET max_build_memory_mb = 4096 WHERE plan = 'team';
UPDATE plan_limits SET max_build_memory_mb = -1   WHERE plan = 'admin';

-- Monthly build-minute usage. max_build_minutes_monthly has been advertised on
-- the pricing page since launch but nothing ever measured or enforced it.
CREATE TABLE IF NOT EXISTS build_usage (
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month    DATE NOT NULL,
    seconds  BIGINT NOT NULL DEFAULT 0,
    builds   INT    NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_build_usage_month ON build_usage(month DESC);

-- +goose Down
DROP TABLE IF EXISTS build_usage;
ALTER TABLE plan_limits DROP COLUMN IF EXISTS max_build_memory_mb;
