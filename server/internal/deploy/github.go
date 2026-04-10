package deploy

import (
	"crypto/hmac"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog"
)

// GitHubApp handles GitHub App authentication and API calls.
type GitHubApp struct {
	AppID        string
	ClientID     string
	ClientSecret string
	WebhookSecret string
	PrivateKey   *rsa.PrivateKey
	log          zerolog.Logger
	client       *http.Client
}

type GitHubRepo struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	FullName    string `json:"full_name"`
	Private     bool   `json:"private"`
	CloneURL    string `json:"clone_url"`
	HTMLURL     string `json:"html_url"`
	Description string `json:"description"`
	Language    string `json:"language"`
	DefaultBranch string `json:"default_branch"`
	UpdatedAt   string `json:"updated_at"`
}

type GitHubTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	RefreshToken string `json:"refresh_token"`
}

// NewGitHubApp creates a new GitHub App client.
func NewGitHubApp(appID, clientID, clientSecret, webhookSecret, privateKeyPath string, log zerolog.Logger) (*GitHubApp, error) {
	keyData, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read private key: %w", err)
	}

	block, _ := pem.Decode(keyData)
	if block == nil {
		return nil, fmt.Errorf("failed to parse PEM block")
	}

	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}

	return &GitHubApp{
		AppID:         appID,
		ClientID:      clientID,
		ClientSecret:  clientSecret,
		WebhookSecret: webhookSecret,
		PrivateKey:    key,
		log:           log.With().Str("component", "github_app").Logger(),
		client:        &http.Client{Timeout: 15 * time.Second},
	}, nil
}

// GenerateJWT creates a signed JWT for GitHub App authentication.
func (g *GitHubApp) GenerateJWT() (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iat": now.Add(-60 * time.Second).Unix(),
		"exp": now.Add(10 * time.Minute).Unix(),
		"iss": g.AppID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(g.PrivateKey)
}

// GetInstallationToken gets an access token for an installation.
func (g *GitHubApp) GetInstallationToken(installationID int64) (string, error) {
	jwtToken, err := g.GenerateJWT()
	if err != nil {
		return "", err
	}

	req, _ := http.NewRequest("POST",
		fmt.Sprintf("https://api.github.com/app/installations/%d/access_tokens", installationID),
		nil)
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := g.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Token string `json:"token"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Token, nil
}

// ExchangeCodeForToken exchanges an OAuth code for a user access token.
func (g *GitHubApp) ExchangeCodeForToken(code string) (*GitHubTokenResponse, error) {
	data := url.Values{
		"client_id":     {g.ClientID},
		"client_secret": {g.ClientSecret},
		"code":          {code},
	}

	req, _ := http.NewRequest("POST", "https://github.com/login/oauth/access_token",
		strings.NewReader(data.Encode()))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result GitHubTokenResponse
	json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

// ListUserRepos lists repos the user has access to via their token.
func (g *GitHubApp) ListUserRepos(accessToken string) ([]GitHubRepo, error) {
	req, _ := http.NewRequest("GET", "https://api.github.com/user/repos?per_page=100&sort=updated&type=all", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var repos []GitHubRepo
	json.NewDecoder(resp.Body).Decode(&repos)
	return repos, nil
}

// GetCloneURL returns an authenticated clone URL for a private repo.
func (g *GitHubApp) GetCloneURL(accessToken, repoFullName string) string {
	return fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", accessToken, repoFullName)
}

// GetInstallations lists all installations of this app.
func (g *GitHubApp) GetInstallations() ([]map[string]interface{}, error) {
	jwtToken, err := g.GenerateJWT()
	if err != nil {
		return nil, err
	}

	req, _ := http.NewRequest("GET", "https://api.github.com/app/installations", nil)
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var installations []map[string]interface{}
	json.Unmarshal(body, &installations)
	return installations, nil
}

// GetOAuthURL returns the GitHub OAuth URL for connecting an account.
func (g *GitHubApp) GetOAuthURL(state, redirectURI string) string {
	return fmt.Sprintf("https://github.com/login/oauth/authorize?client_id=%s&state=%s&redirect_uri=%s&scope=repo",
		g.ClientID, state, url.QueryEscape(redirectURI))
}

// EnsureWebhook creates a push webhook on the repo if one doesn't already exist.
func (g *GitHubApp) EnsureWebhook(accessToken, repoFullName, webhookURL string) error {
	// Check if webhook already exists
	req, _ := http.NewRequest("GET", fmt.Sprintf("https://api.github.com/repos/%s/hooks", repoFullName), nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var hooks []struct {
		Config struct {
			URL string `json:"url"`
		} `json:"config"`
	}
	json.NewDecoder(resp.Body).Decode(&hooks)

	for _, h := range hooks {
		if h.Config.URL == webhookURL {
			return nil // already registered
		}
	}

	// Create webhook
	payload := map[string]interface{}{
		"name":   "web",
		"active": true,
		"events": []string{"push"},
		"config": map[string]string{
			"url":          webhookURL,
			"content_type": "json",
			"secret":       g.WebhookSecret,
		},
	}
	body, _ := json.Marshal(payload)

	req, _ = http.NewRequest("POST", fmt.Sprintf("https://api.github.com/repos/%s/hooks", repoFullName), strings.NewReader(string(body)))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp2, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer resp2.Body.Close()

	if resp2.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp2.Body)
		return fmt.Errorf("create webhook: %s %s", resp2.Status, string(respBody))
	}
	return nil
}

// VerifyWebhookSignature verifies the X-Hub-Signature-256 header.
func (g *GitHubApp) VerifyWebhookSignature(payload []byte, signature string) bool {
	if g.WebhookSecret == "" || signature == "" {
		return g.WebhookSecret == "" // allow if no secret configured
	}

	sig := strings.TrimPrefix(signature, "sha256=")
	mac := hmacSHA256([]byte(g.WebhookSecret), payload)
	return hmacEqual(mac, sig)
}

func hmacSHA256(key, data []byte) string {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return fmt.Sprintf("%x", h.Sum(nil))
}

func hmacEqual(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
