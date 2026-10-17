package deploy

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/serverme/serverme/server/internal/db"
)

// Proxy-node abuse detection.
//
// Free hosting gets farmed for VPN/proxy nodes with public "argo" kits
// (nodejs-argo and friends): an app that serves a decoy page while running a
// cloudflared tunnel, an Xray/V2Ray/sing-box proxy, and often a Nezha
// monitoring agent — each from a randomly named binary in a hidden dir
// (.tmp/xyjlbr, /tmp/.npm/kebkxm) to dodge name-based checks. Their traffic
// leaves via the tunnel, so it never touches our proxy or bandwidth meter.
// (2026-10-17: 37 such free projects found, a third of France's workload.)
//
// Three layers, cheapest first:
//   - egress: the host firewall drops cloudflared's edge port (7844) for
//     non-paid containers (see smtp_egress.go), which kills the tunnel.
//   - deploy: proxyKitGuard refuses source/env that carry the kits' config
//     knobs, before anything is built.
//   - runtime: StartAbuseScanner looks at running processes on every platform
//     host (one command per host) and files an Abuse Report per hit. By default
//     an admin reviews and acts; with app_settings abuse_auto_suspend=true,
//     high-confidence hits on FREE accounts are suspended automatically.

// proxyKitEnvKeys are the configuration knobs the argo kits read. They're
// distinctive enough that a legitimate app essentially never has them.
// HY2/TUIC/REALITY/S5 are the sing-box variant's per-protocol ports.
var proxyKitEnvKeys = []string{"NEZHA_SERVER", "NEZHA_KEY", "NEZHA_PORT", "ARGO_AUTH", "ARGO_DOMAIN", "ARGO_PORT",
	"HY2_PORT", "TUIC_PORT", "REALITY_PORT", "S5_PORT"}

// proxyBinarySigs are Go module paths compiled into proxy/tunnel binaries.
// They survive renaming (kits use random names like .tmp/xyjlbr) and can be
// read from /proc/<pid>/exe even after the kit deletes the file on disk.
const proxyBinarySigs = `github.com/xtls/xray-core|github.com/v2fly/v2ray-core|github.com/sagernet/sing-box|github.com/apernet/hysteria|github.com/cloudflare/cloudflared|github.com/nezhahq/agent|github.com/go-gost/|github.com/ginuerzh/gost`

// proxyKitProcPattern matches process command lines of the kit's components.
const proxyKitProcPattern = `edge-ip-version|tunnel .*run --token|xray|v2ray|sing-box|hysteria|nezha|-s [a-z0-9.-]+:443 -p `

const (
	abuseScanFirstDelay = 10 * time.Minute
	abuseScanInterval   = 6 * time.Hour
	abuseCategoryProxy  = "proxy-node"
)

// proxyKitGuard rejects a deploy whose env vars or source carry argo-kit
// configuration. Applies on platform hosts only (BYOC owners run what they
// like on their own box) and never to admins. Fails open on lookup errors —
// the egress block and runtime scanner still apply.
func (e *Engine) proxyKitGuard(ctx context.Context, runner *Runner, project *db.Project, buildCtx string) error {
	if isAdmin, _ := e.db.IsUserAdmin(ctx, project.UserID); isAdmin {
		return nil
	}
	if project.WorkerServerID != "" {
		if srv, _ := e.db.GetWorkerServer(ctx, project.WorkerServerID); srv != nil && srv.UserID != nil {
			return nil
		}
	}
	hit := ""
	for _, k := range proxyKitEnvKeys {
		if _, ok := project.EnvVars[k]; ok {
			hit = "environment variable " + k
			break
		}
	}
	if hit == "" && buildCtx != "" {
		out, _ := runner.RunShell(ctx, fmt.Sprintf(
			`grep -rIlE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.venv -m1 '%s' %s 2>/dev/null | head -1; true`,
			strings.Join(proxyKitEnvKeys, "|"), shellQuote(buildCtx)))
		if f := strings.TrimSpace(string(out)); f != "" {
			hit = "file " + strings.TrimPrefix(strings.TrimPrefix(f, buildCtx), "/")
		}
	}
	if hit == "" && buildCtx != "" {
		// Proxy binaries committed into the repo/upload. Only large files are
		// candidates (Go binaries are several MB), which keeps this cheap.
		out, _ := runner.RunShell(ctx, fmt.Sprintf(
			`find %s -type f -size +1M -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -50 | while read -r f; do m=$(grep -aoE -m1 '%s' "$f" 2>/dev/null | head -1); [ -n "$m" ] && { echo "$f|$m"; break; }; done; true`,
			shellQuote(buildCtx), proxyBinarySigs))
		if line := strings.TrimSpace(string(out)); line != "" {
			f, sig, _ := strings.Cut(line, "|")
			hit = fmt.Sprintf("binary %s (%s)", strings.TrimPrefix(strings.TrimPrefix(f, buildCtx), "/"), strings.TrimPrefix(sig, "github.com/"))
		}
	}
	if hit == "" {
		return nil
	}
	e.log.Warn().Str("project", project.ID).Str("match", hit).Msg("blocked proxy-node kit deploy")
	e.fileProxyAbuseReport(ctx, project, "Deploy blocked: argo/proxy kit configuration found ("+hit+").")
	e.logMsg(ctx, project.ID, "Deploy blocked: this project looks like a VPN/proxy node (argo/Nezha kit). Running proxies or tunnels isn't allowed on Deployzy's shared servers. If you believe this is a mistake, contact support@deployzy.com.", "error")
	return fmt.Errorf("deploy blocked: proxy-node kit detected (%s)", hit)
}

// StartAbuseScanner scans running containers on every platform host for
// proxy-node processes, shortly after startup and then every few hours.
func (e *Engine) StartAbuseScanner(ctx context.Context) {
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(abuseScanFirstDelay):
		}
		e.scanProxyAbuse(ctx)
		t := time.NewTicker(abuseScanInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				e.scanProxyAbuse(ctx)
			}
		}
	}()
}

// proxyScanScript lists "SMHIT <container>|<signatures>" for every app
// container with a matching process. Two signals per container:
//   - command lines matching proxyKitProcPattern
//   - "bin:<module>" for any process whose executable embeds a proxy module
//     path. System executables (/usr, /bin, /sbin, /lib) are skipped unless
//     deleted, so node/python/sh aren't read; kit binaries live in app or
//     hidden dirs and are usually deleted after launch.
//
// `docker top` requires a pid column.
var proxyScanScript = `for c in $(docker ps -q --filter name=^sm-); do ` +
	`pids=$(docker top "$c" -eo pid 2>/dev/null | tail -n +2); ` +
	`m=$(docker top "$c" -eo pid,args 2>/dev/null | grep -oE '` + proxyKitProcPattern + `' | sort -u | tr '\n' ','); ` +
	`for p in $pids; do x=$(readlink /proc/$p/exe 2>/dev/null) || continue; ` +
	`case "$x" in *deleted*) ;; /usr/*|/bin/*|/sbin/*|/lib/*) continue ;; esac; ` +
	`b=$(grep -aoE -m1 '` + proxyBinarySigs + `' /proc/$p/exe 2>/dev/null | head -1); ` +
	`[ -n "$b" ] && m="${m}bin:${b#github.com/},"; done; ` +
	`[ -n "$m" ] && echo "SMHIT $(docker inspect --format '{{.Name}}' "$c")|$m"; done; true`

// AbuseScanStatus is what the admin console shows about the scanner.
type AbuseScanStatus struct {
	Running       bool       `json:"running"`
	LastStarted   *time.Time `json:"last_started,omitempty"`
	LastFinished  *time.Time `json:"last_finished,omitempty"`
	Hosts         int        `json:"hosts"`
	Hits          int        `json:"hits"`           // containers that matched
	NewReports    int        `json:"new_reports"`    // reports filed this run
	AutoSuspended int        `json:"auto_suspended"` // suspended this run
	NextRunAt     *time.Time `json:"next_run_at,omitempty"`
}

var (
	abuseScanMu    sync.Mutex
	abuseScanState AbuseScanStatus
)

// AbuseScanState returns a snapshot of the scanner's last/current run.
func (e *Engine) AbuseScanState() AbuseScanStatus {
	abuseScanMu.Lock()
	defer abuseScanMu.Unlock()
	return abuseScanState
}

// ScanProxyAbuseNow starts a scan in the background unless one is running.
// Returns false when a scan was already in progress.
func (e *Engine) ScanProxyAbuseNow() bool {
	abuseScanMu.Lock()
	running := abuseScanState.Running
	abuseScanMu.Unlock()
	if running {
		return false
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		e.scanProxyAbuse(ctx)
	}()
	return true
}

// AbuseAutoSuspendSetting is the app_settings key for automatic suspension.
const AbuseAutoSuspendSetting = "abuse_auto_suspend"

// highConfidenceProxy reports whether a hit is certain enough to act on
// without a human: a proxy core or Nezha agent identified by its compiled-in
// module path. A bare cloudflared tunnel is NOT enough (legit apps use it).
func highConfidenceProxy(signatures string) bool {
	for _, sig := range []string{"bin:xtls/xray-core", "bin:v2fly/v2ray-core", "bin:sagernet/sing-box", "bin:apernet/hysteria", "bin:nezhahq/agent"} {
		if strings.Contains(signatures, sig) {
			return true
		}
	}
	return false
}

func (e *Engine) scanProxyAbuse(ctx context.Context) {
	abuseScanMu.Lock()
	if abuseScanState.Running {
		abuseScanMu.Unlock()
		return
	}
	now := time.Now()
	abuseScanState = AbuseScanStatus{Running: true, LastStarted: &now, LastFinished: abuseScanState.LastFinished}
	abuseScanMu.Unlock()

	hosts, hits, filed, suspended := 0, 0, 0, 0
	defer func() {
		done := time.Now()
		next := done.Add(abuseScanInterval)
		abuseScanMu.Lock()
		abuseScanState.Running = false
		abuseScanState.LastFinished = &done
		abuseScanState.NextRunAt = &next
		abuseScanState.Hosts, abuseScanState.Hits = hosts, hits
		abuseScanState.NewReports, abuseScanState.AutoSuspended = filed, suspended
		abuseScanMu.Unlock()
	}()

	autoSuspend := false
	if v, _ := e.db.GetSetting(ctx, AbuseAutoSuspendSetting); v == "true" {
		autoSuspend = true
	}

	runners := []*Runner{NewLocalRunner()}
	servers, err := e.db.ListWorkerServers(ctx, nil)
	if err == nil {
		for i := range servers {
			s := servers[i]
			if s.UserID != nil || s.Status != "active" || s.IsLocal || s.Host == "localhost" || s.Host == "127.0.0.1" || s.Host == "" {
				continue
			}
			if full, err := e.db.GetWorkerServer(ctx, s.ID); err == nil && full != nil {
				runners = append(runners, NewRemoteRunner(full))
			}
		}
	}
	hosts = len(runners)
	for _, r := range runners {
		scanCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		out, err := r.RunShell(scanCtx, proxyScanScript)
		cancel()
		if err != nil {
			e.log.Warn().Err(err).Str("host", r.Host()).Msg("abuse scan failed")
			continue
		}
		for _, hit := range parseProxyScan(string(out)) {
			p := e.projectByShortID(ctx, hit.id8)
			if p == nil {
				continue
			}
			if isAdmin, _ := e.db.IsUserAdmin(ctx, p.UserID); isAdmin {
				continue
			}
			full, err := e.db.GetProject(ctx, p.ID)
			if err != nil || full == nil {
				continue
			}
			hits++
			details := "Running processes match a VPN/proxy-node kit: " + hit.signatures + " (host " + r.Host() + ")."
			if autoSuspend && highConfidenceProxy(hit.signatures) && e.autoSuspendProxy(ctx, full, details) {
				suspended++
				filed++
				continue
			}
			if e.fileProxyAbuseReport(ctx, full, details) {
				filed++
			}
		}
	}
	e.log.Info().Int("hosts", hosts).Int("hits", hits).Int("new_reports", filed).Int("auto_suspended", suspended).Msg("proxy-node abuse scan done")
}

// autoSuspendProxy blocks a FREE owner and stops the project, recording an
// actioned report. Paid owners are never auto-suspended — they get a report
// for a human to review. Returns true when it acted.
func (e *Engine) autoSuspendProxy(ctx context.Context, p *db.Project, details string) bool {
	u, err := e.db.GetUserByID(ctx, p.UserID)
	if err != nil || u == nil || (u.Plan != "" && u.Plan != "free") {
		return false
	}
	if err := e.db.SetUserBlocked(ctx, p.UserID, true, "Running a VPN/proxy node (auto-detected) - prohibited use of free hosting"); err != nil {
		e.log.Error().Err(err).Str("project", p.ID).Msg("auto-suspend: block owner failed")
		return false
	}
	if err := e.Stop(ctx, p); err != nil {
		e.log.Warn().Err(err).Str("project", p.ID).Msg("auto-suspend: stop failed (owner is blocked)")
	}
	target := fmt.Sprintf("https://%s.%s", p.Subdomain, e.AppDomain)
	if e.db.HasAbuseReport(ctx, target, abuseCategoryProxy) {
		_ = e.db.MarkAbuseReportsActioned(ctx, target, abuseCategoryProxy)
	} else {
		r := &db.AbuseReport{
			TargetURL: target, Category: abuseCategoryProxy, ReporterEmail: "scanner@deployzy.com", ReporterIP: "internal",
			Details: fmt.Sprintf("[auto-suspended] project %q (%s), owner %s. %s", p.Name, p.ID, u.Email, details),
		}
		if err := e.db.CreateAbuseReport(ctx, r); err == nil {
			_ = e.db.SetAbuseReportStatus(ctx, r.ID, "actioned")
		}
	}
	e.log.Warn().Str("project", p.ID).Str("owner", u.Email).Msg("auto-suspended proxy-node project")
	return true
}

type proxyHit struct{ id8, signatures string }

// parseProxyScan extracts main-app hits (sm-<8 hex>) from the scan output.
func parseProxyScan(out string) []proxyHit {
	var hits []proxyHit
	for _, line := range strings.Split(out, "\n") {
		rest, ok := strings.CutPrefix(strings.TrimSpace(line), "SMHIT ")
		if !ok {
			continue
		}
		name, sigs, _ := strings.Cut(rest, "|")
		name = strings.TrimPrefix(name, "/")
		id8 := strings.TrimPrefix(name, "sm-")
		if !strings.HasPrefix(name, "sm-") || strings.HasPrefix(name, "sm-svc-") || len(id8) != 8 {
			continue
		}
		hits = append(hits, proxyHit{id8: id8, signatures: strings.TrimSuffix(sigs, ",")})
	}
	return hits
}

// fileProxyAbuseReport records a proxy-node report for a project unless one is
// already open (or was actioned) for it. Returns true when a new one was filed.
func (e *Engine) fileProxyAbuseReport(ctx context.Context, p *db.Project, details string) bool {
	target := fmt.Sprintf("https://%s.%s", p.Subdomain, e.AppDomain)
	if e.db.HasAbuseReport(ctx, target, abuseCategoryProxy) {
		return false
	}
	owner := ""
	if u, err := e.db.GetUserByID(ctx, p.UserID); err == nil && u != nil {
		owner = u.Email
	}
	r := &db.AbuseReport{
		TargetURL:     target,
		Category:      abuseCategoryProxy,
		Details:       fmt.Sprintf("[auto-detected] project %q (%s), owner %s. %s", p.Name, p.ID, owner, details),
		ReporterEmail: "scanner@deployzy.com",
		ReporterIP:    "internal",
	}
	if err := e.db.CreateAbuseReport(ctx, r); err != nil {
		e.log.Error().Err(err).Str("project", p.ID).Msg("file proxy abuse report")
		return false
	}
	return true
}
