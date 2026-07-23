package api

import (
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
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
