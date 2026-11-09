package deploy

import (
	"context"
	"fmt"
	"strconv"
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

// Script kits skip the binaries entirely: a VLESS server written in the app's
// own JavaScript or Python ("node-ws", FastAPI relays), served over WebSocket
// on the app's public port, with identifiers obfuscated so nothing says
// "vless" or "xray". What can't be renamed is the protocol: the handshake
// reads the client UUID from bytes 1..17 of the first frame and then dials the
// requested host over raw TCP. A file with that slice, a raw TCP dial, and a
// WebSocket server is a VLESS server; panels and ordinary WS apps have no
// reason to contain all three.
const (
	vlessUUIDSlice  = `slice\(1, ?17\)|subarray\(1, ?17\)|\[1:17\]`
	rawDialPattern  = `createConnection|net\.connect|open_connection|create_connection`
	appSourceFilter = `--include='*.js' --include='*.mjs' --include='*.cjs' --include='*.ts' --include='*.py' ` +
		`--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=dist --exclude-dir=.venv --exclude-dir=site-packages`
)

// vlessSourceCmd prints the first file under dir (a shell expression) that
// implements a VLESS-over-WebSocket server, or nothing.
func vlessSourceCmd(dir string) string {
	return `grep -rlsE ` + appSourceFilter + ` '` + vlessUUIDSlice + `' ` + dir + ` 2>/dev/null | head -5 | ` +
		`while IFS= read -r f; do grep -qE '` + rawDialPattern + `' "$f" && grep -qi websocket "$f" && { echo "$f"; break; }; done`
}

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
	hit := proxyKitEnvHit(project.EnvVars)
	if hit == "" && buildCtx != "" {
		// A file must carry at least two different kit keys: kits ship a
		// config block (NEZHA_SERVER + NEZHA_KEY + ARGO_DOMAIN …), while a
		// legit project that mentions one name in passing deploys normally.
		keys := strings.Join(proxyKitEnvKeys, "|")
		out, _ := runner.RunShell(ctx, fmt.Sprintf(
			`grep -rIlE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.venv '%s' %s 2>/dev/null | head -20 | while IFS= read -r f; do n=$(grep -oE '%s' "$f" 2>/dev/null | sort -u | wc -l); [ "$n" -ge 2 ] && { echo "$f"; break; }; done; true`,
			keys, shellQuote(buildCtx), keys))
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
	if hit == "" && buildCtx != "" {
		// VLESS server written in the app's own JS/Python (node-ws etc.).
		out, _ := runner.RunShell(ctx, vlessSourceCmd(shellQuote(buildCtx))+"; true")
		if f := strings.TrimSpace(string(out)); f != "" {
			hit = "VLESS server code in " + strings.TrimPrefix(strings.TrimPrefix(f, buildCtx), "/")
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

// proxyKitEnvHit flags env vars only kits set: one of the Nezha/Argo
// credentials, or two or more of the kit's port/config knobs together.
func proxyKitEnvHit(env map[string]string) string {
	var found []string
	for _, k := range proxyKitEnvKeys {
		if _, ok := env[k]; ok {
			if k == "NEZHA_SERVER" || k == "NEZHA_KEY" || k == "ARGO_AUTH" {
				return "environment variable " + k
			}
			found = append(found, k)
		}
	}
	if len(found) >= 2 {
		return "environment variables " + strings.Join(found, ", ")
	}
	return ""
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

// proxyScanScript prints one line per app container with a proxy-like process:
//
//	SMHIT <container>|<signatures>|<established conns>|<rx bytes>|<tx bytes>
//
// Signatures are command-line matches of proxyKitProcPattern plus
// "bin:<module>@<listen addrs>" for every process whose executable embeds a
// proxy module path, with the sockets that process listens on ("-" if none).
// The listen addresses are what tell a VPN server (a proxy core accepting
// connections) apart from a panel or an app that merely uses a proxy.
//
// Executables in system dirs (/usr, /bin, /sbin, /lib) are only read when
// their command line already looks like a proxy (e.g. /usr/local/bin/xray), so
// node/python aren't grepped; kit binaries live in app or hidden dirs and are
// usually deleted after launch. `docker top` requires a pid column.
var proxyScanScript = `for c in $(docker ps -q --filter name=^sm-); do ` +
	`pids=$(docker top "$c" -eo pid 2>/dev/null | tail -n +2); ` +
	`m=$(docker top "$c" -eo pid,args 2>/dev/null | grep -oE '` + proxyKitProcPattern + `' | sort -u | tr '\n' ','); ` +
	`b=""; lst=""; got=""; p0=""; ` +
	`for p in $pids; do x=$(readlink /proc/$p/exe 2>/dev/null) || continue; [ -z "$p0" ] && p0=$p; ` +
	`case "$x" in *deleted*) ;; /usr/*|/bin/*|/sbin/*|/lib/*) tr '\0' ' ' </proc/$p/cmdline 2>/dev/null | grep -qE '` + proxyKitProcPattern + `' || continue ;; esac; ` +
	`s=$(grep -aoE -m1 '` + proxyBinarySigs + `' /proc/$p/exe 2>/dev/null | head -1); [ -z "$s" ] && continue; ` +
	`[ -z "$got" ] && { got=1; lst=$(nsenter -t $p -n ss -Htulnp 2>/dev/null | awk '{for(i=6;i<=NF;i++){n=split($i,a,"pid=");for(j=2;j<=n;j++){split(a[j],q,",");print q[1]" "$5}}}'); }; ` +
	`a=$(echo "$lst" | awk -v p=$p '$1==p{print $2}' | sort -u | tr '\n' ';'); ` +
	`b="${b}bin:${s#github.com/}@${a:--},"; done; ` +
	`wd=$(docker inspect -f '{{.Config.WorkingDir}}' "$c" 2>/dev/null); case "$wd" in ""|/) wd=/app ;; esac; ` +
	`if [ -n "$p0" ]; then R="/proc/$p0/root$wd"; sf=$(` + vlessSourceCmd(`"$R"`) + `); ` +
	`[ -n "$sf" ] && b="${b}src:vless-ws@${sf#$R/},"; fi; ` +
	`[ -z "$m$b" ] && continue; est=""; rx=""; tx=""; ` +
	`if [ -n "$b" ] && [ -n "$p0" ]; then est=$(nsenter -t $p0 -n ss -Htn state established 2>/dev/null | wc -l); ` +
	`set -- $(awk '/eth0:/{print $2, $10}' /proc/$p0/net/dev 2>/dev/null); rx=$1; tx=$2; fi; ` +
	`echo "SMHIT $(docker inspect --format '{{.Name}}' "$c")|$m$b|$est|$rx|$tx"; done; true`

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

// What a scan hit actually is. Only proven behaviour is reported: a process
// name or a bundled binary is not enough, because VPN *panels* (ours, 3x-ui
// before any inbound is set up, Cloudflare-Worker config panels) and apps
// that route their own traffic through a proxy are allowed.
type proxyVerdict int

const (
	// verdictNone: name-only matches, a bare cloudflared tunnel, or a proxy
	// core with no inbound reachable from outside (a client). Not reported.
	verdictNone proxyVerdict = iota
	// verdictKitAgent: a Nezha agent (the remote-control part of the argo
	// kits) with no proxy serving. Reported for review, never auto-suspended.
	verdictKitAgent
	// verdictServer: a proxy core accepting connections on a public socket,
	// or on loopback behind a tunnel — the app is a VPN/proxy server.
	verdictServer
)

var proxyCoreNames = []struct{ module, name string }{
	{"xtls/xray-core", "Xray"}, {"v2fly/v2ray-core", "V2Ray"}, {"sagernet/sing-box", "sing-box"},
	{"apernet/hysteria", "Hysteria"}, {"go-gost/", "GOST"}, {"ginuerzh/gost", "GOST"},
}

type proxyFinding struct {
	verdict proxyVerdict
	summary string // shown in the Abuse Report; plain language for the admin
}

func isLoopbackAddr(addr string) bool {
	a := strings.TrimPrefix(addr, "[")
	return strings.HasPrefix(a, "127.") || strings.HasPrefix(a, "::1]") || strings.HasPrefix(a, "::ffff:127.") || a == "::1"
}

func addrPort(addr string) string {
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		return addr[i+1:]
	}
	return ""
}

// classifyProxyHit decides what a container is doing from its scan line.
// appPort is the port our HTTP proxy sends the app's public traffic to.
func classifyProxyHit(h proxyHit, appPort int) proxyFinding {
	var cores, servingOn []string
	tunnel, nezha, viaAppPort := false, false, false
	loopbackOnly := map[string][]string{}
	for _, tok := range strings.Split(h.signatures, ",") {
		tok = strings.TrimSpace(tok)
		if strings.Contains(tok, "edge-ip-version") || strings.Contains(tok, "run --token") {
			tunnel = true
		}
		if file, ok := strings.CutPrefix(tok, "src:vless-ws@"); ok {
			servingOn = append(servingOn, "a VLESS-over-WebSocket server written in the app's own code ("+file+")")
			viaAppPort = true
			continue
		}
		mod, ok := strings.CutPrefix(tok, "bin:")
		if !ok {
			continue
		}
		mod, addrs, _ := strings.Cut(mod, "@")
		switch {
		case strings.HasPrefix(mod, "cloudflare/cloudflared"):
			tunnel = true
			continue
		case strings.HasPrefix(mod, "nezhahq/agent"):
			nezha = true
			continue
		}
		name := ""
		for _, c := range proxyCoreNames {
			if strings.HasPrefix(mod, c.module) {
				name = c.name
			}
		}
		if name == "" {
			continue
		}
		cores = append(cores, name)
		for _, a := range strings.Split(addrs, ";") {
			if a == "" || a == "-" {
				continue
			}
			if isLoopbackAddr(a) {
				loopbackOnly[name] = append(loopbackOnly[name], a)
				continue
			}
			servingOn = append(servingOn, name+" on "+a)
			if appPort > 0 && addrPort(a) == fmt.Sprint(appPort) {
				viaAppPort = true
			}
		}
	}
	if len(servingOn) == 0 && tunnel {
		for name, addrs := range loopbackOnly {
			for _, a := range addrs {
				servingOn = append(servingOn, name+" on "+a+" (exposed through a Cloudflare tunnel)")
			}
		}
	}

	traffic := ""
	if h.rxBytes > 0 || h.txBytes > 0 {
		traffic = fmt.Sprintf(" %d open connection(s); %s received / %s sent since the container started.",
			h.established, fmtBytes(h.rxBytes), fmtBytes(h.txBytes))
	}
	if len(servingOn) > 0 {
		s := "Acting as a VPN/proxy server: " + strings.Join(uniq(servingOn), ", ") + " is accepting connections."
		if viaAppPort {
			s += " That is the app's public port, so VPN traffic flows through our HTTP proxy."
		}
		s += traffic
		if nezha {
			s += " Also runs a Nezha remote-control agent."
		}
		return proxyFinding{verdict: verdictServer, summary: s}
	}
	if nezha {
		s := "Runs a Nezha remote-control agent (the monitoring part of proxy-node kits; lets a third party run commands in the container)."
		if len(cores) > 0 {
			s += " A " + strings.Join(uniq(cores), "/") + " binary is running but not accepting outside connections."
		} else {
			s += " No proxy server is running, so on its own this is not a VPN."
		}
		return proxyFinding{verdict: verdictKitAgent, summary: s + " Review before acting." + traffic}
	}
	return proxyFinding{verdict: verdictNone}
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	out := in[:0:0]
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func fmtBytes(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.0f MB", float64(n)/(1<<20))
	default:
		return fmt.Sprintf("%d KB", n>>10)
	}
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

	hosts, hits, filed, suspended, ignored := 0, 0, 0, 0, 0
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
			f := classifyProxyHit(hit, full.ContainerPort)
			if f.verdict == verdictNone {
				// Name-only match, bare tunnel, or a proxy used as a client:
				// allowed. Logged so a miss can be traced.
				ignored++
				e.log.Info().Str("project", full.ID).Str("signatures", hit.signatures).Msg("abuse scan: proxy-like process, not serving — not reported")
				continue
			}
			hits++
			details := f.summary + " Evidence: " + hit.signatures + " (host " + r.Host() + ")."
			if autoSuspend && f.verdict == verdictServer && e.autoSuspendProxy(ctx, full, details) {
				suspended++
				filed++
				continue
			}
			if e.fileProxyAbuseReport(ctx, full, details) {
				filed++
			}
		}
	}
	e.log.Info().Int("hosts", hosts).Int("hits", hits).Int("not_serving", ignored).Int("new_reports", filed).Int("auto_suspended", suspended).Msg("proxy-node abuse scan done")
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

type proxyHit struct {
	id8, signatures  string
	established      int
	rxBytes, txBytes int64
}

// parseProxyScan extracts main-app hits (sm-<8 hex>) from the scan output.
func parseProxyScan(out string) []proxyHit {
	var hits []proxyHit
	for _, line := range strings.Split(out, "\n") {
		rest, ok := strings.CutPrefix(strings.TrimSpace(line), "SMHIT ")
		if !ok {
			continue
		}
		f := strings.Split(rest, "|")
		name := strings.TrimPrefix(f[0], "/")
		id8 := strings.TrimPrefix(name, "sm-")
		if !strings.HasPrefix(name, "sm-") || strings.HasPrefix(name, "sm-svc-") || len(id8) != 8 || len(f) < 2 {
			continue
		}
		h := proxyHit{id8: id8, signatures: strings.TrimSuffix(f[1], ",")}
		if len(f) >= 5 {
			h.established, _ = strconv.Atoi(strings.TrimSpace(f[2]))
			h.rxBytes, _ = strconv.ParseInt(strings.TrimSpace(f[3]), 10, 64)
			h.txBytes, _ = strconv.ParseInt(strings.TrimSpace(f[4]), 10, 64)
		}
		hits = append(hits, h)
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
