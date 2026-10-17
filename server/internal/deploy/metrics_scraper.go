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
// prunes rows past each owner's plan metrics_retention_days (PruneMetricsPerPlan).
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
			if n, err := ms.db.PruneMetricsPerPlan(ctx); err != nil {
				ms.log.Warn().Err(err).Msg("prune old metrics failed")
			} else if n > 0 {
				ms.log.Debug().Int64("rows", n).Msg("pruned metrics past plan retention")
			}
		}
	}
}

func (ms *MetricsScraper) scrape(ctx context.Context) {
	projects, err := ms.db.ListRunningProjects(ctx)
	if err != nil || len(projects) == 0 {
		return
	}
	// Group by host so each worker is probed with ONE SSH round-trip per cycle.
	// The old code ran 2 SSH logins per project (docker stats + docker inspect)
	// concurrently every 30s — ~170 logins per cycle on an 84-project worker,
	// which showed up as a load average of 20+ on an otherwise idle box.
	byHost := map[string][]db.Project{}
	for _, p := range projects {
		if p.ContainerID == "" {
			continue
		}
		byHost[p.WorkerServerID] = append(byHost[p.WorkerServerID], p)
	}
	for _, group := range byHost {
		go ms.scrapeHost(ctx, group)
	}
}

// dockerStatsJSON is the fields we parse from `docker stats --no-stream --format {{json .}}`.
type dockerStatsJSON struct {
	Name     string `json:"Name"`
	CPUPerc  string `json:"CPUPerc"`  // "0.13%"
	MemUsage string `json:"MemUsage"` // "3.5MiB / 512MiB"
	NetIO    string `json:"NetIO"`    // "1.2kB / 800B"
}

type containerState struct {
	oom          bool
	restartCount int
	exitCode     int
}

const inspectMarker = "@@SM-INSPECT@@"

// scrapeHost samples every project container on one host in a single shell
// call: `docker stats` for all running containers, then one bulk `docker
// inspect` for the OOM/restart state, separated by a marker line.
func (ms *MetricsScraper) scrapeHost(ctx context.Context, group []db.Project) {
	runner := ms.engine.getRunner(ctx, &group[0])
	runCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	script := `docker stats --no-stream --format '{{json .}}' 2>/dev/null; echo '` + inspectMarker + `'; ` +
		`ids=$(docker ps -q --filter name=^sm-); [ -n "$ids" ] && docker inspect --format '{{.Name}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{.State.ExitCode}}' $ids 2>/dev/null; true`
	out, err := runner.RunShell(runCtx, script)
	if err != nil && len(out) == 0 {
		ms.log.Debug().Err(err).Str("host", runner.Host()).Msg("metrics probe failed")
		return
	}

	stats := map[string]dockerStatsJSON{}
	states := map[string]containerState{}
	inInspect := false
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if line == inspectMarker {
			inInspect = true
			continue
		}
		if !inInspect {
			var st dockerStatsJSON
			if json.Unmarshal([]byte(line), &st) == nil && st.Name != "" {
				stats[st.Name] = st
			}
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) != 4 {
			continue
		}
		rc, _ := strconv.Atoi(parts[2])
		ec, _ := strconv.Atoi(parts[3])
		states[strings.TrimPrefix(parts[0], "/")] = containerState{oom: parts[1] == "true", restartCount: rc, exitCode: ec}
	}

	for _, p := range group {
		name := fmt.Sprintf("sm-%s", p.ID[:8])
		if st, ok := stats[name]; ok {
			cpu := parseCPUPerc(st.CPUPerc)
			memMB, memLimitMB := parseMemUsage(st.MemUsage)
			rx, tx := parseNetIO(st.NetIO)
			if err := ms.db.InsertMetric(ctx, p.ID, cpu, memMB, memLimitMB, rx, tx); err != nil {
				ms.log.Debug().Err(err).Str("project", p.ID).Msg("insert metric failed")
			}
		}
		if cs, ok := states[name]; ok {
			ms.checkOOM(ctx, p, cs)
		}
	}
}

// checkOOM writes a visible log line when a container was OOM-killed since the
// last observation, so users understand why their app is crash-looping.
// Without this, an OOM'd app silently restarts and the user only sees
// "restarted N times" with no cause.
func (ms *MetricsScraper) checkOOM(ctx context.Context, p db.Project, cs containerState) {
	if !cs.oom && cs.exitCode != 137 {
		return
	}
	prev, _ := ms.oomSeen.Load(p.ID)
	prevCount, _ := prev.(int)
	if cs.restartCount <= prevCount {
		return
	}
	ms.oomSeen.Store(p.ID, cs.restartCount)
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
