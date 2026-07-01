package db

import "context"

// ServiceRoute maps a flat sibling subdomain to the host port a non-primary
// service of a multi-service project was published on. See migration 032.
type ServiceRoute struct {
	Subdomain   string
	ProjectID   string
	ServiceName string
	HostPort    int
}

// ReplaceServiceRoutes atomically swaps the set of routes for a project. Each
// deploy re-publishes services on fresh random host ports, so the whole set is
// replaced rather than merged. Passing an empty slice clears them.
func (d *DB) ReplaceServiceRoutes(ctx context.Context, projectID string, routes []ServiceRoute) error {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM service_routes WHERE project_id = $1`, projectID); err != nil {
		return err
	}
	for _, rt := range routes {
		if _, err := tx.Exec(ctx,
			`INSERT INTO service_routes (subdomain, project_id, service_name, host_port)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (subdomain) DO UPDATE SET
			   project_id = EXCLUDED.project_id,
			   service_name = EXCLUDED.service_name,
			   host_port = EXCLUDED.host_port`,
			rt.Subdomain, projectID, rt.ServiceName, rt.HostPort,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// DeleteServiceRoutes removes all service routes for a project (on stop/delete).
func (d *DB) DeleteServiceRoutes(ctx context.Context, projectID string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM service_routes WHERE project_id = $1`, projectID)
	return err
}
