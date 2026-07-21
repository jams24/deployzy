package api

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// Admin-only platform backup management. Backups are written to
// /var/backups/serverme/ by /opt/serverme/backup.sh, fired nightly by the
// serverme-backup.timer systemd unit. Filenames share a timestamp suffix
// (e.g. pg-20260415-220844.sql.gz) so we group them per run.

// platformBackupDir returns the backup directory, preferring the post-rename
// path. Both are checked so older installs keep working.
func platformBackupDir() string {
	if _, err := os.Stat("/var/backups/deployzy"); err == nil {
		return "/var/backups/deployzy"
	}
	return "/var/backups/serverme"
}

type platformBackupRun struct {
	Timestamp  string              `json:"timestamp"`
	Files      []platformBackupFile `json:"files"`
	TotalBytes int64               `json:"total_bytes"`
}

type platformBackupFile struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"` // postgres, data, config, manifest
	SizeBytes int64  `json:"size_bytes"`
	ModTime   string `json:"mod_time"`
}

func (s *Server) handleListPlatformBackups(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(platformBackupDir())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"runs":           []platformBackupRun{},
			"last_run":       nil,
			"next_run":       nextPlatformBackupRun(),
			"timer_active":   platformTimerActive(),
			"local_dir":      platformBackupDir(),
			"offsite_remote": offsiteRemoteName(),
		})
		return
	}

	runs := map[string]*platformBackupRun{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ts := extractPlatformBackupTimestamp(e.Name())
		if ts == "" {
			continue
		}
		info, _ := e.Info()
		if runs[ts] == nil {
			runs[ts] = &platformBackupRun{Timestamp: ts}
		}
		runs[ts].Files = append(runs[ts].Files, platformBackupFile{
			Name:      e.Name(),
			Kind:      classifyPlatformBackup(e.Name()),
			SizeBytes: info.Size(),
			ModTime:   info.ModTime().UTC().Format(time.RFC3339),
		})
		runs[ts].TotalBytes += info.Size()
	}
	var list []platformBackupRun
	for _, r := range runs {
		list = append(list, *r)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Timestamp > list[j].Timestamp })

	var lastRun *string
	if len(list) > 0 {
		lastRun = &list[0].Timestamp
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"runs":           list,
		"last_run":       lastRun,
		"next_run":       nextPlatformBackupRun(),
		"timer_active":   platformTimerActive(),
		"local_dir":      platformBackupDir(),
		"offsite_remote": offsiteRemoteName(),
	})
}

func (s *Server) handleRunPlatformBackup(w http.ResponseWriter, r *http.Request) {
	unit := "deployzy-backup.service"
	if out, _ := exec.Command("systemctl", "is-enabled", unit).Output(); strings.TrimSpace(string(out)) == "not-found" {
		unit = "serverme-backup.service"
	}
	cmd := exec.Command("systemctl", "start", "--no-block", unit)
	if err := cmd.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to trigger backup: "+err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "started"})
}

func (s *Server) handleDeletePlatformBackup(w http.ResponseWriter, r *http.Request) {
	ts := chi.URLParam(r, "timestamp")
	if !validPlatformBackupTimestamp(ts) {
		writeError(w, http.StatusBadRequest, "invalid timestamp")
		return
	}
	pattern := filepath.Join(platformBackupDir(), "*-"+ts+".*")
	matches, _ := filepath.Glob(pattern)
	deleted := 0
	for _, m := range matches {
		abs, err := filepath.Abs(m)
		if err != nil || !strings.HasPrefix(abs, platformBackupDir()+"/") {
			continue
		}
		if err := os.Remove(abs); err == nil {
			deleted++
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"deleted": deleted})
}

func (s *Server) handleDownloadPlatformBackup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "filename")
	// Strict filename pattern: <kind>-<ts>.<ext> — no path separators allowed.
	if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}
	full := filepath.Join(platformBackupDir(), name)
	abs, err := filepath.Abs(full)
	if err != nil || !strings.HasPrefix(abs, platformBackupDir()+"/") {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	if _, err := os.Stat(abs); err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename="+name)
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, abs)
}

func extractPlatformBackupTimestamp(name string) string {
	i := strings.IndexByte(name, '-')
	if i < 0 {
		return ""
	}
	rest := name[i+1:]
	for _, suffix := range []string{".sql.gz", ".tar.gz", ".txt"} {
		if strings.HasSuffix(rest, suffix) {
			return strings.TrimSuffix(rest, suffix)
		}
	}
	return ""
}

func classifyPlatformBackup(name string) string {
	switch {
	case strings.HasPrefix(name, "pg-"):
		return "postgres"
	case strings.HasPrefix(name, "data-"):
		return "data"
	case strings.HasPrefix(name, "config-"):
		return "config"
	case strings.HasPrefix(name, "manifest-"):
		return "manifest"
	}
	return "other"
}

func validPlatformBackupTimestamp(s string) bool {
	_, err := time.Parse("20060102-150405", s)
	return err == nil
}

func nextPlatformBackupRun() string {
	out, err := exec.Command("systemctl", "show", "deployzy-backup.timer", "--property=NextElapseUSecRealtime", "--value").Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		out, err = exec.Command("systemctl", "show", "serverme-backup.timer", "--property=NextElapseUSecRealtime", "--value").Output()
	}
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func platformTimerActive() bool {
	// Unit was renamed serverme-backup → deployzy-backup (2026-07-18); check
	// the new name first, fall back to the old for older installs.
	for _, unit := range []string{"deployzy-backup.timer", "serverme-backup.timer"} {
		out, _ := exec.Command("systemctl", "is-active", unit).Output()
		if strings.TrimSpace(string(out)) == "active" {
			return true
		}
	}
	return false
}

func offsiteRemoteName() string {
	b, err := os.ReadFile("/etc/deployzy/backup-remote.env")
	if err != nil {
		b, err = os.ReadFile("/etc/serverme/backup-remote.env")
	}
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "REMOTE=") {
			return strings.TrimPrefix(line, "REMOTE=")
		}
	}
	return ""
}
