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

	valid := map[string]bool{"postgres": true, "redis": true, "mongodb": true, "mysql": true}
	if !valid[req.Type] {
		writeError(w, http.StatusBadRequest, "unsupported service type — available: postgres, redis, mongodb, mysql")
		return
	}

	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimService); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	// BYOC path — provision a container on the user's own server via SSH.
	if req.WorkerServerID != "" {
		svc, err := s.provisionBYOCService(r.Context(), u.ID, req.Name, req.Type, req.WorkerServerID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to create service on your server: "+err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"service":                 svc,
			"connection_url":          svc.ConnectionURL(),
			"external_connection_url": svc.ConnectionURL(),
		})
		return
	}

	// Platform path — postgres uses central managed PG; others get local containers.
	publicHost := s.resolveServicePublicHost()
	var svc *db.Service
	var err error
	if req.Type == "postgres" {
		svc, err = s.db.CreateService(r.Context(), u.ID, req.Name, req.Type)
		if err != nil {
			s.log.Error().Err(err).Msg("failed to create postgres service")
			writeError(w, http.StatusInternalServerError, "failed to create service: "+err.Error())
			return
		}
	} else {
		svc, err = s.provisionPlatformContainer(r.Context(), u.ID, req.Name, req.Type, publicHost)
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to provision "+req.Type+": "+err.Error())
			return
		}
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"service":                 svc,
		"connection_url":          svc.ConnectionURL(),
		"external_connection_url": svc.ExternalConnectionURL(publicHost),
	})
}

// provisionBYOCService runs a database container on the user's own worker server
// via SSH and records it. Handles postgres, redis, mongodb, and mysql.
func (s *Server) provisionBYOCService(ctx context.Context, userID, name, serviceType, workerServerID string) (*db.Service, error) {
	server, err := s.db.GetWorkerServer(ctx, workerServerID)
	if err != nil || server == nil || server.UserID == nil || *server.UserID != userID {
		return nil, fmt.Errorf("server not found")
	}
	if !server.DockerInstalled {
		return nil, fmt.Errorf("docker not installed on that server — click Install Docker first")
	}

	dbName, password := db.NewServiceCredentials()
	dbUser := dbName
	containerName := "sm-svc-" + dbName
	publicPort := 20000 + (time.Now().UnixNano() % 10000)

	var dockerRun string
	var internalPort int

	switch serviceType {
	case "postgres":
		internalPort = 5432
		dockerRun = fmt.Sprintf(
			`docker pull postgres:16-alpine >/dev/null && `+
				`docker run -d --name %s --restart unless-stopped `+
				`-p %d:5432 `+
				`-e POSTGRES_USER=%s -e POSTGRES_PASSWORD=%s -e POSTGRES_DB=%s `+
				`-v sm-svc-%s-data:/var/lib/postgresql/data `+
				`postgres:16-alpine`,
			containerName, publicPort, dbUser, password, dbName, dbName)
	case "redis":
		internalPort = 6379
		dbUser = "" // Redis has no username concept
		dockerRun = fmt.Sprintf(
			`docker pull redis:7-alpine >/dev/null && `+
				`docker run -d --name %s --restart unless-stopped `+
				`-p %d:6379 `+
				`-v sm-svc-%s-data:/data `+
				`redis:7-alpine redis-server --requirepass %s`,
			containerName, publicPort, dbName, password)
	case "mongodb":
		internalPort = 27017
		dockerRun = fmt.Sprintf(
			`docker pull mongo:7 >/dev/null && `+
				`docker run -d --name %s --restart unless-stopped `+
				`-p %d:27017 `+
				`-e MONGO_INITDB_ROOT_USERNAME=%s -e MONGO_INITDB_ROOT_PASSWORD=%s -e MONGO_INITDB_DATABASE=%s `+
				`-v sm-svc-%s-data:/data/db `+
				`mongo:7`,
			containerName, publicPort, dbUser, password, dbName, dbName)
	case "mysql":
		internalPort = 3306
		dockerRun = fmt.Sprintf(
			`docker pull mysql:8 >/dev/null && `+
				`docker run -d --name %s --restart unless-stopped `+
				`-p %d:3306 `+
				`-e MYSQL_ROOT_PASSWORD=%s -e MYSQL_DATABASE=%s -e MYSQL_USER=%s -e MYSQL_PASSWORD=%s `+
				`-v sm-svc-%s-data:/var/lib/mysql `+
				`mysql:8`,
			containerName, publicPort, password, dbName, dbUser, password, dbName)
	default:
		return nil, fmt.Errorf("unsupported type: %s", serviceType)
	}

	out, err := runRemoteSSH(server, dockerRun, 5*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("docker run failed: %s", lastLine(string(out)))
	}

	svc, err := s.db.CreateBYOCService(ctx, userID, name, serviceType,
		workerServerID, containerName, server.Host, dbName, dbUser, password, int(publicPort))
	if err != nil {
		go runRemoteSSH(server, fmt.Sprintf("docker rm -f %s", containerName), 1*time.Minute)
		return nil, fmt.Errorf("persist: %w", err)
	}
	_ = internalPort // stored via publicPort for BYOC; internal port is the standard container port
	return svc, nil
}

// provisionPlatformContainer runs a Redis/MongoDB/MySQL container locally on the
// platform host and records it. Postgres on the platform uses the central managed PG
// (see CreateService), not this function.
func (s *Server) provisionPlatformContainer(ctx context.Context, userID, name, serviceType, publicHost string) (*db.Service, error) {
	dbName, password := db.NewServiceCredentials()
	dbUser := dbName
	containerName := "sm-svc-" + dbName
	publicPort := int(30000 + (time.Now().UnixNano() % 10000))

	var dockerRun string
	var internalPort int

	switch serviceType {
	case "redis":
		internalPort = 6379
		dbUser = ""
		dockerRun = fmt.Sprintf(
			`docker pull redis:7-alpine >/dev/null 2>&1 && `+
				`docker run -d --name %s --restart unless-stopped `+
				`-p %d:6379 `+
				`-v sm-svc-%s-data:/data `+
				`redis:7-alpine redis-server --requirepass %s`,
			containerName, publicPort, dbName, password)
	case "mongodb":
		internalPort = 27017
		dockerRun = fmt.Sprintf(
			`docker pull mongo:7 >/dev/null 2>&1 && `+
				`docker run -d --name %s --restart unless-stopped `+
				`-p %d:27017 `+
				`-e MONGO_INITDB_ROOT_USERNAME=%s -e MONGO_INITDB_ROOT_PASSWORD=%s -e MONGO_INITDB_DATABASE=%s `+
				`-v sm-svc-%s-data:/data/db `+
				`mongo:7`,
			containerName, publicPort, dbUser, password, dbName, dbName)
	case "mysql":
		internalPort = 3306
		dockerRun = fmt.Sprintf(
			`docker pull mysql:8 >/dev/null 2>&1 && `+
				`docker run -d --name %s --restart unless-stopped `+
				`-p %d:3306 `+
				`-e MYSQL_ROOT_PASSWORD=%s -e MYSQL_DATABASE=%s -e MYSQL_USER=%s -e MYSQL_PASSWORD=%s `+
				`-v sm-svc-%s-data:/var/lib/mysql `+
				`mysql:8`,
			containerName, publicPort, password, dbName, dbUser, password, dbName)
	default:
		return nil, fmt.Errorf("unsupported type: %s", serviceType)
	}

	execCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(execCtx, "bash", "-c", dockerRun).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("docker run failed: %s", lastLine(string(out)))
	}

	svc, err := s.db.CreateContainerService(ctx, userID, name, serviceType, containerName,
		"172.17.0.1", internalPort, publicHost, publicPort, dbName, dbUser, password)
	if err != nil {
		go exec.Command("docker", "rm", "-f", containerName).Run()
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

	// Container cleanup before deleting the DB record.
	svc, _ := s.db.GetService(r.Context(), id)
	if svc != nil && svc.UserID == u.ID && svc.ContainerName != nil {
		dbNameStr := ""
		if svc.DBName != nil { dbNameStr = *svc.DBName }
		if svc.WorkerServerID != nil {
			// BYOC — docker rm on the remote host.
			if server, _ := s.db.GetWorkerServer(r.Context(), *svc.WorkerServerID); server != nil {
				runRemoteSSH(server, fmt.Sprintf("docker rm -f %s && docker volume rm sm-svc-%s-data", *svc.ContainerName, dbNameStr), 30*time.Second)
			}
		} else if svc.Type != "postgres" {
			// Platform container (redis/mongodb/mysql) — rm locally.
			exec.Command("docker", "rm", "-f", *svc.ContainerName).Run()
			if dbNameStr != "" {
				exec.Command("docker", "volume", "rm", "sm-svc-"+dbNameStr+"-data").Run()
			}
		}
	}

	if err := s.db.DeleteService(r.Context(), id, u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete service")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
