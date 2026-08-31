package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/deploy"
	"github.com/serverme/serverme/server/internal/migrate"
)

// Admin visibility + control over standalone databases/services across all
// users. Mirrors handleAdminListProjects/handleAdminDeleteProject but for the
// `services` table (Postgres/Redis/MongoDB/MySQL instances).

func (s *Server) handleAdminListServices(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("search")
	typ := r.URL.Query().Get("type")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 50
	}

	svcs, total, err := s.db.AdminListServices(r.Context(), search, typ, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list databases")
		return
	}

	// Enrich with connection URLs (admins can see full credentials).
	publicHost := s.resolveServicePublicHost()
	result := make([]map[string]interface{}, 0, len(svcs))
	for i := range svcs {
		result = append(result, map[string]interface{}{
			"service":                 svcs[i].Service,
			"user_email":              svcs[i].UserEmail,
			"server_label":            svcs[i].ServerLabel,
			"connection_url":          svcs[i].ConnectionURL(),
			"external_connection_url": svcs[i].ExternalConnectionURL(publicHost),
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"databases": result, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) handleAdminDeleteService(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "serviceId")

	svc, _ := s.db.GetService(r.Context(), id)
	if svc == nil {
		writeError(w, http.StatusNotFound, "database not found")
		return
	}

	// Tear down the container (BYOC over SSH, or platform container locally)
	// before dropping the DB record. Postgres-on-platform state is dropped by
	// AdminDeleteService itself.
	if svc.ContainerName != nil {
		dbNameStr := ""
		if svc.DBName != nil {
			dbNameStr = *svc.DBName
		}
		if svc.WorkerServerID != nil {
			if server, _ := s.db.GetWorkerServer(r.Context(), *svc.WorkerServerID); server != nil {
				runRemoteSSH(server, fmt.Sprintf("docker rm -f %s && docker volume rm sm-svc-%s-data", *svc.ContainerName, dbNameStr), 30*time.Second)
			}
		} else if svc.Type != "postgres" {
			exec.Command("docker", "rm", "-f", *svc.ContainerName).Run()
			if dbNameStr != "" {
				exec.Command("docker", "volume", "rm", "sm-svc-"+dbNameStr+"-data").Run()
			}
		}
	}

	if err := s.db.AdminDeleteService(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete database")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// handleAdminScanOrphans sweeps every reachable host for sm-* containers that
// no longer have an owning DB row. Report-only.
func (s *Server) handleAdminScanOrphans(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	scan, err := s.deployer.FindOrphans(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "orphan scan failed: "+err.Error())
		return
	}
	if scan.Orphans == nil {
		scan.Orphans = []deploy.OrphanContainer{}
	}
	if scan.UnreachableHosts == nil {
		scan.UnreachableHosts = []string{}
	}
	writeJSON(w, http.StatusOK, scan)
}

// handleAdminReapOrphan force-removes one orphan container on a host.
func (s *Server) handleAdminReapOrphan(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	var req struct {
		ServerID string `json:"server_id"`
		Name     string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := s.deployer.ReapOrphan(r.Context(), req.ServerID, req.Name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "reaped"})
}

// handleAdminMoveService migrates a standalone database to another server by
// provisioning a fresh instance on the target and copying the data (dump →
// restore). It is NON-DESTRUCTIVE: the source database is left completely
// intact, so nothing can be lost. The admin verifies the copy, repoints their
// app to the new connection string, then deletes the source when satisfied.
// Only relational engines (postgres/mysql/mongodb) — Redis isn't supported yet.
func (s *Server) handleAdminMoveService(w http.ResponseWriter, r *http.Request) {
	svcID := chi.URLParam(r, "serviceId")
	var body struct {
		WorkerServerID string `json:"worker_server_id"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	target := strings.TrimSpace(body.WorkerServerID)
	if target == "" || target == "auto" || target == "platform" {
		writeError(w, http.StatusBadRequest, "pick a specific target server to migrate the database to")
		return
	}

	svc, err := s.db.GetService(r.Context(), svcID)
	if err != nil || svc == nil {
		writeError(w, http.StatusNotFound, "database not found")
		return
	}
	if svc.Type == "redis" {
		writeError(w, http.StatusBadRequest, "Redis migration isn't supported yet — only Postgres, MySQL and MongoDB can be moved.")
		return
	}
	if svc.WorkerServerID != nil && *svc.WorkerServerID == target {
		writeError(w, http.StatusBadRequest, "database is already on that server")
		return
	}
	tsrv, err := s.db.GetWorkerServer(r.Context(), target)
	if err != nil || tsrv == nil {
		writeError(w, http.StatusBadRequest, "target server not found")
		return
	}
	if tsrv.Status != "active" {
		writeError(w, http.StatusBadRequest, "target server is not active")
		return
	}
	if !tsrv.DockerInstalled {
		writeError(w, http.StatusBadRequest, "Docker isn't installed on the target server — install it first")
		return
	}

	newSvc, targetURL, err := s.startServiceMigration(r.Context(), svc, tsrv)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":         "migrating",
		"target":         tsrv.Label,
		"new_database":   newSvc.Name,
		"new_connection": targetURL,
		"note":           "Copying data now. Your original database is untouched — verify the copy, repoint your app to the new connection, then delete the source when satisfied.",
	})
}

// startServiceMigration provisions a fresh copy of svc on tsrv and kicks off a
// non-destructive background data copy (dump → restore). Shared by the admin and
// user database-move handlers. Returns the new service record + connection URL.
func (s *Server) startServiceMigration(ctx context.Context, svc *db.Service, tsrv *db.WorkerServer) (*db.Service, string, error) {
	dbName, dbUser, dbPass := "", "", ""
	if svc.DBName != nil {
		dbName = *svc.DBName
	}
	if svc.DBUser != nil {
		dbUser = *svc.DBUser
	}
	if svc.DBPassword != nil {
		dbPass = *svc.DBPassword
	}
	var sourceURL string
	if svc.WorkerServerID == nil || *svc.WorkerServerID == "" {
		port := svc.Port
		if port == 0 {
			port = 5432
		}
		sourceURL = fmt.Sprintf("postgresql://%s:%s@localhost:%d/%s", dbUser, dbPass, port, dbName)
	} else {
		sourceURL = svc.ExternalConnectionURL("")
	}

	newSvc, err := s.provisionServiceContainerOn(ctx, svc.UserID, svc.Name+"-"+strings.ToLower(tsrv.Label), svc.Type, tsrv)
	if err != nil {
		return nil, "", fmt.Errorf("failed to provision the database on the target server: %w", err)
	}
	targetURL := newSvc.ExternalConnectionURL("")

	go func() {
		if out, err := migrate.Run(context.Background(), svc.Type, sourceURL, targetURL); err != nil {
			s.log.Error().Err(err).Str("service", svc.ID).Str("out", trimForLog(out)).Msg("database migration failed")
		} else {
			s.log.Info().Str("service", svc.Name).Str("target", tsrv.Label).Msg("database migration complete")
		}
	}()
	return newSvc, targetURL, nil
}

func trimForLog(s string) string {
	if len(s) > 500 {
		return s[:500]
	}
	return s
}
