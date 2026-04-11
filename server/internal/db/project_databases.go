package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ProjectDatabase represents a managed PostgreSQL database for a project.
type ProjectDatabase struct {
	ID         string    `json:"id"`
	ProjectID  string    `json:"project_id"`
	DBName     string    `json:"db_name"`
	DBUser     string    `json:"db_user"`
	DBPassword string    `json:"db_password"`
	Host       string    `json:"host"`
	Port       int       `json:"port"`
	CreatedAt  time.Time `json:"created_at"`
}

// ConnectionURL returns the internal PostgreSQL connection string (for containers).
func (pdb *ProjectDatabase) ConnectionURL() string {
	return fmt.Sprintf("postgresql://%s:%s@%s:%d/%s", pdb.DBUser, pdb.DBPassword, pdb.Host, pdb.Port, pdb.DBName)
}

// ExternalConnectionURL returns the external PostgreSQL connection string (for external tools).
func (pdb *ProjectDatabase) ExternalConnectionURL(publicHost string) string {
	return fmt.Sprintf("postgresql://%s:%s@%s:%d/%s", pdb.DBUser, pdb.DBPassword, publicHost, pdb.Port, pdb.DBName)
}

var safeNameRe = regexp.MustCompile(`[^a-z0-9]`)

// sanitizeDBName creates a safe database/role name from a project ID.
func sanitizeDBName(projectID string) string {
	id := strings.ToLower(projectID)
	if len(id) > 8 {
		id = id[:8]
	}
	id = safeNameRe.ReplaceAllString(id, "_")
	return "sm_" + id
}

// generatePassword creates a random password for a database user.
func generatePassword() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateProjectDatabase creates a new PostgreSQL database and user for a project.
func (d *DB) CreateProjectDatabase(ctx context.Context, projectID string) (*ProjectDatabase, error) {
	// Check if database already exists for this project
	existing, _ := d.GetProjectDatabase(ctx, projectID)
	if existing != nil {
		return existing, nil
	}

	name := sanitizeDBName(projectID)
	password := generatePassword()

	// Check if role already exists
	var exists bool
	d.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1)", name).Scan(&exists)
	if !exists {
		_, err := d.Pool.Exec(ctx, fmt.Sprintf("CREATE ROLE %s WITH LOGIN PASSWORD '%s'", name, password))
		if err != nil {
			return nil, fmt.Errorf("create role: %w", err)
		}
	}

	// Check if database already exists
	d.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&exists)
	if !exists {
		// CREATE DATABASE cannot run inside a transaction
		_, err := d.Pool.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s OWNER %s", name, name))
		if err != nil {
			return nil, fmt.Errorf("create database: %w", err)
		}
	}

	// Insert tracking record
	var pdb ProjectDatabase
	err := d.Pool.QueryRow(ctx,
		`INSERT INTO project_databases (project_id, db_name, db_user, db_password)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, project_id, db_name, db_user, db_password, host, port, created_at`,
		projectID, name, name, password,
	).Scan(&pdb.ID, &pdb.ProjectID, &pdb.DBName, &pdb.DBUser, &pdb.DBPassword, &pdb.Host, &pdb.Port, &pdb.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert tracking record: %w", err)
	}

	return &pdb, nil
}

// GetProjectDatabase retrieves the managed database info for a project.
func (d *DB) GetProjectDatabase(ctx context.Context, projectID string) (*ProjectDatabase, error) {
	var pdb ProjectDatabase
	err := d.Pool.QueryRow(ctx,
		`SELECT id, project_id, db_name, db_user, db_password, host, port, created_at
		 FROM project_databases WHERE project_id = $1`,
		projectID,
	).Scan(&pdb.ID, &pdb.ProjectID, &pdb.DBName, &pdb.DBUser, &pdb.DBPassword, &pdb.Host, &pdb.Port, &pdb.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &pdb, nil
}

// DeleteProjectDatabase drops the managed database and role for a project.
func (d *DB) DeleteProjectDatabase(ctx context.Context, projectID string) error {
	pdb, err := d.GetProjectDatabase(ctx, projectID)
	if err != nil || pdb == nil {
		return nil // No database to delete
	}

	// Terminate active connections
	d.Pool.Exec(ctx, fmt.Sprintf(
		"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()",
		pdb.DBName,
	))

	// Drop database and role
	d.Pool.Exec(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s", pdb.DBName))
	d.Pool.Exec(ctx, fmt.Sprintf("DROP ROLE IF EXISTS %s", pdb.DBUser))

	// Remove tracking record
	d.Pool.Exec(ctx, "DELETE FROM project_databases WHERE project_id = $1", projectID)

	return nil
}
