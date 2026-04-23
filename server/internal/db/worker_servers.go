package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// WorkerServer represents a compute server for deploying projects.
type WorkerServer struct {
	ID                string     `json:"id"`
	UserID            *string    `json:"user_id"`             // NULL = platform, set = BYOC
	Label             string     `json:"label"`
	Host              string     `json:"host"`
	Port              int        `json:"port"`
	SSHUser           string     `json:"ssh_user"`
	SSHPassword       string     `json:"ssh_password,omitempty"`
	SSHKey            string     `json:"ssh_key,omitempty"`
	Region            string     `json:"region"`
	TotalCPU          float64    `json:"total_cpu"`
	TotalMemoryMB     int        `json:"total_memory_mb"`
	AllocatedCPU      float64    `json:"allocated_cpu"`
	AllocatedMemoryMB int        `json:"allocated_memory_mb"`
	MaxProjects       int        `json:"max_projects"`
	CurrentProjects   int        `json:"current_projects"`
	Status            string     `json:"status"`
	LastHeartbeat     *time.Time `json:"last_heartbeat"`
	DockerInstalled   bool       `json:"docker_installed"`
	CreatedAt         time.Time  `json:"created_at"`
	DockerInstallStatus string   `json:"docker_install_status"`
	DockerInstallError  *string  `json:"docker_install_error"`
	Priority            int      `json:"priority"`
	IsLocal             bool     `json:"is_local"`
}

// CreateWorkerServer adds a new worker server.
func (d *DB) CreateWorkerServer(ctx context.Context, ws *WorkerServer) (*WorkerServer, error) {
	var s WorkerServer
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO worker_servers (user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, max_projects, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		 RETURNING id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at, COALESCE(docker_install_status, 'idle'), docker_install_error, COALESCE(priority, 100), COALESCE(is_local, false)`,
		ws.UserID, ws.Label, ws.Host, ws.Port, ws.SSHUser, ws.SSHPassword, ws.SSHKey, ws.Region, ws.TotalCPU, ws.TotalMemoryMB, ws.MaxProjects, ws.Status,
	).Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.SSHPassword, &s.SSHKey, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt, &s.DockerInstallStatus, &s.DockerInstallError, &s.Priority, &s.IsLocal)
	return &s, err
}

// ListWorkerServers returns all platform servers (admin) or user's BYOC servers.
func (d *DB) ListWorkerServers(ctx context.Context, userID *string) ([]WorkerServer, error) {
	var query string
	var args []interface{}
	if userID == nil {
		// Admin: list all platform servers
		query = `SELECT id, user_id, label, host, port, ssh_user, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at, COALESCE(docker_install_status, 'idle'), docker_install_error, COALESCE(priority, 100), COALESCE(is_local, false) FROM worker_servers WHERE user_id IS NULL ORDER BY created_at DESC`
	} else {
		// User: list their BYOC servers
		query = `SELECT id, user_id, label, host, port, ssh_user, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at, COALESCE(docker_install_status, 'idle'), docker_install_error, COALESCE(priority, 100), COALESCE(is_local, false) FROM worker_servers WHERE user_id = $1 ORDER BY created_at DESC`
		args = append(args, *userID)
	}

	rows, err := d.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []WorkerServer
	for rows.Next() {
		var s WorkerServer
		rows.Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt, &s.DockerInstallStatus, &s.DockerInstallError, &s.Priority, &s.IsLocal)
		servers = append(servers, s)
	}
	return servers, nil
}

// GetWorkerServer returns a worker server by ID.
func (d *DB) GetWorkerServer(ctx context.Context, id string) (*WorkerServer, error) {
	var s WorkerServer
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at, COALESCE(docker_install_status, 'idle'), docker_install_error, COALESCE(priority, 100), COALESCE(is_local, false) FROM worker_servers WHERE id = $1`,
		id,
	).Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.SSHPassword, &s.SSHKey, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt, &s.DockerInstallStatus, &s.DockerInstallError, &s.Priority, &s.IsLocal)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

// DeleteWorkerServer removes a worker server. Projects and services that
// were hosted on it get orphaned — we mark them stopped and clear their
// container_id so the dashboard doesn't advertise a "running" project whose
// container lives on a VPS that no longer exists.
func (d *DB) DeleteWorkerServer(ctx context.Context, id string) error {
	// The local row represents the platform host itself — deleting it would
	// orphan every default-platform project and break the scheduler. Refuse.
	var isLocal bool
	d.Pool.QueryRow(ctx, `SELECT COALESCE(is_local, false) FROM worker_servers WHERE id = $1`, id).Scan(&isLocal)
	if isLocal {
		return fmt.Errorf("cannot delete the local platform server")
	}

	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Orphan projects — status → stopped, clear container so redeploys pick a
	// new server instead of dialling out to the dead one.
	if _, err := tx.Exec(ctx,
		`UPDATE projects
		 SET status = 'stopped', container_id = NULL, container_port = NULL
		 WHERE worker_server_id = $1`, id); err != nil {
		return err
	}

	// Orphan services — BYOC Postgres containers vanish with the host, mark
	// them stopped so the UI shows the right state.
	if _, err := tx.Exec(ctx,
		`UPDATE services SET status = 'stopped' WHERE worker_server_id = $1`, id); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM worker_servers WHERE id = $1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpdateWorkerServerStatus updates the status of a server.
func (d *DB) UpdateWorkerServerStatus(ctx context.Context, id, status string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE worker_servers SET status = $2 WHERE id = $1`, id, status)
	return err
}

// UpdateWorkerServerDockerInstalled flips the docker_installed flag after a
// successful Docker install over SSH.
func (d *DB) UpdateWorkerServerDockerInstalled(ctx context.Context, id string, installed bool) error {
	_, err := d.Pool.Exec(ctx, `UPDATE worker_servers SET docker_installed = $2 WHERE id = $1`, id, installed)
	return err
}

// ReconcileServerAllocation recomputes allocated_cpu/allocated_memory_mb and
// current_projects for a server from the actual project reservations. This is
// the single source of truth — callers invoke it after any deploy/delete/stop
// so the number never drifts. Unset (0) project values fall back to the
// engine defaults (0.5 CPU / 512 MB) so we don't under-count.
func (d *DB) ReconcileServerAllocation(ctx context.Context, serverID string) error {
	_, err := d.Pool.Exec(ctx, `
		WITH agg AS (
		  SELECT
		    COALESCE(SUM(CASE WHEN cpus     > 0 THEN cpus     ELSE 0.5 END), 0)::numeric AS cpu_sum,
		    COALESCE(SUM(CASE WHEN memory_mb > 0 THEN memory_mb ELSE 512 END), 0)::int    AS mem_sum,
		    COUNT(*)::int AS proj_count
		  FROM projects
		  WHERE worker_server_id = $1 AND status IN ('running', 'building')
		)
		UPDATE worker_servers
		SET allocated_cpu       = agg.cpu_sum,
		    allocated_memory_mb = agg.mem_sum,
		    current_projects    = agg.proj_count
		FROM agg WHERE worker_servers.id = $1`, serverID)
	return err
}

// UpdateWorkerServerCapacity refreshes total_cpu and total_memory_mb from a
// live hardware probe (nproc + /proc/meminfo over SSH).
func (d *DB) UpdateWorkerServerCapacity(ctx context.Context, id string, totalCPU float64, totalMemoryMB int) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE worker_servers SET total_cpu = $2, total_memory_mb = $3 WHERE id = $1`,
		id, totalCPU, totalMemoryMB)
	return err
}

// SetDockerInstallStatus persists async install progress so the UI can poll
// and a browser timeout doesn't lose the install state.
func (d *DB) SetDockerInstallStatus(ctx context.Context, id, status, errMsg string) error {
	var e *string
	if errMsg != "" { e = &errMsg }
	_, err := d.Pool.Exec(ctx,
		`UPDATE worker_servers
		 SET docker_install_status = $2,
		     docker_install_error = $3,
		     docker_install_started_at = CASE WHEN $2 = 'installing' THEN NOW() ELSE docker_install_started_at END
		 WHERE id = $1`, id, status, e)
	return err
}

// UpdateWorkerHeartbeat updates the heartbeat timestamp.
func (d *DB) UpdateWorkerHeartbeat(ctx context.Context, id string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE worker_servers SET last_heartbeat = now() WHERE id = $1`, id)
	return err
}

// ListAllActiveWorkers returns every worker_server row currently marked active,
// across both platform (user_id IS NULL) and BYOC. Used by background jobs
// like the heartbeat monitor and remote build-dir cleanup — they need to
// operate on every worker regardless of ownership.
func (d *DB) ListAllActiveWorkers(ctx context.Context) ([]WorkerServer, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at, COALESCE(docker_install_status, 'idle'), docker_install_error, COALESCE(priority, 100), COALESCE(is_local, false)
		 FROM worker_servers WHERE status = 'active'`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkerServer
	for rows.Next() {
		var s WorkerServer
		if err := rows.Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.SSHPassword, &s.SSHKey, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt, &s.DockerInstallStatus, &s.DockerInstallError, &s.Priority, &s.IsLocal); err != nil {
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

// SelectServerForProject picks the best available server for a new project.
// Prefers servers with the most available memory.
func (d *DB) SelectServerForProject(ctx context.Context, userID *string) (*WorkerServer, error) {
	var query string
	var args []interface{}

	if userID != nil {
		// Try user's BYOC servers first
		query = `SELECT id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at, COALESCE(docker_install_status, 'idle'), docker_install_error, COALESCE(priority, 100), COALESCE(is_local, false)
			FROM worker_servers
			WHERE user_id = $1 AND status = 'active' AND current_projects < max_projects
			ORDER BY (total_memory_mb - allocated_memory_mb) DESC LIMIT 1`
		args = append(args, *userID)
	} else {
		// Platform servers — priority ASC (lower = primary, fills first), then
		// most-free-RAM as tiebreaker. Also exclude servers already at >85%
		// memory so we genuinely overflow instead of squeezing the host.
		query = `SELECT id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at, COALESCE(docker_install_status, 'idle'), docker_install_error, COALESCE(priority, 100), COALESCE(is_local, false)
			FROM worker_servers
			WHERE user_id IS NULL
			  AND status = 'active'
			  AND current_projects < max_projects
			  AND (total_memory_mb = 0 OR allocated_memory_mb::float / NULLIF(total_memory_mb, 0) < 0.85)
			ORDER BY COALESCE(priority, 100) ASC, (total_memory_mb - allocated_memory_mb) DESC
			LIMIT 1`
	}

	var s WorkerServer
	err := d.Pool.QueryRow(ctx, query, args...).Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.SSHPassword, &s.SSHKey, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt, &s.DockerInstallStatus, &s.DockerInstallError, &s.Priority, &s.IsLocal)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

// AllocateServerResources increments the project count on a server.
func (d *DB) AllocateServerResources(ctx context.Context, serverID string, cpuNeeded float64, memoryNeeded int) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE worker_servers SET current_projects = current_projects + 1, allocated_cpu = allocated_cpu + $2, allocated_memory_mb = allocated_memory_mb + $3 WHERE id = $1`,
		serverID, cpuNeeded, memoryNeeded,
	)
	return err
}

// ReleaseServerResources decrements the project count on a server.
func (d *DB) ReleaseServerResources(ctx context.Context, serverID string, cpuUsed float64, memoryUsed int) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE worker_servers SET current_projects = GREATEST(current_projects - 1, 0), allocated_cpu = GREATEST(allocated_cpu - $2, 0), allocated_memory_mb = GREATEST(allocated_memory_mb - $3, 0) WHERE id = $1`,
		serverID, cpuUsed, memoryUsed,
	)
	return err
}
