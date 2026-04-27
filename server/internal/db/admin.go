package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type AdminUser struct {
	ID         string    `json:"id"`
	Email      string    `json:"email"`
	Name       string    `json:"name"`
	Plan       string    `json:"plan"`
	IsAdmin    bool      `json:"is_admin"`
	CreatedAt  time.Time `json:"created_at"`
	KeyCount   int       `json:"key_count"`
	TunnelReqs int64     `json:"tunnel_requests"`
}

type AdminStats struct {
	TotalUsers     int64 `json:"total_users"`
	TotalKeys      int64 `json:"total_keys"`
	TotalDomains   int64 `json:"total_domains"`
	TotalTeams     int64 `json:"total_teams"`
	TotalRequests  int64 `json:"total_requests"`
	UsersToday     int64 `json:"users_today"`
	UsersThisWeek  int64 `json:"users_this_week"`
	UsersThisMonth int64 `json:"users_this_month"`
	RequestsToday  int64 `json:"requests_today"`

	// Projects / deploy analytics
	ProjectsTotal      int64            `json:"projects_total"`
	ProjectsByStatus   map[string]int64 `json:"projects_by_status"`
	ProjectsByStack    map[string]int64 `json:"projects_by_stack"`
	DeploysToday       int64            `json:"deploys_today"`
	DeploysThisWeek    int64            `json:"deploys_this_week"`
	ServicesTotal      int64            `json:"services_total"`
	TunnelsTotal       int64            `json:"tunnels_total"`
	SubdomainsTotal    int64            `json:"subdomains_total"`
	WorkerServersTotal int64            `json:"worker_servers_total"`
}

func (d *DB) IsUserAdmin(ctx context.Context, userID string) (bool, error) {
	var isAdmin bool
	err := d.Pool.QueryRow(ctx,
		`SELECT COALESCE(is_admin, false) FROM users WHERE id = $1`, userID,
	).Scan(&isAdmin)
	return isAdmin, err
}

func (d *DB) AdminListUsers(ctx context.Context, search string, limit, offset int) ([]AdminUser, int64, error) {
	if limit <= 0 {
		limit = 50
	}

	var total int64
	var users []AdminUser

	if search != "" {
		pattern := "%" + search + "%"
		d.Pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM users WHERE email ILIKE $1 OR name ILIKE $1`, pattern,
		).Scan(&total)

		rows, err := d.Pool.Query(ctx,
			`SELECT u.id, u.email, u.name, u.plan, COALESCE(u.is_admin, false), u.created_at,
			 (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id),
			 COALESCE((SELECT COUNT(*) FROM captured_requests WHERE user_id = u.id), 0)
			 FROM users u WHERE u.email ILIKE $1 OR u.name ILIKE $1
			 ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`,
			pattern, limit, offset,
		)
		if err != nil {
			return nil, 0, err
		}
		defer rows.Close()
		users = scanAdminUsers(rows)
	} else {
		d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&total)

		rows, err := d.Pool.Query(ctx,
			`SELECT u.id, u.email, u.name, u.plan, COALESCE(u.is_admin, false), u.created_at,
			 (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id),
			 COALESCE((SELECT COUNT(*) FROM captured_requests WHERE user_id = u.id), 0)
			 FROM users u
			 ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`,
			limit, offset,
		)
		if err != nil {
			return nil, 0, err
		}
		defer rows.Close()
		users = scanAdminUsers(rows)
	}

	return users, total, nil
}

func scanAdminUsers(rows interface{ Next() bool; Scan(...interface{}) error }) []AdminUser {
	var users []AdminUser
	for rows.Next() {
		var u AdminUser
		rows.Scan(&u.ID, &u.Email, &u.Name, &u.Plan, &u.IsAdmin, &u.CreatedAt, &u.KeyCount, &u.TunnelReqs)
		users = append(users, u)
	}
	return users
}

func (d *DB) AdminGetStats(ctx context.Context) (*AdminStats, error) {
	s := &AdminStats{
		ProjectsByStatus: map[string]int64{},
		ProjectsByStack:  map[string]int64{},
	}
	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	weekAgo := now.AddDate(0, 0, -7)
	monthAgo := now.AddDate(0, -1, 0)

	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&s.TotalUsers)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys`).Scan(&s.TotalKeys)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM domains`).Scan(&s.TotalDomains)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM teams`).Scan(&s.TotalTeams)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM captured_requests`).Scan(&s.TotalRequests)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE created_at >= $1`, today).Scan(&s.UsersToday)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE created_at >= $1`, weekAgo).Scan(&s.UsersThisWeek)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE created_at >= $1`, monthAgo).Scan(&s.UsersThisMonth)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM captured_requests WHERE timestamp >= $1`, today).Scan(&s.RequestsToday)

	// Projects — exclude previews (those with a parent_project_id) so the
	// total matches what admins see in the UI and what billing reports.
	d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM projects WHERE parent_project_id IS NULL`,
	).Scan(&s.ProjectsTotal)

	// Status breakdown
	if rows, err := d.Pool.Query(ctx,
		`SELECT COALESCE(status, 'unknown') AS k, COUNT(*) FROM projects
		 WHERE parent_project_id IS NULL GROUP BY k`,
	); err == nil {
		defer rows.Close()
		for rows.Next() {
			var k string
			var v int64
			if err := rows.Scan(&k, &v); err != nil {
				return nil, err
			}
			s.ProjectsByStatus[k] = v
		}
	}

	// Stack / framework breakdown
	if rows, err := d.Pool.Query(ctx,
		`SELECT COALESCE(framework, 'unknown') AS k, COUNT(*) FROM projects
		 WHERE parent_project_id IS NULL GROUP BY k`,
	); err == nil {
		defer rows.Close()
		for rows.Next() {
			var k string
			var v int64
			if err := rows.Scan(&k, &v); err != nil {
				return nil, err
			}
			s.ProjectsByStack[k] = v
		}
	}

	// Deploys — use deploy_logs.created_at when available, falling back to
	// last_deploy_at on the project itself.
	d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM deploy_logs WHERE created_at >= $1`, today,
	).Scan(&s.DeploysToday)
	d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM deploy_logs WHERE created_at >= $1`, weekAgo,
	).Scan(&s.DeploysThisWeek)

	// Services (standalone DBs), subdomains, active tunnels (last 24h), worker servers
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM services`).Scan(&s.ServicesTotal)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM subdomains`).Scan(&s.SubdomainsTotal)
	d.Pool.QueryRow(ctx,
		`SELECT COUNT(DISTINCT tunnel_name) FROM tunnel_logs
		 WHERE started_at >= $1`, weekAgo,
	).Scan(&s.TunnelsTotal)
	d.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM worker_servers`).Scan(&s.WorkerServersTotal)

	return s, nil
}

func (d *DB) AdminUpdateUser(ctx context.Context, userID string, plan *string, isAdmin *bool) error {
	if plan != nil {
		d.Pool.Exec(ctx, `UPDATE users SET plan = $2, updated_at = now() WHERE id = $1`, userID, *plan)
	}
	if isAdmin != nil {
		d.Pool.Exec(ctx, `UPDATE users SET is_admin = $2 WHERE id = $1`, userID, *isAdmin)
	}
	return nil
}

func (d *DB) AdminDeleteUser(ctx context.Context, userID string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	return err
}

// AdminProject is a project row enriched with the owner's email.
type AdminProject struct {
	Project
	UserEmail string `json:"user_email"`
}

// AdminListProjects returns all projects across all users, newest first.
// search filters on name, subdomain, repo_url, or owner email.
func (d *DB) AdminListProjects(ctx context.Context, search, status string, limit, offset int) ([]AdminProject, int64, error) {
	where := `p.parent_project_id IS NULL`
	args := []interface{}{}
	i := 1

	if search != "" {
		where += ` AND (p.name ILIKE $` + itoa(i) + ` OR p.subdomain ILIKE $` + itoa(i) + ` OR p.repo_url ILIKE $` + itoa(i) + ` OR u.email ILIKE $` + itoa(i) + `)`
		args = append(args, "%"+search+"%")
		i++
	}
	if status != "" && status != "all" {
		where += ` AND p.status = $` + itoa(i)
		args = append(args, status)
		i++
	}

	var total int64
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM projects p LEFT JOIN users u ON u.id = p.user_id WHERE `+where,
		countArgs...,
	).Scan(&total)

	args = append(args, limit, offset)
	rows, err := d.Pool.Query(ctx,
		`SELECT `+projectCols+`, COALESCE(u.email, '') FROM projects p
		 LEFT JOIN users u ON u.id = p.user_id
		 WHERE `+where+`
		 ORDER BY p.created_at DESC
		 LIMIT $`+itoa(i)+` OFFSET $`+itoa(i+1),
		args...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var projects []AdminProject
	for rows.Next() {
		var ap AdminProject
		var envJSON []byte
		p := &ap.Project
		err := rows.Scan(
			&p.ID, &p.UserID, &p.Name, &p.Subdomain, &p.RepoURL, &p.Branch, &p.Framework,
			&p.InstallCmd, &p.BuildCmd, &p.StartCmd, &p.RootDir, &p.NodeVersion, &p.PortOverride,
			&p.MemoryMB, &p.CPUs, &p.HealthCheckPath, &p.ReleaseCmd, &p.CommitSHA, &p.Labels,
			&p.BuildMode, &p.ParentProjectID, &p.PRNumber, &p.PRTitle, &p.PreviewEnabled,
			&p.PRCommentID, &envJSON, &p.Status, &p.ContainerID, &p.ContainerPort,
			&p.GitHubRepo, &p.GitHubBranch, &p.AutoDeploy, &p.LastDeployAt, &p.CreatedAt, &p.UpdatedAt,
			&ap.UserEmail,
		)
		if err != nil {
			return nil, 0, err
		}
		json.Unmarshal(envJSON, &p.EnvVars)
		projects = append(projects, ap)
	}
	return projects, total, rows.Err()
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}
