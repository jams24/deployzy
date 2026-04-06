package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/auth"
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

	// Generate JWT
	token, err := s.jwt.Generate(user.ID, user.Email, user.Plan)
	if err != nil {
		s.log.Error().Err(err).Msg("generate token")
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	// Generate initial API key
	fullToken, apiKey, err := s.db.GenerateAPIKey(r.Context(), user.ID, "default")
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
	Name string `json:"name"`
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

	fullToken, key, err := s.db.GenerateAPIKey(r.Context(), u.ID, req.Name)
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
	u := auth.GetUser(r)
	domains, err := s.db.ListDomains(r.Context(), u.ID)
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

	cnameTarget := "serverme.site"
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
	u := auth.GetUser(r)
	domID := chi.URLParam(r, "id")

	if err := s.db.DeleteDomain(r.Context(), u.ID, domID); err != nil {
		writeError(w, http.StatusNotFound, "domain not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleVerifyDomain(w http.ResponseWriter, r *http.Request) {
	domID := chi.URLParam(r, "id")

	// Look up the domain — we need to verify CNAME
	u := auth.GetUser(r)
	domains, err := s.db.ListDomains(r.Context(), u.ID)
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

	// DNS CNAME lookup
	cnames, err := net.LookupCNAME(targetDomain.Domain)
	if err != nil {
		writeError(w, http.StatusBadRequest, "DNS lookup failed: "+err.Error())
		return
	}

	// Check if CNAME points to our target (with or without trailing dot)
	expected := targetDomain.CnameTarget
	if cnames == expected || cnames == expected+"." {
		if err := s.db.VerifyDomain(r.Context(), domID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to verify")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"verified": true,
			"cname":    cnames,
		})
	} else {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"verified":  false,
			"found":     cnames,
			"expected":  expected,
		})
	}
}

func (s *Server) handleBindDomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	domID := chi.URLParam(r, "id")

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

	// Verify the user owns the target
	if req.TargetType == "project" {
		projects, _ := s.db.ListProjects(r.Context(), u.ID)
		found := false
		for _, p := range projects {
			if p.Subdomain == req.TargetSubdomain {
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusBadRequest, "you don't own a project with that subdomain")
			return
		}
	}

	if err := s.db.BindDomain(r.Context(), domID, u.ID, req.TargetType, req.TargetSubdomain); err != nil {
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
						"url":      fmt.Sprintf("https://%s.%s", p.Subdomain, "serverme.site"),
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
