package deploy

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

// CronScheduler runs per-project scheduled commands inside one-shot containers
// spawned from the project's latest image. Schedules are reloaded every tick so
// adds/edits/deletes take effect without a server restart.
type CronScheduler struct {
	db       *db.DB
	engine   *Engine
	log      zerolog.Logger
	parser   cron.Parser
	mu       sync.Mutex
	lastRuns map[string]time.Time // cronID → last time we triggered it (in-process guard)
}

func NewCronScheduler(database *db.DB, engine *Engine, log zerolog.Logger) *CronScheduler {
	return &CronScheduler{
		db:       database,
		engine:   engine,
		log:      log.With().Str("component", "cron_scheduler").Logger(),
		parser:   cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow),
		lastRuns: map[string]time.Time{},
	}
}

// Start runs the scheduler loop. Ticks every minute and runs any cron whose
// next-from-last-run time has passed.
func (cs *CronScheduler) Start(ctx context.Context) {
	cs.log.Info().Msg("cron scheduler started")
	// Align the first tick to the next minute boundary so schedules like "0 * * * *" are honoured.
	wait := time.Until(time.Now().Truncate(time.Minute).Add(time.Minute))
	select {
	case <-ctx.Done():
		return
	case <-time.After(wait):
	}
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	cs.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cs.tick(ctx)
		}
	}
}

func (cs *CronScheduler) tick(ctx context.Context) {
	crons, err := cs.db.ListAllEnabledCrons(ctx)
	if err != nil {
		cs.log.Warn().Err(err).Msg("list crons failed")
		return
	}
	now := time.Now()
	for _, c := range crons {
		if cs.shouldRun(c, now) {
			go cs.runCron(ctx, c)
		}
	}
}

// shouldRun decides whether a cron is due. A run is due if its Next(last_run)
// is <= now. If we've never run it we anchor Next() to the creation time so a
// cron created mid-interval doesn't fire the moment it's created.
func (cs *CronScheduler) shouldRun(c db.ProjectCron, now time.Time) bool {
	sched, err := cs.parser.Parse(c.Schedule)
	if err != nil {
		return false
	}
	anchor := c.CreatedAt
	if c.LastRunAt != nil {
		anchor = *c.LastRunAt
	}
	// In-memory dedupe so a long-running exec can't trigger twice in the same minute.
	cs.mu.Lock()
	if last, ok := cs.lastRuns[c.ID]; ok && now.Sub(last) < 55*time.Second {
		cs.mu.Unlock()
		return false
	}
	cs.mu.Unlock()
	return !sched.Next(anchor).After(now)
}

func (cs *CronScheduler) runCron(ctx context.Context, c db.ProjectCron) {
	cs.mu.Lock()
	cs.lastRuns[c.ID] = time.Now()
	cs.mu.Unlock()

	project, err := cs.db.GetProject(ctx, c.ProjectID)
	if err != nil || project == nil {
		cs.db.RecordCronRun(ctx, c.ID, "failed", "project not found")
		return
	}

	imageName := fmt.Sprintf("sm-project-%s", project.ID[:8])
	runner := cs.engine.getRunner(ctx, project)

	// Build env var flags (same strip-quotes logic as a real deploy).
	var envFlags []string
	for k, v := range project.EnvVars {
		if strings.HasPrefix(k, "#") || strings.TrimSpace(k) == "" {
			continue
		}
		v = strings.Trim(v, "\"")
		v = strings.Trim(v, "'")
		envFlags = append(envFlags, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	// Inject DATABASE_URL for managed DBs (same as app container).
	if projDB, _ := cs.db.GetProjectDatabase(ctx, project.ID); projDB != nil {
		envFlags = append(envFlags, "-e", "DATABASE_URL="+projDB.ConnectionURL())
	}

	args := []string{"run", "--rm"}
	args = append(args, envFlags...)
	args = append(args, imageName, "sh", "-c", c.Command)

	// Cap runs at 30 minutes so a hung cron doesn't leak forever.
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	cs.log.Info().Str("cron", c.ID).Str("project", project.ID).Msg("running cron")
	out, runErr := runner.Run(runCtx, "docker", args...)

	status := "success"
	if runErr != nil {
		status = "failed"
	}
	output := strings.TrimSpace(string(out))
	if runCtx.Err() == context.DeadlineExceeded {
		status = "failed"
		output = "timed out after 30 minutes\n" + output
	}
	cs.db.RecordCronRun(ctx, c.ID, status, output)
}
