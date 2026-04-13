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
}

// ConnectionURL returns the internal connection string (for containers on same host).
func (s *Service) ConnectionURL() string {
	return s.connectionURLWithHost(s.Host)
}

// ExternalConnectionURL returns the external connection string (for local dev / external tools).
func (s *Service) ExternalConnectionURL(publicHost string) string {
	return s.connectionURLWithHost(publicHost)
}

func (s *Service) connectionURLWithHost(host string) string {
	switch s.Type {
	case "postgres":
		dbName, dbUser, dbPass := "", "", ""
		if s.DBName != nil { dbName = *s.DBName }
		if s.DBUser != nil { dbUser = *s.DBUser }
		if s.DBPassword != nil { dbPass = *s.DBPassword }
		return fmt.Sprintf("postgresql://%s:%s@%s:%d/%s", dbUser, dbPass, host, s.Port, dbName)
	case "redis":
		return fmt.Sprintf("redis://%s:%d", host, s.Port)
	default:
		return ""
	}
}

// CreateService creates a standalone PostgreSQL database service.
func (d *DB) CreateService(ctx context.Context, userID, name, serviceType string) (*Service, error) {
	// Generate safe names
	b := make([]byte, 4)
	rand.Read(b)
	suffix := hex.EncodeToString(b)
	dbName := "svc_" + suffix
	password := hex.EncodeToString(func() []byte { p := make([]byte, 16); rand.Read(p); return p }())

	if serviceType == "postgres" {
		// Create PG role and database
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
		 RETURNING id, user_id, name, type, status, db_name, db_user, db_password, host, port, container_id, created_at`,
		userID, name, serviceType, dbName, dbName, password, 5432,
	).Scan(&svc.ID, &svc.UserID, &svc.Name, &svc.Type, &svc.Status, &svc.DBName, &svc.DBUser, &svc.DBPassword, &svc.Host, &svc.Port, &svc.ContainerID, &svc.CreatedAt)
	return &svc, err
}

// ListServices returns all services for a user.
func (d *DB) ListServices(ctx context.Context, userID string) ([]Service, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT id, user_id, name, type, status, db_name, db_user, db_password, host, port, container_id, created_at
		 FROM services WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var svcs []Service
	for rows.Next() {
		var s Service
		rows.Scan(&s.ID, &s.UserID, &s.Name, &s.Type, &s.Status, &s.DBName, &s.DBUser, &s.DBPassword, &s.Host, &s.Port, &s.ContainerID, &s.CreatedAt)
		svcs = append(svcs, s)
	}
	return svcs, nil
}

// GetService returns a service by ID.
func (d *DB) GetService(ctx context.Context, id string) (*Service, error) {
	var s Service
	err := d.Pool.QueryRow(ctx,
		`SELECT id, user_id, name, type, status, db_name, db_user, db_password, host, port, container_id, created_at
		 FROM services WHERE id = $1`, id,
	).Scan(&s.ID, &s.UserID, &s.Name, &s.Type, &s.Status, &s.DBName, &s.DBUser, &s.DBPassword, &s.Host, &s.Port, &s.ContainerID, &s.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

// DeleteService drops the database/role and removes the service record.
func (d *DB) DeleteService(ctx context.Context, id, userID string) error {
	svc, err := d.GetService(ctx, id)
	if err != nil || svc == nil || svc.UserID != userID {
		return fmt.Errorf("service not found")
	}

	if svc.Type == "postgres" {
		d.Pool.Exec(ctx, fmt.Sprintf("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()", svc.DBName))
		d.Pool.Exec(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s", svc.DBName))
		d.Pool.Exec(ctx, fmt.Sprintf("DROP ROLE IF EXISTS %s", svc.DBUser))
	}

	_, err = d.Pool.Exec(ctx, "DELETE FROM services WHERE id = $1 AND user_id = $2", id, userID)
	return err
}
