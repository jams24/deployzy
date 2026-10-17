package deploy

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

// effectivePlanSQL resolves a user's plan like db.effectivePlan: an active
// referral reward (pro_until) on a free account counts as Pro.
const effectivePlanSQL = `CASE WHEN COALESCE(NULLIF(u.plan, ''), 'free') = 'free' AND u.pro_until > now() THEN 'pro' ELSE COALESCE(NULLIF(u.plan, ''), 'free') END`

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
	serviceID string
	dbName    string
	dbUser    string
	userPlan  string
	overQuota bool
	sizeMB    int
	planMaxMB int
}

func (s *DBQuotaSweeper) sweep(ctx context.Context) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT svc.id, svc.db_name, svc.db_user, u.plan, svc.over_quota,
		       CASE WHEN COALESCE(u.is_admin, false) THEN -1 ELSE COALESCE(pl.max_db_size_mb, 1024) END AS plan_max_mb
		FROM services svc
		JOIN users u ON u.id = svc.user_id
		LEFT JOIN plan_limits pl ON pl.plan = `+effectivePlanSQL+`
		WHERE svc.type = 'postgres' AND COALESCE(svc.container_name, '') = ''`)
	if err != nil {
		s.log.Warn().Err(err).Msg("list services failed")
		return
	}
	defer rows.Close()

	var items []dbRow
	for rows.Next() {
		var d dbRow
		if err := rows.Scan(&d.serviceID, &d.dbName, &d.dbUser, &d.userPlan, &d.overQuota, &d.planMaxMB); err != nil {
			s.log.Warn().Err(err).Msg("scan quota service")
			continue
		}
		items = append(items, d)
	}

	for _, d := range items {
		s.checkOne(ctx, d)
	}

	s.sweepContainers(ctx)
}

// containerSvc is a database running in its own container (sm-svc-*) on a
// worker — any engine. These do NOT live in the control-plane Postgres, so
// pg_database_size on s.db.Pool can't see them; they must be measured on the
// host that runs them.
type containerSvc struct {
	id, typ, container, dbName, dbUser, dbPassword string
	capMB                                          int  // plan max_db_size_mb; -1 = unlimited
	overQuota                                      bool // current recorded state
}

// sweepContainers records size_mb for container-hosted databases by probing
// each worker once (one SSH round-trip per worker, not per database).
// Postgres reports its exact pg_database_size via docker exec; other engines
// (redis/mongo/mysql) report their data volume's on-disk size.
//
// The official postgres image runs the app user as superuser, which bypasses
// GRANT/REVOKE, so container DBs are capped differently (see enforceContainer).
func (s *DBQuotaSweeper) sweepContainers(ctx context.Context) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT svc.id, svc.type, svc.container_name, COALESCE(svc.db_name, ''), COALESCE(svc.db_user, ''),
		       COALESCE(svc.db_password, ''), COALESCE(svc.worker_server_id::text, ''), COALESCE(svc.over_quota, false),
		       CASE WHEN COALESCE(u.is_admin, false) THEN -1 ELSE COALESCE(pl.max_db_size_mb, 1024) END
		FROM services svc
		JOIN users u ON u.id = svc.user_id
		LEFT JOIN plan_limits pl ON pl.plan = `+effectivePlanSQL+`
		WHERE svc.container_name IS NOT NULL AND svc.container_name <> ''`)
	if err != nil {
		s.log.Warn().Err(err).Msg("list container services failed")
		return
	}
	byServer := map[string][]containerSvc{}
	for rows.Next() {
		var c containerSvc
		var serverID string
		if err := rows.Scan(&c.id, &c.typ, &c.container, &c.dbName, &c.dbUser, &c.dbPassword, &serverID, &c.overQuota, &c.capMB); err != nil {
			s.log.Warn().Err(err).Msg("scan container service")
			continue
		}
		byServer[serverID] = append(byServer[serverID], c)
	}
	rows.Close()

	for serverID, svcs := range byServer {
		runner := NewLocalRunner()
		if serverID != "" {
			server, err := s.db.GetWorkerServer(ctx, serverID)
			if err != nil || server == nil {
				continue
			}
			isLocal := server.IsLocal || server.Host == "" || server.Host == "localhost" || server.Host == "127.0.0.1"
			if !isLocal {
				if server.Status == "offline" {
					continue // unreachable — keep the last known size
				}
				runner = NewRemoteRunner(server)
			}
		}
		s.measureOn(ctx, runner, svcs)
	}
}

func (s *DBQuotaSweeper) measureOn(ctx context.Context, runner *Runner, svcs []containerSvc) {
	byID := make(map[string]containerSvc, len(svcs))
	for _, c := range svcs {
		byID[c.id] = c
	}
	var script strings.Builder
	for _, c := range svcs {
		vol := shellQuote("sm-svc-" + c.dbName + "-data")
		volBytes := fmt.Sprintf(`$(du -sb "$(docker volume inspect -f '{{.Mountpoint}}' %s 2>/dev/null)" 2>/dev/null | cut -f1)`, vol)
		if c.typ == "postgres" && c.dbUser != "" && c.dbName != "" {
			exact := fmt.Sprintf(`$(docker exec %s psql -U %s -d %s -tAc 'select pg_database_size(current_database())' 2>/dev/null | tr -d '[:space:]')`,
				shellQuote(c.container), shellQuote(c.dbUser), shellQuote(c.dbName))
			fmt.Fprintf(&script, "v=%s; [ -z \"$v\" ] && v=%s; echo \"SMSIZE %s $v\"\n", exact, volBytes, c.id)
		} else {
			fmt.Fprintf(&script, "echo \"SMSIZE %s %s\"\n", c.id, volBytes)
		}
	}

	pctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	out, err := runner.RunShell(pctx, script.String())
	if err != nil && len(out) == 0 {
		s.log.Debug().Err(err).Str("host", runner.Host()).Msg("container db size probe failed")
		return
	}

	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(strings.TrimSpace(line))
		if len(f) != 3 || f[0] != "SMSIZE" {
			continue
		}
		b, perr := strconv.ParseInt(f[2], 10, 64)
		if perr != nil || b < 0 {
			continue
		}
		// Round up so a non-empty DB never reads as 0 MB.
		mb := int((b + 1024*1024 - 1) / (1024 * 1024))
		s.db.Pool.Exec(ctx,
			`UPDATE services SET size_mb = $1, size_checked_at = NOW() WHERE id = $2`, mb, f[1])
		if c, ok := byID[f[1]]; ok {
			s.enforceContainer(ctx, runner, c, mb)
		}
	}
}

// enforceContainer applies the plan's storage cap to a container-hosted
// database. Container Postgres runs the app as superuser, so GRANT/REVOKE (the
// central-DB mechanism) can't work; instead:
//   - postgres: over the cap → ALTER DATABASE … SET default_transaction_read_only
//     and reset other sessions so they reconnect read-only; back under → RESET.
//     Soft cap: a session can still `SET default_transaction_read_only = off`
//     to delete data and recover (the dashboard explains this).
//   - redis: keep maxmemory = cap with noeviction on every sweep (idempotent),
//     so writes past the cap fail with OOM instead of growing.
//
// Unlimited (-1) caps are never enforced; a DB that was locked is unlocked.
func (s *DBQuotaSweeper) enforceContainer(ctx context.Context, runner *Runner, c containerSvc, sizeMB int) {
	ectx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	switch c.typ {
	case "redis":
		if c.capMB < 0 || c.dbPassword == "" {
			return
		}
		cmd := fmt.Sprintf(`docker exec -e REDISCLI_AUTH=%s %s sh -c 'redis-cli CONFIG SET maxmemory %dmb >/dev/null && redis-cli CONFIG SET maxmemory-policy noeviction >/dev/null'`,
			shellQuote(c.dbPassword), shellQuote(c.container), c.capMB)
		if out, err := runner.RunShell(ectx, cmd); err != nil {
			s.log.Debug().Err(err).Str("service", c.id).Str("out", string(out)).Msg("redis maxmemory set failed")
		}
		s.setOverQuota(ctx, c, c.capMB >= 0 && sizeMB > c.capMB)
	case "postgres":
		if c.dbUser == "" || c.dbName == "" {
			return
		}
		over := c.capMB >= 0 && sizeMB > c.capMB
		if over == c.overQuota {
			return // no transition
		}
		db := `"` + strings.ReplaceAll(c.dbName, `"`, `""`) + `"`
		sql := `ALTER DATABASE ` + db + ` RESET default_transaction_read_only`
		if over {
			sql = `ALTER DATABASE ` + db + ` SET default_transaction_read_only = on; ` +
				`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`
		}
		// PGOPTIONS starts this admin session writable: once the database
		// default is read-only, a plain session couldn't run the RESET that
		// unlocks it (caught in testing — the DB would stay locked forever).
		cmd := fmt.Sprintf(`docker exec -e PGOPTIONS='-c default_transaction_read_only=off' %s psql -U %s -d %s -v ON_ERROR_STOP=1 -tAc %s`,
			shellQuote(c.container), shellQuote(c.dbUser), shellQuote(c.dbName), shellQuote(sql))
		if out, err := runner.RunShell(ectx, cmd); err != nil {
			s.log.Warn().Err(err).Str("service", c.id).Str("out", strings.TrimSpace(string(out))).Msg("container quota toggle failed")
			return
		}
		s.setOverQuota(ctx, c, over)
		if over {
			s.log.Warn().Str("service", c.id).Str("db", c.dbName).Int("size_mb", sizeMB).Int("cap_mb", c.capMB).Msg("container db over quota — read-only")
		} else {
			s.log.Info().Str("service", c.id).Str("db", c.dbName).Int("size_mb", sizeMB).Msg("container db back under quota — writable")
		}
	}
}

func (s *DBQuotaSweeper) setOverQuota(ctx context.Context, c containerSvc, over bool) {
	if over == c.overQuota {
		return
	}
	if _, err := s.db.Pool.Exec(ctx, `UPDATE services SET over_quota = $1 WHERE id = $2`, over, c.id); err != nil {
		s.log.Warn().Err(err).Str("service", c.id).Msg("set over_quota failed")
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
