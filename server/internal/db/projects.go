package db

import (
	"fmt"
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

type Project struct {
	ID              string            `json:"id"`
	UserID          string            `json:"user_id"`
	Name            string            `json:"name"`
	Subdomain       string            `json:"subdomain"`
	RepoURL         string            `json:"repo_url"`
	Branch          string            `json:"branch"`
	Framework       string            `json:"framework"`
	BuildCmd        string            `json:"build_cmd"`
	StartCmd        string            `json:"start_cmd"`
	EnvVars         map[string]string `json:"env_vars"`
	Status          string            `json:"status"`
	ContainerID     string            `json:"container_id"`
	ContainerPort   int               `json:"container_port"`
	WorkerServerID  string            `json:"worker_server_id"`
	LastDeployAt    *time.Time        `json:"last_deploy_at"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}

type DeployLog struct {
	ID        int64     `json:"id"`
	ProjectID string    `json:"project_id"`
	Message   string    `json:"message"`
	Level     string    `json:"level"`
	CreatedAt time.Time `json:"created_at"`
}

func (d *DB) CreateProject(ctx context.Context, userID, name, subdomain, framework string) (*Project, error) {
	var p Project
	envJSON, _ := json.Marshal(map[string]string{})
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO projects (user_id, name, subdomain, framework, env_vars)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, user_id, name, subdomain, repo_url, branch, framework, build_cmd, start_cmd, env_vars, status, container_id, container_port, last_deploy_at, created_at, updated_at`,
		userID, name, subdomain, framework, envJSON,
	).Scan(&p.ID, &p.UserID, &p.Name, &p.Subdomain, &p.RepoURL, &p.Branch, &p.Framework, &p.BuildCmd, &p.StartCmd, &envJSON, &p.Status, &p.ContainerID, &p.ContainerPort, &p.LastDeployAt, &p.CreatedAt, &p.UpdatedAt)
	json.Unmarshal(envJSON, &p.EnvVars)
	return &p, err
}

func (d *DB) GetProjectBySubdomain(ctx context.Context, subdomain string) (*Project, error) {
	var p Project
	var envJSON []byte
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, name, subdomain, repo_url, branch, framework, build_cmd, start_cmd, env_vars, status, container_id, container_port, last_deploy_at, created_at, updated_at
		 FROM projects WHERE subdomain = $1`,
		subdomain,
	).Scan(&p.ID, &p.UserID, &p.Name, &p.Subdomain, &p.RepoURL, &p.Branch, &p.Framework, &p.BuildCmd, &p.StartCmd, &envJSON, &p.Status, &p.ContainerID, &p.ContainerPort, &p.LastDeployAt, &p.CreatedAt, &p.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	json.Unmarshal(envJSON, &p.EnvVars)
	return &p, err
}

func (d *DB) GetProject(ctx context.Context, projectID string) (*Project, error) {
	var p Project
	var envJSON []byte
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, name, subdomain, repo_url, branch, framework, build_cmd, start_cmd, env_vars, status, container_id, container_port, last_deploy_at, created_at, updated_at
		 FROM projects WHERE id = $1`,
		projectID,
	).Scan(&p.ID, &p.UserID, &p.Name, &p.Subdomain, &p.RepoURL, &p.Branch, &p.Framework, &p.BuildCmd, &p.StartCmd, &envJSON, &p.Status, &p.ContainerID, &p.ContainerPort, &p.LastDeployAt, &p.CreatedAt, &p.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	json.Unmarshal(envJSON, &p.EnvVars)
	return &p, err
}

func (d *DB) ListProjects(ctx context.Context, userID string) ([]Project, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, name, subdomain, repo_url, branch, framework, build_cmd, start_cmd, env_vars, status, container_id, container_port, last_deploy_at, created_at, updated_at
		 FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		var envJSON []byte
		rows.Scan(&p.ID, &p.UserID, &p.Name, &p.Subdomain, &p.RepoURL, &p.Branch, &p.Framework, &p.BuildCmd, &p.StartCmd, &envJSON, &p.Status, &p.ContainerID, &p.ContainerPort, &p.LastDeployAt, &p.CreatedAt, &p.UpdatedAt)
		json.Unmarshal(envJSON, &p.EnvVars)
		projects = append(projects, p)
	}
	return projects, nil
}

func (d *DB) UpdateProjectStatus(ctx context.Context, projectID, status, containerID string, port int) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET status = $2, container_id = $3, container_port = $4, last_deploy_at = now(), updated_at = now() WHERE id = $1`,
		projectID, status, containerID, port,
	)
	return err
}

func (d *DB) UpdateProjectConfig(ctx context.Context, projectID, repoURL, branch, buildCmd, startCmd string, envVars map[string]string) error {
	envJSON, _ := json.Marshal(envVars)
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET repo_url = $2, branch = $3, build_cmd = $4, start_cmd = $5, env_vars = $6, updated_at = now() WHERE id = $1`,
		projectID, repoURL, branch, buildCmd, startCmd, envJSON,
	)
	return err
}

func (d *DB) DeleteProject(ctx context.Context, projectID, userID string) error {
	// Delete deploy logs first (foreign key constraint)
	d.Pool.Exec(ctx, `DELETE FROM deploy_logs WHERE project_id = $1`, projectID)

	tag, err := d.Pool.Exec(ctx, `DELETE FROM projects WHERE id = $1 AND user_id = $2`, projectID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("project not found")
	}
	return nil
}

func (d *DB) AddDeployLog(ctx context.Context, projectID, message, level string) {
	d.Pool.Exec(ctx,
		`INSERT INTO deploy_logs (project_id, message, level) VALUES ($1, $2, $3)`,
		projectID, message, level,
	)
}

func (d *DB) GetDeployLogs(ctx context.Context, projectID string, limit int) ([]DeployLog, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := d.Pool.Query(ctx,
		`SELECT id, project_id, message, level, created_at FROM deploy_logs WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
		projectID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []DeployLog
	for rows.Next() {
		var l DeployLog
		rows.Scan(&l.ID, &l.ProjectID, &l.Message, &l.Level, &l.CreatedAt)
		logs = append(logs, l)
	}
	return logs, nil
}

// AssignProjectServer links a project to a worker server.
func (d *DB) AssignProjectServer(ctx context.Context, projectID, serverID string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET worker_server_id = $2 WHERE id = $1`,
		projectID, serverID,
	)
	return err
}

func (d *DB) UpdateProjectEnvVars(ctx context.Context, projectID string, envVars map[string]string) error {
	envJSON, _ := json.Marshal(envVars)
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET env_vars = $2, updated_at = now() WHERE id = $1`,
		projectID, envJSON,
	)
	return err
}
