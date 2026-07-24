package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// DBMigration is a one-time database import job.
type DBMigration struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	SourceType      string     `json:"source_type"`
	SourceHost      string     `json:"source_host"`
	TargetServiceID *string    `json:"target_service_id"`
	Status          string     `json:"status"`
	Error           string     `json:"error"`
	Log             string     `json:"log"`
	CreatedAt       time.Time  `json:"created_at"`
	FinishedAt      *time.Time `json:"finished_at"`
}

// CreateDBMigration records a new import job in 'pending'.
func (d *DB) CreateDBMigration(ctx context.Context, userID, sourceType, sourceHost, targetServiceID string) (*DBMigration, error) {
	var m DBMigration
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO db_migrations (user_id, source_type, source_host, target_service_id, status)
		 VALUES ($1, $2, $3, $4, 'pending')
		 RETURNING id, user_id, source_type, source_host, target_service_id, status, error, log, created_at, finished_at`,
		userID, sourceType, sourceHost, targetServiceID,
	).Scan(&m.ID, &m.UserID, &m.SourceType, &m.SourceHost, &m.TargetServiceID, &m.Status, &m.Error, &m.Log, &m.CreatedAt, &m.FinishedAt)
	return &m, err
}

// SetDBMigrationRunning flips a job to running.
func (d *DB) SetDBMigrationRunning(ctx context.Context, id string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE db_migrations SET status = 'running' WHERE id = $1`, id)
	return err
}

// FinishDBMigration records the terminal state. status is 'success' or 'failed'.
func (d *DB) FinishDBMigration(ctx context.Context, id, status, errMsg, log string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE db_migrations SET status = $2, error = $3, log = $4, finished_at = now() WHERE id = $1`,
		id, status, errMsg, log)
	return err
}

// GetDBMigration returns a job by id, scoped to the owner.
func (d *DB) GetDBMigration(ctx context.Context, id, userID string) (*DBMigration, error) {
	var m DBMigration
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, source_type, source_host, target_service_id, status, error, log, created_at, finished_at
		 FROM db_migrations WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&m.ID, &m.UserID, &m.SourceType, &m.SourceHost, &m.TargetServiceID, &m.Status, &m.Error, &m.Log, &m.CreatedAt, &m.FinishedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &m, err
}

// ListDBMigrations returns a user's jobs, newest first.
func (d *DB) ListDBMigrations(ctx context.Context, userID string) ([]DBMigration, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, source_type, source_host, target_service_id, status, error, log, created_at, finished_at
		 FROM db_migrations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DBMigration
	for rows.Next() {
		var m DBMigration
		if err := rows.Scan(&m.ID, &m.UserID, &m.SourceType, &m.SourceHost, &m.TargetServiceID, &m.Status, &m.Error, &m.Log, &m.CreatedAt, &m.FinishedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// FailStuckDBMigrations marks any still-running jobs as failed. Called at
// startup so a job interrupted by a restart doesn't hang in 'running' forever.
func (d *DB) FailStuckDBMigrations(ctx context.Context) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE db_migrations SET status = 'failed', error = 'interrupted by server restart', finished_at = now()
		 WHERE status IN ('pending', 'running')`)
	return err
}
