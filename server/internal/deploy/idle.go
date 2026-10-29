package deploy

import (
	"context"
	"fmt"
	"net/http"
	"strings"
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
//   - only free-plan, HTTP-serving projects on platform hosts (local or a
//     platform worker such as France) are eligible (see
//     db.ListSleepEligibleProjects); paid and BYOC apps are never slept.
//   - every candidate must answer an HTTP probe right before it is slept, which
//     protects bots/workers (no HTTP listener → never slept, never stranded).
//   - nothing sleeps until the process has watched traffic for idleThreshold:
//     the in-memory activity map is empty after a restart, and remote projects'
//     DB timestamps only began reflecting proxy traffic with this change.
//   - remote hosts are stopped in one batched SSH per host per sweep (one SSH
//     per project is what overloaded France's sshd before).
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

	// Remote wakes pay an SSH round-trip before `docker start`, so they get a
	// little more headroom than wakeTimeout's HTTP wait.
	wakeSSHTimeout = 15 * time.Second
	// Cap on containers stopped per host per sweep, so the first sweep after
	// rollout (dozens of idle apps) is spread over a few minutes.
	sleepBatchMax = 20
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
	startedAt     time.Time            // process start; gates the first sleeps
}

func newIdleManager() *idleManager {
	return &idleManager{
		lastSeen:      make(map[string]time.Time),
		lastPersisted: make(map[string]time.Time),
		sleeping:      make(map[string]bool),
		wakeLocks:     make(map[string]*sync.Mutex),
		rebuilding:    make(map[string]bool),
		lastRebuild:   make(map[string]time.Time),
		startedAt:     time.Now(),
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

	ctx, cancel := context.WithTimeout(context.Background(), wakeTimeout+wakeSSHTimeout)
	defer cancel()

	// Start the container wherever it lives: locally, or over SSH on the
	// platform worker that hosts it.
	runner := NewLocalRunner()
	if p, err := e.db.GetProject(ctx, projectID); err == nil && p != nil {
		runner = e.getRunner(ctx, p)
	}
	if out, err := runner.Run(ctx, "docker", "start", name); err != nil {
		// If the container is simply gone, `docker start` can never succeed and
		// the project would 503 forever. Rebuild it from its recorded source
		// instead — off the request path, since a build takes minutes.
		if !containerExists(ctx, runner, name) {
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
	url := fmt.Sprintf("http://%s:%d/", runner.Host(), port)
	probe := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(wakeTimeout)
	for time.Now().Before(deadline) {
		resp, err := probe.Get(url)
		if err == nil {
			resp.Body.Close()
			e.idle.setSleeping(projectID, false)
			e.NoteRequest(projectID)
			took := time.Since(deadline.Add(-wakeTimeout)).Round(100 * time.Millisecond)
			go func() {
				c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = e.db.SetProjectSleeping(c, projectID, false)
				e.db.AddDeployLog(c, projectID, fmt.Sprintf("Woke up for an incoming request (ready in %s).", took), "event")
			}()
			e.log.Info().Str("project", projectID).Bool("remote", runner.IsRemote()).Msg("woke idle project")
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
	// Until the process has watched traffic for a full idle window, an empty
	// lastSeen map means "unknown", not "idle".
	if time.Since(e.idle.startedAt) < idleThreshold {
		return
	}
	mins := int(idleThreshold / time.Minute)
	candidates, err := e.db.ListSleepEligibleProjects(ctx, mins)
	if err != nil {
		e.log.Error().Err(err).Msg("idle sweeper: list candidates failed")
		return
	}
	now := time.Now()
	byServer := map[string][]db.SleepCandidate{} // "" = local host
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
		key := c.WorkerServerID
		if c.ServerHost == "" {
			key = ""
		}
		if len(byServer[key]) >= sleepBatchMax {
			continue // picked up by a later sweep
		}
		// Only sleep what actually answers HTTP: a background worker or polling
		// bot has no HTTP listener, so the probe fails and it keeps running. An
		// app that DOES answer HTTP can be slept because a request will wake it.
		// This also covers apps whose last_request_at was only ever set by a
		// deploy, not by real traffic.
		host := c.ServerHost
		if host == "" {
			host = "127.0.0.1"
		}
		if !e.respondsHTTP(host, c.ContainerPort) {
			continue
		}
		if c.NeverVisited {
			e.log.Info().Str("project", c.ID).Msg("sleeping never-visited app (passed HTTP probe, 24h+ no traffic)")
		}
		byServer[key] = append(byServer[key], c)
	}
	for key, group := range byServer {
		runner, err := e.sleepRunner(ctx, key)
		if err != nil {
			e.log.Warn().Err(err).Str("server", key).Msg("idle sweeper: no runner for host")
			continue
		}
		e.sleepBatch(ctx, runner, group)
	}
}

// sleepRunner returns the runner for a platform host ("" = local). It refuses
// BYOC servers outright — those are customers' machines, never slept by us.
func (e *Engine) sleepRunner(ctx context.Context, serverID string) (*Runner, error) {
	if serverID == "" {
		return NewLocalRunner(), nil
	}
	srv, err := e.db.GetWorkerServer(ctx, serverID)
	if err != nil || srv == nil {
		return nil, fmt.Errorf("server %s not found", serverID)
	}
	if srv.UserID != nil {
		return nil, fmt.Errorf("server %s is BYOC", srv.Label)
	}
	if srv.IsLocal || srv.Host == "localhost" || srv.Host == "127.0.0.1" || srv.Host == "" {
		return NewLocalRunner(), nil
	}
	return NewRemoteRunner(srv), nil
}

// respondsHTTP reports whether something answers HTTP on host:port.
// Any HTTP response (even 404/500) counts — it proves an HTTP server is there.
// A connection error (worker/bot with no HTTP listener) returns false.
func (e *Engine) respondsHTTP(host string, port int) bool {
	if port <= 0 {
		return false
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://%s:%d/", host, port))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}

// sleepBatch stops a host's idle containers (kept for a fast `docker start`
// wake) in ONE command — one SSH for a remote host — and marks the ones that
// actually stopped as asleep. `docker stop` stops its arguments in parallel and
// prints each name it stopped, so a single failure doesn't lose the rest.
func (e *Engine) sleepBatch(ctx context.Context, runner *Runner, cands []db.SleepCandidate) {
	byName := map[string]db.SleepCandidate{}
	names := make([]string, 0, len(cands))
	for _, c := range cands {
		if c.ContainerName == "" {
			continue
		}
		byName[c.ContainerName] = c
		names = append(names, shellQuote(c.ContainerName))
	}
	if len(names) == 0 {
		return
	}
	// Mark asleep BEFORE stopping. `docker stop` takes up to -t seconds, and the
	// crash sweeper treats an exited container that isn't marked asleep as a
	// crash — marking afterwards let it flag (and take offline) healthy apps that
	// were merely being slept. Undone below for anything that didn't stop.
	for _, c := range byName {
		e.idle.setSleeping(c.ID, true)
	}
	stopCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	out, err := runner.RunShell(stopCtx, "docker stop -t 5 "+strings.Join(names, " ")+" 2>/dev/null; true")
	if err != nil {
		for _, c := range byName {
			e.idle.setSleeping(c.ID, false)
		}
		e.log.Warn().Err(err).Str("host", runner.Host()).Msg("idle sweeper: batch docker stop failed")
		return
	}
	slept := 0
	for _, line := range strings.Split(string(out), "\n") {
		c, ok := byName[strings.TrimSpace(line)]
		if !ok {
			continue
		}
		delete(byName, c.ContainerName) // count each once
		if err := e.db.SetProjectSleeping(ctx, c.ID, true); err != nil {
			e.log.Error().Err(err).Str("project", c.ID).Msg("idle sweeper: mark sleeping failed")
		}
		// Recorded in the project's logs so a stopped container is never a
		// mystery to its owner (it used to show only in our server journal).
		e.db.AddDeployLog(ctx, c.ID, fmt.Sprintf("Asleep — no traffic for %d minutes. The next visit wakes it automatically (usually a few seconds).", int(idleThreshold/time.Minute)), "event")
		slept++
	}
	// Whatever is left in byName didn't stop — it's still running, not asleep.
	for _, c := range byName {
		e.idle.setSleeping(c.ID, false)
	}
	if slept > 0 {
		e.log.Info().Int("count", slept).Str("host", runner.Host()).Msg("slept idle projects")
	}
}

// sleepProject sleeps a single project on whichever platform host runs it.
func (e *Engine) sleepProject(ctx context.Context, c db.SleepCandidate) {
	runner, err := e.sleepRunner(ctx, c.WorkerServerID)
	if err != nil {
		e.log.Warn().Err(err).Str("project", c.ID).Msg("sleep: no runner")
		return
	}
	e.sleepBatch(ctx, runner, []db.SleepCandidate{c})
}

// ForceSleep is an explicit admin action: sleep a specific platform project
// now, bypassing the eligibility rules (plan/traffic/admin checks). Used from
// the admin console to observe or manually reclaim. Never BYOC.
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
		if srv, _ := e.db.GetWorkerServer(ctx, p.WorkerServerID); srv != nil && srv.UserID != nil {
			return fmt.Errorf("force sleep is not supported for BYOC servers")
		}
	}
	if len(p.ID) < 8 {
		return fmt.Errorf("invalid project")
	}
	e.sleepProject(ctx, db.SleepCandidate{ID: p.ID, ContainerName: "sm-" + p.ID[:8], ContainerPort: p.ContainerPort, WorkerServerID: p.WorkerServerID})
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

// IsProjectSleeping reports whether a project is currently idle-slept.
func (e *Engine) IsProjectSleeping(projectID string) bool {
	return e.idle != nil && e.idle.isSleeping(projectID)
}
