package db

import (
	"context"
	"time"
)

type AbuseReport struct {
	ID            string    `json:"id"`
	TargetURL     string    `json:"target_url"`
	Category      string    `json:"category"`
	Details       string    `json:"details"`
	ReporterEmail string    `json:"reporter_email"`
	ReporterIP    string    `json:"reporter_ip"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"created_at"`

	// Resolved from target_url's subdomain (empty when it isn't one of our
	// apps, e.g. a tunnel or a custom domain).
	ProjectID     string `json:"project_id,omitempty"`
	ProjectName   string `json:"project_name,omitempty"`
	ProjectStatus string `json:"project_status,omitempty"`
	OwnerID       string `json:"owner_id,omitempty"`
	OwnerEmail    string `json:"owner_email,omitempty"`
	OwnerPlan     string `json:"owner_plan,omitempty"`
	OwnerBlocked  bool   `json:"owner_blocked"`
	OwnerIsAdmin  bool   `json:"owner_is_admin"`
}

// abuseReportSelect joins each report to the project its URL names and that
// project's owner. One project per report (subdomains are unique).
const abuseReportSelect = `
	SELECT ar.id, ar.target_url, ar.category, ar.details, ar.reporter_email, ar.reporter_ip, ar.status, ar.created_at,
	       COALESCE(p.id::text, ''), COALESCE(p.name, ''),
	       COALESCE(CASE WHEN p.sleeping AND p.status = 'running' THEN 'sleeping' ELSE p.status END, ''),
	       COALESCE(u.id::text, ''), COALESCE(u.email, ''), COALESCE(NULLIF(u.plan, ''), CASE WHEN u.id IS NULL THEN '' ELSE 'free' END),
	       COALESCE(u.blocked, false), COALESCE(u.is_admin, false)
	  FROM abuse_reports ar
	  LEFT JOIN projects p ON p.subdomain = substring(ar.target_url from '^https?://([^./]+)\.') AND p.parent_project_id IS NULL
	  LEFT JOIN users u ON u.id = p.user_id`

func scanAbuseReport(row interface{ Scan(...any) error }, r *AbuseReport) error {
	return row.Scan(&r.ID, &r.TargetURL, &r.Category, &r.Details, &r.ReporterEmail, &r.ReporterIP, &r.Status, &r.CreatedAt,
		&r.ProjectID, &r.ProjectName, &r.ProjectStatus, &r.OwnerID, &r.OwnerEmail, &r.OwnerPlan, &r.OwnerBlocked, &r.OwnerIsAdmin)
}

// GetAbuseReport loads one report with its resolved project/owner.
func (d *DB) GetAbuseReport(ctx context.Context, id string) (*AbuseReport, error) {
	var r AbuseReport
	if err := scanAbuseReport(d.Pool.QueryRow(ctx, abuseReportSelect+` WHERE ar.id = $1`, id), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// MarkAbuseReportsActioned closes the open reports for one target+category
// (used when a project is suspended for what those reports describe).
func (d *DB) MarkAbuseReportsActioned(ctx context.Context, targetURL, category string) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE abuse_reports SET status = 'actioned' WHERE target_url = $1 AND category = $2 AND status = 'open'`,
		targetURL, category)
	return err
}

func (d *DB) CreateAbuseReport(ctx context.Context, r *AbuseReport) error {
	return d.Pool.QueryRow(ctx,
		`INSERT INTO abuse_reports (target_url, category, details, reporter_email, reporter_ip)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
		r.TargetURL, r.Category, r.Details, r.ReporterEmail, r.ReporterIP,
	).Scan(&r.ID, &r.CreatedAt)
}

func (d *DB) ListAbuseReports(ctx context.Context, status string, limit int) ([]AbuseReport, error) {
	if limit <= 0 {
		limit = 100
	}
	q := abuseReportSelect
	args := []any{}
	if status != "" && status != "all" {
		q += ` WHERE ar.status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY ar.created_at DESC LIMIT $` + itoa(len(args)+1)
	args = append(args, limit)
	rows, err := d.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AbuseReport{}
	for rows.Next() {
		var r AbuseReport
		if err := scanAbuseReport(rows, &r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *DB) SetAbuseReportStatus(ctx context.Context, id, status string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE abuse_reports SET status = $2 WHERE id = $1`, id, status)
	return err
}

// HasAbuseReport reports whether a non-dismissed report already exists for this
// target and category, so automated scanners don't file duplicates.
func (d *DB) HasAbuseReport(ctx context.Context, targetURL, category string) bool {
	var n int
	d.Pool.QueryRow(ctx,
		`SELECT count(*) FROM abuse_reports WHERE target_url = $1 AND category = $2 AND status <> 'dismissed'`,
		targetURL, category).Scan(&n)
	return n > 0
}

// CountOpenAbuseReports is used for the admin badge.
func (d *DB) CountOpenAbuseReports(ctx context.Context) int {
	var n int
	d.Pool.QueryRow(ctx, `SELECT count(*) FROM abuse_reports WHERE status = 'open'`).Scan(&n)
	return n
}
