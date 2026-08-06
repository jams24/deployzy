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
	q := `SELECT id, target_url, category, details, reporter_email, reporter_ip, status, created_at FROM abuse_reports`
	args := []any{}
	if status != "" && status != "all" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT ` + itoa(len(args)+1)
	args = append(args, limit)
	rows, err := d.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AbuseReport{}
	for rows.Next() {
		var r AbuseReport
		if err := rows.Scan(&r.ID, &r.TargetURL, &r.Category, &r.Details, &r.ReporterEmail, &r.ReporterIP, &r.Status, &r.CreatedAt); err != nil {
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

// CountOpenAbuseReports is used for the admin badge.
func (d *DB) CountOpenAbuseReports(ctx context.Context) int {
	var n int
	d.Pool.QueryRow(ctx, `SELECT count(*) FROM abuse_reports WHERE status = 'open'`).Scan(&n)
	return n
}
