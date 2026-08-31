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

// BackupTarget describes WHERE a database lives so the scheduler knows how to
// dump it: locally (main server) or by SSH-ing into the worker that hosts it.
type BackupTarget struct {
	Found          bool
	ServerID       string
	IsLocal        bool
	BackupsEnabled bool
	SSHUser        string
	SSHPassword    string
	SSHKey         string
	SSHHost        string
	SSHPort        int
}

// GetBackupTarget resolves the worker server that hosts a database (matched by
// the database's connection host against a server's host or service_host). If no
// server matches, the database is treated as local to the main server.
func (d *DB) GetBackupTarget(ctx context.Context, dbHost string) (*BackupTarget, error) {
	var t BackupTarget
	err := d.Pool.QueryRow(ctx,
		`SELECT id, COALESCE(is_local,false), COALESCE(backups_enabled,true),
		        COALESCE(ssh_user,'root'), COALESCE(ssh_password,''), COALESCE(ssh_key,''),
		        host, COALESCE(port,22)
		 FROM worker_servers
		 WHERE host = $1 OR service_host = $1
		 ORDER BY is_local DESC
		 LIMIT 1`,
		dbHost,
	).Scan(&t.ServerID, &t.IsLocal, &t.BackupsEnabled, &t.SSHUser, &t.SSHPassword, &t.SSHKey, &t.SSHHost, &t.SSHPort)
	if err == pgx.ErrNoRows {
		// No matching server row — treat as local (main server), backups on.
		return &BackupTarget{Found: false, IsLocal: true, BackupsEnabled: true}, nil
	}
	if err != nil {
		return nil, err
	}
	t.Found = true
	return &t, nil
}

// SetServerBackups enables/disables scheduled database backups for every
// database hosted on a given platform/BYOC server.
func (d *DB) SetServerBackups(ctx context.Context, serverID string, enabled bool) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE worker_servers SET backups_enabled = $2 WHERE id = $1`,
		serverID, enabled,
	)
	return err
}

// EnableProjectBackup turns on a daily backup schedule for a project's database.
// Called when a database is provisioned so backups are ON by default.
func (d *DB) EnableProjectBackup(ctx context.Context, projectID string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE project_databases
		 SET backup_enabled = true,
		     backup_schedule = COALESCE(NULLIF(backup_schedule,''),'daily'),
		     backup_time = COALESCE(NULLIF(backup_time,''),'03:00'),
		     backup_retention = GREATEST(COALESCE(backup_retention,0),7)
		 WHERE project_id = $1`,
		projectID,
	)
	return err
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
