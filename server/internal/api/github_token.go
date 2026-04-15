package api

import (
	"context"
	"time"

	"github.com/serverme/serverme/server/internal/db"
)

// bestGitHubToken returns the freshest usable GitHub token for APP-SCOPE
// operations — cloning a private repo, posting a PR comment, creating a
// webhook. These work best with an installation token (acts as the app on
// behalf of the user), which is cached per installation.
//
// For USER-SCOPE operations (GET /user/repos, GET /user, ...) use
// bestUserGitHubToken instead — those endpoints reject installation tokens.
//
// Returns ("", false) if there's no connection or both paths fail.
func (s *Server) bestGitHubToken(ctx context.Context, userID string) (string, bool) {
	if s.deployer == nil || s.deployer.GitHub == nil {
		return "", false
	}
	gc, _ := s.db.GetGitHubConnection(ctx, userID)
	if gc == nil {
		return "", false
	}

	// 1. Try the installation token. Cached, ~1h TTL.
	if gc.InstallationID > 0 {
		if tok, err := s.deployer.GitHub.GetInstallationToken(gc.InstallationID); err == nil && tok != "" {
			return tok, true
		}
		// Fall through to user token if install fetch failed.
	}

	// 2. User OAuth token as fallback.
	return s.getUserGitHubToken(ctx, gc, userID)
}

// bestUserGitHubToken is what handlers should call for GET /user/repos,
// /user/commits on user-accessible repos, and any other endpoint that needs
// the caller to act AS the user rather than as the app. Installation tokens
// do not have access to these endpoints — they return 403 or an empty list,
// which is what caused the "no repos found" bug after a user reconnected.
//
// Auto-refreshes via refresh_token if the stored access token is close to
// expiry (or expiry unknown + refresh_token present).
func (s *Server) bestUserGitHubToken(ctx context.Context, userID string) (string, bool) {
	if s.deployer == nil || s.deployer.GitHub == nil {
		return "", false
	}
	gc, _ := s.db.GetGitHubConnection(ctx, userID)
	if gc == nil {
		return "", false
	}
	return s.getUserGitHubToken(ctx, gc, userID)
}

// getUserGitHubToken handles the refresh-if-stale logic. Extracted so both
// best*Token variants share it without duplication.
func (s *Server) getUserGitHubToken(ctx context.Context, gc *db.GitHubConnection, userID string) (string, bool) {
	// Refresh if expiry is known and close, or if expiry is unknown and we
	// have a refresh token (pre-refresh-column DB rows will all be NULL;
	// a reconnect from the new callback populates them).
	needRefresh := gc.RefreshToken != "" && (gc.AccessTokenExpiresAt == nil ||
		time.Until(*gc.AccessTokenExpiresAt) < 2*time.Minute)

	if needRefresh {
		newTokens, err := s.deployer.GitHub.RefreshOAuthToken(gc.RefreshToken)
		if err == nil && newTokens != nil && newTokens.AccessToken != "" {
			s.db.UpdateGitHubTokens(ctx, userID, newTokens.AccessToken, newTokens.RefreshToken,
				newTokens.ExpiresIn, newTokens.RefreshTokenExpiresIn)
			return newTokens.AccessToken, true
		}
		// Refresh failed but we might still have a working access_token; try that.
		s.log.Debug().Err(err).Str("user", userID).Msg("github refresh failed; trying stored access_token")
	}

	if gc.AccessToken != "" {
		return gc.AccessToken, true
	}
	return "", false
}

// githubConnectionHealth returns a compact status the frontend can show
// without having to test-call GitHub itself. Used by /github/status.
type githubConnectionHealth struct {
	Connected           bool       `json:"connected"`
	Username            string     `json:"username,omitempty"`
	InstallationPresent bool       `json:"installation_present"`
	AccessExpiresAt     *time.Time `json:"access_expires_at,omitempty"`
	NeedsReconnect      bool       `json:"needs_reconnect"`
}

func (s *Server) githubStatusFor(ctx context.Context, gc *db.GitHubConnection) githubConnectionHealth {
	if gc == nil {
		return githubConnectionHealth{Connected: false}
	}
	h := githubConnectionHealth{
		Connected:           true,
		Username:            gc.GitHubUsername,
		InstallationPresent: gc.InstallationID > 0,
		AccessExpiresAt:     gc.AccessTokenExpiresAt,
	}
	// If the access token is expired AND there's no refresh token AND no
	// installation, the user genuinely has to reconnect.
	if gc.InstallationID == 0 &&
		gc.AccessTokenExpiresAt != nil && time.Now().After(*gc.AccessTokenExpiresAt) &&
		gc.RefreshToken == "" {
		h.NeedsReconnect = true
	}
	return h
}
