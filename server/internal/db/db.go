package db

import (
	"context"
	"embed"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/rs/zerolog"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver for goose
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB wraps the pgx connection pool.
type DB struct {
	Pool *pgxpool.Pool
	log  zerolog.Logger
}

// New creates a new database connection pool and runs migrations.
func New(ctx context.Context, databaseURL string, log zerolog.Logger) (*DB, error) {
	log = log.With().Str("component", "db").Logger()

	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.HealthCheckPeriod = 30 * time.Second
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	log.Info().Msg("connected to PostgreSQL")

	db := &DB{Pool: pool, log: log}

	if err := db.migrate(databaseURL); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return db, nil
}

func (d *DB) migrate(databaseURL string) error {
	goose.SetBaseFS(migrations)

	sqlDB, err := goose.OpenDBWithDriver("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open for migration: %w", err)
	}
	defer sqlDB.Close()

	if err := goose.Up(sqlDB, "migrations"); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}

	d.log.Info().Msg("migrations complete")
	return nil
}

// Close closes the database pool.
func (d *DB) Close() {
	d.Pool.Close()
}
