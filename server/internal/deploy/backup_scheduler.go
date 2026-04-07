package deploy

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

const backupBasePath = "/opt/serverme/backups"

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

		bs.log.Info().Str("project", pdb.ProjectID).Str("db", pdb.DBName).Msg("running scheduled backup")
		bs.runBackup(ctx, &pdb)

		// Clean old backups
		oldFiles, _ := bs.db.CleanOldBackups(ctx, pdb.ProjectID, schedule.Retention)
		for _, fn := range oldFiles {
			os.Remove(filepath.Join(backupBasePath, pdb.ProjectID, fn))
		}
	}
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

func (bs *BackupScheduler) runBackup(ctx context.Context, pdb *db.ProjectDatabase) {
	os.MkdirAll(filepath.Join(backupBasePath, pdb.ProjectID), 0750)

	ts := time.Now().UTC().Format("20060102-150405")
	fileName := fmt.Sprintf("%s_%s.sql.gz", pdb.DBName, ts)
	filePath := filepath.Join(backupBasePath, pdb.ProjectID, fileName)

	cmd := fmt.Sprintf("PGPASSWORD='%s' pg_dump -U %s -h %s -p %d %s | gzip > %s",
		pdb.DBPassword, pdb.DBUser, pdb.Host, pdb.Port, pdb.DBName, filePath)
	_, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		bs.log.Error().Err(err).Str("db", pdb.DBName).Msg("scheduled backup failed")
		return
	}

	info, _ := os.Stat(filePath)
	fileSize := int64(0)
	if info != nil {
		fileSize = info.Size()
	}

	bs.db.InsertBackupRecord(ctx, pdb.ProjectID, fileName, fileSize)
	bs.db.UpdateLastBackup(ctx, pdb.ProjectID)
	bs.log.Info().Str("db", pdb.DBName).Str("file", fileName).Int64("size", fileSize).Msg("backup completed")
}
