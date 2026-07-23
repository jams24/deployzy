package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/deploy"
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
	if req.MaxProjects == 0 { req.MaxProjects = 10 }

	ws := &db.WorkerServer{
		Label:         req.Label,
		Host:          req.Host,
		Port:          req.Port,
		SSHUser:       req.SSHUser,
		SSHPassword:   req.SSHPassword,
		SSHKey:        req.SSHKey,
		Region:        req.Region,
		MaxProjects:   req.MaxProjects,
		Status:        "active",
	}

	// Probe real hardware first; fall back to admin-provided overrides; final
	// fallback to safe defaults so the row never lands with 0 capacity.
	cpus, memMB := probeServerResources(ws)
	if cpus > 0 {
		ws.TotalCPU = cpus
	} else if req.TotalCPU > 0 {
		ws.TotalCPU = req.TotalCPU
	} else {
		ws.TotalCPU = 2.0
	}
	if memMB > 0 {
		ws.TotalMemoryMB = memMB
	} else if req.TotalMemoryMB > 0 {
		ws.TotalMemoryMB = req.TotalMemoryMB
	} else {
		ws.TotalMemoryMB = 4096
	}

	dockerOK := testServerConnection(ws)
	ws.DockerInstalled = dockerOK

	server, err := s.db.CreateWorkerServer(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add server")
		return
	}

	// Auto-create a DNS-only A record: database-<label>.deployzy.com → host IP
	dnsResult := ""
	if s.cfDNS != nil && s.cfDomain != "" && isIP(ws.Host) {
		recordName := fmt.Sprintf("database-%s.%s", sanitizeLabel(ws.Label), s.cfDomain)
		if err := s.cfDNS.UpsertARecord(recordName, ws.Host, false); err != nil {
			s.log.Warn().Err(err).Str("record", recordName).Msg("cloudflare DNS create failed")
			dnsResult = "dns_failed: " + err.Error()
		} else {
			dnsResult = recordName
			server.ServiceHost = recordName
			s.db.SetWorkerServerServiceHost(r.Context(), server.ID, recordName)
		}
	}
	// Fall back to raw IP if no CF DNS was created
	if server.ServiceHost == "" && isIP(server.Host) {
		server.ServiceHost = server.Host
		s.db.SetWorkerServerServiceHost(r.Context(), server.ID, server.Host)
	}

	resp := map[string]interface{}{
		"server":           server,
		"docker_installed": dockerOK,
	}
	if dnsResult != "" {
		resp["dns_record"] = dnsResult
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (s *Server) handleAdminDeleteServer(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverId")

	// The admin path previously deleted the row with no host cleanup at all,
	// orphaning every container on that machine. Mirror the user path.
	server, _ := s.db.GetWorkerServer(r.Context(), serverID)
	var purgeErr error
	if server != nil {
		purgeErr = s.purgeServerResources(r.Context(), server)
	}

	if err := s.db.DeleteWorkerServer(r.Context(), serverID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete server")
		return
	}

	resp := map[string]string{"status": "deleted"}
	if purgeErr != nil && server != nil {
		resp["warning"] = leftoverWarning(server, server.CurrentProjects)
	}
	writeJSON(w, http.StatusOK, resp)
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

	// Activation must be earned, not declared: verify the server actually
	// answers over SSH before marking it active — otherwise a dead server
	// gets scheduled deploys that all fail.
	if req.Status == "active" {
		srv, err := s.db.GetWorkerServer(r.Context(), serverID)
		if err != nil || srv == nil {
			writeError(w, http.StatusNotFound, "server not found")
			return
		}
		if !srv.IsLocal {
			runner := deploy.NewRemoteRunner(srv)
			pingCtx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
			_, perr := runner.RunShell(pingCtx, "echo ok")
			cancel()
			if perr != nil {
				writeError(w, http.StatusBadGateway,
					"server is not reachable over SSH — fix connectivity/credentials first: "+perr.Error())
				return
			}
			s.db.UpdateWorkerHeartbeat(r.Context(), serverID)
		}
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
		MaxProjects:   5,
		Status:        "active",
	}

	// Probe actual hardware — replaces the old hard-coded 2 CPU / 4096 MB.
	cpus, memMB := probeServerResources(ws)
	if cpus > 0 {
		ws.TotalCPU = cpus
	} else {
		ws.TotalCPU = 2.0
	}
	if memMB > 0 {
		ws.TotalMemoryMB = memMB
	} else {
		ws.TotalMemoryMB = 4096
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

	// Auto-create a DNS-only A record for this BYOC server: database-<label>.deployzy.com → host IP
	dnsResult := ""
	if s.cfDNS != nil && s.cfDomain != "" && isIP(ws.Host) {
		recordName := fmt.Sprintf("database-%s.%s", sanitizeLabel(ws.Label), s.cfDomain)
		if err := s.cfDNS.UpsertARecord(recordName, ws.Host, false); err != nil {
			s.log.Warn().Err(err).Str("record", recordName).Msg("cloudflare DNS create failed")
		} else {
			dnsResult = recordName
			server.ServiceHost = recordName
			s.db.SetWorkerServerServiceHost(r.Context(), server.ID, recordName)
		}
	}
	// Fall back to raw IP if no CF DNS was created
	if server.ServiceHost == "" && isIP(server.Host) {
		server.ServiceHost = server.Host
		s.db.SetWorkerServerServiceHost(r.Context(), server.ID, server.Host)
	}

	resp := map[string]interface{}{
		"server":           server,
		"docker_installed": dockerOK,
		"message":          dockerMessage(dockerOK),
	}
	if dnsResult != "" {
		resp["dns_record"] = dnsResult
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (s *Server) handleDeleteUserServer(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	serverID := chi.URLParam(r, "serverId")

	server, _ := s.db.GetWorkerServer(r.Context(), serverID)
	if server == nil || server.UserID == nil || *server.UserID != u.ID {
		writeError(w, http.StatusNotFound, "server not found")
		return
	}

	// Clean the host BEFORE dropping the row, and report the outcome. This
	// used to be fire-and-forget, so an unreachable VPS silently kept running
	// containers while the UI said "deleted" — leaving the owner with no
	// record of what to clean up on a machine we no longer track.
	purgeErr := s.purgeServerResources(r.Context(), server)

	if err := s.db.DeleteWorkerServer(r.Context(), serverID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete server: "+err.Error())
		return
	}

	resp := map[string]string{"status": "deleted"}
	if purgeErr != nil {
		resp["warning"] = leftoverWarning(server, server.CurrentProjects)
	}
	writeJSON(w, http.StatusOK, resp)
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

// probeServerResources SSHes in and returns (cpus, memoryMB) from the remote
// host. Falls back to (0, 0) on any failure so the caller keeps defaults.
func probeServerResources(ws *db.WorkerServer) (float64, int) {
	probe := "echo $(nproc) $(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
	var cmd string
	if ws.SSHPassword != "" {
		cmd = fmt.Sprintf("sshpass -p '%s' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 %s@%s -p %d %q 2>/dev/null",
			ws.SSHPassword, ws.SSHUser, ws.Host, ws.Port, probe)
	} else if ws.SSHKey != "" {
		cmd = fmt.Sprintf("KEY=$(mktemp) && echo %q > $KEY && chmod 600 $KEY && ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 %s@%s -p %d %q 2>/dev/null; RC=$?; rm -f $KEY; exit $RC",
			ws.SSHKey, ws.SSHUser, ws.Host, ws.Port, probe)
	} else {
		return 0, 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "bash", "-c", cmd).Output()
	if err != nil {
		return 0, 0
	}
	var cpus float64
	var mem int
	fmt.Sscanf(strings.TrimSpace(string(out)), "%f %d", &cpus, &mem)
	return cpus, mem
}

func dockerMessage(installed bool) string {
	if installed {
		return "Server connected. Docker is installed and ready."
	}
	return "Server connected but Docker is not installed. Install Docker to deploy projects."
}

// handleInstallDocker kicks off an async Docker install on a user's BYOC
// server and returns immediately with status=installing so browser timeouts
// can't lose the install state. The UI polls the servers list to see when
// docker_install_status flips to "installed" or "failed".
func (s *Server) handleInstallDocker(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	serverID := chi.URLParam(r, "serverId")

	server, _ := s.db.GetWorkerServer(r.Context(), serverID)
	if server == nil || server.UserID == nil || *server.UserID != u.ID {
		writeError(w, http.StatusNotFound, "server not found")
		return
	}
	if server.DockerInstalled {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already_installed"})
		return
	}
	if server.DockerInstallStatus == "installing" {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "installing"})
		return
	}

	// Flip to installing before returning so concurrent clicks don't spawn
	// duplicate installs.
	s.db.SetDockerInstallStatus(r.Context(), server.ID, "installing", "")

	go s.runDockerInstall(server)

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "installing"})
}

func (s *Server) runDockerInstall(server *db.WorkerServer) {
	// get.docker.com is the official bootstrap. Idempotent — safe to re-run.
	install := "curl -fsSL https://get.docker.com | sh && systemctl enable --now docker"
	var cmd string
	if server.SSHPassword != "" {
		cmd = fmt.Sprintf("sshpass -p '%s' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 %s@%s -p %d %q 2>&1",
			server.SSHPassword, server.SSHUser, server.Host, server.Port, install)
	} else if server.SSHKey != "" {
		cmd = fmt.Sprintf("KEY=$(mktemp) && echo %q > $KEY && chmod 600 $KEY && ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15 %s@%s -p %d %q 2>&1; RC=$?; rm -f $KEY; exit $RC",
			server.SSHKey, server.SSHUser, server.Host, server.Port, install)
	} else {
		s.db.SetDockerInstallStatus(context.Background(), server.ID, "failed", "no ssh credentials")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, "bash", "-c", cmd).CombinedOutput()
	if err != nil {
		s.db.SetDockerInstallStatus(context.Background(), server.ID, "failed", lastLine(string(out)))
		return
	}

	// Verify docker is now callable. Retry a few times since the daemon may
	// take a few seconds to start after `systemctl enable --now docker`.
	ok := false
	for i := 0; i < 5; i++ {
		if testServerConnection(server) {
			ok = true
			break
		}
		time.Sleep(3 * time.Second)
	}

	if ok {
		s.db.UpdateWorkerServerDockerInstalled(context.Background(), server.ID, true)
		s.db.SetDockerInstallStatus(context.Background(), server.ID, "installed", "")
		// Refresh hardware stats now that we have SSH working end-to-end.
		if cpus, memMB := probeServerResources(server); cpus > 0 && memMB > 0 {
			s.db.UpdateWorkerServerCapacity(context.Background(), server.ID, cpus, memMB)
		}
	} else {
		s.db.SetDockerInstallStatus(context.Background(), server.ID, "failed", "install finished but docker --version still fails")
	}
}

func lastLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, "\n"); i >= 0 {
		return s[i+1:]
	}
	return s
}

// isIP returns true when s is a valid IPv4 or IPv6 address (not a hostname).
func isIP(s string) bool {
	return net.ParseIP(s) != nil
}

var labelSanitizer = regexp.MustCompile(`[^a-z0-9-]`)

// sanitizeLabel lowercases and strips characters unsafe for a DNS label.
func sanitizeLabel(label string) string {
	s := strings.ToLower(label)
	s = labelSanitizer.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}

// handleListSelectableServers returns the platform regions (and the user's own
// BYOC servers) a user may deploy to. Powers the region picker in the project
// create flow — no more silent auto-assignment.
func (s *Server) handleListSelectableServers(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	servers, err := s.db.ListSelectableServers(r.Context(), u.ID)
	if err != nil {
		s.log.Error().Err(err).Msg("list selectable servers")
		writeError(w, http.StatusInternalServerError, "failed to list servers")
		return
	}
	writeJSON(w, http.StatusOK, servers)
}

// handleAdminSetServerSelectable toggles whether a platform server is offered
// in the user region picker — independent of active/draining status, so an
// admin can hide a server from self-serve without taking it out of rotation.
func (s *Server) handleAdminSetServerSelectable(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverId")
	var req struct {
		Selectable bool `json:"selectable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := s.db.SetServerUserSelectable(r.Context(), serverID, req.Selectable); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update server")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"user_selectable": req.Selectable})
}
