package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

// osPipe returns an os.Pipe. Wrapped so the import stays tidy.
func osPipe() (*os.File, *os.File, error) {
	return os.Pipe()
}

// handleProjectLogsWS streams a project's container logs live over WebSocket.
// Auth uses a ?token= query param because browsers can't attach Authorization
// headers to WebSocket upgrades. Token is the same JWT used for REST calls.
//
// On the wire: each frame is a JSON line {"t":"<ISO time>","line":"..."}
// plus occasional {"type":"status","msg":"..."} for lifecycle events.
func (s *Server) handleProjectLogsWS(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")

	// Auth via ?token=
	tok := r.URL.Query().Get("token")
	if tok == "" {
		http.Error(w, "token required", http.StatusUnauthorized)
		return
	}
	claims, err := s.jwt.Validate(tok)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || project.UserID != claims.UserID {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	if project.ContainerID == "" {
		http.Error(w, "no container running", http.StatusConflict)
		return
	}
	// Plan-gated: free tier doesn't get live log streaming.
	if !s.isFeatureAllowedForUser(r.Context(), claims.UserID, "live_logs") {
		http.Error(w, "live log streaming requires a paid plan", http.StatusPaymentRequired)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Debug().Err(err).Msg("log ws upgrade failed")
		return
	}
	defer conn.Close()

	// Container name follows sm-<first 8 of project ID>
	containerName := fmt.Sprintf("sm-%s", project.ID[:8])

	// Use docker logs -f with the last 200 lines of backfill so the user sees
	// recent context immediately. We stream stdout+stderr combined.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	cmd := exec.CommandContext(ctx, "docker", "logs", "-f", "--tail", "200", "--timestamps", containerName)
	// Merge stdout+stderr into a single pipe so we don't need two scanners.
	stdoutR, stdoutW, pipeErr := osPipe()
	if pipeErr != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "msg": "logs unavailable"})
		return
	}
	cmd.Stdout = stdoutW
	cmd.Stderr = stdoutW
	stdout := stdoutR
	if err := cmd.Start(); err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "msg": "failed to start log stream"})
		return
	}
	// Ensure we clean up the docker process and pipe when the WS disconnects.
	defer func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		stdoutW.Close()
		_ = cmd.Wait()
		stdoutR.Close()
	}()

	// Read loop (detect client disconnect → cancel ctx → kills docker logs)
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	scanner := bufio.NewScanner(stdout)
	// Allow up to 1MB per log line (Next.js error stacks can be huge).
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	_ = conn.WriteJSON(map[string]string{"type": "status", "msg": "streaming"})
	for scanner.Scan() {
		line := scanner.Text()
		// docker logs --timestamps prefixes each line with an RFC3339Nano time;
		// split it so the client can render timestamps separately if it wants.
		t := time.Now().UTC().Format(time.RFC3339)
		msg := line
		if sp := splitTimestamp(line); sp != nil {
			t = sp[0]
			msg = sp[1]
		}
		payload, _ := json.Marshal(map[string]string{"t": t, "line": msg})
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			return
		}
	}
}

// splitTimestamp splits "2026-04-14T12:34:56.789Z log message" into [ts, msg].
// Returns nil if the line doesn't start with an ISO timestamp.
func splitTimestamp(line string) []string {
	if len(line) < 20 || line[4] != '-' || line[7] != '-' || line[10] != 'T' {
		return nil
	}
	if sp := findFirstSpace(line); sp > 0 {
		return []string{line[:sp], line[sp+1:]}
	}
	return nil
}

func findFirstSpace(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == ' ' {
			return i
		}
	}
	return -1
}
