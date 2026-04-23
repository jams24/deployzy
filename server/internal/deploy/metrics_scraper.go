package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

// MetricsScraper samples `docker stats` every 30 seconds for every running
// project and records CPU, memory, and network to project_metrics. It also
// prunes rows older than 7 days each run so the table stays small.
type MetricsScraper struct {
	db     *db.DB
	engine *Engine
	log    zerolog.Logger
	// oomSeen tracks the last-seen RestartCount per project so we only log an
	// OOM event once per kill (docker restarts crash-looping containers fast).
	oomSeen sync.Map // projectID → lastRestartCount (int)
}

func NewMetricsScraper(database *db.DB, engine *Engine, log zerolog.Logger) *MetricsScraper {
	return &MetricsScraper{
		db:     database,
		engine: engine,
		log:    log.With().Str("component", "metrics_scraper").Logger(),
	}
}

func (ms *MetricsScraper) Start(ctx context.Context) {
	ms.log.Info().Msg("metrics scraper started")
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	pruneTicker := time.NewTicker(1 * time.Hour)
	defer pruneTicker.Stop()

	ms.scrape(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ms.scrape(ctx)
		case <-pruneTicker.C:
			if err := ms.db.PruneOldMetrics(ctx, time.Now().AddDate(0, 0, -7)); err != nil {
				ms.log.Warn().Err(err).Msg("prune old metrics failed")
			}
		}
	}
}

func (ms *MetricsScraper) scrape(ctx context.Context) {
	projects, err := ms.db.ListRunningProjects(ctx)
	if err != nil || len(projects) == 0 {
		return
	}
	for _, p := range projects {
		if p.ContainerID == "" {
			continue
		}
		// Remote workers use the same runner abstraction as local, so we no
		// longer skip them — getRunner() transparently SSHs for remote
		// projects and runs docker commands there.
		go ms.scrapeOne(ctx, p)
	}
}

// dockerStatsJSON is the fields we parse from `docker stats --no-stream --format {{json .}}`.
type dockerStatsJSON struct {
	Name     string `json:"Name"`
	CPUPerc  string `json:"CPUPerc"`  // "0.13%"
	MemUsage string `json:"MemUsage"` // "3.5MiB / 512MiB"
	NetIO    string `json:"NetIO"`    // "1.2kB / 800B"
}

func (ms *MetricsScraper) scrapeOne(ctx context.Context, p db.Project) {
	containerName := fmt.Sprintf("sm-%s", p.ID[:8])
	runner := ms.engine.getRunner(ctx, &p)

	runCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	out, err := runner.Run(runCtx, "docker", "stats", "--no-stream", "--format", "{{json .}}", containerName)
	if err != nil {
		return
	}
	line := strings.TrimSpace(string(out))
	if line == "" {
		return
	}

	var stats dockerStatsJSON
	if err := json.Unmarshal([]byte(line), &stats); err != nil {
		return
	}

	cpu := parseCPUPerc(stats.CPUPerc)
	memMB, memLimitMB := parseMemUsage(stats.MemUsage)
	rx, tx := parseNetIO(stats.NetIO)

	if err := ms.db.InsertMetric(ctx, p.ID, cpu, memMB, memLimitMB, rx, tx); err != nil {
		ms.log.Debug().Err(err).Str("project", p.ID).Msg("insert metric failed")
	}

	ms.checkOOM(ctx, p, runner, containerName)
}

// checkOOM inspects the container and, if it was OOM-killed since the last
// observation, writes a visible log line so users understand why their app is
// crash-looping. Without this, an OOM'd app silently restarts and the user
// only sees "restarted N times" with no cause.
func (ms *MetricsScraper) checkOOM(ctx context.Context, p db.Project, runner *Runner, containerName string) {
	inspectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := runner.Run(inspectCtx, "docker", "inspect", "--format",
		"{{.State.OOMKilled}}|{{.RestartCount}}|{{.State.ExitCode}}", containerName)
	if err != nil {
		return
	}
	parts := strings.Split(strings.TrimSpace(string(out)), "|")
	if len(parts) != 3 {
		return
	}
	oom := parts[0] == "true"
	restartCount, _ := strconv.Atoi(parts[1])
	exitCode, _ := strconv.Atoi(parts[2])

	if !oom && exitCode != 137 {
		return
	}
	prev, _ := ms.oomSeen.Load(p.ID)
	prevCount, _ := prev.(int)
	if restartCount <= prevCount {
		return
	}
	ms.oomSeen.Store(p.ID, restartCount)
	ms.engine.logMsg(ctx, p.ID, fmt.Sprintf(
		"Container OOM-killed — exceeded memory limit (%d MB). Exit 137. Increase Memory MB in project settings, or upgrade your plan for a higher ceiling.",
		planMemLimitFromID(ctx, ms.db, p.ID),
	), "error")
}

// planMemLimitFromID looks up what memory limit the project is running under
// (project override or plan ceiling). Used only for the OOM message.
func planMemLimitFromID(ctx context.Context, database *db.DB, projectID string) int {
	proj, err := database.GetProject(ctx, projectID)
	if err != nil || proj == nil {
		return 0
	}
	if proj.MemoryMB > 0 {
		return proj.MemoryMB
	}
	user, err := database.GetUserByID(ctx, proj.UserID)
	if err != nil || user == nil {
		return 512
	}
	limits, _ := database.GetPlanLimits(ctx, user.Plan)
	if limits != nil && limits.MaxMemoryMB > 0 {
		if limits.MaxMemoryMB < 512 {
			return limits.MaxMemoryMB
		}
	}
	return 512
}

// parseCPUPerc turns "0.13%" → 0.13.
func parseCPUPerc(s string) float64 {
	s = strings.TrimSpace(strings.TrimSuffix(s, "%"))
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

// parseMemUsage turns "3.5MiB / 512MiB" → (3, 512). Returns MB (decimal, close
// enough for a graph).
func parseMemUsage(s string) (int, int) {
	parts := strings.Split(s, "/")
	if len(parts) != 2 {
		return 0, 0
	}
	return bytesToMB(parseSize(strings.TrimSpace(parts[0]))), bytesToMB(parseSize(strings.TrimSpace(parts[1])))
}

// parseNetIO turns "1.2kB / 800B" → (1200, 800).
func parseNetIO(s string) (int64, int64) {
	parts := strings.Split(s, "/")
	if len(parts) != 2 {
		return 0, 0
	}
	return parseSize(strings.TrimSpace(parts[0])), parseSize(strings.TrimSpace(parts[1]))
}

// parseSize handles docker's size strings: "3.5MiB", "1.2kB", "800B", "2.3GiB".
func parseSize(s string) int64 {
	if s == "" {
		return 0
	}
	// Find where digits/dot end and the unit begins.
	i := 0
	for i < len(s) && (s[i] == '.' || (s[i] >= '0' && s[i] <= '9')) {
		i++
	}
	num, _ := strconv.ParseFloat(s[:i], 64)
	unit := strings.TrimSpace(s[i:])
	mul := float64(1)
	switch unit {
	case "B":
		mul = 1
	case "kB", "KB", "KiB":
		mul = 1024
	case "MB", "MiB":
		mul = 1024 * 1024
	case "GB", "GiB":
		mul = 1024 * 1024 * 1024
	case "TB", "TiB":
		mul = 1024 * 1024 * 1024 * 1024
	}
	return int64(num * mul)
}

func bytesToMB(b int64) int {
	return int(b / (1024 * 1024))
}
