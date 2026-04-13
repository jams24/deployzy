-- +goose Up
CREATE TABLE IF NOT EXISTS project_metrics (
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ts              TIMESTAMPTZ NOT NULL,
    cpu_pct         NUMERIC(6,2) NOT NULL DEFAULT 0,   -- 0.00 - 100.00
    memory_mb       INTEGER      NOT NULL DEFAULT 0,
    memory_limit_mb INTEGER      NOT NULL DEFAULT 0,
    net_rx_bytes    BIGINT       NOT NULL DEFAULT 0,
    net_tx_bytes    BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_project_metrics_ts ON project_metrics(ts);

-- +goose Down
DROP TABLE IF EXISTS project_metrics;
