package api

import (
	"encoding/json"
	"github.com/serverme/serverme/server/internal/auth"
	"net/http"
	"strconv"

	"net/url"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/serverme/serverme/server/internal/inspect"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// handleListRequests returns captured requests for a tunnel.
// canInspectTunnel reports whether any of userIDs (the caller's workspace)
// owns tunnelURL. The owner comes from the live registry, or from buffered
// captures once the tunnel has disconnected. Unknown owner → no access.
// Admins get no bypass: captured traffic carries the tunnel owner's (and
// their visitors') headers, cookies and tokens.
func (s *Server) canInspectTunnel(tunnelURL string, userIDs []string) bool {
	owner := ""
	if t := s.registry.LookupByURL(tunnelURL); t != nil {
		owner = t.UserID
	} else if s.inspect != nil {
		owner = s.inspect.OwnerOf(tunnelURL)
	}
	if owner == "" {
		return false
	}
	for _, id := range userIDs {
		if id == owner {
			return true
		}
	}
	return false
}

// inspectAccess resolves the tunnel URL param and checks ownership; it writes
// the error response and returns "" when the caller may not inspect it.
func (s *Server) inspectAccess(w http.ResponseWriter, r *http.Request) string {
	tunnelURL, _ := url.PathUnescape(chi.URLParam(r, "url"))
	if tunnelURL == "" {
		writeError(w, http.StatusBadRequest, "tunnel URL required")
		return ""
	}
	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return ""
	}
	if !s.canInspectTunnel(tunnelURL, userIDs) {
		writeError(w, http.StatusNotFound, "tunnel not found")
		return ""
	}
	return tunnelURL
}

func (s *Server) handleListRequests(w http.ResponseWriter, r *http.Request) {
	tunnelURL := s.inspectAccess(w, r)
	if tunnelURL == "" {
		return
	}

	requests := s.inspect.List(tunnelURL)
	if requests == nil {
		requests = []*inspect.CapturedRequest{}
	}
	writeJSON(w, http.StatusOK, requests)
}

// handleGetRequest returns a single captured request by ID.
func (s *Server) handleGetRequest(w http.ResponseWriter, r *http.Request) {
	tunnelURL := s.inspectAccess(w, r)
	if tunnelURL == "" {
		return
	}
	reqID := chi.URLParam(r, "reqId")

	req := s.inspect.Get(tunnelURL, reqID)
	if req == nil {
		writeError(w, http.StatusNotFound, "request not found")
		return
	}
	writeJSON(w, http.StatusOK, req)
}

// handleReplayRequest replays a captured request through the tunnel.
func (s *Server) handleReplayRequest(w http.ResponseWriter, r *http.Request) {
	tunnelURL, _ := url.PathUnescape(chi.URLParam(r, "url"))
	reqID := chi.URLParam(r, "reqId")

	captured := s.inspect.Get(tunnelURL, reqID)
	if captured == nil {
		writeError(w, http.StatusNotFound, "request not found")
		return
	}

	// Find the tunnel to get the proxy URL
	tunnels := s.registry.List()
	var proxyURL string
	for _, t := range tunnels {
		if t.URL == tunnelURL {
			proxyURL = tunnelURL
			break
		}
	}
	if proxyURL == "" {
		writeError(w, http.StatusNotFound, "tunnel no longer active")
		return
	}

	result, err := inspect.Replay(captured, proxyURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "replay failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// handleTrafficWebSocket streams live captured requests via WebSocket.
func (s *Server) handleTrafficWebSocket(w http.ResponseWriter, r *http.Request) {
	tunnelURL, _ := url.PathUnescape(chi.URLParam(r, "url"))
	if tunnelURL == "" {
		http.Error(w, "tunnel URL required", http.StatusBadRequest)
		return
	}
	// Browsers can't set headers on a WebSocket, so the JWT rides in ?token=
	// (same as the project logs/terminal sockets). This endpoint used to be
	// completely unauthenticated: anyone could stream any tunnel's traffic.
	claims, err := s.jwt.Validate(r.URL.Query().Get("token"))
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userIDs := []string{claims.UserID}
	if teamID := r.URL.Query().Get("team_id"); teamID != "" {
		if _, ok := s.db.IsTeamMember(r.Context(), teamID, claims.UserID); !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		members, err := s.db.ListTeamMembers(r.Context(), teamID)
		if err != nil {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		userIDs = userIDs[:0]
		for _, m := range members {
			userIDs = append(userIDs, m.UserID)
		}
	}
	if !s.canInspectTunnel(tunnelURL, userIDs) {
		http.Error(w, "tunnel not found", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Error().Err(err).Msg("WebSocket upgrade failed")
		return
	}
	defer conn.Close()

	// Subscribe to traffic for this tunnel
	ch := s.inspect.Subscribe(tunnelURL)
	defer s.inspect.Unsubscribe(tunnelURL, ch)

	s.log.Debug().Str("tunnel", tunnelURL).Msg("WebSocket traffic subscriber connected")

	// Read loop (to detect client disconnect)
	go func() {
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				return
			}
		}
	}()

	// Write loop (stream captured requests)
	for req := range ch {
		data, err := json.Marshal(req)
		if err != nil {
			continue
		}
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			s.log.Debug().Err(err).Msg("WebSocket write failed")
			return
		}
	}
}

func (s *Server) handleAnalytics(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeError(w, http.StatusServiceUnavailable, "analytics requires database")
		return
	}

	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	hours := 24
	if h := r.URL.Query().Get("hours"); h != "" {
		if parsed, err := strconv.Atoi(h); err == nil && parsed > 0 {
			hours = parsed
		}
	}

	analytics, err := s.db.GetAnalyticsForUsers(r.Context(), userIDs, hours)
	if err != nil {
		s.log.Error().Err(err).Msg("analytics query failed")
		writeError(w, http.StatusInternalServerError, "analytics query failed")
		return
	}

	writeJSON(w, http.StatusOK, analytics)
}

// handleAccountAnalytics serves the Account → Analytics page: traffic to the
// workspace's apps and tunnels (?range=24h|7d|30d), plus this month's
// bandwidth against the plan cap. Replaces the inspector-only /analytics
// view, which was empty unless request inspection was enabled.
func (s *Server) handleAccountAnalytics(w http.ResponseWriter, r *http.Request) {
	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	u := auth.GetUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	a, err := s.db.GetAccountAnalytics(r.Context(), userIDs, u.ID, r.URL.Query().Get("range"))
	if err != nil {
		s.log.Error().Err(err).Msg("account analytics")
		writeError(w, http.StatusInternalServerError, "failed to load analytics")
		return
	}
	writeJSON(w, http.StatusOK, a)
}

// handleClearRequests empties a tunnel's in-memory capture buffer (owner only).
func (s *Server) handleClearRequests(w http.ResponseWriter, r *http.Request) {
	tunnelURL := s.inspectAccess(w, r)
	if tunnelURL == "" {
		return
	}
	s.inspect.Clear(tunnelURL)
	writeJSON(w, http.StatusOK, map[string]string{"status": "cleared"})
}
