package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// DatabaseBackup represents a backup of a project's managed database.
type DatabaseBackup struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	FileName  string    `json:"file_name"`
	FileSize  int64     `json:"file_size"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

// BackupSchedule holds the schedule config for a project database.
type BackupSchedule struct {
	Enabled   bool       `json:"enabled"`
	Schedule  string     `json:"schedule"`  // daily, weekly, every6h, every12h
	Time      string     `json:"time"`      // HH:MM (UTC)
	Retention int        `json:"retention"` // days to keep
	LastAt    *time.Time `json:"last_backup_at"`
}

// InsertBackupRecord inserts a backup tracking record.
func (d *DB) InsertBackupRecord(ctx context.Context, projectID, fileName string, fileSize int64) (*DatabaseBackup, error) {
	var b DatabaseBackup
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO database_backups (project_id, file_name, file_size)
		 VALUES ($1, $2, $3)
		 RETURNING id, project_id, file_name, file_size, status, created_at`,
		projectID, fileName, fileSize,
	).Scan(&b.ID, &b.ProjectID, &b.FileName, &b.FileSize, &b.Status, &b.CreatedAt)
	return &b, err
}

// ListBackups returns all backups for a project, newest first.
func (d *DB) ListBackups(ctx context.Context, projectID string) ([]DatabaseBackup, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, project_id, file_name, file_size, status, created_at
		 FROM database_backups WHERE project_id = $1 ORDER BY created_at DESC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var backups []DatabaseBackup
	for rows.Next() {
		var b DatabaseBackup
		rows.Scan(&b.ID, &b.ProjectID, &b.FileName, &b.FileSize, &b.Status, &b.CreatedAt)
		backups = append(backups, b)
	}
	return backups, nil
}

// DeleteBackupRecord removes a backup tracking record.
func (d *DB) DeleteBackupRecord(ctx context.Context, backupID, projectID string) error {
	_, err := d.Pool.Exec(ctx,
		`DELETE FROM database_backups WHERE id = $1 AND project_id = $2`,
		backupID, projectID,
	)
	return err
}

// GetBackupSchedule returns the backup schedule for a project database.
func (d *DB) GetBackupSchedule(ctx context.Context, projectID string) (*BackupSchedule, error) {
	var s BackupSchedule
	err := d.Pool.QueryRow(ctx,
		`SELECT backup_enabled, backup_schedule, backup_time, backup_retention, last_backup_at
		 FROM project_databases WHERE project_id = $1`,
		projectID,
	).Scan(&s.Enabled, &s.Schedule, &s.Time, &s.Retention, &s.LastAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

// UpdateBackupSchedule updates the backup schedule for a project database.
func (d *DB) UpdateBackupSchedule(ctx context.Context, projectID string, enabled bool, schedule, backupTime string, retention int) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE project_databases SET backup_enabled = $2, backup_schedule = $3, backup_time = $4, backup_retention = $5
		 WHERE project_id = $1`,
		projectID, enabled, schedule, backupTime, retention,
	)
	return err
}

// UpdateLastBackup updates the last backup timestamp.
func (d *DB) UpdateLastBackup(ctx context.Context, projectID string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE project_databases SET last_backup_at = now() WHERE project_id = $1`,
		projectID,
	)
	return err
}

// GetProjectsDueForBackup returns project databases that need a backup run.
func (d *DB) GetProjectsDueForBackup(ctx context.Context) ([]ProjectDatabase, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT pd.id, pd.project_id, pd.db_name, pd.db_user, pd.db_password, pd.host, pd.port, pd.created_at
		 FROM project_databases pd
		 WHERE pd.backup_enabled = true`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dbs []ProjectDatabase
	for rows.Next() {
		var pdb ProjectDatabase
		rows.Scan(&pdb.ID, &pdb.ProjectID, &pdb.DBName, &pdb.DBUser, &pdb.DBPassword, &pdb.Host, &pdb.Port, &pdb.CreatedAt)
		dbs = append(dbs, pdb)
	}
	return dbs, nil
}

// CleanOldBackups removes backup records older than retention days for a project.
func (d *DB) CleanOldBackups(ctx context.Context, projectID string, retentionDays int) ([]string, error) {
	rows, err := d.Pool.Query(ctx,
		`DELETE FROM database_backups WHERE project_id = $1 AND created_at < now() - ($2 || ' days')::interval RETURNING file_name`,
		projectID, retentionDays,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var fileNames []string
	for rows.Next() {
		var fn string
		rows.Scan(&fn)
		fileNames = append(fileNames, fn)
	}
	return fileNames, nil
}
