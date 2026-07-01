-- +goose Up
-- Routing table for multi-service projects. Each non-primary service runs in the
-- project's container on its own port and is reachable at a flat sibling
-- subdomain (<projectsub>-<servicename>). The proxy resolves a hostname by its
-- first DNS label, so these single-label subdomains are looked up here and
-- mapped to the host port the service was published on during the last deploy.
CREATE TABLE IF NOT EXISTS service_routes (
    subdomain    TEXT PRIMARY KEY,
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    service_name TEXT NOT NULL,
    host_port    INT  NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_routes_project ON service_routes(project_id);

-- +goose Down
DROP TABLE IF EXISTS service_routes;
