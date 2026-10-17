package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/deploy"
	"github.com/serverme/serverme/server/internal/notify"
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
				"<p>Triage in the admin console → Abuse Reports tab (https://deployzy.com/admin).</p>"
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

// handleAdminSuspendFromAbuseReport is the one-click action on a report:
// block the owner (no sign-in, no deploys), stop the reported project, and
// close the report. Refuses admin-owned projects.
func (s *Server) handleAdminSuspendFromAbuseReport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Notify bool `json:"notify"` // email the owner (off by default for abuse)
	}
	_ = decodeJSON(r, &req) // empty body = defaults
	rep, err := s.db.GetAbuseReport(r.Context(), chi.URLParam(r, "id"))
	if err != nil || rep == nil {
		writeError(w, http.StatusNotFound, "report not found")
		return
	}
	if rep.ProjectID == "" || rep.OwnerID == "" {
		writeError(w, http.StatusBadRequest, "this report doesn't point at a Deployzy app — act on it manually")
		return
	}
	if rep.OwnerIsAdmin {
		writeError(w, http.StatusBadRequest, "the owner is an admin; refusing to suspend")
		return
	}
	reason := "Abuse report (" + rep.Category + ")"
	if rep.Category == "proxy-node" {
		reason = "Running a VPN/proxy node - prohibited use of free hosting"
	}
	if err := s.db.SetUserBlocked(r.Context(), rep.OwnerID, true, reason); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to suspend owner")
		return
	}
	stopped := false
	if s.deployer != nil {
		if p, err := s.db.GetProject(r.Context(), rep.ProjectID); err == nil && p != nil {
			if err := s.deployer.Stop(r.Context(), p); err != nil {
				s.log.Warn().Err(err).Str("project", p.ID).Msg("abuse suspend: stop failed")
			} else {
				stopped = true
			}
		}
	}
	_ = s.db.SetAbuseReportStatus(r.Context(), rep.ID, "actioned")
	if req.Notify {
		var offline []string
		if stopped {
			offline = []string{rep.ProjectName}
		}
		s.sendSuspensionEmail(rep.OwnerID, offline)
	}
	writeJSON(w, http.StatusOK, map[string]any{"owner": rep.OwnerEmail, "project": rep.ProjectName, "stopped": stopped, "notified": req.Notify})
}

// handleAdminAbuseScanStatus returns the proxy-node scanner state + settings.
func (s *Server) handleAdminAbuseScanStatus(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	v, _ := s.db.GetSetting(r.Context(), deploy.AbuseAutoSuspendSetting)
	writeJSON(w, http.StatusOK, map[string]any{"scan": s.deployer.AbuseScanState(), "auto_suspend": v == "true"})
}

// handleAdminAbuseScanNow starts a scan of every platform host in the background.
func (s *Server) handleAdminAbuseScanNow(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}
	started := s.deployer.ScanProxyAbuseNow()
	writeJSON(w, http.StatusAccepted, map[string]any{"started": started})
}

// handleAdminSetAbuseAutoSuspend toggles automatic suspension of
// high-confidence proxy-node hits on free accounts.
func (s *Server) handleAdminSetAbuseAutoSuspend(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	v := "false"
	if req.Enabled {
		v = "true"
	}
	if err := s.db.SetSetting(r.Context(), deploy.AbuseAutoSuspendSetting, v); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save setting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"auto_suspend": req.Enabled})
}

// sendSuspensionEmail emails a suspended user, in the background, using the
// generic template (no detection details). offlineApps names apps that were
// stopped as part of the suspension; nil means none were.
func (s *Server) sendSuspensionEmail(userID string, offlineApps []string) {
	if s.emailSvc == nil {
		return
	}
	u, err := s.db.GetUserByID(context.Background(), userID)
	if err != nil || u == nil || u.Email == "" {
		return
	}
	go func() {
		if err := s.emailSvc.SendOne(u.Email, "Your Deployzy account has been suspended", notify.AccountSuspendedEmail(u.Name, offlineApps)); err != nil {
			s.log.Warn().Err(err).Str("user", userID).Msg("suspension email failed")
		} else {
			s.log.Info().Str("user", userID).Msg("suspension email sent")
		}
	}()
}
