package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/db"
)

// handleSubmitAbuseReport accepts a public abuse report (phishing, malware,
// spam, illegal content) against a deployed app / tunnel / domain. No auth;
// rate-limited by the unauth limiter on this route group. Stores it and pings
// the admin so takedown can happen fast.
func (s *Server) handleSubmitAbuseReport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TargetURL     string `json:"target_url"`
		Category      string `json:"category"`
		Details       string `json:"details"`
		ReporterEmail string `json:"reporter_email"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.TargetURL) == "" {
		writeError(w, http.StatusBadRequest, "the reported URL is required")
		return
	}
	cat := strings.ToLower(strings.TrimSpace(req.Category))
	switch cat {
	case "phishing", "malware", "spam", "illegal", "other":
	default:
		cat = "other"
	}
	rep := &db.AbuseReport{
		TargetURL:     strings.TrimSpace(req.TargetURL),
		Category:      cat,
		Details:       strings.TrimSpace(req.Details),
		ReporterEmail: strings.TrimSpace(req.ReporterEmail),
		ReporterIP:    requestIP(r),
	}
	if err := s.db.CreateAbuseReport(r.Context(), rep); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to submit report")
		return
	}

	// Notify the team so takedown is fast (best-effort).
	if s.emailSvc != nil {
		go func(rep db.AbuseReport) {
			body := "<p><strong>New abuse report</strong></p>" +
				"<p>Category: " + htmlEscapeSafe(rep.Category) + "<br>" +
				"URL: " + htmlEscapeSafe(rep.TargetURL) + "<br>" +
				"Reporter: " + htmlEscapeSafe(rep.ReporterEmail) + " (" + htmlEscapeSafe(rep.ReporterIP) + ")</p>" +
				"<p>" + htmlEscapeSafe(rep.Details) + "</p>" +
				"<p>Triage in the admin console → IP Bans / Users / Projects.</p>"
			_ = s.emailSvc.SendOne("support@deployzy.com", "⚠️ Abuse report: "+rep.Category, body)
		}(*rep)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "received"})
}

func (s *Server) handleAdminListAbuseReports(w http.ResponseWriter, r *http.Request) {
	reports, err := s.db.ListAbuseReports(r.Context(), r.URL.Query().Get("status"), 200)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list reports")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reports": reports})
}

func (s *Server) handleAdminSetAbuseReportStatus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Status string `json:"status"`
	}
	decodeJSON(r, &req)
	if req.Status != "actioned" && req.Status != "dismissed" && req.Status != "open" {
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}
	if err := s.db.SetAbuseReportStatus(r.Context(), chi.URLParam(r, "id"), req.Status); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// htmlEscapeSafe is a tiny escaper for the notification email body.
func htmlEscapeSafe(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;")
	return r.Replace(s)
}
