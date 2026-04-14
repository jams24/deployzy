package api

import (
	"context"
	"time"

	"github.com/serverme/serverme/server/internal/db"
)

// bestGitHubToken returns the freshest usable GitHub token for a user,
// auto-refreshing the user OAuth token if it's expired. Preference order:
//
//  1. App installation token (cached, covers private repo ops and PR comments)
//  2. User OAuth access token, refreshed if expired using stored refresh_token
//
// Returns ("", false) if there's no connection or both paths fail. The
// boolean is true when a usable token is returned — callers should treat
// false as "user needs to reconnect" and surface that clearly.
//
// This exists so handlers don't each reimplement the same prefer-install-
// fallback-to-user dance and no-one forgets the refresh path.
func (s *Server) bestGitHubToken(ctx context.Context, userID string) (string, bool) {
	if s.deployer == nil || s.deployer.GitHub == nil {
		return "", false
	}
	gc, _ := s.db.GetGitHubConnection(ctx, userID)
	if gc == nil {
		return "", false
	}

	// 1. Try the installation token. It's cached and lasts ~1h, so this is
	//    almost always instant and works for private repos.
	if gc.InstallationID > 0 {
		if tok, err := s.deployer.GitHub.GetInstallationToken(gc.InstallationID); err == nil && tok != "" {
			return tok, true
		}
		// Fall through to user token if install fetch failed (transient
		// GitHub error, or the user uninstalled the app).
	}

	// 2. User OAuth token — refresh if it's about to expire (or has).
	if gc.AccessTokenExpiresAt != nil && time.Until(*gc.AccessTokenExpiresAt) < 2*time.Minute && gc.RefreshToken != "" {
		newTokens, err := s.deployer.GitHub.RefreshOAuthToken(gc.RefreshToken)
		if err == nil && newTokens != nil && newTokens.AccessToken != "" {
			s.db.UpdateGitHubTokens(ctx, userID, newTokens.AccessToken, newTokens.RefreshToken,
				newTokens.ExpiresIn, newTokens.RefreshTokenExpiresIn)
			return newTokens.AccessToken, true
		}
		s.log.Warn().Err(err).Str("user", userID).Msg("github refresh failed — user must reconnect")
		return "", false
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
