package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
)

// resolveServicePublicHost returns the public host users should use to connect
// to standalone services from outside Docker (local dev, pgAdmin, etc).
func (s *Server) resolveServicePublicHost() string {
	if s.deployer != nil && s.deployer.Domain != "" {
		return s.deployer.Domain
	}
	return "localhost"
}

func (s *Server) handleCreateService(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Name           string `json:"name"`
		Type           string `json:"type"` // postgres, redis
		WorkerServerID string `json:"worker_server_id,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.Type == "" {
		writeError(w, http.StatusBadRequest, "name and type required")
		return
	}

	valid := map[string]bool{"postgres": true}
	if !valid[req.Type] {
		writeError(w, http.StatusBadRequest, "unsupported service type — available: postgres")
		return
	}

	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimService); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	// BYOC path — provision a Postgres container on the user's own server
	// via docker run over SSH. No plan DB-size cap here since storage comes
	// from the user's own disk.
	if req.WorkerServerID != "" {
		svc, err := s.provisionBYOCPostgres(r.Context(), u.ID, req.Name, req.WorkerServerID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to create database on your server: "+err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"service":                 svc,
			"connection_url":          svc.ConnectionURL(),
			"external_connection_url": svc.ConnectionURL(),
		})
		return
	}

	// Platform path — existing behaviour.
	svc, err := s.db.CreateService(r.Context(), u.ID, req.Name, req.Type)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to create service")
		writeError(w, http.StatusInternalServerError, "failed to create service: "+err.Error())
		return
	}

	publicHost := s.resolveServicePublicHost()
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"service":                 svc,
		"connection_url":          svc.ConnectionURL(),
		"external_connection_url": svc.ExternalConnectionURL(publicHost),
	})
}

// provisionBYOCPostgres runs a Postgres container on the user's own worker
// server over SSH and records it as a service. Rollback on failure.
func (s *Server) provisionBYOCPostgres(ctx context.Context, userID, name, workerServerID string) (*db.Service, error) {
	server, err := s.db.GetWorkerServer(ctx, workerServerID)
	if err != nil || server == nil || server.UserID == nil || *server.UserID != userID {
		return nil, fmt.Errorf("server not found")
	}
	if !server.DockerInstalled {
		return nil, fmt.Errorf("docker not installed on that server — click Install Docker first")
	}

	dbName, password := db.NewServiceCredentials()
	containerName := "sm-svc-" + dbName
	// Random high port so concurrent services on the same BYOC box don't
	// collide. 20000–29999 is wide enough for a single user's caps.
	publicPort := 20000 + (time.Now().UnixNano()%10000)

	// Minimal, secure-by-default postgres container: listen on 0.0.0.0 so
	// it's reachable from the user's other project containers, volume-
	// backed for persistence, password-protected, restart-on-failure.
	dockerRun := fmt.Sprintf(
		`docker pull postgres:16-alpine >/dev/null && `+
			`docker run -d --name %s --restart unless-stopped `+
			`-p %d:5432 `+
			`-e POSTGRES_USER=%s -e POSTGRES_PASSWORD=%s -e POSTGRES_DB=%s `+
			`-v sm-svc-%s-data:/var/lib/postgresql/data `+
			`postgres:16-alpine`,
		containerName, publicPort, dbName, password, dbName, dbName)

	out, err := runRemoteSSH(server, dockerRun, 3*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("docker run failed: %s", lastLine(string(out)))
	}

	svc, err := s.db.CreateBYOCService(ctx, userID, name, "postgres",
		workerServerID, containerName, server.Host, dbName, dbName, password, int(publicPort))
	if err != nil {
		// Best-effort cleanup: nuke the container we just started.
		go runRemoteSSH(server, fmt.Sprintf("docker rm -f %s", containerName), 1*time.Minute)
		return nil, fmt.Errorf("persist: %w", err)
	}
	return svc, nil
}

// runRemoteSSH executes a command over SSH on a worker server. Uses
// sshpass for password auth, a temp file for key auth. Kept separate from
// testServerConnection so we can reuse it for arbitrary commands.
func runRemoteSSH(server *db.WorkerServer, command string, timeout time.Duration) ([]byte, error) {
	var cmd string
	if server.SSHPassword != "" {
		cmd = fmt.Sprintf("sshpass -p '%s' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 %s@%s -p %d %q 2>&1",
			server.SSHPassword, server.SSHUser, server.Host, server.Port, command)
	} else if server.SSHKey != "" {
		cmd = fmt.Sprintf("KEY=$(mktemp) && echo %q > $KEY && chmod 600 $KEY && ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15 %s@%s -p %d %q 2>&1; RC=$?; rm -f $KEY; exit $RC",
			server.SSHKey, server.SSHUser, server.Host, server.Port, command)
	} else {
		return nil, fmt.Errorf("no credentials")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return exec.CommandContext(ctx, "bash", "-c", cmd).CombinedOutput()
}


func (s *Server) handleListServices(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	svcs, err := s.db.ListServices(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list services")
		return
	}
	if svcs == nil {
		svcs = []db.Service{}
	}

	// Add connection URLs
	type svcWithURL struct {
		db.Service
		ConnectionURL         string `json:"connection_url"`
		ExternalConnectionURL string `json:"external_connection_url"`
	}
	publicHost := s.resolveServicePublicHost()
	result := make([]svcWithURL, len(svcs))
	for i, svc := range svcs {
		result[i] = svcWithURL{
			Service:               svc,
			ConnectionURL:         svc.ConnectionURL(),
			ExternalConnectionURL: svc.ExternalConnectionURL(publicHost),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGetService(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	id := chi.URLParam(r, "serviceId")

	svc, _ := s.db.GetService(r.Context(), id)
	if svc == nil || svc.UserID != u.ID {
		writeError(w, http.StatusNotFound, "service not found")
		return
	}

	publicHost := s.resolveServicePublicHost()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"service":                 svc,
		"connection_url":          svc.ConnectionURL(),
		"external_connection_url": svc.ExternalConnectionURL(publicHost),
	})
}

func (s *Server) handleDeleteService(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	id := chi.URLParam(r, "serviceId")

	// BYOC services need to docker-rm the container on the remote host first;
	// the DB-level DeleteService only drops platform Postgres state.
	svc, _ := s.db.GetService(r.Context(), id)
	if svc != nil && svc.UserID == u.ID && svc.WorkerServerID != nil && svc.ContainerName != nil {
		if server, _ := s.db.GetWorkerServer(r.Context(), *svc.WorkerServerID); server != nil {
			// Best-effort — a container that already died is fine.
			runRemoteSSH(server, fmt.Sprintf("docker rm -f %s && docker volume rm sm-svc-%s-data", *svc.ContainerName, *svc.DBName), 30*time.Second)
		}
	}

	if err := s.db.DeleteService(r.Context(), id, u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete service")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
