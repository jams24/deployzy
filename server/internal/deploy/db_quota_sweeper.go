package deploy

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

// DBQuotaSweeper enforces per-plan Postgres disk caps on standalone services.
// Every 5 minutes it queries pg_database_size for each user-owned DB, compares
// against the plan's max_db_size_mb, and toggles INSERT/UPDATE grants on the
// role so over-quota DBs stop growing until the user deletes data or upgrades.
//
// Reads and DELETEs stay allowed so the user can recover — this is a soft
// cap, not a lockout.
type DBQuotaSweeper struct {
	db  *db.DB
	log zerolog.Logger
}

func NewDBQuotaSweeper(database *db.DB, log zerolog.Logger) *DBQuotaSweeper {
	return &DBQuotaSweeper{
		db:  database,
		log: log.With().Str("component", "db_quota_sweeper").Logger(),
	}
}

func (s *DBQuotaSweeper) Start(ctx context.Context) {
	s.log.Info().Msg("db quota sweeper started")
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	// Run once at startup so a restart picks up any drift since shutdown.
	s.sweep(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweep(ctx)
		}
	}
}

type dbRow struct {
	serviceID  string
	dbName     string
	dbUser     string
	userPlan   string
	overQuota  bool
	sizeMB     int
	planMaxMB  int
}

func (s *DBQuotaSweeper) sweep(ctx context.Context) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT svc.id, svc.db_name, svc.db_user, u.plan, svc.over_quota,
		       COALESCE(pl.max_db_size_mb, 500) AS plan_max_mb
		FROM services svc
		JOIN users u ON u.id = svc.user_id
		LEFT JOIN plan_limits pl ON pl.plan = u.plan
		WHERE svc.type = 'postgres'`)
	if err != nil {
		s.log.Warn().Err(err).Msg("list services failed")
		return
	}
	defer rows.Close()

	var items []dbRow
	for rows.Next() {
		var d dbRow
		if err := rows.Scan(&d.serviceID, &d.dbName, &d.dbUser, &d.userPlan, &d.overQuota, &d.planMaxMB); err != nil {
			continue
		}
		items = append(items, d)
	}

	for _, d := range items {
		s.checkOne(ctx, d)
	}
}

func (s *DBQuotaSweeper) checkOne(ctx context.Context, d dbRow) {
	var sizeBytes int64
	err := s.db.Pool.QueryRow(ctx, `SELECT pg_database_size($1)`, d.dbName).Scan(&sizeBytes)
	if err != nil {
		return
	}
	sizeMB := int(sizeBytes / (1024 * 1024))

	// Persist the observed size so the UI can show usage without re-querying.
	s.db.Pool.Exec(ctx,
		`UPDATE services SET size_mb = $1, size_checked_at = NOW() WHERE id = $2`,
		sizeMB, d.serviceID)

	// -1 = unlimited (admin). No enforcement.
	if d.planMaxMB < 0 {
		return
	}

	overNow := sizeMB > d.planMaxMB
	if overNow == d.overQuota {
		return // no transition
	}

	if overNow {
		// Over the cap — revoke write grants. DELETE stays allowed so users can
		// recover; REVOKE is schema-wide on the user's own DB so it only
		// affects their data, not platform tables.
		_, err := s.db.Pool.Exec(ctx, fmt.Sprintf(
			`REVOKE INSERT, UPDATE ON ALL TABLES IN SCHEMA public FROM %s`, d.dbUser))
		if err != nil {
			s.log.Warn().Err(err).Str("service", d.serviceID).Msg("revoke failed")
			return
		}
		s.db.Pool.Exec(ctx, fmt.Sprintf(
			`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE ON TABLES FROM %s`, d.dbUser))
		s.db.Pool.Exec(ctx,
			`UPDATE services SET over_quota = true WHERE id = $1`, d.serviceID)
		s.log.Warn().
			Str("service", d.serviceID).Str("db", d.dbName).
			Int("size_mb", sizeMB).Int("cap_mb", d.planMaxMB).
			Msg("db over quota — writes revoked")
	} else {
		// Back under the cap (user deleted data or upgraded) — restore grants.
		_, err := s.db.Pool.Exec(ctx, fmt.Sprintf(
			`GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO %s`, d.dbUser))
		if err != nil {
			s.log.Warn().Err(err).Str("service", d.serviceID).Msg("grant restore failed")
			return
		}
		s.db.Pool.Exec(ctx, fmt.Sprintf(
			`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE ON TABLES TO %s`, d.dbUser))
		s.db.Pool.Exec(ctx,
			`UPDATE services SET over_quota = false WHERE id = $1`, d.serviceID)
		s.log.Info().
			Str("service", d.serviceID).Str("db", d.dbName).
			Int("size_mb", sizeMB).Int("cap_mb", d.planMaxMB).
			Msg("db back under quota — writes restored")
	}
}
