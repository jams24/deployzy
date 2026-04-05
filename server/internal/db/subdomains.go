package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// PlanLimit holds the limits for a plan.
type PlanLimit struct {
	Plan           string `json:"plan"`
	MaxSubdomains  int    `json:"max_subdomains"`
	MaxTunnels     int    `json:"max_tunnels"`
	MaxRate        int    `json:"max_rate"`
}

// GetPlanLimits returns the limits for a given plan.
func (d *DB) GetPlanLimits(ctx context.Context, plan string) (*PlanLimit, error) {
	var pl PlanLimit
	err := d.Pool.QueryRow(ctx,
		`SELECT plan, max_subdomains, max_tunnels, max_rate FROM plan_limits WHERE plan = $1`,
		plan,
	).Scan(&pl.Plan, &pl.MaxSubdomains, &pl.MaxTunnels, &pl.MaxRate)
	if err == pgx.ErrNoRows {
		// Default to free limits
		return &PlanLimit{Plan: plan, MaxSubdomains: 10, MaxTunnels: 10, MaxRate: 100}, nil
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
