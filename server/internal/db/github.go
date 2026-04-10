package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type GitHubConnection struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	GitHubUsername string    `json:"github_username"`
	AccessToken    string    `json:"-"`
	RefreshToken   string    `json:"-"`
	InstallationID int64     `json:"installation_id"`
	CreatedAt      time.Time `json:"created_at"`
}

func (d *DB) SaveGitHubConnection(ctx context.Context, userID, username, accessToken, refreshToken string, installationID int64) error {
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO github_connections (user_id, github_username, access_token, refresh_token, installation_id)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (user_id) DO UPDATE SET github_username = $2, access_token = $3, refresh_token = $4, installation_id = $5`,
		userID, username, accessToken, refreshToken, installationID,
	)
	return err
}

func (d *DB) GetGitHubConnection(ctx context.Context, userID string) (*GitHubConnection, error) {
	var gc GitHubConnection
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, github_username, access_token, refresh_token, installation_id, created_at
		 FROM github_connections WHERE user_id = $1`,
		userID,
	).Scan(&gc.ID, &gc.UserID, &gc.GitHubUsername, &gc.AccessToken, &gc.RefreshToken, &gc.InstallationID, &gc.CreatedAt)
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
