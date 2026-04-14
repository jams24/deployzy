package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type GitHubConnection struct {
	ID                    string     `json:"id"`
	UserID                string     `json:"user_id"`
	GitHubUsername        string     `json:"github_username"`
	AccessToken           string     `json:"-"`
	RefreshToken          string     `json:"-"`
	InstallationID        int64      `json:"installation_id"`
	AccessTokenExpiresAt  *time.Time `json:"-"`
	RefreshTokenExpiresAt *time.Time `json:"-"`
	CreatedAt             time.Time  `json:"created_at"`
}

// SaveGitHubConnection upserts an OAuth result. expiresIn / refreshExpiresIn
// are seconds from now (0 = unknown → column stays NULL → refresh treated
// as always-needed). GitHub OAuth user tokens expire in ~8h; refresh tokens
// last ~6 months.
func (d *DB) SaveGitHubConnection(ctx context.Context, userID, username, accessToken, refreshToken string, installationID int64, expiresIn, refreshExpiresIn int) error {
	var accessExpiresAt, refreshExpiresAt *time.Time
	if expiresIn > 0 {
		t := time.Now().Add(time.Duration(expiresIn) * time.Second)
		accessExpiresAt = &t
	}
	if refreshExpiresIn > 0 {
		t := time.Now().Add(time.Duration(refreshExpiresIn) * time.Second)
		refreshExpiresAt = &t
	}
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO github_connections
		   (user_id, github_username, access_token, refresh_token, installation_id,
		    access_token_expires_at, refresh_token_expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (user_id) DO UPDATE SET
		   github_username = $2,
		   access_token = $3,
		   refresh_token = $4,
		   installation_id = $5,
		   access_token_expires_at = $6,
		   refresh_token_expires_at = $7`,
		userID, username, accessToken, refreshToken, installationID, accessExpiresAt, refreshExpiresAt,
	)
	return err
}

// UpdateGitHubTokens replaces just the token fields after a refresh; leaves
// installation_id / github_username alone. If the incoming refreshToken is
// empty, the existing one is preserved (GitHub may rotate it OR leave it).
func (d *DB) UpdateGitHubTokens(ctx context.Context, userID, accessToken, refreshToken string, expiresIn, refreshExpiresIn int) error {
	var accessExpiresAt, refreshExpiresAt *time.Time
	if expiresIn > 0 {
		t := time.Now().Add(time.Duration(expiresIn) * time.Second)
		accessExpiresAt = &t
	}
	if refreshExpiresIn > 0 {
		t := time.Now().Add(time.Duration(refreshExpiresIn) * time.Second)
		refreshExpiresAt = &t
	}
	_, err := d.Pool.Exec(ctx,
		`UPDATE github_connections SET
		   access_token = $2,
		   refresh_token = COALESCE(NULLIF($3, ''), refresh_token),
		   access_token_expires_at = $4,
		   refresh_token_expires_at = COALESCE($5, refresh_token_expires_at)
		 WHERE user_id = $1`,
		userID, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt,
	)
	return err
}

func (d *DB) GetGitHubConnection(ctx context.Context, userID string) (*GitHubConnection, error) {
	var gc GitHubConnection
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, github_username, access_token, refresh_token, installation_id,
		        access_token_expires_at, refresh_token_expires_at, created_at
		 FROM github_connections WHERE user_id = $1`,
		userID,
	).Scan(&gc.ID, &gc.UserID, &gc.GitHubUsername, &gc.AccessToken, &gc.RefreshToken, &gc.InstallationID,
		&gc.AccessTokenExpiresAt, &gc.RefreshTokenExpiresAt, &gc.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &gc, err
}

func (d *DB) DeleteGitHubConnection(ctx context.Context, userID string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM github_connections WHERE user_id = $1`, userID)
	return err
}

func (d *DB) GetProjectByGitHubRepo(ctx context.Context, repoFullName string) (*Project, error) {
	p, err := scanProject(d.Pool.QueryRow(ctx,
		`SELECT `+projectCols+` FROM projects WHERE github_repo = $1 AND auto_deploy = true LIMIT 1`,
		repoFullName,
	).Scan)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &p, err
}

// GetProjectsByGitHubRepo returns all projects linked to a repo with auto_deploy enabled.
func (d *DB) GetProjectsByGitHubRepo(ctx context.Context, repoFullName string) ([]Project, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects WHERE github_repo = $1 AND auto_deploy = true`,
		repoFullName,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		p, err := scanProject(rows.Scan)
		if err != nil {
			continue
		}
		projects = append(projects, p)
	}
	return projects, nil
}

func (d *DB) UpdateProjectGitHub(ctx context.Context, projectID, githubRepo, branch string, autoDeploy bool) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET github_repo = $2, github_branch = $3, auto_deploy = $4, updated_at = now() WHERE id = $1`,
		projectID, githubRepo, branch, autoDeploy,
	)
	return err
}

func (d *DB) SetProjectAutoDeploy(ctx context.Context, projectID string, enabled bool) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET auto_deploy = $2, updated_at = now() WHERE id = $1`,
		projectID, enabled,
	)
	return err
}
