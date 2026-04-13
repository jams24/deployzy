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
	InstallCmd      string            `json:"install_cmd"`
	BuildCmd        string            `json:"build_cmd"`
	StartCmd        string            `json:"start_cmd"`
	RootDir         string            `json:"root_dir"`
	NodeVersion     string            `json:"node_version"`
	PortOverride    int               `json:"port_override"`
	MemoryMB        int               `json:"memory_mb"`
	CPUs            float64           `json:"cpus"`
	EnvVars         map[string]string `json:"env_vars"`
	Status          string            `json:"status"`
	ContainerID     string            `json:"container_id"`
	ContainerPort   int               `json:"container_port"`
	WorkerServerID  string            `json:"worker_server_id"`
	GitHubRepo      string            `json:"github_repo"`
	GitHubBranch    string            `json:"github_branch"`
	AutoDeploy      bool              `json:"auto_deploy"`
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

// projectCols is the standard column list for project queries.
const projectCols = `id, user_id, name, subdomain, repo_url, branch, framework, install_cmd, build_cmd, start_cmd, root_dir, node_version, port_override, memory_mb, cpus, env_vars, status, container_id, container_port, github_repo, github_branch, auto_deploy, last_deploy_at, created_at, updated_at`

// scanProject scans a row into a Project struct. The row must match projectCols order.
func scanProject(scan func(dest ...any) error) (Project, error) {
	var p Project
	var envJSON []byte
	err := scan(&p.ID, &p.UserID, &p.Name, &p.Subdomain, &p.RepoURL, &p.Branch, &p.Framework, &p.InstallCmd, &p.BuildCmd, &p.StartCmd, &p.RootDir, &p.NodeVersion, &p.PortOverride, &p.MemoryMB, &p.CPUs, &envJSON, &p.Status, &p.ContainerID, &p.ContainerPort, &p.GitHubRepo, &p.GitHubBranch, &p.AutoDeploy, &p.LastDeployAt, &p.CreatedAt, &p.UpdatedAt)
	if err == nil {
		json.Unmarshal(envJSON, &p.EnvVars)
	}
	return p, err
}

func (d *DB) CreateProject(ctx context.Context, userID, name, subdomain, framework string) (*Project, error) {
	envJSON, _ := json.Marshal(map[string]string{})
	p, err := scanProject(d.Pool.QueryRow(ctx,
		`INSERT INTO projects (user_id, name, subdomain, framework, env_vars)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING `+projectCols,
		userID, name, subdomain, framework, envJSON,
	).Scan)
	return &p, err
}

func (d *DB) GetProjectBySubdomain(ctx context.Context, subdomain string) (*Project, error) {
	p, err := scanProject(d.Pool.QueryRow(ctx,
		`SELECT `+projectCols+` FROM projects WHERE subdomain = $1`, subdomain,
	).Scan)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &p, err
}

func (d *DB) GetProject(ctx context.Context, projectID string) (*Project, error) {
	p, err := scanProject(d.Pool.QueryRow(ctx,
		`SELECT `+projectCols+` FROM projects WHERE id = $1`, projectID,
	).Scan)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &p, err
}

func (d *DB) ListProjects(ctx context.Context, userID string) ([]Project, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
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

func (d *DB) UpdateProjectStatus(ctx context.Context, projectID, status, containerID string, port int) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET status = $2, container_id = $3, container_port = $4, last_deploy_at = now(), updated_at = now() WHERE id = $1`,
		projectID, status, containerID, port,
	)
	return err
}

// ResetStuckBuilds marks any projects still in "building" state as "failed".
// Called at server startup so deploys interrupted by a restart don't hang forever.
// Returns the number of projects reset.
func (d *DB) ResetStuckBuilds(ctx context.Context) (int64, error) {
	tag, err := d.Pool.Exec(ctx,
		`UPDATE projects SET status = 'failed', updated_at = now() WHERE status = 'building'`,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (d *DB) UpdateProjectConfig(ctx context.Context, projectID, repoURL, branch, buildCmd, startCmd string, envVars map[string]string) error {
	envJSON, _ := json.Marshal(envVars)
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET repo_url = $2, branch = $3, build_cmd = $4, start_cmd = $5, env_vars = $6, updated_at = now() WHERE id = $1`,
		projectID, repoURL, branch, buildCmd, startCmd, envJSON,
	)
	return err
}

// BuildConfig bundles all the advanced build settings a user can override.
type BuildConfig struct {
	InstallCmd   string
	BuildCmd     string
	StartCmd     string
	RootDir      string
	NodeVersion  string
	PortOverride int
	MemoryMB     int
	CPUs         float64
}

// UpdateProjectBuildConfig updates the advanced build/run settings for a project.
func (d *DB) UpdateProjectBuildConfig(ctx context.Context, projectID string, cfg BuildConfig) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET
		   install_cmd = $2,
		   build_cmd = $3,
		   start_cmd = $4,
		   root_dir = $5,
		   node_version = $6,
		   port_override = $7,
		   memory_mb = $8,
		   cpus = $9,
		   updated_at = now()
		 WHERE id = $1`,
		projectID, cfg.InstallCmd, cfg.BuildCmd, cfg.StartCmd, cfg.RootDir,
		cfg.NodeVersion, cfg.PortOverride, cfg.MemoryMB, cfg.CPUs,
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
