-- +goose Up
CREATE TABLE IF NOT EXISTS services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,  -- postgres, redis
    status          TEXT NOT NULL DEFAULT 'running',
    db_name         TEXT,
    db_user         TEXT,
    db_password     TEXT,
    host            TEXT NOT NULL DEFAULT '172.17.0.1',
    port            INT NOT NULL DEFAULT 5432,
    container_id    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_user ON services(user_id);

-- +goose Down
DROP TABLE IF EXISTS services;
