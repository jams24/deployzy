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
	HealthCheckPath string            `json:"health_check_path"`
	ReleaseCmd      string            `json:"release_cmd"`
	CommitSHA       string            `json:"commit_sha"`
	Labels          []string          `json:"labels"`
	BuildMode       string            `json:"build_mode"` // "auto" | "ignore_dockerfile"
	DockerfilePath  string            `json:"dockerfile_path"` // e.g. "Dockerfile.bot"; empty = "Dockerfile"
	// DeploySource — "git" (default, clone+build), "image" (run a prebuilt
	// registry image), or "upload" (build from an uploaded tarball).
	DeploySource    string            `json:"deploy_source"`
	ImageRef        string            `json:"image_ref"` // registry image when DeploySource=="image"
	// Services — when non-empty, this project deploys multiple directories from
	// the repo as separate processes inside one container (see ProjectService).
	// Empty = single-service (the normal case).
	Services        []ProjectService  `json:"services"`
	// Preview deployments — per-PR ephemeral children of a parent project.
	ParentProjectID *string           `json:"parent_project_id"`
	PRNumber        int               `json:"pr_number"`
	PRTitle         string            `json:"pr_title"`
	PreviewEnabled  bool              `json:"preview_enabled"`
	PRCommentID     int64             `json:"pr_comment_id"`
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

// ProjectService is one service in a multi-service project: a directory in the
// repo built and run as its own process inside the shared container. The first
// service in the list is the "primary" and keeps the project's main port +
// subdomain; the rest bind their own port and get a flat sibling subdomain
// (<projectsub>-<name>.<domain>).
type ProjectService struct {
	Name         string            `json:"name"`          // DNS-safe label, e.g. "api"
	RootDir      string            `json:"root_dir"`      // dir within the repo
	Port         int               `json:"port"`          // port the service listens on
	InstallCmd   string            `json:"install_cmd"`
	BuildCmd     string            `json:"build_cmd"`
	StartCmd     string            `json:"start_cmd"`
	Framework    string            `json:"framework"`     // detected stack, e.g. "nextjs"
	EnvOverrides map[string]string `json:"env_overrides"` // applied on top of shared env, this service only
}

type DeployLog struct {
	ID        int64     `json:"id"`
	ProjectID string    `json:"project_id"`
	Message   string    `json:"message"`
	Level     string    `json:"level"`
	CreatedAt time.Time `json:"created_at"`
}

// projectCols is the standard column list for project queries.
// NULL-able columns (container_id/container_port/github_repo/repo_url) are
// COALESCE'd so the non-pointer Go struct fields can always scan — a stopped
// project whose worker_server was deleted has container_id=NULL, which would
// otherwise fail `cannot scan NULL into *string` and skip the row.
const projectCols = `id, user_id, name, subdomain, COALESCE(repo_url, ''), branch, framework, install_cmd, build_cmd, start_cmd, root_dir, node_version, port_override, memory_mb, cpus, health_check_path, release_cmd, commit_sha, labels, build_mode, parent_project_id, pr_number, pr_title, preview_enabled, pr_comment_id, env_vars, status, COALESCE(container_id, ''), COALESCE(container_port, 0), COALESCE(github_repo, ''), github_branch, auto_deploy, last_deploy_at, created_at, updated_at, COALESCE(dockerfile_path, ''), COALESCE(services, '[]'), COALESCE(deploy_source, 'git'), COALESCE(image_ref, '')`

// adminProjectCols is projectCols with every column prefixed by "p." for use
// in JOIN queries where bare column names like id/created_at would be ambiguous.
const adminProjectCols = `p.id, p.user_id, p.name, p.subdomain, COALESCE(p.repo_url, ''), p.branch, p.framework, p.install_cmd, p.build_cmd, p.start_cmd, p.root_dir, p.node_version, p.port_override, p.memory_mb, p.cpus, p.health_check_path, p.release_cmd, p.commit_sha, p.labels, p.build_mode, p.parent_project_id, p.pr_number, p.pr_title, p.preview_enabled, p.pr_comment_id, p.env_vars, p.status, COALESCE(p.container_id, ''), COALESCE(p.container_port, 0), COALESCE(p.github_repo, ''), p.github_branch, p.auto_deploy, p.last_deploy_at, p.created_at, p.updated_at, COALESCE(p.dockerfile_path, ''), COALESCE(p.services, '[]'), COALESCE(p.deploy_source, 'git'), COALESCE(p.image_ref, '')`

// scanProject scans a row into a Project struct. The row must match projectCols order.
func scanProject(scan func(dest ...any) error) (Project, error) {
	var p Project
	var envJSON []byte
	var servicesJSON []byte
	err := scan(&p.ID, &p.UserID, &p.Name, &p.Subdomain, &p.RepoURL, &p.Branch, &p.Framework, &p.InstallCmd, &p.BuildCmd, &p.StartCmd, &p.RootDir, &p.NodeVersion, &p.PortOverride, &p.MemoryMB, &p.CPUs, &p.HealthCheckPath, &p.ReleaseCmd, &p.CommitSHA, &p.Labels, &p.BuildMode, &p.ParentProjectID, &p.PRNumber, &p.PRTitle, &p.PreviewEnabled, &p.PRCommentID, &envJSON, &p.Status, &p.ContainerID, &p.ContainerPort, &p.GitHubRepo, &p.GitHubBranch, &p.AutoDeploy, &p.LastDeployAt, &p.CreatedAt, &p.UpdatedAt, &p.DockerfilePath, &servicesJSON, &p.DeploySource, &p.ImageRef)
	if err == nil {
		json.Unmarshal(envJSON, &p.EnvVars)
		json.Unmarshal(servicesJSON, &p.Services)
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
	// Hide preview children from the main project list — they appear
	// under their parent via /projects/{id}/previews instead.
	rows, err := d.Pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects WHERE user_id = $1 AND parent_project_id IS NULL ORDER BY created_at DESC`,
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
			// NEVER silently drop a row — log loudly so future schema/
			// type mismatches (nullable column → non-pointer Go field)
			// show up in logs instead of hiding every row behind one
			// broken one. pgx's rows iterator ALSO terminates on the
			// first real scan error, so dropping one row effectively
			// drops the rest too.
			fmt.Printf("[ERROR] ListProjects scan failed user=%s err=%v\n", userID, err)
			return nil, err
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
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

// ListRunningProjects returns every project currently in 'running' status.
// Used by the metrics scraper to know which containers to poll. Separate from
// the user-scoped ListProjects because the scraper runs as a system process.
func (d *DB) ListRunningProjects(ctx context.Context) ([]Project, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects WHERE status = 'running'`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		p, err := scanProject(rows.Scan)
		if err != nil {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

// ListProjectsWithGitHub returns every non-preview project that has a
// github_repo set. Used by admin restore flows to mass-redeploy after a
// disaster-recovery. Sorted oldest-first so newer projects get deployed
// last and any build cache benefits them most.
func (d *DB) ListProjectsWithGitHub(ctx context.Context) ([]Project, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects
		 WHERE parent_project_id IS NULL
		   AND github_repo IS NOT NULL AND github_repo <> ''
		 ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		p, err := scanProject(rows.Scan)
		if err != nil {
			continue
		}
		out = append(out, p)
	}
	return out, nil
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
	InstallCmd      string
	BuildCmd        string
	StartCmd        string
	RootDir         string
	NodeVersion     string
	PortOverride    int
	MemoryMB        int
	CPUs            float64
	HealthCheckPath string
	ReleaseCmd      string
	BuildMode       string
	DockerfilePath  string
	Services        []ProjectService
}

// UpdateProjectBuildConfig updates the advanced build/run settings for a project.
func (d *DB) UpdateProjectBuildConfig(ctx context.Context, projectID string, cfg BuildConfig) error {
	services := cfg.Services
	if services == nil {
		services = []ProjectService{}
	}
	servicesJSON, _ := json.Marshal(services)
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
		   health_check_path = $10,
		   release_cmd = $11,
		   build_mode = $12,
		   dockerfile_path = $13,
		   services = $14,
		   updated_at = now()
		 WHERE id = $1`,
		projectID, cfg.InstallCmd, cfg.BuildCmd, cfg.StartCmd, cfg.RootDir,
		cfg.NodeVersion, cfg.PortOverride, cfg.MemoryMB, cfg.CPUs,
		cfg.HealthCheckPath, cfg.ReleaseCmd, cfg.BuildMode, cfg.DockerfilePath,
		servicesJSON,
	)
	return err
}

// SetProjectSource sets where a project's container comes from: "git" (default),
// "image" (registry image_ref), or "upload" (uploaded tarball). Kept separate
// from UpdateProjectBuildConfig so the build-config editor can't wipe it.
func (d *DB) SetProjectSource(ctx context.Context, projectID, source, imageRef string) error {
	if source == "" {
		source = "git"
	}
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET deploy_source = $2, image_ref = $3, updated_at = now() WHERE id = $1`,
		projectID, source, imageRef,
	)
	return err
}

// UpdateProjectLabels replaces the labels for a project.
func (d *DB) UpdateProjectLabels(ctx context.Context, projectID string, labels []string) error {
	if labels == nil {
		labels = []string{}
	}
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET labels = $2, updated_at = now() WHERE id = $1`,
		projectID, labels,
	)
	return err
}

// ── Preview deployment helpers ──

// GetPreviewByPR finds an existing preview project for a (parent, PR#) pair.
// Returns nil if none exists yet.
func (d *DB) GetPreviewByPR(ctx context.Context, parentID string, prNumber int) (*Project, error) {
	p, err := scanProject(d.Pool.QueryRow(ctx,
		`SELECT `+projectCols+` FROM projects
		 WHERE parent_project_id = $1 AND pr_number = $2
		 LIMIT 1`,
		parentID, prNumber,
	).Scan)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ListPreviewsForParent returns all preview projects for a parent, newest first.
func (d *DB) ListPreviewsForParent(ctx context.Context, parentID string) ([]Project, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT `+projectCols+` FROM projects
		 WHERE parent_project_id = $1
		 ORDER BY pr_number DESC`,
		parentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		p, err := scanProject(rows.Scan)
		if err != nil {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

// CreatePreviewProject inserts a new preview-project row inheriting the parent's
// build configuration. Called when a PR is first opened. Branch is the PR's
// head ref; subdomain is derived from the parent's subdomain + PR number.
func (d *DB) CreatePreviewProject(ctx context.Context, parent *Project, prNumber int, prTitle, branch, prSubdomain string) (*Project, error) {
	envJSON, _ := json.Marshal(parent.EnvVars)
	labels := parent.Labels
	if labels == nil {
		labels = []string{}
	}
	services := parent.Services
	if services == nil {
		services = []ProjectService{}
	}
	servicesJSON, _ := json.Marshal(services)
	// Inherit the parent's worker_server_id so a preview lands on the same
	// worker as production — otherwise it falls through to auto-select and
	// the PR preview can end up on a different machine from prod, which is
	// surprising behaviour.
	var workerID any
	if parent.WorkerServerID != "" {
		workerID = parent.WorkerServerID
	} else {
		workerID = nil
	}
	p, err := scanProject(d.Pool.QueryRow(ctx,
		`INSERT INTO projects (
			user_id, name, subdomain, repo_url, branch, framework,
			install_cmd, build_cmd, start_cmd, root_dir, node_version,
			port_override, memory_mb, cpus, health_check_path, release_cmd,
			labels, build_mode, dockerfile_path, services, deploy_source, image_ref,
			parent_project_id, pr_number, pr_title,
			github_repo, github_branch, worker_server_id,
			env_vars
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
		RETURNING `+projectCols,
		parent.UserID,
		fmt.Sprintf("%s PR #%d", parent.Name, prNumber),
		prSubdomain,
		parent.RepoURL,
		branch,
		parent.Framework,
		parent.InstallCmd, parent.BuildCmd, parent.StartCmd, parent.RootDir, parent.NodeVersion,
		parent.PortOverride, parent.MemoryMB, parent.CPUs, parent.HealthCheckPath, parent.ReleaseCmd,
		labels, parent.BuildMode, parent.DockerfilePath, servicesJSON, parent.DeploySource, parent.ImageRef,
		parent.ID, prNumber, prTitle,
		parent.GitHubRepo, branch, workerID,
		envJSON,
	).Scan)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// UpdatePreviewCommentID records the GitHub comment ID once we've posted the
// first preview URL to the PR — lets us edit the comment on subsequent
// deploys instead of spamming new ones.
func (d *DB) UpdatePreviewCommentID(ctx context.Context, previewID string, commentID int64) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET pr_comment_id = $2 WHERE id = $1`,
		previewID, commentID,
	)
	return err
}

// UpdateProjectPreviewEnabled toggles whether preview deploys run for a project.
func (d *DB) UpdateProjectPreviewEnabled(ctx context.Context, projectID string, enabled bool) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET preview_enabled = $2, updated_at = now() WHERE id = $1`,
		projectID, enabled,
	)
	return err
}

// UpdateProjectCommitSHA records which commit was actually deployed.
// Called by the engine after a successful clone so rollbacks and the UI know
// exactly what's running.
func (d *DB) UpdateProjectCommitSHA(ctx context.Context, projectID, sha string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE projects SET commit_sha = $2, updated_at = now() WHERE id = $1`,
		projectID, sha,
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

// PruneOldDeployLogs drops deploy log rows older than cutoff. Called
// periodically by the retention sweeper in main.go.
func (d *DB) PruneOldDeployLogs(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := d.Pool.Exec(ctx,
		`DELETE FROM deploy_logs WHERE created_at < $1`, cutoff,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// PruneOldCapturedRequests drops old inspector rows. Captured request bodies
// can be 10KB each; a popular tunnel accumulates fast.
func (d *DB) PruneOldCapturedRequests(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := d.Pool.Exec(ctx,
		`DELETE FROM captured_requests WHERE timestamp < $1`, cutoff,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
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
