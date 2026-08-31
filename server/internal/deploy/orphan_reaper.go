package deploy

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// OrphanReaper detects Docker containers named `sm-*` that have no owning row
// in the database — the reverse of every other loop, which goes DB→container.
// An orphan can arise when a project/service is deleted while its host is
// unreachable (the DB row comes out but the container survives), or after a
// botched move. They consume RAM/CPU/disk invisibly until found.
//
// This is report-only by design: it never removes anything on its own. Removal
// is an explicit admin action (ReapOrphan) so a bug in the ownership query can
// never nuke a live customer container.

// OrphanContainer is a running/stopped sm-* container with no DB owner.
type OrphanContainer struct {
	ServerID    string `json:"server_id"`    // "" for the local platform host
	ServerLabel string `json:"server_label"` // human label of the host
	Host        string `json:"host"`         // IP/hostname of the host
	IsLocal     bool   `json:"is_local"`
	Name        string `json:"name"`  // container name (sm-…)
	State       string `json:"state"` // running | exited | created | …
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
}

// OrphanScan is the full result of a sweep: the orphans found plus the hosts we
// couldn't reach (so the admin knows the picture may be incomplete).
type OrphanScan struct {
	Orphans          []OrphanContainer `json:"orphans"`
	UnreachableHosts []string          `json:"unreachable_hosts"`
	HostsScanned     int               `json:"hosts_scanned"`
	ScannedAt        string            `json:"scanned_at"`
}

// expectedContainerNames builds the set of container names the platform knows
// about: sm-<id8> (+ the blue-green "-next" variant) for every project, and the
// container_name of every containerized service.
func (e *Engine) expectedContainerNames(ctx context.Context) (map[string]bool, error) {
	expected := map[string]bool{}
	ids, err := e.db.AllProjectIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("list project ids: %w", err)
	}
	for _, id := range ids {
		if len(id) < 8 {
			continue
		}
		base := "sm-" + id[:8]
		expected[base] = true
		expected[base+"-next"] = true // transient container during a deploy
	}
	names, err := e.db.AllServiceContainerNames(ctx)
	if err != nil {
		return nil, fmt.Errorf("list service container names: %w", err)
	}
	for _, n := range names {
		expected[n] = true
	}
	return expected, nil
}

// scanHosts returns the local host plus every active, reachable remote worker
// (platform pool + BYOC). Each entry pairs a runner with its server metadata.
type scanHost struct {
	runner   *Runner
	serverID string
	label    string
	host     string
	isLocal  bool
}

func (e *Engine) scanHosts(ctx context.Context) []scanHost {
	hosts := []scanHost{{runner: NewLocalRunner(), serverID: "", label: "Deployzy platform", host: "127.0.0.1", isLocal: true}}

	servers, err := e.db.ListWorkerServers(ctx, nil)
	if err != nil {
		e.log.Warn().Err(err).Msg("orphan reaper: list worker servers failed")
		return hosts
	}
	for _, s := range servers {
		if s.IsLocal || s.Status != "active" {
			continue
		}
		if s.Host == "" || s.Host == "localhost" || s.Host == "127.0.0.1" {
			continue
		}
		// ListWorkerServers doesn't select SSH credentials — fetch the full row.
		full, err := e.db.GetWorkerServer(ctx, s.ID)
		if err != nil || full == nil {
			continue
		}
		hosts = append(hosts, scanHost{
			runner:   NewRemoteRunner(full),
			serverID: full.ID,
			label:    full.Label,
			host:     full.Host,
			isLocal:  false,
		})
	}
	return hosts
}

// FindOrphans sweeps every reachable host for sm-* containers with no DB owner.
func (e *Engine) FindOrphans(ctx context.Context) (*OrphanScan, error) {
	expected, err := e.expectedContainerNames(ctx)
	if err != nil {
		return nil, err
	}

	scan := &OrphanScan{ScannedAt: time.Now().UTC().Format(time.RFC3339)}
	for _, h := range e.scanHosts(ctx) {
		scan.HostsScanned++
		listCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		// Tab-separated so names/status with spaces stay parseable.
		out, err := h.runner.Run(listCtx,
			"docker", "ps", "-a", "--filter", "name=sm-", "--format",
			"{{.Names}}\t{{.State}}\t{{.Status}}\t{{.CreatedAt}}")
		cancel()
		if err != nil {
			scan.UnreachableHosts = append(scan.UnreachableHosts, h.label)
			e.log.Warn().Err(err).Str("host", h.label).Msg("orphan reaper: host unreachable")
			continue
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			parts := strings.SplitN(line, "\t", 4)
			name := parts[0]
			// Ignore anything that isn't ours, and anything the DB expects.
			if !strings.HasPrefix(name, "sm-") || expected[name] {
				continue
			}
			oc := OrphanContainer{
				ServerID: h.serverID, ServerLabel: h.label, Host: h.host, IsLocal: h.isLocal, Name: name,
			}
			if len(parts) > 1 {
				oc.State = parts[1]
			}
			if len(parts) > 2 {
				oc.Status = parts[2]
			}
			if len(parts) > 3 {
				oc.CreatedAt = parts[3]
			}
			scan.Orphans = append(scan.Orphans, oc)
		}
	}
	return scan, nil
}

// ReapOrphan force-removes a single orphan container on a specific host, after
// re-checking it really has no DB owner (guards against a race where the row
// was created between scan and reap). serverID "" means the local host.
func (e *Engine) ReapOrphan(ctx context.Context, serverID, name string) error {
	if !strings.HasPrefix(name, "sm-") {
		return fmt.Errorf("refusing to remove non-platform container %q", name)
	}
	expected, err := e.expectedContainerNames(ctx)
	if err != nil {
		return err
	}
	if expected[name] {
		return fmt.Errorf("%s is owned by an active project/service — not an orphan", name)
	}

	runner := NewLocalRunner()
	if serverID != "" {
		server, err := e.db.GetWorkerServer(ctx, serverID)
		if err != nil || server == nil {
			return fmt.Errorf("server not found")
		}
		if !server.IsLocal {
			runner = NewRemoteRunner(server)
		}
	}

	rmCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := runner.Exec(rmCtx, "docker", "rm", "-f", name); err != nil {
		return fmt.Errorf("docker rm failed on %s: %w", runner.Host(), err)
	}
	// Best-effort: drop the matching data volume if this was a service container.
	if strings.HasPrefix(name, "sm-svc-") {
		runner.Exec(rmCtx, "docker", "volume", "rm", name+"-data")
	}
	e.log.Info().Str("container", name).Str("server", serverID).Msg("orphan reaped by admin")
	return nil
}
