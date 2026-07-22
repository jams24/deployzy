package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/notify"
)

type statePayload struct {
	Nonce    string `json:"n"`
	Callback string `json:"c,omitempty"`
	CliState string `json:"s,omitempty"`
}

func (s *Server) handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if s.google == nil || s.google.ClientID == "" {
		writeError(w, http.StatusNotImplemented, "Google OAuth not configured")
		return
	}

	payload := statePayload{
		Nonce:    generateOAuthState(),
		Callback: r.URL.Query().Get("callback"),
		CliState: r.URL.Query().Get("cli_state"),
	}
	stateJSON, _ := json.Marshal(payload)
	state := base64.URLEncoding.EncodeToString(stateJSON)

	authURL := fmt.Sprintf(
		"https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=%s&state=%s&access_type=offline&prompt=select_account",
		url.QueryEscape(s.google.ClientID),
		url.QueryEscape(s.google.RedirectURL),
		url.QueryEscape("openid email profile"),
		url.QueryEscape(state),
	)

	http.Redirect(w, r, authURL, http.StatusFound)
}

func (s *Server) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if s.google == nil {
		writeError(w, http.StatusNotImplemented, "Google OAuth not configured")
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		redirectWithError(w, r, s.google.FrontendURL, "OAuth failed: "+r.URL.Query().Get("error"))
		return
	}

	var cliCallback, cliState string
	if stateB64 := r.URL.Query().Get("state"); stateB64 != "" {
		if stateJSON, err := base64.URLEncoding.DecodeString(stateB64); err == nil {
			var payload statePayload
			if json.Unmarshal(stateJSON, &payload) == nil {
				cliCallback = payload.Callback
				cliState = payload.CliState
			}
		}
	}

	tokenData, err := exchangeGoogleCode(s.google, code)
	if err != nil {
		s.log.Error().Err(err).Msg("Google token exchange failed")
		redirectWithError(w, r, s.google.FrontendURL, "Token exchange failed")
		return
	}

	userInfo, err := getGoogleUserInfo(tokenData.AccessToken)
	if err != nil {
		s.log.Error().Err(err).Msg("Google user info failed")
		redirectWithError(w, r, s.google.FrontendURL, "Failed to get user info")
		return
	}

	if userInfo.Email == "" {
		redirectWithError(w, r, s.google.FrontendURL, "No email from Google")
		return
	}

	user, err := s.db.GetUserByEmail(r.Context(), userInfo.Email)
	if err != nil {
		redirectWithError(w, r, s.google.FrontendURL, "Internal error")
		return
	}

	if user == nil {
		randPass := make([]byte, 32)
		rand.Read(randPass)
		user, err = s.db.CreateUser(r.Context(), userInfo.Email, userInfo.Name, hex.EncodeToString(randPass))
		if err != nil {
			redirectWithError(w, r, s.google.FrontendURL, "Failed to create account")
			return
		}
		s.db.GenerateAPIKey(r.Context(), user.ID, "default", "full")
		// Google already proved the user owns this mailbox — no code needed.
		s.db.MarkEmailVerified(r.Context(), user.ID)
		// Welcome email: the password-signup path has always sent this, but
		// OAuth signups silently skipped it — every Google user since launch
		// got nothing (backfilled manually for 2026-07-21).
		if s.emailSvc != nil {
			go func(email, name string) {
				if err := s.emailSvc.SendOne(email, "Welcome to Deployzy 🚀", notify.WelcomeEmail(name)); err != nil {
					s.log.Warn().Err(err).Str("email", email).Msg("failed to send welcome email")
				}
			}(user.Email, user.Name)
		}
		s.log.Info().Str("email", userInfo.Email).Msg("new user created via Google OAuth")
	} else if !user.EmailVerified {
		// Signed up with a password and never confirmed, but has now proved
		// ownership via Google — clear the pending verification.
		s.db.MarkEmailVerified(r.Context(), user.ID)
	}

	token, err := s.jwt.Generate(user.ID, user.Email, user.Plan)
	if err != nil {
		redirectWithError(w, r, s.google.FrontendURL, "Token generation failed")
		return
	}

	if cliState != "" {
		s.cliPending.Store(cliState, token)
		http.Redirect(w, r, s.google.FrontendURL+"/auth/cli-success", http.StatusFound)
	} else if cliCallback != "" && strings.HasPrefix(cliCallback, "http://127.0.0.1") {
		http.Redirect(w, r, fmt.Sprintf("%s?token=%s", cliCallback, url.QueryEscape(token)), http.StatusFound)
	} else {
		http.Redirect(w, r, fmt.Sprintf("%s/auth/callback?token=%s", s.google.FrontendURL, url.QueryEscape(token)), http.StatusFound)
	}
}

type googleTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
}

type googleUserInfo struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

func exchangeGoogleCode(cfg *GoogleOAuthConfig, code string) (*googleTokenResponse, error) {
	data := url.Values{
		"client_id":     {cfg.ClientID},
		"client_secret": {cfg.ClientSecret},
		"code":          {code},
		"redirect_uri":  {cfg.RedirectURL},
		"grant_type":    {"authorization_code"},
	}

	resp, err := http.Post("https://oauth2.googleapis.com/token", "application/x-www-form-urlencoded", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("token exchange failed (%d): %s", resp.StatusCode, string(body))
	}

	var result googleTokenResponse
	json.Unmarshal(body, &result)
	return &result, nil
}

func getGoogleUserInfo(accessToken string) (*googleUserInfo, error) {
	req, _ := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var info googleUserInfo
	json.NewDecoder(resp.Body).Decode(&info)
	return &info, nil
}

func generateOAuthState() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func redirectWithError(w http.ResponseWriter, r *http.Request, frontendURL, errMsg string) {
	http.Redirect(w, r, fmt.Sprintf("%s/sign-in?error=%s", frontendURL, url.QueryEscape(errMsg)), http.StatusFound)
}

// handleAuthPoll is called by the CLI to retrieve the JWT token after OAuth.
// The CLI passes the cli_state UUID it generated; this endpoint returns the token
// once the OAuth callback has stored it, and consumes the entry immediately.
func (s *Server) handleAuthPoll(w http.ResponseWriter, r *http.Request) {
	state := chi.URLParam(r, "state")
	if val, ok := s.cliPending.LoadAndDelete(state); ok {
		writeJSON(w, http.StatusOK, map[string]string{"token": val.(string)})
	} else {
		w.WriteHeader(http.StatusNotFound)
	}
}
