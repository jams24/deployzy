package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// OAuthProvider defines an OAuth provider configuration.
type OAuthProvider struct {
	Name         string `json:"name"` // "google" or "github"
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	AuthURL      string `json:"auth_url"`
	TokenURL     string `json:"token_url"`
	UserInfoURL  string `json:"user_info_url"`
	Scopes       string `json:"scopes"`
}

// KnownProviders has pre-configured OAuth URLs.
var KnownProviders = map[string]OAuthProvider{
	"github": {
		Name:        "github",
		AuthURL:     "https://github.com/login/oauth/authorize",
		TokenURL:    "https://github.com/login/oauth/access_token",
		UserInfoURL: "https://api.github.com/user",
		Scopes:      "user:email",
	},
	"google": {
		Name:        "google",
		AuthURL:     "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:    "https://oauth2.googleapis.com/token",
		UserInfoURL: "https://www.googleapis.com/oauth2/v2/userinfo",
		Scopes:      "openid email profile",
	},
}

// OAuthGate protects a tunnel with OAuth authentication.
// Users must authenticate via the provider before traffic reaches the tunnel.
type OAuthGate struct {
	provider    OAuthProvider
	callbackURL string
	sessions    sync.Map // sessionToken -> email
	states      sync.Map // state -> timestamp (for CSRF)
}

// NewOAuthGate creates an OAuth gate for a tunnel.
func NewOAuthGate(provider OAuthProvider, callbackURL string) *OAuthGate {
	return &OAuthGate{
		provider:    provider,
		callbackURL: callbackURL,
	}
}

// Middleware returns an HTTP middleware that enforces OAuth authentication.
func (g *OAuthGate) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check for callback path
			if r.URL.Path == "/__serverme/oauth/callback" {
				g.handleCallback(w, r, next)
				return
			}

			// Check session cookie
			cookie, err := r.Cookie("__sm_session")
			if err == nil {
				if email, ok := g.sessions.Load(cookie.Value); ok {
					r.Header.Set("X-Deployzy-User", email.(string))
					next.ServeHTTP(w, r)
					return
				}
			}

			// Redirect to OAuth provider
			state := generateState()
			g.states.Store(state, time.Now())

			authURL := fmt.Sprintf("%s?client_id=%s&redirect_uri=%s&scope=%s&state=%s&response_type=code",
				g.provider.AuthURL,
				url.QueryEscape(g.provider.ClientID),
				url.QueryEscape(g.callbackURL+"/__serverme/oauth/callback"),
				url.QueryEscape(g.provider.Scopes),
				url.QueryEscape(state),
			)

			http.Redirect(w, r, authURL, http.StatusFound)
		})
	}
}

func (g *OAuthGate) handleCallback(w http.ResponseWriter, r *http.Request, next http.Handler) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	// Verify state
	if _, ok := g.states.LoadAndDelete(state); !ok {
		http.Error(w, "Invalid OAuth state", http.StatusBadRequest)
		return
	}

	// Exchange code for token
	tokenResp, err := exchangeCode(g.provider, code, g.callbackURL+"/__serverme/oauth/callback")
	if err != nil {
		http.Error(w, "OAuth token exchange failed", http.StatusInternalServerError)
		return
	}

	// Get user info
	email, err := getUserEmail(g.provider, tokenResp.AccessToken)
	if err != nil {
		http.Error(w, "Failed to get user info", http.StatusInternalServerError)
		return
	}

	// Create session
	sessionToken := generateState()
	g.sessions.Store(sessionToken, email)

	http.SetCookie(w, &http.Cookie{
		Name:     "__sm_session",
		Value:    sessionToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   86400, // 24 hours
	})

	// Redirect to original path
	http.Redirect(w, r, "/", http.StatusFound)
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

func exchangeCode(provider OAuthProvider, code, redirectURI string) (*tokenResponse, error) {
	data := url.Values{
		"client_id":     {provider.ClientID},
		"client_secret": {provider.ClientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"grant_type":    {"authorization_code"},
	}

	req, _ := http.NewRequest("POST", provider.TokenURL, strings.NewReader(data.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}

func getUserEmail(provider OAuthProvider, accessToken string) (string, error) {
	req, _ := http.NewRequest("GET", provider.UserInfoURL, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return "", err
	}

	if email, ok := data["email"].(string); ok && email != "" {
		return email, nil
	}

	return fmt.Sprintf("user@%s", provider.Name), nil
}

func generateState() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
