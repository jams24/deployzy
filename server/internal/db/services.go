package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Service represents a standalone infrastructure service (database, Redis, etc).
type Service struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	Status      string    `json:"status"`
	DBName      *string   `json:"db_name"`
	DBUser      *string   `json:"db_user"`
	DBPassword  *string   `json:"db_password"`
	Host        string    `json:"host"`
	Port        int       `json:"port"`
	ContainerID *string   `json:"container_id"`
	CreatedAt   time.Time `json:"created_at"`
	SizeMB      int       `json:"size_mb"`
	OverQuota   bool      `json:"over_quota"`
	WorkerServerID *string `json:"worker_server_id"`
	ContainerName  *string `json:"container_name"`
	PublicHost     *string `json:"public_host"`
	PublicPort     *int    `json:"public_port"`
}

// ConnectionURL returns the internal connection string (for containers on same host).
func (s *Service) ConnectionURL() string {
	return s.connectionURLWithHostPort(s.Host, s.Port)
}

// ExternalConnectionURL returns the external connection string (for local dev / external tools).
// Uses PublicHost/PublicPort when set (containerized services with mapped ports).
func (s *Service) ExternalConnectionURL(fallbackHost string) string {
	host := fallbackHost
	port := s.Port
	if s.PublicHost != nil && *s.PublicHost != "" {
		host = *s.PublicHost
	}
	if s.PublicPort != nil && *s.PublicPort > 0 {
		port = *s.PublicPort
	}
	return s.connectionURLWithHostPort(host, port)
}

func (s *Service) connectionURLWithHostPort(host string, port int) string {
	ptrStr := func(p *string) string {
		if p == nil { return "" }
		return *p
	}
	switch s.Type {
	case "postgres":
		return fmt.Sprintf("postgresql://%s:%s@%s:%d/%s", ptrStr(s.DBUser), ptrStr(s.DBPassword), host, port, ptrStr(s.DBName))
	case "redis":
		pw := ptrStr(s.DBPassword)
		if pw != "" {
			return fmt.Sprintf("redis://:%s@%s:%d", pw, host, port)
		}
		return fmt.Sprintf("redis://%s:%d", host, port)
	case "mongodb":
		dbUser, dbPass, dbName := ptrStr(s.DBUser), ptrStr(s.DBPassword), ptrStr(s.DBName)
		if dbUser != "" {
			return fmt.Sprintf("mongodb://%s:%s@%s:%d/%s?authSource=admin", dbUser, dbPass, host, port, dbName)
		}
		return fmt.Sprintf("mongodb://%s:%d/%s", host, port, dbName)
	case "mysql":
		return fmt.Sprintf("mysql://%s:%s@%s:%d/%s", ptrStr(s.DBUser), ptrStr(s.DBPassword), host, port, ptrStr(s.DBName))
	default:
		return ""
	}
}

// NewServiceCredentials generates a safe (db_name, password) pair for a new
// service. Exposed so handlers can reuse the same format for BYOC and
// platform-hosted services.
func NewServiceCredentials() (string, string) {
	b := make([]byte, 4)
	rand.Read(b)
	dbName := "svc_" + hex.EncodeToString(b)
	pw := make([]byte, 16)
	rand.Read(pw)
	return dbName, hex.EncodeToString(pw)
}

// CreateService creates a standalone Postgres service on the platform's
// central Postgres. Use CreateServiceRecord + remote docker-run for BYOC.
func (d *DB) CreateService(ctx context.Context, userID, name, serviceType string) (*Service, error) {
	dbName, password := NewServiceCredentials()

	if serviceType == "postgres" {
		var exists bool
		d.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1)", dbName).Scan(&exists)
		if !exists {
			_, err := d.Pool.Exec(ctx, fmt.Sprintf("CREATE ROLE %s WITH LOGIN PASSWORD '%s'", dbName, password))
			if err != nil {
				return nil, fmt.Errorf("create role: %w", err)
			}
		}
		d.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)", dbName).Scan(&exists)
		if !exists {
			_, err := d.Pool.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s OWNER %s", dbName, dbName))
			if err != nil {
				return nil, fmt.Errorf("create database: %w", err)
			}
		}
	}

	var svc Service
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO services (user_id, name, type, db_name, db_user, db_password, port)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, user_id, name, type, status, db_name, db_user, db_password, host, port, container_id, created_at, COALESCE(size_mb, 0), COALESCE(over_quota, false), worker_server_id, container_name, public_host, public_port`,
		userID, name, serviceType, dbName, dbName, password, 5432,
	).Scan(&svc.ID, &svc.UserID, &svc.Name, &svc.Type, &svc.Status, &svc.DBName, &svc.DBUser, &svc.DBPassword, &svc.Host, &svc.Port, &svc.ContainerID, &svc.CreatedAt, &svc.SizeMB, &svc.OverQuota, &svc.WorkerServerID, &svc.ContainerName, &svc.PublicHost, &svc.PublicPort)
	return &svc, err
}

// CreateContainerService persists a platform-hosted container service (Redis, MongoDB,
// MySQL). The caller must docker-run the container locally before calling this; cleanup
// on failure is the caller's responsibility.
func (d *DB) CreateContainerService(ctx context.Context, userID, name, serviceType, containerName, internalHost string, internalPort int, publicHost string, publicPort int, dbName, dbUser, dbPassword string) (*Service, error) {
	var svc Service
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO services (user_id, name, type, db_name, db_user, db_password, host, port, container_name, public_host, public_port, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
		 RETURNING id, user_id, name, type, status, db_name, db_user, db_password, host, port, container_id, created_at, COALESCE(size_mb, 0), COALESCE(over_quota, false), worker_server_id, container_name, public_host, public_port`,
		userID, name, serviceType, dbName, dbUser, dbPassword, internalHost, internalPort, containerName, publicHost, publicPort,
	).Scan(&svc.ID, &svc.UserID, &svc.Name, &svc.Type, &svc.Status, &svc.DBName, &svc.DBUser, &svc.DBPassword, &svc.Host, &svc.Port, &svc.ContainerID, &svc.CreatedAt, &svc.SizeMB, &svc.OverQuota, &svc.WorkerServerID, &svc.ContainerName, &svc.PublicHost, &svc.PublicPort)
	return &svc, err
}

// CreateBYOCService inserts a service row that points at a Postgres container
// running on a user's BYOC worker server. The caller is responsible for the
// actual `docker run` over SSH before persisting (or for cleanup on failure).
func (d *DB) CreateBYOCService(ctx context.Context, userID, name, serviceType, workerServerID, containerName, publicHost, dbName, dbUser, dbPassword string, publicPort int) (*Service, error) {
	var svc Service
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO services (user_id, name, type, db_name, db_user, db_password, host, port, worker_server_id, container_name, public_host, public_port, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
		 RETURNING id, user_id, name, type, status, db_name, db_user, db_password, host, port, container_id, created_at, COALESCE(size_mb, 0), COALESCE(over_quota, false), worker_server_id, container_name, public_host, public_port`,
		userID, name, serviceType, dbName, dbUser, dbPassword, publicHost, publicPort, workerServerID, containerName, publicHost, publicPort,
	).Scan(&svc.ID, &svc.UserID, &svc.Name, &svc.Type, &svc.Status, &svc.DBName, &svc.DBUser, &svc.DBPassword, &svc.Host, &svc.Port, &svc.ContainerID, &svc.CreatedAt, &svc.SizeMB, &svc.OverQuota, &svc.WorkerServerID, &svc.ContainerName, &svc.PublicHost, &svc.PublicPort)
	return &svc, err
}

// ListServices returns all services for a user.
func (d *DB) ListServices(ctx context.Context, userID string) ([]Service, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, name, type, status, db_name, db_user, db_password, host, port, container_id, created_at, COALESCE(size_mb, 0), COALESCE(over_quota, false), worker_server_id, container_name, public_host, public_port
		 FROM services WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var svcs []Service
	for rows.Next() {
		var s Service
		rows.Scan(&s.ID, &s.UserID, &s.Name, &s.Type, &s.Status, &s.DBName, &s.DBUser, &s.DBPassword, &s.Host, &s.Port, &s.ContainerID, &s.CreatedAt, &s.SizeMB, &s.OverQuota, &s.WorkerServerID, &s.ContainerName, &s.PublicHost, &s.PublicPort)
		svcs = append(svcs, s)
	}
	return svcs, nil
}

// GetService returns a service by ID.
func (d *DB) GetService(ctx context.Context, id string) (*Service, error) {
	var s Service
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, name, type, status, db_name, db_user, db_password, host, port, container_id, created_at, COALESCE(size_mb, 0), COALESCE(over_quota, false), worker_server_id, container_name, public_host, public_port
		 FROM services WHERE id = $1`, id,
	).Scan(&s.ID, &s.UserID, &s.Name, &s.Type, &s.Status, &s.DBName, &s.DBUser, &s.DBPassword, &s.Host, &s.Port, &s.ContainerID, &s.CreatedAt, &s.SizeMB, &s.OverQuota, &s.WorkerServerID, &s.ContainerName, &s.PublicHost, &s.PublicPort)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

// DeleteService drops the database/role and removes the service record. For
// BYOC services the caller (handler) is responsible for `docker rm` on the
// remote host before calling this; we only clean up platform-Postgres state
// here.
func (d *DB) DeleteService(ctx context.Context, id, userID string) error {
	svc, err := d.GetService(ctx, id)
	if err != nil || svc == nil || svc.UserID != userID {
		return fmt.Errorf("service not found")
	}

	// Only drop platform Postgres state when the service actually lives on platform PG.
	if svc.Type == "postgres" && svc.WorkerServerID == nil && svc.ContainerName == nil && svc.DBName != nil && svc.DBUser != nil {
		d.Pool.Exec(ctx, fmt.Sprintf("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()", *svc.DBName))
		d.Pool.Exec(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s", *svc.DBName))
		d.Pool.Exec(ctx, fmt.Sprintf("DROP ROLE IF EXISTS %s", *svc.DBUser))
	}

	_, err = d.Pool.Exec(ctx, "DELETE FROM services WHERE id = $1 AND user_id = $2", id, userID)
	return err
}
