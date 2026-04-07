package api

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
)

const backupDir = "/opt/serverme/backups"

func (s *Server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	pdb, _ := s.db.GetProjectDatabase(r.Context(), projectID)
	if pdb == nil {
		writeError(w, http.StatusBadRequest, "no database for this project")
		return
	}

	// Ensure backup dir exists
	os.MkdirAll(filepath.Join(backupDir, projectID), 0750)

	// Generate backup filename
	ts := time.Now().UTC().Format("20060102-150405")
	fileName := fmt.Sprintf("%s_%s.sql.gz", pdb.DBName, ts)
	filePath := filepath.Join(backupDir, projectID, fileName)

	// Run pg_dump and gzip
	cmd := fmt.Sprintf("PGPASSWORD='%s' pg_dump -U %s -h %s -p %d %s | gzip > %s",
		pdb.DBPassword, pdb.DBUser, pdb.Host, pdb.Port, pdb.DBName, filePath)
	out, err := exec.Command("bash", "-c", cmd).CombinedOutput()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "backup failed: "+string(out))
		return
	}

	// Get file size
	info, _ := os.Stat(filePath)
	fileSize := int64(0)
	if info != nil {
		fileSize = info.Size()
	}

	// Record in DB
	backup, err := s.db.InsertBackupRecord(r.Context(), projectID, fileName, fileSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record backup")
		return
	}

	s.db.UpdateLastBackup(r.Context(), projectID)

	writeJSON(w, http.StatusCreated, backup)
}

func (s *Server) handleListBackups(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	backups, _ := s.db.ListBackups(r.Context(), projectID)
	if backups == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, backups)
}

func (s *Server) handleDownloadBackup(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	backupID := chi.URLParam(r, "backupId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	// Find backup record
	backups, _ := s.db.ListBackups(r.Context(), projectID)
	var fileName string
	for _, b := range backups {
		if b.ID == backupID {
			fileName = b.FileName
			break
		}
	}
	if fileName == "" {
		writeError(w, http.StatusNotFound, "backup not found")
		return
	}

	filePath := filepath.Join(backupDir, projectID, fileName)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "backup file not found on disk")
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
	w.Header().Set("Content-Type", "application/gzip")
	http.ServeFile(w, r, filePath)
}

func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	backupID := chi.URLParam(r, "backupId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	// Find and delete file
	backups, _ := s.db.ListBackups(r.Context(), projectID)
	for _, b := range backups {
		if b.ID == backupID {
			os.Remove(filepath.Join(backupDir, projectID, b.FileName))
			break
		}
	}

	s.db.DeleteBackupRecord(r.Context(), backupID, projectID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleRestoreBackup(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")
	backupID := chi.URLParam(r, "backupId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	pdb, _ := s.db.GetProjectDatabase(r.Context(), projectID)
	if pdb == nil {
		writeError(w, http.StatusBadRequest, "no database for this project")
		return
	}

	// Find backup
	backups, _ := s.db.ListBackups(r.Context(), projectID)
	var fileName string
	for _, b := range backups {
		if b.ID == backupID {
			fileName = b.FileName
			break
		}
	}
	if fileName == "" {
		writeError(w, http.StatusNotFound, "backup not found")
		return
	}

	filePath := filepath.Join(backupDir, projectID, fileName)

	// Drop and recreate all tables, then restore
	// First terminate connections
	dropCmd := fmt.Sprintf("PGPASSWORD='%s' psql -U %s -h %s -p %d %s -c \"DROP SCHEMA public CASCADE; CREATE SCHEMA public;\"",
		pdb.DBPassword, pdb.DBUser, pdb.Host, pdb.Port, pdb.DBName)
	exec.Command("bash", "-c", dropCmd).Run()

	// Restore from backup
	restoreCmd := fmt.Sprintf("gunzip -c %s | PGPASSWORD='%s' psql -U %s -h %s -p %d %s",
		filePath, pdb.DBPassword, pdb.DBUser, pdb.Host, pdb.Port, pdb.DBName)
	out, err := exec.Command("bash", "-c", restoreCmd).CombinedOutput()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "restore failed: "+string(out))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "restored"})
}

func (s *Server) handleGetBackupSchedule(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	schedule, _ := s.db.GetBackupSchedule(r.Context(), projectID)
	if schedule == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"schedule": nil})
		return
	}
	writeJSON(w, http.StatusOK, schedule)
}

func (s *Server) handleUpdateBackupSchedule(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	projectID := chi.URLParam(r, "projectId")

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != u.ID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	var req struct {
		Enabled   bool   `json:"enabled"`
		Schedule  string `json:"schedule"`
		Time      string `json:"time"`
		Retention int    `json:"retention"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// Validate
	validSchedules := map[string]bool{"every6h": true, "every12h": true, "daily": true, "weekly": true}
	if !validSchedules[req.Schedule] {
		req.Schedule = "daily"
	}
	if req.Retention < 1 {
		req.Retention = 7
	}
	if req.Retention > 30 {
		req.Retention = 30
	}

	s.db.UpdateBackupSchedule(r.Context(), projectID, req.Enabled, req.Schedule, req.Time, req.Retention)
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
