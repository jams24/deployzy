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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog"
)

// GitHubApp handles GitHub App authentication and API calls.
type GitHubApp struct {
	AppID         string
	ClientID      string
	ClientSecret  string
	WebhookSecret string
	PrivateKey    *rsa.PrivateKey
	log           zerolog.Logger
	client        *http.Client

	// installTokenCache: installationID → (token, expiresAt).
	// App installation tokens expire after ~1h. Previously we re-fetched on
	// every API call (deploy, list commits, PR comment, ...) which meant
	// one extra GitHub round-trip per operation AND a brittle failure mode
	// if GitHub blipped during the fetch. Now we reuse the same token
	// until it has <5min of life left.
	installTokenCache sync.Map // key: int64 installationID, value: *cachedToken
}

// cachedToken holds an installation token + its expiry. Valid reports whether
// the token is still usable (with a 5-minute grace window to avoid handing
// out a token that'll expire mid-operation).
type cachedToken struct {
	token     string
	expiresAt time.Time
}

func (c *cachedToken) Valid() bool {
	return c != nil && c.token != "" && time.Until(c.expiresAt) > 5*time.Minute
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
	AccessToken           string `json:"access_token"`
	TokenType             string `json:"token_type"`
	Scope                 string `json:"scope"`
	RefreshToken          string `json:"refresh_token"`
	ExpiresIn             int    `json:"expires_in"`              // seconds, ~28800 (8h) for user tokens
	RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"` // seconds, ~15552000 (6mo)
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

// GetInstallationToken returns a GitHub App installation access token, using
// the in-memory cache when possible. First call for a given installation
// fetches from GitHub; subsequent calls reuse the cached token until 5 min
// before expiry. This is the single biggest reliability win in the GitHub
// layer — we used to round-trip GitHub for every deploy/list/comment.
func (g *GitHubApp) GetInstallationToken(installationID int64) (string, error) {
	if cached, ok := g.installTokenCache.Load(installationID); ok {
		if ct, _ := cached.(*cachedToken); ct.Valid() {
			return ct.token, nil
		}
	}

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
	if resp.StatusCode >= 400 {
		// Don't cache failures — next call should retry.
		return "", fmt.Errorf("github installation token fetch failed: %d", resp.StatusCode)
	}

	var result struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.Token == "" {
		return "", fmt.Errorf("github installation token empty")
	}

	// Default to 50min TTL if GitHub didn't include expires_at (hedges against
	// API quirks — real value is always ~1h).
	exp := result.ExpiresAt
	if exp.IsZero() {
		exp = time.Now().Add(50 * time.Minute)
	}
	g.installTokenCache.Store(installationID, &cachedToken{token: result.Token, expiresAt: exp})
	return result.Token, nil
}

// InvalidateInstallationToken drops the cached token for an installation.
// Call this after a 401 from GitHub so the next operation re-fetches instead
// of handing out a dead token.
func (g *GitHubApp) InvalidateInstallationToken(installationID int64) {
	g.installTokenCache.Delete(installationID)
}

// RefreshOAuthToken exchanges a refresh_token for a fresh user access token.
// GitHub OAuth App user tokens expire after 8h, refresh tokens after 6 months.
// This is what's needed so users don't have to manually reconnect every
// workday.
func (g *GitHubApp) RefreshOAuthToken(refreshToken string) (*GitHubTokenResponse, error) {
	if refreshToken == "" {
		return nil, fmt.Errorf("no refresh token stored")
	}
	data := url.Values{
		"client_id":     {g.ClientID},
		"client_secret": {g.ClientSecret},
		"refresh_token": {refreshToken},
		"grant_type":    {"refresh_token"},
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
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("refresh rejected — reconnect required")
	}
	return &result, nil
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

// ListUserRepos lists every repo the user has access to — public + private,
// owner + collaborator + org member. Paginates so users with >100 repos see
// all of them.
//
// `type=all` seems obvious but is wrong: GitHub treats it as "repos the user
// owns", excluding collaborator + org repos. The correct query combines
// `visibility=all` (public + private) with `affiliation=owner,collaborator,
// organization_member`. `type` and `visibility` cannot be used together.
func (g *GitHubApp) ListUserRepos(accessToken string) ([]GitHubRepo, error) {
	var all []GitHubRepo
	for page := 1; page <= 10; page++ { // cap at 10 pages = 1000 repos; anything more gets truncated
		url := fmt.Sprintf(
			"https://api.github.com/user/repos?per_page=100&page=%d&sort=updated&visibility=all&affiliation=owner,collaborator,organization_member",
			page)
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Accept", "application/vnd.github+json")

		resp, err := g.client.Do(req)
		if err != nil {
			return nil, err
		}
		var batch []GitHubRepo
		json.NewDecoder(resp.Body).Decode(&batch)
		resp.Body.Close()
		if len(batch) == 0 {
			break
		}
		all = append(all, batch...)
		if len(batch) < 100 {
			break // last page
		}
	}
	return all, nil
}

// GitHubCommit is a minimal commit summary returned to the UI.
type GitHubCommit struct {
	SHA     string `json:"sha"`
	Message string `json:"message"`
	Author  string `json:"author"`
	Date    string `json:"date"`
}

// ListCommits returns the most recent commits on a branch (up to 20).
func (g *GitHubApp) ListCommits(accessToken, repoFullName, branch string) ([]GitHubCommit, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/commits?sha=%s&per_page=20", repoFullName, branch)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var raw []struct {
		SHA    string `json:"sha"`
		Commit struct {
			Message string `json:"message"`
			Author  struct {
				Name string `json:"name"`
				Date string `json:"date"`
			} `json:"author"`
		} `json:"commit"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	out := make([]GitHubCommit, 0, len(raw))
	for _, c := range raw {
		// Only take the first line of the message — commit bodies can be huge.
		msg := c.Commit.Message
		if nl := strings.IndexByte(msg, '\n'); nl >= 0 {
			msg = msg[:nl]
		}
		out = append(out, GitHubCommit{
			SHA:     c.SHA,
			Message: msg,
			Author:  c.Commit.Author.Name,
			Date:    c.Commit.Author.Date,
		})
	}
	return out, nil
}

// GitHubContentEntry is one entry (file or directory) in a repo path listing.
type GitHubContentEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"` // "dir" | "file"
}

// ListRepoContents lists the entries at a path in a repo at a given ref (branch
// or SHA). Used by the "Select Base Directory" picker to let users browse the
// repo tree instead of typing a monorepo path by hand. Directories are returned
// first so the picker can show them at the top; files are included too (shown
// non-selectable) so the listing matches what the user sees on GitHub.
func (g *GitHubApp) ListRepoContents(accessToken, repoFullName, path, ref string) ([]GitHubContentEntry, error) {
	// Trim slashes so "/", "src/", "/src" all normalise to the same API path.
	cleanPath := strings.Trim(path, "/")
	url := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s", repoFullName, cleanPath)
	if ref != "" {
		url += "?ref=" + ref
	}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// A path pointing at a file (not a dir) returns a JSON object, not an
		// array — and a missing path returns 404. Surface a clean error either way.
		return nil, fmt.Errorf("github contents %s: status %d", cleanPath, resp.StatusCode)
	}

	var raw []GitHubContentEntry
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	// Directories first, then files; each group alphabetical.
	dirs := make([]GitHubContentEntry, 0, len(raw))
	files := make([]GitHubContentEntry, 0, len(raw))
	for _, e := range raw {
		if e.Type == "dir" {
			dirs = append(dirs, e)
		} else {
			files = append(files, e)
		}
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].Name < dirs[j].Name })
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return append(dirs, files...), nil
}

// PostIssueComment posts a new comment to an issue or PR. Returns the comment ID
// so subsequent deploys can edit the existing comment instead of spamming new ones.
func (g *GitHubApp) PostIssueComment(token, repoFullName string, issueNumber int, body string) (int64, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/issues/%d/comments", repoFullName, issueNumber)
	reqBody, _ := json.Marshal(map[string]string{"body": body})
	req, _ := http.NewRequest("POST", url, strings.NewReader(string(reqBody)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("github comment failed: %d", resp.StatusCode)
	}
	var result struct {
		ID int64 `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.ID, nil
}

// UpdateIssueComment edits an existing comment by ID. Used when a preview
// redeploys: we want the same comment to just update the commit SHA / status.
func (g *GitHubApp) UpdateIssueComment(token, repoFullName string, commentID int64, body string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/issues/comments/%d", repoFullName, commentID)
	reqBody, _ := json.Marshal(map[string]string{"body": body})
	req, _ := http.NewRequest("PATCH", url, strings.NewReader(string(reqBody)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("github comment update failed: %d", resp.StatusCode)
	}
	return nil
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
// If no signature is provided (legacy webhooks without a secret), allow it through.
// If a signature IS provided, verify it against our secret.
func (g *GitHubApp) VerifyWebhookSignature(payload []byte, signature string) bool {
	if signature == "" {
		return true // allow unsigned webhooks (legacy/existing hooks without secret)
	}
	if g.WebhookSecret == "" {
		return true // no secret configured on our side, can't verify
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
