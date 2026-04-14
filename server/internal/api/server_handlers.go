package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
)

// --- Admin: Platform Server Management ---

func (s *Server) handleAdminListServers(w http.ResponseWriter, r *http.Request) {
	servers, err := s.db.ListWorkerServers(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list servers")
		return
	}
	if servers == nil {
		servers = []db.WorkerServer{}
	}
	// Strip sensitive fields
	for i := range servers {
		servers[i].SSHPassword = ""
		servers[i].SSHKey = ""
	}
	writeJSON(w, http.StatusOK, servers)
}

func (s *Server) handleAdminAddServer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Label         string  `json:"label"`
		Host          string  `json:"host"`
		Port          int     `json:"port"`
		SSHUser       string  `json:"ssh_user"`
		SSHPassword   string  `json:"ssh_password"`
		SSHKey        string  `json:"ssh_key"`
		Region        string  `json:"region"`
		TotalCPU      float64 `json:"total_cpu"`
		TotalMemoryMB int     `json:"total_memory_mb"`
		MaxProjects   int     `json:"max_projects"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Host == "" || req.Label == "" {
		writeError(w, http.StatusBadRequest, "label and host required")
		return
	}

	if req.Port == 0 { req.Port = 22 }
	if req.SSHUser == "" { req.SSHUser = "root" }
	if req.Region == "" { req.Region = "default" }
	if req.TotalCPU == 0 { req.TotalCPU = 2.0 }
	if req.TotalMemoryMB == 0 { req.TotalMemoryMB = 4096 }
	if req.MaxProjects == 0 { req.MaxProjects = 10 }

	ws := &db.WorkerServer{
		Label:         req.Label,
		Host:          req.Host,
		Port:          req.Port,
		SSHUser:       req.SSHUser,
		SSHPassword:   req.SSHPassword,
		SSHKey:        req.SSHKey,
		Region:        req.Region,
		TotalCPU:      req.TotalCPU,
		TotalMemoryMB: req.TotalMemoryMB,
		MaxProjects:   req.MaxProjects,
		Status:        "active",
	}

	// Test SSH connection
	dockerOK := testServerConnection(ws)
	ws.DockerInstalled = dockerOK

	server, err := s.db.CreateWorkerServer(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add server")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"server":           server,
		"docker_installed": dockerOK,
	})
}

func (s *Server) handleAdminDeleteServer(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverId")
	if err := s.db.DeleteWorkerServer(r.Context(), serverID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete server")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleAdminUpdateServerStatus(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverId")
	var req struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	valid := map[string]bool{"active": true, "draining": true, "offline": true}
	if !valid[req.Status] {
		writeError(w, http.StatusBadRequest, "status must be active, draining, or offline")
		return
	}
	s.db.UpdateWorkerServerStatus(r.Context(), serverID, req.Status)
	writeJSON(w, http.StatusOK, map[string]string{"status": req.Status})
}

// --- User: BYOC Server Management ---

func (s *Server) handleListUserServers(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	servers, _ := s.db.ListWorkerServers(r.Context(), &u.ID)
	if servers == nil {
		servers = []db.WorkerServer{}
	}
	for i := range servers {
		servers[i].SSHPassword = ""
		servers[i].SSHKey = ""
	}
	writeJSON(w, http.StatusOK, servers)
}

func (s *Server) handleAddUserServer(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Label       string `json:"label"`
		Host        string `json:"host"`
		Port        int    `json:"port"`
		SSHUser     string `json:"ssh_user"`
		SSHPassword string `json:"ssh_password"`
		SSHKey      string `json:"ssh_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Host == "" || req.Label == "" {
		writeError(w, http.StatusBadRequest, "label and host required")
		return
	}

	if req.Port == 0 { req.Port = 22 }
	if req.SSHUser == "" { req.SSHUser = "root" }

	// Plan limit: max BYOC servers.
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimBYOCServer); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	ws := &db.WorkerServer{
		UserID:        &u.ID,
		Label:         req.Label,
		Host:          req.Host,
		Port:          req.Port,
		SSHUser:       req.SSHUser,
		SSHPassword:   req.SSHPassword,
		SSHKey:        req.SSHKey,
		Region:        "user",
		TotalCPU:      2.0,
		TotalMemoryMB: 4096,
		MaxProjects:   5,
		Status:        "active",
	}

	dockerOK := testServerConnection(ws)
	ws.DockerInstalled = dockerOK

	server, err := s.db.CreateWorkerServer(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add server")
		return
	}

	server.SSHPassword = ""
	server.SSHKey = ""
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"server":           server,
		"docker_installed": dockerOK,
		"message":          dockerMessage(dockerOK),
	})
}

func (s *Server) handleDeleteUserServer(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	serverID := chi.URLParam(r, "serverId")

	server, _ := s.db.GetWorkerServer(r.Context(), serverID)
	if server == nil || server.UserID == nil || *server.UserID != u.ID {
		writeError(w, http.StatusNotFound, "server not found")
		return
	}

	s.db.DeleteWorkerServer(r.Context(), serverID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// --- Helpers ---

func testServerConnection(ws *db.WorkerServer) bool {
	var cmd string
	if ws.SSHPassword != "" {
		cmd = fmt.Sprintf("sshpass -p '%s' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 %s@%s -p %d 'docker --version' 2>&1",
			ws.SSHPassword, ws.SSHUser, ws.Host, ws.Port)
	} else if ws.SSHKey != "" {
		// Write key to temp file
		cmd = fmt.Sprintf("echo '%s' > /tmp/sm_test_key && chmod 600 /tmp/sm_test_key && ssh -i /tmp/sm_test_key -o StrictHostKeyChecking=no -o ConnectTimeout=10 %s@%s -p %d 'docker --version' 2>&1; rm -f /tmp/sm_test_key",
			ws.SSHKey, ws.SSHUser, ws.Host, ws.Port)
	} else {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "bash", "-c", cmd).CombinedOutput()
	return err == nil && strings.Contains(string(out), "Docker")
}

func dockerMessage(installed bool) string {
	if installed {
		return "Server connected. Docker is installed and ready."
	}
	return "Server connected but Docker is not installed. Install Docker to deploy projects."
}
