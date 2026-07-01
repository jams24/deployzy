-- +goose Up
CREATE TABLE bandwidth_usage (
    project_id TEXT    NOT NULL,
    month      DATE    NOT NULL,
    bytes      BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, month)
);

-- +goose Down
DROP TABLE IF EXISTS bandwidth_usage;
