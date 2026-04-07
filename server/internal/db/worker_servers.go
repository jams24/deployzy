package db

import (
	"context"
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
}

// CreateWorkerServer adds a new worker server.
func (d *DB) CreateWorkerServer(ctx context.Context, ws *WorkerServer) (*WorkerServer, error) {
	var s WorkerServer
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO worker_servers (user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, max_projects, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		 RETURNING id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at`,
		ws.UserID, ws.Label, ws.Host, ws.Port, ws.SSHUser, ws.SSHPassword, ws.SSHKey, ws.Region, ws.TotalCPU, ws.TotalMemoryMB, ws.MaxProjects, ws.Status,
	).Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.SSHPassword, &s.SSHKey, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt)
	return &s, err
}

// ListWorkerServers returns all platform servers (admin) or user's BYOC servers.
func (d *DB) ListWorkerServers(ctx context.Context, userID *string) ([]WorkerServer, error) {
	var query string
	var args []interface{}
	if userID == nil {
		// Admin: list all platform servers
		query = `SELECT id, user_id, label, host, port, ssh_user, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at FROM worker_servers WHERE user_id IS NULL ORDER BY created_at DESC`
	} else {
		// User: list their BYOC servers
		query = `SELECT id, user_id, label, host, port, ssh_user, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at FROM worker_servers WHERE user_id = $1 ORDER BY created_at DESC`
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
		rows.Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt)
		servers = append(servers, s)
	}
	return servers, nil
}

// GetWorkerServer returns a worker server by ID.
func (d *DB) GetWorkerServer(ctx context.Context, id string) (*WorkerServer, error) {
	var s WorkerServer
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at FROM worker_servers WHERE id = $1`,
		id,
	).Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.SSHPassword, &s.SSHKey, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

// DeleteWorkerServer removes a worker server.
func (d *DB) DeleteWorkerServer(ctx context.Context, id string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM worker_servers WHERE id = $1`, id)
	return err
}

// UpdateWorkerServerStatus updates the status of a server.
func (d *DB) UpdateWorkerServerStatus(ctx context.Context, id, status string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE worker_servers SET status = $2 WHERE id = $1`, id, status)
	return err
}

// UpdateWorkerHeartbeat updates the heartbeat timestamp.
func (d *DB) UpdateWorkerHeartbeat(ctx context.Context, id string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE worker_servers SET last_heartbeat = now() WHERE id = $1`, id)
	return err
}

// SelectServerForProject picks the best available server for a new project.
// Prefers servers with the most available memory.
func (d *DB) SelectServerForProject(ctx context.Context, userID *string) (*WorkerServer, error) {
	var query string
	var args []interface{}

	if userID != nil {
		// Try user's BYOC servers first
		query = `SELECT id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at
			FROM worker_servers
			WHERE user_id = $1 AND status = 'active' AND current_projects < max_projects
			ORDER BY (total_memory_mb - allocated_memory_mb) DESC LIMIT 1`
		args = append(args, *userID)
	} else {
		// Platform servers (admin-managed)
		query = `SELECT id, user_id, label, host, port, ssh_user, ssh_password, ssh_key, region, total_cpu, total_memory_mb, allocated_cpu, allocated_memory_mb, max_projects, current_projects, status, last_heartbeat, docker_installed, created_at
			FROM worker_servers
			WHERE user_id IS NULL AND status = 'active' AND current_projects < max_projects
			ORDER BY (total_memory_mb - allocated_memory_mb) DESC LIMIT 1`
	}

	var s WorkerServer
	err := d.Pool.QueryRow(ctx, query, args...).Scan(&s.ID, &s.UserID, &s.Label, &s.Host, &s.Port, &s.SSHUser, &s.SSHPassword, &s.SSHKey, &s.Region, &s.TotalCPU, &s.TotalMemoryMB, &s.AllocatedCPU, &s.AllocatedMemoryMB, &s.MaxProjects, &s.CurrentProjects, &s.Status, &s.LastHeartbeat, &s.DockerInstalled, &s.CreatedAt)
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
