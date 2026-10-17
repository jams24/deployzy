package deploy

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

const backupBasePath = DataRoot + "/backups"

// BackupScheduler runs periodic database backups.
type BackupScheduler struct {
	db  *db.DB
	log zerolog.Logger
}

// NewBackupScheduler creates a new backup scheduler.
func NewBackupScheduler(database *db.DB, log zerolog.Logger) *BackupScheduler {
	return &BackupScheduler{
		db:  database,
		log: log.With().Str("component", "backup_scheduler").Logger(),
	}
}

// Start begins the backup scheduler loop. Call as a goroutine.
func (bs *BackupScheduler) Start(ctx context.Context) {
	bs.log.Info().Msg("backup scheduler started")
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			bs.runDueBackups(ctx)
		}
	}
}

func (bs *BackupScheduler) runDueBackups(ctx context.Context) {
	dbs, err := bs.db.GetProjectsDueForBackup(ctx)
	if err != nil || len(dbs) == 0 {
		return
	}

	for _, pdb := range dbs {
		schedule, err := bs.db.GetBackupSchedule(ctx, pdb.ProjectID)
		if err != nil || schedule == nil || !schedule.Enabled {
			continue
		}

		if !bs.isDue(schedule) {
			continue
		}

		// Per-server toggle: skip databases hosted on a server whose backups are
		// switched off. Also tells us whether to dump locally or over SSH.
		target, err := bs.db.GetBackupTarget(ctx, pdb.Host)
		if err != nil {
			bs.log.Error().Err(err).Str("db", pdb.DBName).Msg("backup: could not resolve host server")
			continue
		}
		if !target.BackupsEnabled {
			bs.log.Debug().Str("db", pdb.DBName).Str("host", pdb.Host).Msg("backup: skipped — server backups disabled")
			continue
		}

		bs.log.Info().Str("project", pdb.ProjectID).Str("db", pdb.DBName).Bool("local", target.IsLocal).Msg("running scheduled backup")
		bs.runBackup(ctx, &pdb, target)

		// Guard retention so cleanup never purges everything (0 days = delete all).
		retention := schedule.Retention
		if retention < 1 {
			retention = 7
		}
		// Cap at the owner's plan (plan_limits.backup_retention_days). Free (0)
		// can no longer enable schedules; ones enabled before that keep running
		// (grandfathered) with at most a week of history.
		if planDays := bs.planBackupRetention(ctx, pdb.ProjectID); planDays > 0 && retention > planDays {
			retention = planDays
		} else if planDays == 0 && retention > 7 {
			retention = 7
		}
		oldFiles, _ := bs.db.CleanOldBackups(ctx, pdb.ProjectID, retention)
		for _, fn := range oldFiles {
			os.Remove(filepath.Join(backupBasePath, pdb.ProjectID, fn))
		}
	}
}

// planBackupRetention returns the project owner's plan backup_retention_days:
// -1 for admins/unlimited (or on lookup failure, so we never over-delete).
func (bs *BackupScheduler) planBackupRetention(ctx context.Context, projectID string) int {
	p, err := bs.db.GetProject(ctx, projectID)
	if err != nil || p == nil {
		return -1
	}
	if isAdmin, _ := bs.db.IsUserAdmin(ctx, p.UserID); isAdmin {
		return -1
	}
	u, err := bs.db.GetUserByID(ctx, p.UserID)
	if err != nil || u == nil {
		return -1
	}
	pl, err := bs.db.GetPlanLimits(ctx, u.Plan)
	if err != nil || pl == nil {
		return -1
	}
	return pl.BackupRetentionDays
}

func (bs *BackupScheduler) isDue(schedule *db.BackupSchedule) bool {
	if schedule.LastAt == nil {
		return true // Never backed up
	}

	elapsed := time.Since(*schedule.LastAt)

	switch schedule.Schedule {
	case "every6h":
		return elapsed >= 6*time.Hour
	case "every12h":
		return elapsed >= 12*time.Hour
	case "daily":
		return elapsed >= 24*time.Hour
	case "weekly":
		return elapsed >= 7*24*time.Hour
	}
	return elapsed >= 24*time.Hour
}

func (bs *BackupScheduler) runBackup(ctx context.Context, pdb *db.ProjectDatabase, target *db.BackupTarget) {
	os.MkdirAll(filepath.Join(backupBasePath, pdb.ProjectID), 0750)

	ts := time.Now().UTC().Format("20060102-150405")
	fileName := fmt.Sprintf("%s_%s.sql.gz", pdb.DBName, ts)
	filePath := filepath.Join(backupBasePath, pdb.ProjectID, fileName)

	var cmd string
	if target == nil || target.IsLocal {
		// Local (main server) — dump straight to disk.
		cmd = fmt.Sprintf("PGPASSWORD='%s' pg_dump -U %s -h %s -p %d %s | gzip > %s",
			pdb.DBPassword, pdb.DBUser, pdb.Host, pdb.Port, pdb.DBName, filePath)
	} else {
		// Remote worker (France / BYOC) — run pg_dump ON the worker against its
		// own local port and stream the gzip back over SSH to the main server.
		// This avoids exposing the DB port to the internet and works through the
		// worker's firewall (the dump runs inside the worker).
		remote := fmt.Sprintf("PGPASSWORD='%s' pg_dump -U %s -h 127.0.0.1 -p %d '%s' | gzip",
			pdb.DBPassword, pdb.DBUser, pdb.Port, pdb.DBName)
		sshCmd, cleanup := bs.sshExec(target, remote)
		if cleanup != "" {
			defer os.Remove(cleanup)
		}
		cmd = fmt.Sprintf("%s > %s", sshCmd, filePath)
	}

	if out, err := exec.Command("bash", "-c", cmd).CombinedOutput(); err != nil {
		bs.log.Error().Err(err).Str("db", pdb.DBName).Str("out", tail(string(out), 200)).Msg("scheduled backup failed")
		os.Remove(filePath)
		return
	}

	info, _ := os.Stat(filePath)
	fileSize := int64(0)
	if info != nil {
		fileSize = info.Size()
	}
	// A near-empty file means the dump failed silently — don't record it as good.
	if fileSize < 40 {
		bs.log.Error().Str("db", pdb.DBName).Int64("size", fileSize).Msg("scheduled backup produced an empty file")
		os.Remove(filePath)
		return
	}

	bs.db.InsertBackupRecord(ctx, pdb.ProjectID, fileName, fileSize)
	bs.db.UpdateLastBackup(ctx, pdb.ProjectID)
	bs.log.Info().Str("db", pdb.DBName).Str("file", fileName).Int64("size", fileSize).Bool("remote", target != nil && !target.IsLocal).Msg("backup completed")
}

// sshExec builds an `ssh … 'remoteCmd'` prefix for a worker, using its password
// (sshpass) or key. Returns the command string and a temp key path to clean up
// (empty when password auth is used).
func (bs *BackupScheduler) sshExec(t *db.BackupTarget, remoteCmd string) (string, string) {
	opts := fmt.Sprintf("-o StrictHostKeyChecking=no -o ConnectTimeout=25 -p %d", t.SSHPort)
	dest := fmt.Sprintf("%s@%s", t.SSHUser, t.SSHHost)
	if t.SSHKey != "" {
		f, err := os.CreateTemp("", "bk-key-*")
		if err == nil {
			f.WriteString(t.SSHKey)
			f.Close()
			os.Chmod(f.Name(), 0600)
			return fmt.Sprintf("ssh -i %s %s %s %s", f.Name(), opts, dest, shquote(remoteCmd)), f.Name()
		}
	}
	// Password auth (sshpass is already present on the host for deploys).
	return fmt.Sprintf("sshpass -p %s ssh %s %s %s", shquote(t.SSHPassword), opts, dest, shquote(remoteCmd)), ""
}

func shquote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
