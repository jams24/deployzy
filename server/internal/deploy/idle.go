package deploy

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/serverme/serverme/server/internal/db"
)

// Idle sleep/wake for free-tier apps ("scale to zero", Railway/Heroku style).
//
// The idea: most free apps sit idle. If an eligible app receives no HTTP traffic
// for idleThreshold, the sweeper stops its container (kept, not removed) to free
// real CPU/RAM. The next request that hits the proxy wakes it with `docker
// start` and waits for its port to accept connections before forwarding.
//
// Safety rails, by construction:
//   - only free-plan, platform-local, HTTP-serving projects are eligible
//     (see db.ListSleepEligibleProjects); paid/BYOC/worker apps are never slept.
//   - a project with no last_request_at (never received HTTP) is never slept,
//     which protects bots/workers.
//   - RAM is never overcommitted; this only stops idle containers.
//   - state (sleeping flag) is persisted, so a restart rehydrates correctly.

const (
	idleThreshold = 30 * time.Minute // no requests for this long → sleep
	sweepInterval = 60 * time.Second // how often the sweeper runs
	wakeTimeout   = 20 * time.Second // max time to wait for a woken container
	touchThrottle = 60 * time.Second // min gap between DB last_request_at writes

	// A wake can find the container gone entirely (pruned, or removed by a
	// failed redeploy). `docker start` can never recover from that, so we
	// rebuild from the project's recorded source instead. Builds are slow and
	// can fail permanently (deleted/private repo), so they run off the request
	// path and are rate-limited per project.
	rebuildTimeout  = 15 * time.Minute // max time for a wake-triggered rebuild
	rebuildCooldown = 2 * time.Minute  // min gap between rebuild attempts per project
)

// idleManager tracks per-project activity and sleep state in memory. All maps
// are guarded by mu. Wake serialization uses per-project mutexes in wakeLocks.
type idleManager struct {
	mu            sync.RWMutex
	lastSeen      map[string]time.Time // projectID → last forwarded request
	lastPersisted map[string]time.Time // projectID → last DB touch
	sleeping      map[string]bool      // projectID → container is stopped for idleness
	wakeLocks     map[string]*sync.Mutex
	rebuilding    map[string]bool      // projectID → a wake-triggered rebuild is in flight
	lastRebuild   map[string]time.Time // projectID → last rebuild attempt (cooldown)
}

func newIdleManager() *idleManager {
	return &idleManager{
		lastSeen:      make(map[string]time.Time),
		lastPersisted: make(map[string]time.Time),
		sleeping:      make(map[string]bool),
		wakeLocks:     make(map[string]*sync.Mutex),
		rebuilding:    make(map[string]bool),
		lastRebuild:   make(map[string]time.Time),
	}
}

func (m *idleManager) isSleeping(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sleeping[id]
}

func (m *idleManager) setSleeping(id string, v bool) {
	m.mu.Lock()
	m.sleeping[id] = v
	m.mu.Unlock()
}

// tryStartRebuild claims the right to rebuild a project, returning false if one
// is already in flight or the last attempt was too recent. The cooldown stops a
// project whose repo is gone from triggering a build on every single request.
func (m *idleManager) tryStartRebuild(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rebuilding[id] {
		return false
	}
	if last, ok := m.lastRebuild[id]; ok && time.Since(last) < rebuildCooldown {
		return false
	}
	m.rebuilding[id] = true
	m.lastRebuild[id] = time.Now()
	return true
}

func (m *idleManager) finishRebuild(id string) {
	m.mu.Lock()
	delete(m.rebuilding, id)
	m.mu.Unlock()
}

func (m *idleManager) wakeLock(id string) *sync.Mutex {
	m.mu.Lock()
	defer m.mu.Unlock()
	l := m.wakeLocks[id]
	if l == nil {
		l = &sync.Mutex{}
		m.wakeLocks[id] = l
	}
	return l
}

// NoteRequest records activity for a project and, throttled, persists it so the
// idle decision survives a restart. Cheap enough for the hot path: a map write
// plus an occasional async DB update.
func (e *Engine) NoteRequest(projectID string) {
	if projectID == "" {
		return
	}
	now := time.Now()
	m := e.idle
	m.mu.Lock()
	m.lastSeen[projectID] = now
	needPersist := now.Sub(m.lastPersisted[projectID]) > touchThrottle
	if needPersist {
		m.lastPersisted[projectID] = now
	}
	m.mu.Unlock()
	if needPersist {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = e.db.TouchProjectRequest(ctx, projectID)
		}()
	}
}

// WakeIfSleeping starts a project's container if it was slept for idleness, and
// blocks until its port accepts connections (or wakeTimeout). It's a no-op fast
// path when the project isn't sleeping. Concurrent requests for the same project
// are serialized so only one `docker start` runs. port is the container's mapped
// host port (already known to the proxy).
func (e *Engine) WakeIfSleeping(projectID string, port int) error {
	if projectID == "" || !e.idle.isSleeping(projectID) {
		return nil
	}
	lock := e.idle.wakeLock(projectID)
	lock.Lock()
	defer lock.Unlock()

	// Re-check under the lock: another request may have already woken it.
	if !e.idle.isSleeping(projectID) {
		return nil
	}
	if len(projectID) < 8 {
		return fmt.Errorf("invalid project id")
	}
	name := "sm-" + projectID[:8]

	ctx, cancel := context.WithTimeout(context.Background(), wakeTimeout)
	defer cancel()

	local := NewLocalRunner()
	if out, err := local.Run(ctx, "docker", "start", name); err != nil {
		// If the container is simply gone, `docker start` can never succeed and
		// the project would 503 forever. Rebuild it from its recorded source
		// instead — off the request path, since a build takes minutes.
		if !containerExists(ctx, local, name) {
			if e.idle.tryStartRebuild(projectID) {
				e.log.Warn().Str("project", projectID).Str("container", name).
					Msg("wake: container missing — rebuilding from source")
				go e.rebuildMissingContainer(projectID, name)
			}
			return fmt.Errorf("app is rebuilding, please retry shortly")
		}
		e.log.Error().Err(err).Str("project", projectID).Str("out", trimLogs(string(out), 300)).Msg("wake: docker start failed")
		return fmt.Errorf("failed to wake container")
	}

	// Wait until the app actually answers HTTP. A bare TCP dial is NOT enough:
	// Docker's userland port proxy accepts connections on the mapped host port
	// the instant `docker start` returns — before the app inside has bound — so
	// forwarding then would 502. Any HTTP response (even 404/500) means the app
	// is serving; a connection error means it's still booting.
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	probe := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(wakeTimeout)
	for time.Now().Before(deadline) {
		resp, err := probe.Get(url)
		if err == nil {
			resp.Body.Close()
			e.idle.setSleeping(projectID, false)
			e.NoteRequest(projectID)
			go func() {
				c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = e.db.SetProjectSleeping(c, projectID, false)
			}()
			e.log.Info().Str("project", projectID).Msg("woke idle project")
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	// Port never came up. Leave the flag set so a later request retries; the
	// container is started, so worst case it's just slow to boot.
	e.log.Warn().Str("project", projectID).Int("port", port).Msg("wake: port did not come up in time")
	return fmt.Errorf("app is starting, please retry")
}

// StartIdleSweeper rehydrates the sleeping set from the DB, then runs a periodic
// sweep that sleeps eligible idle projects. Non-blocking; returns immediately.
func (e *Engine) StartIdleSweeper(ctx context.Context) {
	if ids, err := e.db.ListSleepingProjectIDs(ctx); err == nil {
		e.idle.mu.Lock()
		for _, id := range ids {
			e.idle.sleeping[id] = true
		}
		e.idle.mu.Unlock()
		if len(ids) > 0 {
			e.log.Info().Int("count", len(ids)).Msg("idle sweeper: rehydrated sleeping projects")
		}
	}
	go func() {
		t := time.NewTicker(sweepInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				e.sweepIdle(ctx)
			}
		}
	}()
	e.log.Info().Dur("idle_after", idleThreshold).Msg("idle sweeper started")
}

// sweepIdle stops eligible projects that have been idle past the threshold.
func (e *Engine) sweepIdle(ctx context.Context) {
	mins := int(idleThreshold / time.Minute)
	candidates, err := e.db.ListSleepEligibleProjects(ctx, mins)
	if err != nil {
		e.log.Error().Err(err).Msg("idle sweeper: list candidates failed")
		return
	}
	now := time.Now()
	for _, c := range candidates {
		// Double-check in-memory activity: the DB last_request_at is only written
		// throttled, so a project could have been active more recently than the DB
		// shows. Never sleep something seen within the idle window.
		e.idle.mu.RLock()
		last, seen := e.idle.lastSeen[c.ID]
		asleep := e.idle.sleeping[c.ID]
		e.idle.mu.RUnlock()
		if asleep {
			continue
		}
		if seen && now.Sub(last) < idleThreshold {
			continue
		}
		// Never-visited apps: only sleep them if they actually answer HTTP. This
		// is the safety gate — a background worker or Telegram bot doesn't serve
		// HTTP, so the probe fails and we leave it running. An app that DOES
		// answer HTTP can be safely slept because a future request will wake it.
		if c.NeverVisited {
			if !e.respondsHTTP(c.ContainerPort) {
				continue
			}
			e.log.Info().Str("project", c.ID).Msg("sleeping never-visited app (passed HTTP probe, 24h+ no traffic)")
		}
		e.sleepProject(ctx, c)
	}
}

// respondsHTTP reports whether something answers HTTP on the given local port.
// Any HTTP response (even 404/500) counts — it proves an HTTP server is there.
// A connection error (worker/bot with no HTTP listener) returns false.
func (e *Engine) respondsHTTP(port int) bool {
	if port <= 0 {
		return false
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}

// sleepProject stops a project's container (kept for a fast `docker start` wake)
// and marks it asleep. Platform-local only — the sweeper's candidate query
// already excludes remote/BYOC hosts.
func (e *Engine) sleepProject(ctx context.Context, c db.SleepCandidate) {
	if c.ContainerName == "" {
		return
	}
	local := NewLocalRunner()
	if out, err := local.Run(ctx, "docker", "stop", "-t", "5", c.ContainerName); err != nil {
		e.log.Warn().Err(err).Str("project", c.ID).Str("out", trimLogs(string(out), 200)).Msg("idle sweeper: docker stop failed")
		return
	}
	e.idle.setSleeping(c.ID, true)
	if err := e.db.SetProjectSleeping(ctx, c.ID, true); err != nil {
		e.log.Error().Err(err).Str("project", c.ID).Msg("idle sweeper: mark sleeping failed")
	}
	e.log.Info().Str("project", c.ID).Msg("slept idle project")
}

// ForceSleep is an explicit admin action: sleep a specific platform-local
// project now, bypassing the eligibility rules (plan/traffic/admin checks). Used
// from the admin console to observe or manually reclaim. Local-only — remote
// (BYOC) projects can't be managed by the local docker path.
func (e *Engine) ForceSleep(ctx context.Context, projectID string) error {
	p, err := e.db.GetProject(ctx, projectID)
	if err != nil || p == nil {
		return fmt.Errorf("project not found")
	}
	if p.Status != "running" {
		return fmt.Errorf("project is not running")
	}
	if e.idle.isSleeping(projectID) {
		return nil // already asleep
	}
	if p.WorkerServerID != "" {
		if srv, _ := e.db.GetWorkerServer(ctx, p.WorkerServerID); srv != nil && !srv.IsLocal {
			return fmt.Errorf("force sleep is only supported for platform-local projects")
		}
	}
	if len(p.ID) < 8 {
		return fmt.Errorf("invalid project")
	}
	e.sleepProject(ctx, db.SleepCandidate{ID: p.ID, ContainerName: "sm-" + p.ID[:8], ContainerPort: p.ContainerPort})
	if !e.idle.isSleeping(projectID) {
		return fmt.Errorf("failed to sleep the container")
	}
	return nil
}

// ForceWake is an explicit admin action: wake a slept project now.
func (e *Engine) ForceWake(ctx context.Context, projectID string) error {
	p, err := e.db.GetProject(ctx, projectID)
	if err != nil || p == nil {
		return fmt.Errorf("project not found")
	}
	if !e.idle.isSleeping(projectID) {
		return nil // already awake
	}
	return e.WakeIfSleeping(projectID, p.ContainerPort)
}

// containerExists reports whether a container with this name is known to Docker
// (in any state). Used to tell "stopped container failed to start" apart from
// "container no longer exists", which need different recovery.
func containerExists(ctx context.Context, r *Runner, name string) bool {
	_, err := r.Run(ctx, "docker", "inspect", "--type", "container", name)
	return err == nil
}

// rebuildMissingContainer redeploys a sleeping project whose container has
// disappeared. Runs in its own goroutine off the request path; the caller has
// already claimed the rebuild slot via tryStartRebuild.
func (e *Engine) rebuildMissingContainer(projectID, name string) {
	defer e.idle.finishRebuild(projectID)

	ctx, cancel := context.WithTimeout(context.Background(), rebuildTimeout)
	defer cancel()

	p, err := e.db.GetProject(ctx, projectID)
	if err != nil || p == nil {
		e.log.Error().Err(err).Str("project", projectID).Msg("wake rebuild: project not found")
		return
	}
	if err := e.Deploy(ctx, p); err != nil {
		// Leave the sleeping flag set so a later request retries after the
		// cooldown; a permanently broken source (deleted or private repo) will
		// keep failing here rather than spinning.
		e.log.Error().Err(err).Str("project", projectID).Str("container", name).
			Msg("wake rebuild: deploy failed")
		return
	}

	e.idle.setSleeping(projectID, false)
	if err := e.db.SetProjectSleeping(ctx, projectID, false); err != nil {
		e.log.Error().Err(err).Str("project", projectID).Msg("wake rebuild: clear sleeping flag failed")
	}
	e.log.Info().Str("project", projectID).Str("container", name).Msg("wake rebuild: project restored")
}
