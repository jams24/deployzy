package api

import (
	"net/http"
	"strings"
	"time"
)


type broadcastRequest struct {
	Subject  string `json:"subject"`
	HTMLBody string `json:"html_body"`
	Audience string `json:"audience"` // "all", "free", "pro"
}

func (s *Server) handleAdminBroadcast(w http.ResponseWriter, r *http.Request) {
	if s.emailSvc == nil {
		writeError(w, http.StatusServiceUnavailable, "email service not configured")
		return
	}

	var req broadcastRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Subject = strings.TrimSpace(req.Subject)
	req.HTMLBody = strings.TrimSpace(req.HTMLBody)
	if req.Subject == "" || req.HTMLBody == "" {
		writeError(w, http.StatusBadRequest, "subject and html_body are required")
		return
	}
	if req.Audience == "" {
		req.Audience = "all"
	}

	recipients, err := s.db.AdminGetEmailRecipients(r.Context(), req.Audience)
	if err != nil {
		s.log.Error().Err(err).Msg("get email recipients")
		writeError(w, http.StatusInternalServerError, "failed to load recipients")
		return
	}

	// Send one individual email per recipient so nobody sees others' addresses.
	// Pause every 10 sends to stay within Brevo's rate limits.
	sent, failed := 0, 0

	for i, rcpt := range recipients {
		if err := s.emailSvc.SendOne(rcpt.Email, req.Subject, req.HTMLBody); err != nil {
			s.log.Warn().Err(err).Str("to", rcpt.Email).Msg("broadcast send failed")
			failed++
		} else {
			sent++
		}
		if (i+1)%10 == 0 {
			time.Sleep(200 * time.Millisecond)
		}
	}

	s.log.Info().
		Int("sent", sent).
		Int("failed", failed).
		Str("audience", req.Audience).
		Str("subject", req.Subject).
		Msg("broadcast complete")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sent":   sent,
		"failed": failed,
		"total":  len(recipients),
	})
}

// handleAdminBroadcastPreview returns the recipient count for a given audience.
func (s *Server) handleAdminBroadcastPreview(w http.ResponseWriter, r *http.Request) {
	audience := r.URL.Query().Get("audience")
	if audience == "" {
		audience = "all"
	}

	recipients, err := s.db.AdminGetEmailRecipients(r.Context(), audience)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to count recipients")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"count":    len(recipients),
		"audience": audience,
	})
}
