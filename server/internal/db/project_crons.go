package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// ProjectCron is a scheduled command run against a project's container image.
type ProjectCron struct {
	ID         string     `json:"id"`
	ProjectID  string     `json:"project_id"`
	Name       string     `json:"name"`
	Schedule   string     `json:"schedule"`
	Command    string     `json:"command"`
	Enabled    bool       `json:"enabled"`
	LastRunAt  *time.Time `json:"last_run_at"`
	LastStatus string     `json:"last_status"`
	LastOutput string     `json:"last_output"`
	CreatedAt  time.Time  `json:"created_at"`
}

const cronCols = `id, project_id, name, schedule, command, enabled, last_run_at, last_status, last_output, created_at`

func scanCron(scan func(dest ...any) error) (ProjectCron, error) {
	var c ProjectCron
	err := scan(&c.ID, &c.ProjectID, &c.Name, &c.Schedule, &c.Command, &c.Enabled, &c.LastRunAt, &c.LastStatus, &c.LastOutput, &c.CreatedAt)
	return c, err
}

func (d *DB) CreateCron(ctx context.Context, projectID, name, schedule, command string) (*ProjectCron, error) {
	c, err := scanCron(d.Pool.QueryRow(ctx,
		`INSERT INTO project_crons (project_id, name, schedule, command)
		 VALUES ($1, $2, $3, $4) RETURNING `+cronCols,
		projectID, name, schedule, command,
	).Scan)
	return &c, err
}

func (d *DB) ListCrons(ctx context.Context, projectID string) ([]ProjectCron, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT `+cronCols+` FROM project_crons WHERE project_id = $1 ORDER BY created_at DESC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProjectCron
	for rows.Next() {
		c, err := scanCron(rows.Scan)
		if err != nil {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

// ListAllEnabledCrons returns every enabled cron across all projects. Used by
// the scheduler to know what to check each tick.
func (d *DB) ListAllEnabledCrons(ctx context.Context) ([]ProjectCron, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT `+cronCols+` FROM project_crons WHERE enabled = true`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProjectCron
	for rows.Next() {
		c, err := scanCron(rows.Scan)
		if err != nil {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

func (d *DB) GetCron(ctx context.Context, id string) (*ProjectCron, error) {
	c, err := scanCron(d.Pool.QueryRow(ctx,
		`SELECT `+cronCols+` FROM project_crons WHERE id = $1`, id,
	).Scan)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &c, err
}

func (d *DB) UpdateCron(ctx context.Context, id, name, schedule, command string, enabled bool) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE project_crons SET name=$2, schedule=$3, command=$4, enabled=$5 WHERE id=$1`,
		id, name, schedule, command, enabled,
	)
	return err
}

func (d *DB) DeleteCron(ctx context.Context, id string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM project_crons WHERE id = $1`, id)
	return err
}

// RecordCronRun updates the bookkeeping fields after an execution attempt.
func (d *DB) RecordCronRun(ctx context.Context, id, status, output string) error {
	// Cap output at 2KB so one noisy cron can't blow up the row size.
	if len(output) > 2048 {
		output = output[:2048]
	}
	_, err := d.Pool.Exec(ctx,
		`UPDATE project_crons SET last_run_at=now(), last_status=$2, last_output=$3 WHERE id=$1`,
		id, status, output,
	)
	return err
}
