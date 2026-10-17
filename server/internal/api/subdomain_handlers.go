package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

func (s *Server) handleListSubdomains(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	subs, err := s.db.ListUserSubdomains(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list subdomains")
		return
	}

	count, _ := s.db.CountUserSubdomains(r.Context(), u.ID)

	user, _ := s.db.GetUserByID(r.Context(), u.ID)
	plan := "free"
	if user != nil {
		plan = user.Plan
	}
	limits, _ := s.db.GetPlanLimits(r.Context(), plan)

	// What each reserved name is used by right now: a live tunnel from this
	// user's CLI and/or a deployed app on the same subdomain.
	type tunnelUse struct {
		URL       string `json:"url"`
		LocalAddr string `json:"local_addr"`
		Protocol  string `json:"protocol"`
	}
	type item struct {
		ID        string                  `json:"id"`
		Subdomain string                  `json:"subdomain"`
		CreatedAt interface{}             `json:"created_at"`
		Tunnel    *tunnelUse              `json:"tunnel,omitempty"`
		Project   *db.SubdomainProjectUse `json:"project,omitempty"`
	}
	live := map[string]*tunnelUse{}
	for _, t := range s.registry.ListByUser(u.ID) {
		// The URL's first label is authoritative (https://<name>.<domain>);
		// t.Subdomain may hold the full host rather than the bare name.
		host := strings.TrimPrefix(strings.TrimPrefix(t.URL, "https://"), "http://")
		name, _, _ := strings.Cut(host, ".")
		if name != "" {
			live[name] = &tunnelUse{URL: t.URL, LocalAddr: t.LocalAddr, Protocol: t.Protocol}
		}
	}
	projects, err := s.db.ProjectsBySubdomain(r.Context(), u.ID)
	if err != nil {
		s.log.Warn().Err(err).Msg("subdomain project usage")
		projects = nil
	}
	items := make([]item, 0, len(subs))
	for _, sd := range subs {
		it := item{ID: sd.ID, Subdomain: sd.Subdomain, CreatedAt: sd.CreatedAt, Tunnel: live[sd.Subdomain]}
		if p, ok := projects[sd.Subdomain]; ok {
			pp := p
			it.Project = &pp
		}
		items = append(items, it)
	}

	// Every plan's allowance, for the upgrade hint (the page used to print the
	// caller's own limit as the "Free" figure).
	planLimits := map[string]int{}
	if all, err := s.db.ListPlanLimits(r.Context()); err == nil {
		for _, pl := range all {
			if pl.Plan != "admin" {
				planLimits[pl.Plan] = pl.MaxSubdomains
			}
		}
	}
	domain := "deployzy.app"
	if s.deployer != nil && s.deployer.AppDomain != "" {
		domain = s.deployer.AppDomain
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subdomains":  items,
		"count":       count,
		"limit":       limits.MaxSubdomains,
		"plan":        plan,
		"domain":      domain,
		"plan_limits": planLimits,
	})
}

func (s *Server) handleAddSubdomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Subdomain string `json:"subdomain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Subdomain == "" {
		writeError(w, http.StatusBadRequest, "subdomain required")
		return
	}

	available, reason := s.db.CheckSubdomainAvailable(r.Context(), req.Subdomain, u.ID)
	if !available {
		writeError(w, http.StatusConflict, reason)
		return
	}

	if err := s.db.ReserveSubdomainAuto(r.Context(), u.ID, req.Subdomain); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reserve subdomain")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"subdomain": req.Subdomain,
		"url":       "https://" + req.Subdomain + ".deployzy.com",
	})
}

func (s *Server) handleReleaseSubdomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Subdomain string `json:"subdomain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Subdomain == "" {
		writeError(w, http.StatusBadRequest, "subdomain required")
		return
	}

	if err := s.db.ReleaseSubdomain(r.Context(), u.ID, req.Subdomain); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "released"})
}

func (s *Server) handleCheckSubdomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	subdomain := r.URL.Query().Get("subdomain")
	if subdomain == "" {
		writeError(w, http.StatusBadRequest, "subdomain required")
		return
	}

	slug := slugifySubdomain(subdomain)
	available, reason := s.db.CheckSubdomainAvailable(r.Context(), slug, u.ID)
	// suggestion is the name the deploy would actually use: the clean slug when
	// it's free, or a Vercel/Railway-style variant with a random id when taken.
	suggestion := slug
	if !available && reason == "subdomain already taken" {
		suggestion = s.uniqueSubdomain(r.Context(), slug, u.ID)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subdomain":  subdomain,
		"slug":       slug,
		"available":  available,
		"reason":     reason,
		"suggestion": suggestion,
	})
}
