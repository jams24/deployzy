package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"

	"github.com/creack/pty"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

// termClientMsg is what the browser sends us. Every client→server frame is a
// JSON text message so keystrokes and control (resize) share one channel.
//   {"type":"input","data":"ls\n"}
//   {"type":"resize","cols":120,"rows":30}
type termClientMsg struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// handleProjectTerminalWS gives the user an interactive shell inside their
// running container, straight from the dashboard (like Railway's Shell tab).
//
// Wire protocol:
//   - client → server: JSON text frames (termClientMsg above)
//   - server → client: raw container output as BINARY frames; lifecycle
//     notices ({"type":"status"|"error","msg":...}) as JSON TEXT frames.
//
// Auth is via ?token= (browsers can't set Authorization on WS upgrades),
// the same JWT used for REST. Owner-or-admin only.
func (s *Server) handleProjectTerminalWS(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")

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

	isAdmin, _ := s.db.IsUserAdmin(r.Context(), claims.UserID)
	project, _ := s.db.GetProject(r.Context(), projectID)
	if project == nil || (project.UserID != claims.UserID && !isAdmin) {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	if project.ContainerID == "" {
		http.Error(w, "no container running", http.StatusConflict)
		return
	}
	// Same paid gate as live logs (admins exempt). The web shell is a
	// debugging power-tool, so it rides the same feature flag.
	if !isAdmin && !s.isFeatureAllowedForUser(r.Context(), claims.UserID, "live_logs") {
		http.Error(w, "web terminal requires a paid plan", http.StatusPaymentRequired)
		return
	}
	if s.deployer == nil {
		http.Error(w, "deploy engine unavailable", http.StatusServiceUnavailable)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Debug().Err(err).Msg("terminal ws upgrade failed")
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	cmd, localPTY := s.deployer.ShellExecCmd(ctx, project)

	var shellIn io.Writer      // where we write the user's keystrokes
	var shellOut io.Reader     // where container output comes from
	var ptmx *os.File          // set only in local-PTY mode
	var cleanup func()

	s.log.Info().Str("project", projectID).Bool("local_pty", localPTY).Msg("terminal session opening")

	if localPTY {
		p, perr := pty.Start(cmd)
		if perr != nil {
			s.log.Warn().Err(perr).Str("project", projectID).Msg("terminal pty.Start failed")
			_ = conn.WriteJSON(map[string]string{"type": "error", "msg": "failed to open shell: " + perr.Error()})
			return
		}
		// Give the shell a sane default window so bash renders a prompt; the
		// client sends a real resize on connect.
		_ = pty.Setsize(p, &pty.Winsize{Rows: 30, Cols: 100})
		ptmx = p
		shellIn = p
		shellOut = p
		cleanup = func() {
			_ = ptmx.Close()
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			_ = cmd.Wait()
		}
	} else {
		// Remote: ssh -tt already allocated a PTY on the host, so stdout
		// carries the merged stream. Pipe stdin/stdout raw.
		sin, e1 := cmd.StdinPipe()
		sout, e2 := cmd.StdoutPipe()
		if e1 != nil || e2 != nil {
			_ = conn.WriteJSON(map[string]string{"type": "error", "msg": "failed to open shell"})
			return
		}
		if serr := cmd.Start(); serr != nil {
			_ = conn.WriteJSON(map[string]string{"type": "error", "msg": "failed to start shell: " + serr.Error()})
			return
		}
		shellIn = sin
		shellOut = sout
		cleanup = func() {
			_ = sin.Close()
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			_ = cmd.Wait()
		}
	}
	defer cleanup()

	_ = conn.WriteJSON(map[string]string{"type": "status", "msg": "connected"})

	// container → client: stream raw output as binary frames.
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, rerr := shellOut.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					cancel()
					return
				}
			}
			if rerr != nil {
				// Shell exited or pipe closed — tell the client and stop.
				s.log.Info().Err(rerr).Str("project", projectID).Msg("terminal shell output ended")
				_ = conn.WriteJSON(map[string]string{"type": "status", "msg": "session ended"})
				cancel()
				return
			}
		}
	}()

	// client → container: keystrokes + resize.
	for {
		mt, data, rerr := conn.ReadMessage()
		if rerr != nil {
			cancel()
			return
		}
		if mt != websocket.TextMessage {
			continue
		}
		var msg termClientMsg
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "input":
			if _, werr := io.WriteString(shellIn, msg.Data); werr != nil {
				cancel()
				return
			}
		case "resize":
			if ptmx != nil && msg.Cols > 0 && msg.Rows > 0 {
				_ = pty.Setsize(ptmx, &pty.Winsize{Rows: msg.Rows, Cols: msg.Cols})
			}
			// Remote resize is best-effort skipped; ssh -tt uses a default size.
		}
	}
}
