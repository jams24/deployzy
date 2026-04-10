package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/serverme/serverme/server/internal/auth"
)

// handleGitHubConnect starts the GitHub OAuth flow.
func (s *Server) handleGitHubConnect(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil || s.deployer.GitHub == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub integration not configured")
		return
	}

	state := generateGHState()
	redirectURI := fmt.Sprintf("https://api.%s/api/v1/github/callback", s.deployer.Domain)
	authURL := s.deployer.GitHub.GetOAuthURL(state, redirectURI)

	http.Redirect(w, r, authURL, http.StatusFound)
}

// handleGitHubCallback handles the OAuth callback from GitHub.
func (s *Server) handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	if s.deployer == nil || s.deployer.GitHub == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub integration not configured")
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Redirect(w, r, "https://serverme.site/projects?error=github_denied", http.StatusFound)
		return
	}

	// Exchange code for token
	tokenResp, err := s.deployer.GitHub.ExchangeCodeForToken(code)
	if err != nil || tokenResp.AccessToken == "" {
		s.log.Error().Err(err).Msg("GitHub token exchange failed")
		http.Redirect(w, r, "https://serverme.site/projects?error=token_exchange", http.StatusFound)
		return
	}

	// Get GitHub user info
	ghUser, err := getGitHubUser(tokenResp.AccessToken)
	if err != nil {
		s.log.Error().Err(err).Msg("GitHub user info failed")
		http.Redirect(w, r, "https://serverme.site/projects?error=user_info", http.StatusFound)
		return
	}

	// Find installation ID for this user
	installID := int64(0)
	if s.deployer != nil && s.deployer.GitHub != nil {
		installations, _ := s.deployer.GitHub.GetInstallations()
		for _, inst := range installations {
			if acct, ok := inst["account"].(map[string]interface{}); ok {
				if login, ok := acct["login"].(string); ok && login == ghUser.Login {
					if id, ok := inst["id"].(float64); ok {
						installID = int64(id)
					}
				}
			}
		}
	}

	redirectURL := fmt.Sprintf("https://serverme.site/projects?github_connected=true&github_token=%s&github_user=%s&installation_id=%d",
		url.QueryEscape(tokenResp.AccessToken), url.QueryEscape(ghUser.Login), installID)

	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// handleGitHubSaveConnection saves the GitHub connection for the authenticated user.
func (s *Server) handleGitHubSaveConnection(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		AccessToken    string `json:"access_token"`
		GitHubUsername string `json:"github_username"`
		InstallationID int64  `json:"installation_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AccessToken == "" {
		writeError(w, http.StatusBadRequest, "access_token required")
		return
	}

	err := s.db.SaveGitHubConnection(r.Context(), u.ID, req.GitHubUsername, req.AccessToken, "", req.InstallationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save connection")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "connected"})
}

// handleGitHubStatus returns the user's GitHub connection status.
func (s *Server) handleGitHubStatus(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	gc, _ := s.db.GetGitHubConnection(r.Context(), u.ID)
	if gc == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"connected": false})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"connected": true,
		"username":  gc.GitHubUsername,
	})
}

// handleGitHubDisconnect removes the GitHub connection.
func (s *Server) handleGitHubDisconnect(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	s.db.DeleteGitHubConnection(r.Context(), u.ID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

// handleGitHubRepos lists the user's GitHub repos.
func (s *Server) handleGitHubRepos(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	gc, _ := s.db.GetGitHubConnection(r.Context(), u.ID)
	if gc == nil {
		writeError(w, http.StatusBadRequest, "GitHub not connected")
		return
	}

	if s.deployer == nil || s.deployer.GitHub == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub not configured")
		return
	}

	repos, err := s.deployer.GitHub.ListUserRepos(gc.AccessToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list repos")
		return
	}

	writeJSON(w, http.StatusOK, repos)
}

// handleGitHubWebhook processes push events for auto-deploy.
func (s *Server) handleGitHubWebhook(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)

	// Verify webhook signature if secret is configured
	if s.deployer != nil && s.deployer.GitHub != nil {
		sig := r.Header.Get("X-Hub-Signature-256")
		if !s.deployer.GitHub.VerifyWebhookSignature(body, sig) {
			s.log.Warn().Msg("GitHub webhook signature verification failed")
			w.WriteHeader(http.StatusForbidden)
			return
		}
	}

	// Only handle push events
	event := r.Header.Get("X-GitHub-Event")
	if event == "ping" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"pong"}`))
		return
	}
	if event != "" && event != "push" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var payload struct {
		Ref        string `json:"ref"`
		Repository struct {
			FullName string `json:"full_name"`
			CloneURL string `json:"clone_url"`
		} `json:"repository"`
	}
	json.Unmarshal(body, &payload)

	if payload.Repository.FullName == "" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Extract pushed branch name from ref (refs/heads/main → main)
	pushedBranch := strings.TrimPrefix(payload.Ref, "refs/heads/")

	s.log.Info().Str("repo", payload.Repository.FullName).Str("branch", pushedBranch).Msg("GitHub push webhook")

	// Find all projects linked to this repo with auto_deploy enabled
	projects, _ := s.db.GetProjectsByGitHubRepo(r.Context(), payload.Repository.FullName)
	if len(projects) == 0 {
		w.WriteHeader(http.StatusOK)
		return
	}

	deployed := 0
	for _, project := range projects {
		// Branch filter: only deploy if the pushed branch matches the project's configured branch
		projectBranch := project.GitHubBranch
		if projectBranch == "" {
			projectBranch = project.Branch
		}
		if projectBranch == "" {
			projectBranch = "main"
		}
		if pushedBranch != projectBranch {
			s.log.Debug().Str("project", project.ID).Str("pushed", pushedBranch).Str("expected", projectBranch).Msg("skipping — branch mismatch")
			continue
		}

		// Get the user's GitHub token for cloning private repos
		p := project // capture for goroutine
		gc, _ := s.db.GetGitHubConnection(r.Context(), p.UserID)
		if gc != nil && s.deployer != nil && s.deployer.GitHub != nil {
			// Prefer installation token (auto-refreshes), fall back to user token
			token := gc.AccessToken
			if gc.InstallationID > 0 {
				if instToken, err := s.deployer.GitHub.GetInstallationToken(gc.InstallationID); err == nil && instToken != "" {
					token = instToken
				}
			}
			p.RepoURL = fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, payload.Repository.FullName)
		}

		s.log.Info().Str("project", p.ID).Str("repo", payload.Repository.FullName).Str("branch", pushedBranch).Msg("auto-deploying on push")
		go func() {
			ctx := context.Background()
			if err := s.deployer.Deploy(ctx, &p); err != nil {
				s.log.Error().Err(err).Str("project", p.ID).Msg("auto-deploy failed")
			}
		}()
		deployed++
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(fmt.Sprintf(`{"status":"deploying","count":%d}`, deployed)))
}

type ghUser struct {
	Login string `json:"login"`
}

func getGitHubUser(accessToken string) (*ghUser, error) {
	req, _ := http.NewRequest("GET", "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var user ghUser
	json.NewDecoder(resp.Body).Decode(&user)
	return &user, nil
}

func generateGHState() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
