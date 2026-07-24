package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/migrate"
)

// One-time "bring your own database" import. Premium-only. We create a fresh
// Deployzy-managed target, then dump the user's source into it in the
// background, tracking status on a db_migrations row.

func (s *Server) handleCreateMigration(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	if !billing.IsFeatureAllowed(r.Context(), s.db, u, "db_migration") {
		writeError(w, http.StatusPaymentRequired,
			"Database migration is a paid feature — upgrade to import an existing database into Deployzy.")
		return
	}

	var req struct {
		SourceType string `json:"source_type"` // postgres | mysql | mongodb
		SourceURL  string `json:"source_url"`
		TargetName string `json:"target_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	valid := map[string]bool{migrate.Postgres: true, migrate.MySQL: true, migrate.MongoDB: true}
	if !valid[req.SourceType] {
		writeError(w, http.StatusBadRequest, "source_type must be postgres, mysql, or mongodb")
		return
	}
	if req.TargetName == "" {
		req.TargetName = "migrated-" + req.SourceType
	}

	// Validate + SSRF-guard the source before creating anything.
	host, err := migrate.ValidateSource(req.SourceType, req.SourceURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Respect the standalone-service quota.
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimService); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	// Reject up front if the source is bigger than the user's plan storage cap —
	// otherwise the restore fills the DB and the quota sweeper immediately
	// revokes writes, which is a worse experience than a clear "too big" error.
	// Admins are exempt; a failed size probe (0) doesn't block.
	if isAdmin, _ := s.db.IsUserAdmin(r.Context(), u.ID); !isAdmin {
		plan := u.Plan
		if fresh, _ := s.db.GetUserByID(r.Context(), u.ID); fresh != nil && fresh.Plan != "" {
			plan = fresh.Plan
		}
		if limits, _ := s.db.GetPlanLimits(r.Context(), plan); limits != nil && limits.MaxDBSizeMB > 0 {
			if srcMB, _ := migrate.SourceSizeMB(r.Context(), req.SourceType, req.SourceURL); srcMB > limits.MaxDBSizeMB {
				writeError(w, http.StatusPaymentRequired, fmt.Sprintf(
					"Source database is %d MB but your plan allows %d MB of database storage. Upgrade for more, or trim the source first.",
					srcMB, limits.MaxDBSizeMB))
				return
			}
		}
	}

	// Create the target (platform-hosted, so it's reachable on localhost by the
	// migration container running with --network host).
	var svc *db.Service
	if req.SourceType == migrate.Postgres {
		svc, err = s.db.CreateService(r.Context(), u.ID, req.TargetName, "postgres")
	} else {
		svc, err = s.provisionPlatformContainer(r.Context(), u.ID, req.TargetName, req.SourceType)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to create target database: "+err.Error())
		return
	}

	targetURL := internalTargetURL(svc)
	job, err := s.db.CreateDBMigration(r.Context(), u.ID, req.SourceType, host, svc.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record migration")
		return
	}

	// Run in the background — dumps can take minutes. Detached context so a
	// finished request doesn't cancel it.
	go s.runMigration(job.ID, req.SourceType, req.SourceURL, targetURL, svc)

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"migration": job,
		"service":   svc,
	})
}

func (s *Server) runMigration(jobID, sourceType, sourceURL, targetURL string, svc *db.Service) {
	// Generous ceiling so large imports (up to the 50 GB team cap) can finish;
	// the job is fully async so a long run never ties up a request.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Hour)
	defer cancel()

	s.db.SetDBMigrationRunning(ctx, jobID)

	// Freshly-created container targets (mysql/mongo) need a moment to accept
	// connections. Postgres-platform is always up.
	if svc.PublicPort != nil && *svc.PublicPort > 0 {
		waitTCP(fmt.Sprintf("127.0.0.1:%d", *svc.PublicPort), 90*time.Second)
	}

	log, err := migrate.Run(ctx, sourceType, sourceURL, targetURL)
	if err != nil {
		s.log.Warn().Err(err).Str("job", jobID).Msg("db migration failed")
		s.db.FinishDBMigration(context.Background(), jobID, "failed", err.Error(), log)
		return
	}
	s.db.FinishDBMigration(context.Background(), jobID, "success", "", log)
	s.log.Info().Str("job", jobID).Str("type", sourceType).Msg("db migration complete")
}

// internalTargetURL builds a connection string the migration container reaches
// on the host's localhost (host networking). Platform Postgres is on :5432; a
// container service is on its mapped public port.
func internalTargetURL(svc *db.Service) string {
	ptr := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	user, pass, name := ptr(svc.DBUser), ptr(svc.DBPassword), ptr(svc.DBName)
	switch svc.Type {
	case "postgres":
		return fmt.Sprintf("postgresql://%s:%s@127.0.0.1:5432/%s?sslmode=disable", user, pass, name)
	case "mysql":
		port := 3306
		if svc.PublicPort != nil {
			port = *svc.PublicPort
		}
		return fmt.Sprintf("mysql://%s:%s@127.0.0.1:%d/%s", user, pass, port, name)
	case "mongodb":
		port := 27017
		if svc.PublicPort != nil {
			port = *svc.PublicPort
		}
		return fmt.Sprintf("mongodb://%s:%s@127.0.0.1:%d/%s?authSource=admin", user, pass, port, name)
	}
	return ""
}

func waitTCP(addr string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
		if err == nil {
			conn.Close()
			time.Sleep(3 * time.Second) // grace for the engine to finish init after the port opens
			return
		}
		time.Sleep(3 * time.Second)
	}
}

func (s *Server) handleListMigrations(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	jobs, err := s.db.ListDBMigrations(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list migrations")
		return
	}
	if jobs == nil {
		jobs = []db.DBMigration{}
	}
	writeJSON(w, http.StatusOK, jobs)
}

func (s *Server) handleGetMigration(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	id := chi.URLParam(r, "id")
	job, err := s.db.GetDBMigration(r.Context(), id, u.ID)
	if err != nil || job == nil {
		writeError(w, http.StatusNotFound, "migration not found")
		return
	}
	writeJSON(w, http.StatusOK, job)
}
