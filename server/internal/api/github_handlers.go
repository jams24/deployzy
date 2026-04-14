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
	"github.com/serverme/serverme/server/internal/db"
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

// handleGitHubCommits lists the 20 most recent commits for a repo+branch.
// Used by the UI's "Select Commit" dropdown for pin/rollback deploys.
func (s *Server) handleGitHubCommits(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	repo := r.URL.Query().Get("repo")
	branch := r.URL.Query().Get("branch")
	if repo == "" || branch == "" {
		writeError(w, http.StatusBadRequest, "repo and branch are required")
		return
	}

	gc, _ := s.db.GetGitHubConnection(r.Context(), u.ID)
	if gc == nil {
		writeError(w, http.StatusBadRequest, "GitHub not connected")
		return
	}
	if s.deployer == nil || s.deployer.GitHub == nil {
		writeError(w, http.StatusServiceUnavailable, "GitHub not configured")
		return
	}

	// Prefer the installation token (auto-refreshing); fall back to the user's OAuth token.
	token := gc.AccessToken
	if gc.InstallationID > 0 {
		if instToken, err := s.deployer.GitHub.GetInstallationToken(gc.InstallationID); err == nil && instToken != "" {
			token = instToken
		}
	}

	commits, err := s.deployer.GitHub.ListCommits(token, repo, branch)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list commits")
		return
	}
	writeJSON(w, http.StatusOK, commits)
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

	event := r.Header.Get("X-GitHub-Event")
	if event == "ping" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"pong"}`))
		return
	}
	if event == "pull_request" {
		s.handlePullRequestEvent(w, r, body)
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

// handlePullRequestEvent handles opened/reopened/synchronize/closed events to
// manage preview deployments. One preview child-project per (parent, PR#).
// Signature verification has already happened in the caller.
func (s *Server) handlePullRequestEvent(w http.ResponseWriter, r *http.Request, body []byte) {
	var payload struct {
		Action      string `json:"action"`
		Number      int    `json:"number"`
		PullRequest struct {
			Title string `json:"title"`
			Head  struct {
				Ref string `json:"ref"` // branch name on the fork/head repo
				SHA string `json:"sha"`
			} `json:"head"`
		} `json:"pull_request"`
		Repository struct {
			FullName string `json:"full_name"`
		} `json:"repository"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}
	if payload.Repository.FullName == "" || payload.Number == 0 {
		w.WriteHeader(http.StatusOK)
		return
	}

	s.log.Info().Str("repo", payload.Repository.FullName).Int("pr", payload.Number).Str("action", payload.Action).Msg("PR event")

	// Find parent projects linked to this repo that have previews enabled.
	parents, _ := s.db.GetProjectsByGitHubRepo(r.Context(), payload.Repository.FullName)
	for _, parent := range parents {
		parent := parent
		if !parent.PreviewEnabled || parent.ParentProjectID != nil {
			continue // either disabled, or this IS a preview (no nested previews)
		}
		switch payload.Action {
		case "opened", "reopened", "synchronize", "edited":
			go s.deployPreview(parent, payload.Number, payload.PullRequest.Title, payload.PullRequest.Head.Ref, payload.PullRequest.Head.SHA, payload.Repository.FullName)
		case "closed":
			go s.teardownPreview(parent.ID, payload.Number)
		}
	}
	w.WriteHeader(http.StatusOK)
}

// deployPreview creates (if needed) and redeploys the preview project for a PR.
func (s *Server) deployPreview(parent db.Project, prNumber int, prTitle, branch, sha, repoFull string) {
	ctx := context.Background()

	// Find or create the preview child project.
	preview, _ := s.db.GetPreviewByPR(ctx, parent.ID, prNumber)
	if preview == nil {
		subdomain := previewSubdomain(parent.Subdomain, prNumber)
		p, err := s.db.CreatePreviewProject(ctx, &parent, prNumber, prTitle, branch, subdomain)
		if err != nil {
			s.log.Error().Err(err).Str("parent", parent.ID).Int("pr", prNumber).Msg("create preview failed")
			return
		}
		preview = p
	} else {
		// Update branch + title if the PR was retargeted or renamed.
		if preview.Branch != branch || preview.PRTitle != prTitle {
			s.db.UpdateProjectConfig(ctx, preview.ID, preview.RepoURL, branch, preview.BuildCmd, preview.StartCmd, preview.EnvVars)
			// pr_title isn't in UpdateProjectConfig — direct update:
			s.db.Pool.Exec(ctx, `UPDATE projects SET pr_title = $2, branch = $3 WHERE id = $1`, preview.ID, prTitle, branch)
			preview.Branch = branch
			preview.PRTitle = prTitle
		}
	}

	// Pin to the PR head SHA so subsequent pushes to the PR redeploy cleanly.
	s.db.UpdateProjectCommitSHA(ctx, preview.ID, sha)
	preview.CommitSHA = sha

	// Inject auth token into repo URL for private repos (matches the push flow).
	if s.deployer != nil && s.deployer.GitHub != nil {
		gc, _ := s.db.GetGitHubConnection(ctx, preview.UserID)
		if gc != nil {
			token := gc.AccessToken
			if gc.InstallationID > 0 {
				if t, err := s.deployer.GitHub.GetInstallationToken(gc.InstallationID); err == nil && t != "" {
					token = t
				}
			}
			preview.RepoURL = fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repoFull)
		}
	}

	if err := s.deployer.Deploy(ctx, preview); err != nil {
		s.log.Error().Err(err).Str("preview", preview.ID).Msg("preview deploy failed")
		return
	}

	// Refetch after deploy to get the post-deploy status + container_port.
	fresh, _ := s.db.GetProject(ctx, preview.ID)
	if fresh == nil {
		return
	}
	s.postOrEditPRComment(ctx, fresh, repoFull)
}

// teardownPreview stops + removes the preview project (and its container) when
// a PR closes. Leaves history in place by letting the existing delete path
// handle container + DB cleanup.
func (s *Server) teardownPreview(parentID string, prNumber int) {
	ctx := context.Background()
	preview, _ := s.db.GetPreviewByPR(ctx, parentID, prNumber)
	if preview == nil {
		return
	}
	s.log.Info().Str("preview", preview.ID).Int("pr", prNumber).Msg("tearing down preview")
	// Stop container + remove
	if s.deployer != nil {
		_ = s.deployer.Stop(ctx, preview)
	}
	// Hard delete: removes DB row + cascades deploy_logs (FK ON DELETE CASCADE).
	s.db.DeleteProject(ctx, preview.ID, preview.UserID)
}

// postOrEditPRComment posts (or edits) the preview-URL comment on the PR.
// Uses pr_comment_id to decide whether to POST or PATCH.
func (s *Server) postOrEditPRComment(ctx context.Context, preview *db.Project, repoFull string) {
	if s.deployer == nil || s.deployer.GitHub == nil {
		return
	}
	gc, _ := s.db.GetGitHubConnection(ctx, preview.UserID)
	if gc == nil {
		return
	}
	token := gc.AccessToken
	if gc.InstallationID > 0 {
		if t, err := s.deployer.GitHub.GetInstallationToken(gc.InstallationID); err == nil && t != "" {
			token = t
		}
	}

	domain := "serverme.site"
	if s.deployer.Domain != "" {
		domain = s.deployer.Domain
	}
	url := fmt.Sprintf("https://%s.%s", preview.Subdomain, domain)

	statusEmoji := "🚀"
	statusText := "Preview deployed"
	if preview.Status != "running" {
		statusEmoji = "⚠️"
		statusText = fmt.Sprintf("Preview status: %s", preview.Status)
	}
	sha := preview.CommitSHA
	if len(sha) > 7 {
		sha = sha[:7]
	}
	body := fmt.Sprintf("%s **%s**\n\n- **URL**: %s\n- **Commit**: `%s`\n- **Status**: `%s`\n\n_Automatically deployed by [ServerMe](https://%s) when this PR is updated. Closed PRs are torn down automatically._",
		statusEmoji, statusText, url, sha, preview.Status, domain,
	)

	if preview.PRCommentID > 0 {
		if err := s.deployer.GitHub.UpdateIssueComment(token, repoFull, preview.PRCommentID, body); err == nil {
			return
		}
		// Fall through and POST a new one if the update failed (e.g. user deleted it).
	}
	id, err := s.deployer.GitHub.PostIssueComment(token, repoFull, preview.PRNumber, body)
	if err != nil {
		s.log.Warn().Err(err).Int("pr", preview.PRNumber).Msg("post PR comment failed")
		return
	}
	s.db.UpdatePreviewCommentID(ctx, preview.ID, id)
}

// previewSubdomain builds a safe subdomain for a PR's preview:
//
//	<parent-subdomain>-pr-<number>    e.g. "myapp-pr-42"
//
// Capped at 63 chars to stay within DNS limits; if the parent's subdomain is
// too long we truncate it.
func previewSubdomain(parent string, pr int) string {
	suffix := fmt.Sprintf("-pr-%d", pr)
	max := 63 - len(suffix)
	if len(parent) > max {
		parent = parent[:max]
	}
	return parent + suffix
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
