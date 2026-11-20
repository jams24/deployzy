package db

import (
	"context"
	"time"
)

// Onboarding is the dashboard's setup state for one user: the two stored
// flags plus checklist steps derived from what the account has actually done,
// so the checklist can never drift from reality.
type Onboarding struct {
	CreatedAt          time.Time `json:"created_at"`
	TourDone           bool      `json:"tour_done"`
	ChecklistDismissed bool      `json:"checklist_dismissed"`
	GitHubConnected    bool      `json:"github_connected"`
	Deployed           bool      `json:"deployed"`
	Database           bool      `json:"database"`
	Tunnel             bool      `json:"tunnel"`
	Domain             bool      `json:"domain"`
}

// GetOnboarding computes the setup state in one round trip. "Deployed" means
// a project that has actually run (not just created, not only ever failed).
func (d *DB) GetOnboarding(ctx context.Context, userID string) (*Onboarding, error) {
	var o Onboarding
	err := d.Pool.QueryRow(ctx, `
		SELECT u.created_at,
		       u.tour_done_at IS NOT NULL,
		       u.checklist_dismissed_at IS NOT NULL,
		       EXISTS (SELECT 1 FROM github_connections g WHERE g.user_id = u.id),
		       EXISTS (SELECT 1 FROM projects p
		                WHERE p.user_id = u.id AND p.last_deploy_at IS NOT NULL
		                  AND p.status NOT IN ('created', 'failed')),
		       EXISTS (SELECT 1 FROM services s WHERE s.user_id = u.id),
		       EXISTS (SELECT 1 FROM tunnel_sessions t WHERE t.user_id = u.id),
		       EXISTS (SELECT 1 FROM domains dm WHERE dm.user_id = u.id)
		  FROM users u
		 WHERE u.id = $1`, userID,
	).Scan(&o.CreatedAt, &o.TourDone, &o.ChecklistDismissed, &o.GitHubConnected,
		&o.Deployed, &o.Database, &o.Tunnel, &o.Domain)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// SetTourDone records that the user finished or skipped the tour (done=true),
// or clears it so the tour can run again (done=false).
func (d *DB) SetTourDone(ctx context.Context, userID string, done bool) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE users SET tour_done_at = CASE WHEN $2 THEN COALESCE(tour_done_at, now()) ELSE NULL END WHERE id = $1`,
		userID, done)
	return err
}

// SetChecklistDismissed hides (true) or restores (false) the setup checklist.
func (d *DB) SetChecklistDismissed(ctx context.Context, userID string, dismissed bool) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE users SET checklist_dismissed_at = CASE WHEN $2 THEN COALESCE(checklist_dismissed_at, now()) ELSE NULL END WHERE id = $1`,
		userID, dismissed)
	return err
}
