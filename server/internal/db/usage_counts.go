package db

import "context"

// Per-dimension count helpers used by the plan-limit enforcer. Each one is a
// single COUNT(*) — cheap, but called on every "create X" request so we
// keep them as lean as possible (no joins, indexed columns only).

func (d *DB) CountProjectsForUser(ctx context.Context, userID string) (int, error) {
	var n int
	// Excludes preview children — they don't count toward the project quota
	// because they're auto-managed by PR webhooks, not user-created.
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM projects WHERE user_id = $1 AND parent_project_id IS NULL`,
		userID,
	).Scan(&n)
	return n, err
}

func (d *DB) CountActivePreviewsForUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM projects WHERE user_id = $1 AND parent_project_id IS NOT NULL`,
		userID,
	).Scan(&n)
	return n, err
}

func (d *DB) CountServicesForUser(ctx context.Context, userID string) (int, error) {
	// Unified cap: standalone services + project-attached databases share the
	// same plan limit so users can't bypass by creating one of each.
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT
		   (SELECT COUNT(*) FROM services WHERE user_id = $1)
		 + (SELECT COUNT(*) FROM project_databases pdb
		    JOIN projects p ON p.id = pdb.project_id
		    WHERE p.user_id = $1 AND p.parent_project_id IS NULL)`, userID,
	).Scan(&n)
	return n, err
}

func (d *DB) CountProjectDatabasesForUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM project_databases pdb
		 JOIN projects p ON p.id = pdb.project_id
		 WHERE p.user_id = $1 AND p.parent_project_id IS NULL`,
		userID,
	).Scan(&n)
	return n, err
}

func (d *DB) CountCustomDomainsForUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM domains WHERE user_id = $1`, userID,
	).Scan(&n)
	return n, err
}

func (d *DB) CountCronsForUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM project_crons pc
		 JOIN projects p ON p.id = pc.project_id
		 WHERE p.user_id = $1`,
		userID,
	).Scan(&n)
	return n, err
}

func (d *DB) CountBYOCServersForUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM worker_servers WHERE user_id = $1`, userID,
	).Scan(&n)
	return n, err
}
