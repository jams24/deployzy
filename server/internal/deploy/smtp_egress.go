package deploy

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/serverme/serverme/server/internal/db"
)

// egressUnit is the systemd oneshot that (re)applies the host-level base DROPs on
// every boot/docker-restart: block direct-to-MX :25 for all containers, and base
// DROP the submission ports (465/587) — the deploy engine punches per-project
// ACCEPT holes above these for paid plans.
const egressUnit = `[Unit]
Description=Deployzy container egress policy (block :25, gate submission 465/587)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c "iptables -C DOCKER-USER -p tcp --dport 25 -j DROP 2>/dev/null || iptables -I DOCKER-USER -p tcp --dport 25 -j DROP"
ExecStart=/bin/sh -c "iptables -C DOCKER-USER -p tcp -m multiport --dports 465,587 -j DROP 2>/dev/null || iptables -A DOCKER-USER -p tcp -m multiport --dports 465,587 -j DROP"

[Install]
WantedBy=multi-user.target
`

// EgressSetupScript is a single-line, quoting-safe (base64) shell command that
// installs + enables the egress unit on a host. Reused by new-server provisioning
// and the existing-server reconcile. Idempotent.
var EgressSetupScript = "echo " + base64.StdEncoding.EncodeToString([]byte(egressUnit)) +
	" | base64 -d > /etc/systemd/system/deployzy-egress.service; " +
	"systemctl daemon-reload >/dev/null 2>&1; systemctl enable --now deployzy-egress.service >/dev/null 2>&1 || true; "

// Outbound-SMTP egress policy for user containers (Railway-style, plan-gated).
//
//   - Port 25 (direct-to-MX) is blocked for ALL containers at the host level by
//     the deployzy-egress.service systemd unit — it's the spam-relay vector and
//     no legitimate hosted app needs it.
//   - Ports 465/587 (authenticated submission — "send with your own SMTP creds")
//     are blocked by a base DROP for all containers, and this punches a
//     per-project ACCEPT ONLY for paid plans (pro/team), admins, and BYOC.
//
// Each ACCEPT is tagged in an iptables comment with the project id, so a redeploy
// (new container IP) or a downgrade replaces/removes the project's own rule —
// no stale rules accumulate that could let a reused IP through. Fail-closed:
// anything we can't confirm as paid stays blocked.

const smtpSubmissionPorts = "465,587"

// smtpAllowed reports whether this project's containers may open outbound SMTP
// submission connections. BYOC (user's own server) and admins always may; on
// platform servers only paid plans may. Fails closed on any lookup error.
func (e *Engine) smtpAllowed(ctx context.Context, project *db.Project, assignedServer *db.WorkerServer) bool {
	if assignedServer != nil && assignedServer.UserID != nil && *assignedServer.UserID == project.UserID {
		return true // BYOC — user owns the box
	}
	if isAdmin, _ := e.db.IsUserAdmin(ctx, project.UserID); isAdmin {
		return true
	}
	user, err := e.db.GetUserByID(ctx, project.UserID)
	if err != nil || user == nil {
		return false
	}
	switch user.Plan {
	case "pro", "team":
		return true
	}
	return false
}

// applySMTPEgress reconciles the submission-port firewall rule for a project's
// container. Best-effort: it logs nothing and never fails a deploy — the base
// DROP is the safe default, so a failure here just means "blocked", never "open".
func (e *Engine) applySMTPEgress(ctx context.Context, runner *Runner, projectID8, containerName string, allowed bool) {
	if runner == nil {
		return
	}
	tag := "dz-smtp:" + projectID8

	// Remove any prior rule(s) for this project (redeploy with a new IP, or a
	// paid→free downgrade). Delete by line-number — robust against the quoting
	// iptables applies to the comment in its -S/-L output. Re-query each pass
	// because line numbers shift after every delete.
	del := fmt.Sprintf(
		`while n=$(iptables -L DOCKER-USER --line-numbers -n 2>/dev/null | grep -F -- %q | awk '{print $1}' | tail -1); [ -n "$n" ]; do iptables -D DOCKER-USER "$n" || break; done`,
		tag)
	_, _ = runner.RunShell(ctx, del)

	if !allowed {
		return // base DROP now blocks 465/587 for this container
	}

	ipOut, err := runner.Run(ctx, "docker", "inspect", "-f",
		"{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", containerName)
	ip := strings.TrimSpace(string(ipOut))
	if err != nil || ip == "" {
		return
	}
	ins := fmt.Sprintf(
		`iptables -I DOCKER-USER 1 -s %s -p tcp -m multiport --dports %s -m comment --comment %q -j ACCEPT`,
		ip, smtpSubmissionPorts, tag)
	_, _ = runner.RunShell(ctx, ins)
}

// projectByShortID resolves the (partial) project id embedded in a container
// name (sm-<id8>) to enough of a Project to make the plan decision.
func (e *Engine) projectByShortID(ctx context.Context, id8 string) *db.Project {
	var p db.Project
	if err := e.db.Pool.QueryRow(ctx,
		`SELECT id, user_id FROM projects WHERE id::text LIKE $1 LIMIT 1`, id8+"%",
	).Scan(&p.ID, &p.UserID); err != nil {
		return nil
	}
	return &p
}

// reconcileEgressOnHost re-applies submission-port allow rules for every user app
// container running on the host reachable through `runner`. Run after the base
// DROP is (re)installed so no existing paid container is stranded.
func (e *Engine) reconcileEgressOnHost(ctx context.Context, runner *Runner) int {
	out, err := runner.Run(ctx, "docker", "ps", "--format", "{{.Names}}", "--filter", "name=sm-")
	if err != nil {
		return 0
	}
	n := 0
	for _, name := range strings.Fields(string(out)) {
		// Main app containers only: sm-<8hex>. Skip sm-svc-* (DBs/services) and -next.
		if !strings.HasPrefix(name, "sm-") || strings.HasPrefix(name, "sm-svc-") || strings.HasSuffix(name, "-next") {
			continue
		}
		id8 := strings.TrimPrefix(name, "sm-")
		if len(id8) != 8 {
			continue
		}
		project := e.projectByShortID(ctx, id8)
		if project == nil {
			continue
		}
		e.applySMTPEgress(ctx, runner, id8, name, e.smtpAllowed(ctx, project, nil))
		n++
	}
	return n
}

// ReconcileSMTPEgress backfills allow rules on the LOCAL host (quick path used at
// startup on the control-plane box).
func (e *Engine) ReconcileSMTPEgress(ctx context.Context) {
	n := e.reconcileEgressOnHost(ctx, NewLocalRunner())
	e.log.Info().Int("containers", n).Msg("reconciled outbound-SMTP egress rules (local)")
}

// EnsureEgressAllServers installs/enables the egress unit (host base DROPs) and
// backfills paid allow-holes on EVERY platform server — local and remote — so the
// whole fleet enforces the policy, existing servers included. BYOC servers are
// skipped (users own that compute). Idempotent; safe to run at every startup.
func (e *Engine) EnsureEgressAllServers(ctx context.Context) {
	// Local control-plane host.
	local := NewLocalRunner()
	_, _ = local.RunShell(ctx, EgressSetupScript)
	e.reconcileEgressOnHost(ctx, local)

	servers, err := e.db.ListWorkerServers(ctx, nil)
	if err != nil {
		return
	}
	applied := 0
	for i := range servers {
		s := servers[i]
		if s.UserID != nil {
			continue // BYOC — user owns it, don't touch their firewall
		}
		if s.IsLocal || s.Host == "localhost" || s.Host == "127.0.0.1" || s.Host == "" {
			continue // already handled by the local runner above
		}
		if !s.DockerInstalled {
			continue
		}
		full, err := e.db.GetWorkerServer(ctx, s.ID)
		if err != nil || full == nil {
			continue
		}
		runner := NewRemoteRunner(full)
		if _, err := runner.RunShell(ctx, EgressSetupScript); err != nil {
			e.log.Warn().Err(err).Str("server", full.Label).Msg("egress unit install failed")
			continue
		}
		e.reconcileEgressOnHost(ctx, runner)
		applied++
	}
	e.log.Info().Int("remote_platform_servers", applied).Msg("applied outbound-SMTP egress policy to fleet")
}
