package db

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Admin console list endpoints (users, projects): server-side filtering,
// sorting and page-number pagination, with facet counts for the filter chips.
// Each page is ONE query — per-row aggregates come from grouped CTEs, never
// from a correlated subquery per row — and the total rides along via
// count(*) OVER (). Projects deliberately omit env vars: the list never shows
// them and they're users' secrets.

// openAbuseProjects resolves open abuse reports to project rows through the
// report URL's first DNS label (https://<subdomain>.<app domain>/...).
const openAbuseProjects = `
	SELECT DISTINCT p.id, p.user_id
	  FROM abuse_reports ar
	  JOIN projects p ON p.subdomain = substring(ar.target_url from '^https?://([^./]+)\.')
	 WHERE ar.status = 'open'`

// AdminUserRow is one row of the admin Users list.
type AdminUserRow struct {
	ID             string     `json:"id"`
	Email          string     `json:"email"`
	Name           string     `json:"name"`
	Plan           string     `json:"plan"`
	ProUntil       *time.Time `json:"pro_until,omitempty"`
	IsAdmin        bool       `json:"is_admin"`
	EmailVerified  bool       `json:"email_verified"`
	CreatedAt      time.Time  `json:"created_at"`
	LastSeenAt     *time.Time `json:"last_seen_at,omitempty"`
	KeyCount       int        `json:"key_count"`
	SignupIP       string     `json:"signup_ip"`
	SignupCountry  string     `json:"signup_country"`
	LastLoginIP    string     `json:"last_login_ip"`
	LastCountry    string     `json:"last_country"`
	Blocked        bool       `json:"blocked"`
	BlockedReason  string     `json:"blocked_reason,omitempty"`
	BlockedAt      *time.Time `json:"blocked_at,omitempty"`
	Projects       int        `json:"projects"`
	Running        int        `json:"running"`
	Sleeping       int        `json:"sleeping"`
	BandwidthBytes int64      `json:"bandwidth_bytes"` // this calendar month
	Flagged        bool       `json:"flagged"`         // owns a project with an open abuse report
}

// AdminUserQuery filters the Users list. Status: all|active|suspended|admin|
// flagged|unverified. Sort: newest|oldest|last_seen|projects|bandwidth|email.
type AdminUserQuery struct {
	Search, Plan, Status, Sort string
	Limit, Offset              int
}

// AdminUserFacets are whole-table counts for the filter chips (independent of
// the current filter, so the chips don't jump around while you click them).
type AdminUserFacets struct {
	Total      int            `json:"total"`
	ByPlan     map[string]int `json:"by_plan"`
	Suspended  int            `json:"suspended"`
	Admins     int            `json:"admins"`
	Flagged    int            `json:"flagged"`
	Unverified int            `json:"unverified"`
}

var adminUserSorts = map[string]string{
	"newest":    "created_at DESC",
	"oldest":    "created_at ASC",
	"last_seen": "last_seen_at DESC NULLS LAST",
	"projects":  "projects DESC, created_at DESC",
	"bandwidth": "bandwidth_bytes DESC, created_at DESC",
	"email":     "email ASC",
}

func clampPage(limit, offset int) (int, int) {
	if limit <= 0 || limit > 200 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// AdminListUsersPage returns one page of users plus the filtered total.
func (d *DB) AdminListUsersPage(ctx context.Context, q AdminUserQuery) ([]AdminUserRow, int, error) {
	limit, offset := clampPage(q.Limit, q.Offset)
	order, ok := adminUserSorts[q.Sort]
	if !ok {
		order = adminUserSorts["newest"]
	}
	var where []string
	args := []any{}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }

	if s := strings.TrimSpace(q.Search); s != "" {
		p := arg("%" + s + "%")
		where = append(where, `(email ILIKE `+p+` OR name ILIKE `+p+` OR signup_ip ILIKE `+p+` OR last_login_ip ILIKE `+p+
			` OR id::text ILIKE `+p+` OR EXISTS (SELECT 1 FROM projects x WHERE x.user_id = b.id AND (x.name ILIKE `+p+` OR x.subdomain ILIKE `+p+`)))`)
	}
	if q.Plan != "" && q.Plan != "all" {
		where = append(where, `plan = `+arg(q.Plan))
	}
	switch q.Status {
	case "active":
		where = append(where, `NOT blocked`)
	case "suspended":
		where = append(where, `blocked`)
	case "admin":
		where = append(where, `is_admin`)
	case "flagged":
		where = append(where, `flagged`)
	case "unverified":
		where = append(where, `NOT email_verified`)
	}
	cond := ""
	if len(where) > 0 {
		cond = "WHERE " + strings.Join(where, " AND ")
	}
	lim, off := arg(limit), arg(offset)

	rows, err := d.Pool.Query(ctx, `
		WITH proj AS (
			SELECT user_id, count(*) AS n,
			       count(*) FILTER (WHERE status = 'running' AND NOT sleeping) AS running,
			       count(*) FILTER (WHERE sleeping) AS asleep
			  FROM projects WHERE parent_project_id IS NULL GROUP BY user_id
		), bw AS (
			SELECT p.user_id, SUM(bu.bytes) AS bytes
			  FROM bandwidth_usage bu JOIN projects p ON p.id::text = bu.project_id
			 WHERE bu.month = date_trunc('month', now())::date
			 GROUP BY p.user_id
		), keys AS (
			SELECT user_id, count(*) AS n FROM api_keys GROUP BY user_id
		), flag AS (
			SELECT DISTINCT user_id FROM (`+openAbuseProjects+`) f
		), b AS (
			SELECT u.id, u.email, COALESCE(u.name, '') AS name,
			       COALESCE(NULLIF(u.plan, ''), 'free') AS plan, u.pro_until,
			       COALESCE(u.is_admin, false) AS is_admin, COALESCE(u.email_verified, false) AS email_verified,
			       u.created_at, u.last_seen_at, COALESCE(keys.n, 0)::int AS key_count,
			       COALESCE(u.signup_ip, '') AS signup_ip, COALESCE(u.signup_country, '') AS signup_country,
			       COALESCE(u.last_login_ip, '') AS last_login_ip, COALESCE(u.last_country, '') AS last_country,
			       COALESCE(u.blocked, false) AS blocked, COALESCE(u.blocked_reason, '') AS blocked_reason, u.blocked_at,
			       COALESCE(proj.n, 0)::int AS projects, COALESCE(proj.running, 0)::int AS running,
			       COALESCE(proj.asleep, 0)::int AS asleep, COALESCE(bw.bytes, 0)::bigint AS bandwidth_bytes,
			       (flag.user_id IS NOT NULL) AS flagged
			  FROM users u
			  LEFT JOIN proj ON proj.user_id = u.id
			  LEFT JOIN bw   ON bw.user_id = u.id
			  LEFT JOIN keys ON keys.user_id = u.id
			  LEFT JOIN flag ON flag.user_id = u.id
		)
		SELECT id, email, name, plan, pro_until, is_admin, email_verified, created_at, last_seen_at, key_count,
		       signup_ip, signup_country, last_login_ip, last_country, blocked, blocked_reason, blocked_at,
		       projects, running, asleep, bandwidth_bytes, flagged, count(*) OVER () AS total
		  FROM b `+cond+`
		 ORDER BY `+order+`, id
		 LIMIT `+lim+` OFFSET `+off, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AdminUserRow{}
	total := 0
	for rows.Next() {
		var u AdminUserRow
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Plan, &u.ProUntil, &u.IsAdmin, &u.EmailVerified,
			&u.CreatedAt, &u.LastSeenAt, &u.KeyCount, &u.SignupIP, &u.SignupCountry, &u.LastLoginIP,
			&u.LastCountry, &u.Blocked, &u.BlockedReason, &u.BlockedAt, &u.Projects, &u.Running,
			&u.Sleeping, &u.BandwidthBytes, &u.Flagged, &total); err != nil {
			return nil, 0, fmt.Errorf("scan admin user: %w", err)
		}
		out = append(out, u)
	}
	// An empty page past the end reports total 0; the UI then jumps to page 1.
	return out, total, rows.Err()
}

// AdminUserFacetCounts returns the chip counts for the Users list.
func (d *DB) AdminUserFacetCounts(ctx context.Context) (*AdminUserFacets, error) {
	f := &AdminUserFacets{ByPlan: map[string]int{}}
	rows, err := d.Pool.Query(ctx, `SELECT COALESCE(NULLIF(plan, ''), 'free'), count(*) FROM users GROUP BY 1`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var plan string
		var n int
		if err := rows.Scan(&plan, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan plan facet: %w", err)
		}
		f.ByPlan[plan] = n
		f.Total += n
	}
	rows.Close()
	if err := d.Pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE COALESCE(blocked, false)),
		       count(*) FILTER (WHERE COALESCE(is_admin, false)),
		       count(*) FILTER (WHERE NOT COALESCE(email_verified, false)),
		       (SELECT count(DISTINCT user_id) FROM (`+openAbuseProjects+`) f)
		  FROM users`).Scan(&f.Suspended, &f.Admins, &f.Unverified, &f.Flagged); err != nil {
		return nil, err
	}
	return f, nil
}

// AdminProjectRow is one row of the admin Projects list. No env vars.
type AdminProjectRow struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Subdomain      string     `json:"subdomain"`
	Status         string     `json:"status"`
	Sleeping       bool       `json:"sleeping"`
	Framework      string     `json:"framework"`
	DeploySource   string     `json:"deploy_source"`
	RepoURL        string     `json:"repo_url"` // credentials stripped
	Branch         string     `json:"branch"`
	MemoryMB       int        `json:"memory_mb"`
	CreatedAt      time.Time  `json:"created_at"`
	LastDeployAt   *time.Time `json:"last_deploy_at,omitempty"`
	LastRequestAt  *time.Time `json:"last_request_at,omitempty"`
	UserID         string     `json:"user_id"`
	UserEmail      string     `json:"user_email"`
	UserPlan       string     `json:"user_plan"`
	UserBlocked    bool       `json:"user_blocked"`
	WorkerServerID string     `json:"worker_server_id"`
	ServerLabel    string     `json:"server_label"`
	ServerBYOC     bool       `json:"server_byoc"`
	BandwidthBytes int64      `json:"bandwidth_bytes"` // this calendar month
	Flagged        bool       `json:"flagged"`
}

// AdminProjectQuery filters the Projects list. Status: all|running|sleeping|
// building|crashed|failed|stopped|created. Server: worker id, or "local".
// Sort: newest|oldest|last_deploy|last_request|bandwidth|name.
type AdminProjectQuery struct {
	Search, Status, Server, Plan, Sort string
	FlaggedOnly                        bool
	Limit, Offset                      int
}

type AdminProjectFacets struct {
	Total    int                `json:"total"`
	ByStatus map[string]int     `json:"by_status"` // "sleeping" counted separately from running
	Flagged  int                `json:"flagged"`
	Servers  []AdminServerFacet `json:"servers"`
}

type AdminServerFacet struct {
	ID    string `json:"id"` // "local" for the platform host
	Label string `json:"label"`
	Count int    `json:"count"`
}

var adminProjectSorts = map[string]string{
	"newest":       "created_at DESC",
	"oldest":       "created_at ASC",
	"last_deploy":  "last_deploy_at DESC NULLS LAST",
	"last_request": "last_request_at DESC NULLS LAST",
	"bandwidth":    "bandwidth_bytes DESC, created_at DESC",
	"name":         "lower(name) ASC",
}

// adminProjectBase resolves each top-level project's owner, host and monthly
// bandwidth. Projects with no worker row live on the local platform host.
const adminProjectBase = `
	WITH bw AS (
		SELECT project_id, SUM(bytes) AS bytes FROM bandwidth_usage
		 WHERE month = date_trunc('month', now())::date GROUP BY project_id
	), flag AS (` + openAbuseProjects + `
	), b AS (
		SELECT p.id, p.name, p.subdomain,
		       CASE WHEN p.sleeping AND p.status = 'running' THEN 'sleeping' ELSE p.status END AS status,
		       p.sleeping, COALESCE(p.framework, '') AS framework, COALESCE(p.deploy_source, 'git') AS deploy_source,
		       COALESCE(p.repo_url, '') AS repo_url, COALESCE(p.branch, '') AS branch, COALESCE(p.memory_mb, 0) AS memory_mb,
		       p.created_at, p.last_deploy_at, p.last_request_at,
		       p.user_id, COALESCE(u.email, '') AS user_email, COALESCE(NULLIF(u.plan, ''), 'free') AS user_plan,
		       COALESCE(u.blocked, false) AS user_blocked,
		       CASE WHEN ws.id IS NULL OR ws.is_local THEN 'local' ELSE ws.id::text END AS server_id,
		       COALESCE(ws.label, 'Deployzy Cloud') AS server_label, (ws.user_id IS NOT NULL) AS server_byoc,
		       COALESCE(bw.bytes, 0)::bigint AS bandwidth_bytes, (flag.id IS NOT NULL) AS flagged
		  FROM projects p
		  LEFT JOIN users u ON u.id = p.user_id
		  LEFT JOIN worker_servers ws ON ws.id = p.worker_server_id
		  LEFT JOIN bw ON bw.project_id = p.id::text
		  LEFT JOIN flag ON flag.id = p.id
		 WHERE p.parent_project_id IS NULL
	)`

// AdminListProjectsPage returns one page of projects plus the filtered total.
func (d *DB) AdminListProjectsPage(ctx context.Context, q AdminProjectQuery) ([]AdminProjectRow, int, error) {
	limit, offset := clampPage(q.Limit, q.Offset)
	order, ok := adminProjectSorts[q.Sort]
	if !ok {
		order = adminProjectSorts["newest"]
	}
	var where []string
	args := []any{}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }

	if s := strings.TrimSpace(q.Search); s != "" {
		p := arg("%" + s + "%")
		where = append(where, `(name ILIKE `+p+` OR subdomain ILIKE `+p+` OR repo_url ILIKE `+p+` OR user_email ILIKE `+p+` OR id::text ILIKE `+p+`)`)
	}
	if q.Status != "" && q.Status != "all" {
		where = append(where, `status = `+arg(q.Status))
	}
	if q.Server != "" && q.Server != "all" {
		where = append(where, `server_id = `+arg(q.Server))
	}
	if q.Plan != "" && q.Plan != "all" {
		where = append(where, `user_plan = `+arg(q.Plan))
	}
	if q.FlaggedOnly {
		where = append(where, `flagged`)
	}
	cond := ""
	if len(where) > 0 {
		cond = "WHERE " + strings.Join(where, " AND ")
	}
	lim, off := arg(limit), arg(offset)

	rows, err := d.Pool.Query(ctx, adminProjectBase+`
		SELECT id, name, subdomain, status, sleeping, framework, deploy_source, repo_url, branch, memory_mb,
		       created_at, last_deploy_at, last_request_at, user_id, user_email, user_plan, user_blocked,
		       server_id, server_label, server_byoc, bandwidth_bytes, flagged, count(*) OVER () AS total
		  FROM b `+cond+`
		 ORDER BY `+order+`, id
		 LIMIT `+lim+` OFFSET `+off, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AdminProjectRow{}
	total := 0
	for rows.Next() {
		var p AdminProjectRow
		if err := rows.Scan(&p.ID, &p.Name, &p.Subdomain, &p.Status, &p.Sleeping, &p.Framework, &p.DeploySource,
			&p.RepoURL, &p.Branch, &p.MemoryMB, &p.CreatedAt, &p.LastDeployAt, &p.LastRequestAt, &p.UserID,
			&p.UserEmail, &p.UserPlan, &p.UserBlocked, &p.WorkerServerID, &p.ServerLabel, &p.ServerBYOC,
			&p.BandwidthBytes, &p.Flagged, &total); err != nil {
			return nil, 0, fmt.Errorf("scan admin project: %w", err)
		}
		p.RepoURL = stripURLCreds(p.RepoURL)
		out = append(out, p)
	}
	return out, total, rows.Err()
}

// AdminProjectFacetCounts returns status/server chip counts for the Projects list.
func (d *DB) AdminProjectFacetCounts(ctx context.Context) (*AdminProjectFacets, error) {
	f := &AdminProjectFacets{ByStatus: map[string]int{}, Servers: []AdminServerFacet{}}
	rows, err := d.Pool.Query(ctx, adminProjectBase+`
		SELECT 's', status, '', count(*) FROM b GROUP BY status
		UNION ALL
		SELECT 'h', server_id, server_label, count(*) FROM b GROUP BY server_id, server_label
		UNION ALL
		SELECT 'f', '', '', count(*) FROM b WHERE flagged`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var kind, key, label string
		var n int
		if err := rows.Scan(&kind, &key, &label, &n); err != nil {
			return nil, fmt.Errorf("scan project facet: %w", err)
		}
		switch kind {
		case "s":
			f.ByStatus[key] = n
			f.Total += n
		case "h":
			f.Servers = append(f.Servers, AdminServerFacet{ID: key, Label: label, Count: n})
		case "f":
			f.Flagged = n
		}
	}
	return f, rows.Err()
}

var urlCreds = regexp.MustCompile(`^(https?://)[^/@]+@`)

// stripURLCreds removes an embedded token from a clone URL before it reaches
// the browser (private-repo projects store https://<token>@github.com/...).
func stripURLCreds(u string) string { return urlCreds.ReplaceAllString(u, "$1") }
