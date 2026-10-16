-- +goose Up
-- History of CLI tunnel sessions (one row per authenticated control
-- connection). The live registry forgets a client the moment it disconnects;
-- this lets admins answer "who opened tunnels today, from where, for how long,
-- and how much traffic did they push".
CREATE TABLE IF NOT EXISTS tunnel_sessions (
    id              BIGSERIAL PRIMARY KEY,
    client_id       TEXT        NOT NULL,
    user_id         UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
    remote_ip       TEXT        NOT NULL DEFAULT '',
    client_version  TEXT        NOT NULL DEFAULT '',
    os              TEXT        NOT NULL DEFAULT '',
    connected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    disconnected_at TIMESTAMPTZ NULL,
    tunnel_urls     TEXT[]      NOT NULL DEFAULT '{}',
    requests        BIGINT      NOT NULL DEFAULT 0,
    bytes_in        BIGINT      NOT NULL DEFAULT 0,
    bytes_out       BIGINT      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tunnel_sessions_connected_at ON tunnel_sessions (connected_at DESC);
CREATE INDEX IF NOT EXISTS idx_tunnel_sessions_user ON tunnel_sessions (user_id, connected_at DESC);

-- +goose Down
DROP TABLE IF EXISTS tunnel_sessions;
