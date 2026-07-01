package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	db "github.com/serverme/serverme/server/internal/db"
)

// --- JSON helpers ---

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v interface{}) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// --- Health ---

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"version": proto.Version,
	})
}

// --- Auth ---

type registerRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Ref      string `json:"ref"` // optional referral code
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password required")
		return
	}

	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	// Check if email exists
	existing, err := s.db.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		s.log.Error().Err(err).Msg("check existing user")
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, "email already registered")
		return
	}

	user, err := s.db.CreateUser(r.Context(), req.Email, req.Name, req.Password)
	if err != nil {
		s.log.Error().Err(err).Msg("create user")
		writeError(w, http.StatusInternalServerError, "failed to create user")
		return
	}

	// Referral attribution: if a valid ref code was passed, link this signup.
	if req.Ref != "" {
		if referrerID := s.db.ResolveReferralCode(r.Context(), req.Ref); referrerID != "" {
			s.db.SetReferredBy(r.Context(), user.ID, referrerID)
		}
	}

	// Generate JWT
	token, err := s.jwt.Generate(user.ID, user.Email, user.Plan)
	if err != nil {
		s.log.Error().Err(err).Msg("generate token")
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	// Generate initial API key
	fullToken, apiKey, err := s.db.GenerateAPIKey(r.Context(), user.ID, "default", "full")
	if err != nil {
		s.log.Error().Err(err).Msg("generate api key")
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"user":    user,
		"token":   token,
		"api_key": fullToken,
		"api_key_info": apiKey,
	})
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := s.db.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		s.log.Error().Err(err).Msg("get user")
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil || !user.CheckPassword(req.Password) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	token, err := s.jwt.Generate(user.ID, user.Email, user.Plan)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user":  user,
		"token": token,
	})
}

// --- User ---

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	user, err := s.db.GetUserByID(r.Context(), u.ID)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) handleDeleteMe(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	if err := s.db.DeleteUser(r.Context(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete account")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// --- API Keys ---

func (s *Server) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	keys, err := s.db.ListAPIKeys(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list keys")
		return
	}
	if keys == nil {
		keys = []db.APIKey{}
	}
	writeJSON(w, http.StatusOK, keys)
}

type createAPIKeyRequest struct {
	Name  string `json:"name"`
	Scope string `json:"scope"` // "read" | "deploy" | "full" (default)
}

func (s *Server) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req createAPIKeyRequest
	if err := decodeJSON(r, &req); err != nil {
		req.Name = "default"
	}
	if req.Name == "" {
		req.Name = "default"
	}
	if req.Scope == "" {
		req.Scope = "full"
	}
	if !db.ValidScope(req.Scope) {
		writeError(w, http.StatusBadRequest, "scope must be 'read', 'deploy', or 'full'")
		return
	}
	// Only a full-scope session can mint a full-scope key — stops a leaked
	// deploy/read key from escalating to a full key.
	if req.Scope == "full" && u.Scope != "full" {
		writeError(w, http.StatusForbidden, "only a full-access session can create a full-scope key")
		return
	}

	fullToken, key, err := s.db.GenerateAPIKey(r.Context(), u.ID, req.Name, req.Scope)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create key")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"api_key": fullToken,
		"info":    key,
	})
}

func (s *Server) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	keyID := chi.URLParam(r, "id")

	if err := s.db.DeleteAPIKey(r.Context(), u.ID, keyID); err != nil {
		writeError(w, http.StatusNotFound, "key not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// --- Domains ---

func (s *Server) handleListDomains(w http.ResponseWriter, r *http.Request) {
	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	domains, err := s.db.ListDomainsForUsers(r.Context(), userIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list domains")
		return
	}
	if domains == nil {
		domains = []db.Domain{}
	}
	writeJSON(w, http.StatusOK, domains)
}

type createDomainRequest struct {
	Domain string `json:"domain"`
}

func (s *Server) handleCreateDomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req createDomainRequest
	if err := decodeJSON(r, &req); err != nil || req.Domain == "" {
		writeError(w, http.StatusBadRequest, "domain required")
		return
	}

	// Check if domain already exists
	existing, _ := s.db.GetDomainByName(r.Context(), req.Domain)
	if existing != nil {
		writeError(w, http.StatusConflict, "domain already registered")
		return
	}

	// Plan limit: max custom domains.
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimCustomDomain); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	cnameTarget := "deployzy.com"
	dom, err := s.db.CreateDomain(r.Context(), u.ID, req.Domain, cnameTarget)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create domain")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"domain": dom,
		"instructions": map[string]string{
			"type":   "CNAME",
			"name":   req.Domain,
			"target": cnameTarget,
			"note":   "Add this CNAME record to your DNS, then call POST /api/v1/domains/{id}/verify",
		},
	})
}

func (s *Server) handleDeleteDomain(w http.ResponseWriter, r *http.Request) {
	domID := chi.URLParam(r, "id")

	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	if err := s.db.DeleteDomainForUsers(r.Context(), userIDs, domID); err != nil {
		writeError(w, http.StatusNotFound, "domain not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleVerifyDomain(w http.ResponseWriter, r *http.Request) {
	domID := chi.URLParam(r, "id")

	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	domains, err := s.db.ListDomainsForUsers(r.Context(), userIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	var targetDomain *db.Domain
	for _, d := range domains {
		if d.ID == domID {
			targetDomain = &d
			break
		}
	}
	if targetDomain == nil {
		writeError(w, http.StatusNotFound, "domain not found")
		return
	}

	// Try multiple verification methods
	verified := false
	method := ""
	expected := targetDomain.CnameTarget

	// Method 1: CNAME lookup
	cnames, _ := net.LookupCNAME(targetDomain.Domain)
	if cnames == expected || cnames == expected+"." {
		verified = true
		method = "cname"
	}

	// Method 2: A-record comparison (Cloudflare flattens root CNAMEs)
	if !verified {
		ips, _ := net.LookupHost(targetDomain.Domain)
		serverIPs, _ := net.LookupHost(expected)
		for _, ip := range ips {
			for _, sip := range serverIPs {
				if ip == sip {
					verified = true
					method = "a-record"
					break
				}
			}
			if verified {
				break
			}
		}
	}

	// Method 3: Check against known server IP using external DNS (dig)
	if !verified {
		out, err := exec.Command("dig", "+short", targetDomain.Domain, "@8.8.8.8").Output()
		if err == nil {
			domainIP := strings.TrimSpace(string(out))
			out2, err2 := exec.Command("dig", "+short", expected, "@8.8.8.8").Output()
			if err2 == nil {
				serverIP := strings.TrimSpace(string(out2))
				if domainIP != "" && serverIP != "" && domainIP == serverIP {
					verified = true
					method = "dig"
				}
			}
		}
	}

	// Method 4: Direct IP check using curl (last resort)
	if !verified {
		out, _ := exec.Command("dig", "+short", targetDomain.Domain).Output()
		domainIP := strings.TrimSpace(string(out))
		out2, _ := exec.Command("dig", "+short", expected).Output()
		serverIP := strings.TrimSpace(string(out2))
		if domainIP != "" && serverIP != "" && domainIP == serverIP {
			verified = true
			method = "dig-local"
		}
	}

	if verified {
		if err := s.db.VerifyDomain(r.Context(), domID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to verify")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"verified": true,
			"method":   method,
		})
	} else {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"verified": false,
			"found":    cnames,
			"expected": expected,
			"hint":     "If using Cloudflare, make sure the CNAME/A record points to deployzy.com",
		})
	}
}

func (s *Server) handleBindDomain(w http.ResponseWriter, r *http.Request) {
	domID := chi.URLParam(r, "id")

	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		TargetType      string `json:"target_type"`
		TargetSubdomain string `json:"target_subdomain"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.TargetType != "tunnel" && req.TargetType != "project" {
		writeError(w, http.StatusBadRequest, "target_type must be 'tunnel' or 'project'")
		return
	}
	if req.TargetSubdomain == "" {
		writeError(w, http.StatusBadRequest, "target_subdomain required")
		return
	}

	// Verify the user has access to the target (tunnel or project)
	if req.TargetType == "project" {
		found := false
		for _, uid := range userIDs {
			projects, _ := s.db.ListProjects(r.Context(), uid)
			for _, p := range projects {
				if p.Subdomain == req.TargetSubdomain {
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			writeError(w, http.StatusBadRequest, "no project with that subdomain found in your team")
			return
		}
	}

	// Find which user in the team owns this domain
	domains, err := s.db.ListDomainsForUsers(r.Context(), userIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to find domain")
		return
	}
	var domainOwnerID string
	for _, d := range domains {
		if d.ID == domID {
			domainOwnerID = d.UserID
			break
		}
	}
	if domainOwnerID == "" {
		writeError(w, http.StatusNotFound, "domain not found or not accessible")
		return
	}

	if err := s.db.BindDomain(r.Context(), domID, domainOwnerID, req.TargetType, req.TargetSubdomain); err != nil {
		writeError(w, http.StatusBadRequest, "failed to bind domain — is it verified?")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":           "bound",
		"target_type":      req.TargetType,
		"target_subdomain": req.TargetSubdomain,
	})
}

// --- Tunnels ---

func (s *Server) handleListTunnels(w http.ResponseWriter, r *http.Request) {
	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	var result []map[string]interface{}

	// Active CLI tunnels
	for _, uid := range userIDs {
		tunnels := s.registry.ListByUser(uid)
		for _, t := range tunnels {
			result = append(result, map[string]interface{}{
				"url":       t.URL,
				"protocol":  t.Protocol,
				"name":      t.Name,
				"client_id": t.ClientID,
				"user_id":   t.UserID,
				"type":      "tunnel",
			})
		}
	}

	// Deployed projects (running containers)
	if s.db != nil {
		for _, uid := range userIDs {
			projects, _ := s.db.ListProjects(r.Context(), uid)
			for _, p := range projects {
				if p.Status == "running" {
					result = append(result, map[string]interface{}{
						"url":      fmt.Sprintf("https://%s.%s", p.Subdomain, "deployzy.com"),
						"protocol": "deploy",
						"name":     p.Name,
						"user_id":  p.UserID,
						"type":     "project",
						"status":   p.Status,
					})
				}
			}
		}
	}

	if result == nil {
		result = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, result)
}

// --- Subdomains ---

type reserveSubdomainRequest struct {
	Subdomain string `json:"subdomain"`
}

func (s *Server) handleReserveSubdomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	if u.Plan == "free" {
		writeError(w, http.StatusForbidden, "reserved subdomains require a paid plan")
		return
	}

	var req reserveSubdomainRequest
	if err := decodeJSON(r, &req); err != nil || req.Subdomain == "" {
		writeError(w, http.StatusBadRequest, "subdomain required")
		return
	}

	// Check if already taken
	existing, _ := s.db.GetReservedSubdomain(r.Context(), req.Subdomain)
	if existing != nil {
		writeError(w, http.StatusConflict, "subdomain already reserved")
		return
	}

	rs, err := s.db.ReserveSubdomain(r.Context(), u.ID, req.Subdomain)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reserve subdomain")
		return
	}

	writeJSON(w, http.StatusCreated, rs)
}
