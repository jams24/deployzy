package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// PlanLimit holds every per-plan cap and feature flag. -1 in any int field
// means "unlimited" — caller logic should check Unlimited(n) before comparing.
type PlanLimit struct {
	Plan                    string  `json:"plan"`
	MaxSubdomains           int     `json:"max_subdomains"`
	MaxTunnels              int     `json:"max_tunnels"`
	MaxRate                 int     `json:"max_rate"`
	MaxProjects             int     `json:"max_projects"`
	MaxCustomDomains        int     `json:"max_custom_domains"`
	MaxDatabases            int     `json:"max_databases"`
	MaxServices             int     `json:"max_services"`
	MaxCrons                int     `json:"max_crons"`
	MaxBYOCServers          int     `json:"max_byoc_servers"`
	MaxPreviewDeploys       int     `json:"max_preview_deploys"`
	MaxMemoryMB             int     `json:"max_memory_mb"`
	MaxCPUs                 float64 `json:"max_cpus"`
	MaxBandwidthGB          int     `json:"max_bandwidth_gb"`
	MaxBuildMinutesMonthly  int     `json:"max_build_minutes_monthly"`
	AnalyticsRetentionDays  int     `json:"analytics_retention_days"`
	MetricsRetentionDays    int     `json:"metrics_retention_days"`
	DeployLogRetentionDays  int     `json:"deploy_log_retention_days"`
	BackupRetentionDays     int     `json:"backup_retention_days"`
	AllowPreviews           bool    `json:"allow_previews"`
	AllowReleaseCmd         bool    `json:"allow_release_cmd"`
	AllowHealthChecks       bool    `json:"allow_health_checks"`
	AllowPrivateRepos       bool    `json:"allow_private_repos"`
	AllowTCPTunnels         bool    `json:"allow_tcp_tunnels"`
	AllowCustomEvents       bool    `json:"allow_custom_events"`
	AllowLiveLogs           bool    `json:"allow_live_logs"`
	AllowTelegram           bool    `json:"allow_telegram"`
}

// Unlimited reports whether a numeric limit field is set to "unlimited" (-1).
// Centralised so admin-bypass logic only lives in one place.
func Unlimited(v int) bool { return v < 0 }

// GetPlanLimits returns the limits for a given plan, or the conservative
// 'free' fallback if the plan name is unknown.
func (d *DB) GetPlanLimits(ctx context.Context, plan string) (*PlanLimit, error) {
	var pl PlanLimit
	err := d.Pool.QueryRow(ctx,
		`SELECT plan, max_subdomains, max_tunnels, max_rate,
		        max_projects, max_custom_domains, max_databases, max_services, max_crons,
		        max_byoc_servers, max_preview_deploys, max_memory_mb, max_cpus,
		        max_bandwidth_gb, max_build_minutes_monthly,
		        analytics_retention_days, metrics_retention_days, deploy_log_retention_days, backup_retention_days,
		        allow_previews, allow_release_cmd, allow_health_checks, allow_private_repos,
		        allow_tcp_tunnels, allow_custom_events, allow_live_logs, allow_telegram
		 FROM plan_limits WHERE plan = $1`,
		plan,
	).Scan(
		&pl.Plan, &pl.MaxSubdomains, &pl.MaxTunnels, &pl.MaxRate,
		&pl.MaxProjects, &pl.MaxCustomDomains, &pl.MaxDatabases, &pl.MaxServices, &pl.MaxCrons,
		&pl.MaxBYOCServers, &pl.MaxPreviewDeploys, &pl.MaxMemoryMB, &pl.MaxCPUs,
		&pl.MaxBandwidthGB, &pl.MaxBuildMinutesMonthly,
		&pl.AnalyticsRetentionDays, &pl.MetricsRetentionDays, &pl.DeployLogRetentionDays, &pl.BackupRetentionDays,
		&pl.AllowPreviews, &pl.AllowReleaseCmd, &pl.AllowHealthChecks, &pl.AllowPrivateRepos,
		&pl.AllowTCPTunnels, &pl.AllowCustomEvents, &pl.AllowLiveLogs, &pl.AllowTelegram,
	)
	if err == pgx.ErrNoRows {
		// Unknown plan → conservative free defaults so the user still
		// gets *some* access (and we never panic on a missing row).
		return &PlanLimit{
			Plan: "free", MaxSubdomains: 5, MaxTunnels: 5, MaxRate: 100,
			MaxProjects: 3, MaxCustomDomains: 1, MaxDatabases: 2, MaxBYOCServers: 1,
			MaxMemoryMB: 256, MaxCPUs: 0.25, MaxBandwidthGB: 50, MaxBuildMinutesMonthly: 60,
			AnalyticsRetentionDays: 7, MetricsRetentionDays: 1, DeployLogRetentionDays: 3,
		}, nil
	}
	return &pl, err
}

// CheckSubdomainAvailable checks if a subdomain is available for a user.
// Returns: available (bool), reason (string)
func (d *DB) CheckSubdomainAvailable(ctx context.Context, subdomain, userID string) (bool, string) {
	// Check if subdomain is reserved by someone else
	var ownerID string
	err := d.Pool.QueryRow(ctx,
		`SELECT user_id FROM reserved_subdomains WHERE subdomain = $1`,
		subdomain,
	).Scan(&ownerID)

	if err == nil {
		// Subdomain reserved — check if same user owns it
		if ownerID == userID {
			return true, "" // User owns it
		}
		return false, "subdomain already taken"
	}

	// Check if an existing project already uses this subdomain
	var projectOwnerID string
	err = d.Pool.QueryRow(ctx,
		`SELECT user_id FROM projects WHERE subdomain = $1`,
		subdomain,
	).Scan(&projectOwnerID)

	if err == nil {
		if projectOwnerID == userID {
			return true, "" // User's own project
		}
		return false, "subdomain already taken"
	}

	// Subdomain is free — check if user has reached their limit
	var count int
	d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM reserved_subdomains WHERE user_id = $1`,
		userID,
	).Scan(&count)

	// Get user plan
	var plan string
	d.Pool.QueryRow(ctx, `SELECT plan FROM users WHERE id = $1`, userID).Scan(&plan)

	limits, _ := d.GetPlanLimits(ctx, plan)

	if count >= limits.MaxSubdomains {
		return false, fmt.Sprintf("subdomain limit reached (%d/%d for %s plan)", count, limits.MaxSubdomains, plan)
	}

	return true, ""
}

// ReserveSubdomainAuto automatically reserves a subdomain when a user creates a tunnel with it.
func (d *DB) ReserveSubdomainAuto(ctx context.Context, userID, subdomain string) error {
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO reserved_subdomains (user_id, subdomain, auto_reserved)
		 VALUES ($1, $2, true)
		 ON CONFLICT (subdomain) DO NOTHING`,
		userID, subdomain,
	)
	return err
}

// ListUserSubdomains returns all subdomains reserved by a user.
func (d *DB) ListUserSubdomains(ctx context.Context, userID string) ([]ReservedSubdomain, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, subdomain, created_at FROM reserved_subdomains WHERE user_id = $1 ORDER BY created_at`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []ReservedSubdomain
	for rows.Next() {
		var s ReservedSubdomain
		rows.Scan(&s.ID, &s.UserID, &s.Subdomain, &s.CreatedAt)
		subs = append(subs, s)
	}
	return subs, nil
}

// ReleaseSubdomain releases a reserved subdomain.
func (d *DB) ReleaseSubdomain(ctx context.Context, userID, subdomain string) error {
	tag, err := d.Pool.Exec(ctx,
		`DELETE FROM reserved_subdomains WHERE user_id = $1 AND subdomain = $2`,
		userID, subdomain,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("subdomain not found or not owned by you")
	}
	return nil
}

// CountUserSubdomains returns how many subdomains a user has reserved.
func (d *DB) CountUserSubdomains(ctx context.Context, userID string) (int, error) {
	var count int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM reserved_subdomains WHERE user_id = $1`,
		userID,
	).Scan(&count)
	return count, err
}
