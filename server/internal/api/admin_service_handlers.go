package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/deploy"
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
