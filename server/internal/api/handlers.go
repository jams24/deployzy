package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	db "github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/notify"
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

	// Reject disposable/temp-mail domains and domains that can't receive mail.
	if err := validateSignupEmail(r.Context(), req.Email); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Block signups from banned IPs.
	ip, country := requestIP(r), requestCountry(r)
	if s.db.IsIPBanned(r.Context(), ip) {
		writeError(w, http.StatusForbidden, "signups from your network are not permitted")
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
	s.db.SetUserSignupIP(r.Context(), user.ID, ip, country)

	// Referral attribution: if a valid ref code was passed, link this signup.
	if req.Ref != "" {
		if referrerID := s.db.ResolveReferralCode(r.Context(), req.Ref); referrerID != "" {
			s.db.SetReferredBy(r.Context(), user.ID, referrerID)
		}
	}

	// Password signups must confirm their address before the account becomes
	// usable — no JWT and no API key are issued until then. (Google OAuth
	// users skip this: Google already proved mailbox ownership.) If email
	// isn't configured we can't deliver a code, so fall back to issuing
	// credentials immediately rather than locking the user out.
	if s.emailSvc != nil {
		code, err := s.db.GenerateVerifyCode(r.Context(), user.ID)
		if err != nil {
			s.log.Error().Err(err).Msg("generate verify code")
			writeError(w, http.StatusInternalServerError, "failed to start verification")
			return
		}
		go func(email, name, code string) {
			if err := s.emailSvc.SendOne(email, "Your Deployzy verification code", notify.VerifyCodeEmail(name, code)); err != nil {
				s.log.Warn().Err(err).Str("email", email).Msg("failed to send verification email")
			}
		}(user.Email, user.Name, code)

		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"verification_required": true,
			"email":                 user.Email,
		})
		return
	}

	s.db.MarkEmailVerified(r.Context(), user.ID)
	s.issueCredentials(w, r, user, http.StatusCreated)
}

// issueCredentials mints the JWT + initial API key for a verified user and
// writes the standard auth payload. Shared by the register fallback and the
// email-verification endpoint so both return an identical shape.
func (s *Server) issueCredentials(w http.ResponseWriter, r *http.Request, user *db.User, status int) {
	token, err := s.jwt.Generate(user.ID, user.Email, user.Plan)
	if err != nil {
		s.log.Error().Err(err).Msg("generate token")
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	fullToken, apiKey, err := s.db.GenerateAPIKey(r.Context(), user.ID, "default", "full")
	if err != nil {
		s.log.Error().Err(err).Msg("generate api key")
	}

	// Send welcome email asynchronously so it never blocks the response.
	if s.emailSvc != nil {
		go func(email, name string) {
			if err := s.emailSvc.SendOne(email, "Welcome to Deployzy 🚀", notify.WelcomeEmail(name)); err != nil {
				s.log.Warn().Err(err).Str("email", email).Msg("failed to send welcome email")
			}
		}(user.Email, user.Name)
	}

	writeJSON(w, status, map[string]interface{}{
		"user":         user,
		"token":        token,
		"api_key":      fullToken,
		"api_key_info": apiKey,
	})
}

type verifyEmailRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

// handleVerifyEmail confirms a signup code and, on success, issues the JWT +
// API key the register call withheld.
func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req verifyEmailRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Email == "" || req.Code == "" {
		writeError(w, http.StatusBadRequest, "email and code required")
		return
	}

	user, err := s.db.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		s.log.Error().Err(err).Msg("verify: get user")
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	// Same generic message whether the address is unknown or the code is
	// wrong — don't let this endpoint enumerate registered emails.
	if user == nil {
		writeError(w, http.StatusBadRequest, "invalid or expired code")
		return
	}

	result, err := s.db.CheckVerifyCode(r.Context(), user.ID, strings.TrimSpace(req.Code))
	if err != nil {
		s.log.Error().Err(err).Msg("verify: check code")
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	switch result {
	case db.VerifyOK, db.VerifyAlreadyVerified:
		user.EmailVerified = true
		s.issueCredentials(w, r, user, http.StatusOK)
	case db.VerifyExpired, db.VerifyNoCode:
		writeError(w, http.StatusBadRequest, "code expired — request a new one")
	case db.VerifyTooManyAttempts:
		writeError(w, http.StatusTooManyRequests, "too many attempts — request a new code")
	default:
		writeError(w, http.StatusBadRequest, "invalid or expired code")
	}
}

// handleResendVerification issues a fresh code, rate-limited to one per
// minute. Always reports success so it can't be used to probe for accounts.
func (s *Server) handleResendVerification(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Email == "" {
		writeError(w, http.StatusBadRequest, "email required")
		return
	}

	ok := map[string]string{"status": "sent"}
	user, err := s.db.GetUserByEmail(r.Context(), req.Email)
	if err != nil || user == nil || user.EmailVerified || s.emailSvc == nil {
		writeJSON(w, http.StatusOK, ok)
		return
	}
	if allowed, _ := s.db.CanResendVerifyCode(r.Context(), user.ID); !allowed {
		writeError(w, http.StatusTooManyRequests, "please wait a minute before requesting another code")
		return
	}

	code, err := s.db.GenerateVerifyCode(r.Context(), user.ID)
	if err != nil {
		s.log.Error().Err(err).Msg("resend: generate code")
		writeJSON(w, http.StatusOK, ok)
		return
	}
	go func(email, name, code string) {
		if err := s.emailSvc.SendOne(email, "Your Deployzy verification code", notify.VerifyCodeEmail(name, code)); err != nil {
			s.log.Warn().Err(err).Str("email", email).Msg("failed to resend verification email")
		}
	}(user.Email, user.Name, code)

	writeJSON(w, http.StatusOK, ok)
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

	// Suspended accounts can't sign in.
	if s.db.IsUserBlocked(r.Context(), user.ID) {
		writeError(w, http.StatusForbidden, "This account has been suspended. Contact support@deployzy.com if you believe this is a mistake.")
		return
	}

	// Record where this sign-in came from (and block banned IPs).
	ip, country := requestIP(r), requestCountry(r)
	if s.db.IsIPBanned(r.Context(), ip) {
		writeError(w, http.StatusForbidden, "access from your network is not permitted")
		return
	}
	s.db.TouchUserLogin(r.Context(), user.ID, ip, country)

	// Unverified password signup: send a fresh code and tell the client to
	// show the verification step instead of logging in. Flagged distinctly so
	// the frontend can route rather than just print an error.
	if !user.EmailVerified && s.emailSvc != nil {
		if allowed, _ := s.db.CanResendVerifyCode(r.Context(), user.ID); allowed {
			if code, err := s.db.GenerateVerifyCode(r.Context(), user.ID); err == nil {
				go func(email, name, code string) {
					if err := s.emailSvc.SendOne(email, "Your Deployzy verification code", notify.VerifyCodeEmail(name, code)); err != nil {
						s.log.Warn().Err(err).Str("email", email).Msg("failed to send verification email")
					}
				}(user.Email, user.Name, code)
			}
		}
		writeJSON(w, http.StatusForbidden, map[string]interface{}{
			"error":                 "Please confirm your email to continue — we've sent you a code.",
			"verification_required": true,
			"email":                 user.Email,
		})
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

// handleUpdateMe lets a user edit their own profile. Only the display name is
// editable (email is the login identity; plan is billing-controlled).
func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name cannot be empty")
		return
	}
	if len(name) > 80 {
		name = name[:80]
	}
	if err := s.db.UpdateUserName(r.Context(), u.ID, name); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}
	user, _ := s.db.GetUserByID(r.Context(), u.ID)
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) handleDeleteMe(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	// Tear down running containers/volumes first — deleting the row only
	// cascades DB records and would leave their apps running forever.
	s.purgeUserResources(r.Context(), u.ID)

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
	writeJSON(w, http.StatusOK, domainViews(domains))
}

type createDomainRequest struct {
	Domain string `json:"domain"`
	// Optional: where the domain should route once its DNS verifies.
	TargetType      string `json:"target_type"`
	TargetSubdomain string `json:"target_subdomain"`
}

func (s *Server) handleCreateDomain(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req createDomainRequest
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Domain) == "" {
		writeError(w, http.StatusBadRequest, "domain required")
		return
	}
	name, note, err := normalizeDomain(req.Domain)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	_, userIDs, err := s.getTeamContext(r)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	if req.TargetType != "" || req.TargetSubdomain != "" {
		if err := s.checkDomainTarget(r, userIDs, req.TargetType, req.TargetSubdomain); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	if existing, _ := s.db.GetDomainByName(r.Context(), name); existing != nil {
		writeError(w, http.StatusConflict, name+" is already added to a Deployzy account")
		return
	}

	// Plan limit: max custom domains.
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimCustomDomain); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	dom, err := s.db.CreateDomain(r.Context(), u.ID, name, cnameTarget, req.TargetType, req.TargetSubdomain)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create domain")
		return
	}
	view := domainViews([]db.Domain{*dom})[0]

	// Legacy "instructions" kept for the SDKs/CLI; the dashboard uses "records".
	main := view.Records[0]
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"domain":  view,
		"note":    note,
		"records": view.Records,
		"instructions": map[string]string{
			"type":   main.Type,
			"name":   name,
			"host":   main.Host,
			"target": main.Value,
			"note":   "Add the DNS record, then call POST /api/v1/domains/{id}/verify (pending domains are also checked automatically every few minutes)",
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
	for i := range domains {
		if domains[i].ID == domID {
			targetDomain = &domains[i]
			break
		}
	}
	if targetDomain == nil {
		writeError(w, http.StatusNotFound, "domain not found")
		return
	}

	verified, method, hint := checkDomainDNS(targetDomain.Domain)
	if err := s.db.RecordDomainCheck(r.Context(), domID, verified, hint); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save check")
		return
	}
	if verified {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"verified": true,
			"method":   method,
		})
		return
	}
	found, _ := net.LookupCNAME(targetDomain.Domain)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"verified": false,
		"found":    found,
		"expected": cnameTarget,
		"hint":     hint,
	})
}

// cloudflareCIDRs are Cloudflare's published IPv4 ranges. A custom domain that
// resolves into one of these is proxied (orange cloud) — its real CNAME target
// is masked, so DNS verification can't see cname.deployzy.com behind it.
var cloudflareCIDRs = func() []*net.IPNet {
	raw := []string{
		"173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
		"141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
		"197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
		"104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
	}
	nets := make([]*net.IPNet, 0, len(raw))
	for _, c := range raw {
		if _, n, err := net.ParseCIDR(c); err == nil {
			nets = append(nets, n)
		}
	}
	return nets
}()

func domainIsCloudflareProxied(domain string) bool {
	ips, err := net.LookupHost(domain)
	if err != nil {
		return false
	}
	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		for _, n := range cloudflareCIDRs {
			if n.Contains(ip) {
				return true
			}
		}
	}
	return false
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

	// An empty target disconnects the domain (routing requires a target).
	if req.TargetSubdomain == "" {
		req.TargetType = ""
	} else if err := s.checkDomainTarget(r, userIDs, req.TargetType, req.TargetSubdomain); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
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
		writeError(w, http.StatusBadRequest, "failed to connect domain")
		return
	}

	status := "bound"
	if req.TargetSubdomain == "" {
		status = "unbound"
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":           status,
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
			st := t.Stats.Snapshot()
			result = append(result, map[string]interface{}{
				"url":        t.URL,
				"protocol":   t.Protocol,
				"name":       t.Name,
				"client_id":  t.ClientID,
				"user_id":    t.UserID,
				"type":       "tunnel",
				"local_addr": t.LocalAddr,
				"inspect":    t.Inspect,
				"created_at": t.CreatedAt,
				"requests":   st.Requests,
				"bytes":      st.BytesIn + st.BytesOut,
			})
		}
	}

	// Deployed projects (running containers). Apps are served on the app
	// domain (deployzy.app, isolated from the brand domain); idle-slept apps
	// are reported as "sleeping" — they wake on the next request.
	if s.db != nil {
		appDomain := "deployzy.app"
		if s.deployer != nil && s.deployer.AppDomain != "" {
			appDomain = s.deployer.AppDomain
		}
		for _, uid := range userIDs {
			projects, _ := s.db.ListProjects(r.Context(), uid)
			for _, p := range projects {
				if p.Status != "running" || p.ParentProjectID != nil {
					continue
				}
				status := "running"
				if s.deployer != nil && s.deployer.IsProjectSleeping(p.ID) {
					status = "sleeping"
				}
				result = append(result, map[string]interface{}{
					"id":         p.ID,
					"url":        fmt.Sprintf("https://%s.%s", p.Subdomain, appDomain),
					"protocol":   "deploy",
					"name":       p.Name,
					"subdomain":  p.Subdomain,
					"user_id":    p.UserID,
					"type":       "project",
					"status":     status,
					"framework":  p.Framework,
					"created_at": p.CreatedAt,
				})
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

// POST /api/v1/users/me/password — change password. Requires the current
// password (Google sign-ups have a random one they never saw, so this is
// email/password accounts only). Notifies the account email afterwards.
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var req struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if len(req.New) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}
	if len(req.New) > 72 { // bcrypt's input limit
		writeError(w, http.StatusBadRequest, "new password must be at most 72 characters")
		return
	}
	user, err := s.db.GetUserByID(r.Context(), u.ID)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if !user.CheckPassword(req.Current) {
		writeError(w, http.StatusForbidden, "current password is incorrect")
		return
	}
	if req.Current == req.New {
		writeError(w, http.StatusBadRequest, "new password must be different from the current one")
		return
	}
	if err := s.db.SetUserPassword(r.Context(), u.ID, req.New); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update password")
		return
	}
	if s.emailSvc != nil {
		go func(to string) {
			body := `<p style="margin:0 0 12px;font-size:16px;color:#ffffff;font-weight:600;">Your password was changed</p>
<p style="margin:0;font-size:14px;color:#888888;line-height:1.6;">The password for your Deployzy account was just changed. If this was you, there's nothing else to do. If it wasn't, contact <a href="mailto:support@deployzy.com" style="color:#a5b4fc;">support@deployzy.com</a> right away.</p>`
			_ = s.emailSvc.SendOne(to, "Your Deployzy password was changed", notify.SecurityNoticeEmail(body))
		}(user.Email)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
