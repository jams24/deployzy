// Package migrate performs one-time "bring your own database" imports: dump a
// user's existing database and restore it into a freshly-created Deployzy
// service. It shells out to the official client tools, but runs them inside a
// throwaway Docker container (so the host needs no mysql/mongo clients) and
// never interpolates user input into a shell string — credentials are passed as
// container environment variables and referenced by name in a fixed script.
package migrate

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/url"
	"os/exec"
	"strings"
)

// Supported source types.
const (
	Postgres = "postgres"
	MySQL    = "mysql"
	MongoDB  = "mongodb"
)

// denyExtraIPs are hosts we refuse to dump from even though they're public —
// notably our own VPS, so the tool can't be turned against the platform.
var denyExtraIPs = map[string]bool{
	"163.245.208.218": true,
}

// ValidateSource parses and sanity-checks a source connection string and returns
// the host (for display). It rejects anything pointing at a private, loopback,
// link-local, or otherwise non-public address so the importer can't be used to
// reach internal services (SSRF) — e.g. our own Postgres on localhost or the
// cloud metadata endpoint.
func ValidateSource(sourceType, rawURL string) (host string, err error) {
	if rawURL == "" {
		return "", fmt.Errorf("source connection string is required")
	}
	// Normalise scheme so url.Parse is happy for all three.
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("invalid connection string")
	}
	host = u.Hostname()
	if host == "" {
		return "", fmt.Errorf("connection string has no host")
	}

	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return "", fmt.Errorf("could not resolve host %q", host)
	}
	for _, ip := range ips {
		if !isPublicIP(ip) || denyExtraIPs[ip.String()] {
			return "", fmt.Errorf("host %q resolves to a non-public or blocked address — the source must be a publicly reachable database", host)
		}
	}
	return host, nil
}

func isPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	// CGNAT / shared address space (100.64.0.0/10) — Tailscale et al.
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
		return false
	}
	return true
}

// Run dumps sourceURL and restores it into targetURL. The target is always a
// Deployzy-managed DB reachable on the host's localhost (platform Postgres, or a
// mapped service container port), so we run with --network host. Returns a
// trimmed combined log.
func Run(ctx context.Context, sourceType, sourceURL, targetURL string) (string, error) {
	script, image, env, err := buildJob(sourceType, sourceURL, targetURL)
	if err != nil {
		return "", err
	}

	args := []string{"run", "--rm", "--network", "host"}
	for k, v := range env {
		args = append(args, "-e", k+"="+v)
	}
	args = append(args, image, "sh", "-c", script)

	cmd := exec.CommandContext(ctx, "docker", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	runErr := cmd.Run()

	log := out.String()
	if len(log) > 8000 { // keep the tail — errors surface at the end
		log = "…\n" + log[len(log)-8000:]
	}
	if runErr != nil {
		return log, fmt.Errorf("migration failed: %s", lastNonEmptyLine(log))
	}
	return log, nil
}

// buildJob returns the shell script (referencing only env-var names, never the
// raw values), the docker image, and the env map for one migration.
func buildJob(sourceType, sourceURL, targetURL string) (script, image string, env map[string]string, err error) {
	// IMPORTANT: dump to a file, then restore only on success (`&&`). A naive
	// `dump | restore` pipe returns the restore's exit code, so a failed dump
	// (e.g. version mismatch) yields empty input and a FALSE success. The file +
	// `&&` + `set -e` makes any dump failure abort the whole job with its error.
	switch sourceType {
	case Postgres:
		// pg_dump 17 can read servers up to 17 (Railway/Supabase/Neon default to
		// newer majors); a 16 client refuses a 17 server. --no-owner/--no-acl so
		// the dump restores cleanly into the target's differently-named role.
		// The target is our platform Postgres 16; a pg_dump from a newer server
		// (17) emits `SET transaction_timeout` in the preamble, which 16 rejects
		// and — with ON_ERROR_STOP — aborts the whole restore. Strip that single
		// newer-GUC line; everything else restores cleanly.
		return `set -e
pg_dump --no-owner --no-acl -d "$SRC" -f /tmp/dump.sql
test -s /tmp/dump.sql
sed -i '/^SET transaction_timeout/d' /tmp/dump.sql
psql -v ON_ERROR_STOP=1 -d "$DST" -f /tmp/dump.sql`,
			"postgres:17-alpine",
			map[string]string{"SRC": sourceURL, "DST": targetURL},
			nil

	case MongoDB:
		return `set -e
mongodump --uri="$SRC" --archive=/tmp/dump.archive
mongorestore --uri="$DST" --archive=/tmp/dump.archive --drop`,
			"mongo:7",
			map[string]string{"SRC": sourceURL, "DST": targetURL},
			nil

	case MySQL:
		// The mysql client can't take a URL — split both endpoints into parts.
		s, err := parseMySQL(sourceURL)
		if err != nil {
			return "", "", nil, fmt.Errorf("source: %w", err)
		}
		d, err := parseMySQL(targetURL)
		if err != nil {
			return "", "", nil, fmt.Errorf("target: %w", err)
		}
		// MYSQL_PWD keeps passwords off the process list. All values arrive as
		// env vars, so nothing user-controlled is parsed by the shell.
		return `set -e
MYSQL_PWD="$SPW" mysqldump --single-transaction --no-tablespaces -h"$SHOST" -P"$SPORT" -u"$SUSER" "$SDB" > /tmp/dump.sql
test -s /tmp/dump.sql
MYSQL_PWD="$DPW" mysql -h"$DHOST" -P"$DPORT" -u"$DUSER" "$DDB" < /tmp/dump.sql`,
			"mysql:8",
			map[string]string{
				"SHOST": s.host, "SPORT": s.port, "SUSER": s.user, "SPW": s.pass, "SDB": s.db,
				"DHOST": d.host, "DPORT": d.port, "DUSER": d.user, "DPW": d.pass, "DDB": d.db,
			},
			nil
	}
	return "", "", nil, fmt.Errorf("unsupported source type %q", sourceType)
}

type mysqlParts struct{ host, port, user, pass, db string }

func parseMySQL(raw string) (mysqlParts, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return mysqlParts{}, fmt.Errorf("invalid mysql url")
	}
	p := mysqlParts{host: u.Hostname(), port: u.Port(), db: strings.TrimPrefix(u.Path, "/")}
	if p.port == "" {
		p.port = "3306"
	}
	if u.User != nil {
		p.user = u.User.Username()
		p.pass, _ = u.User.Password()
	}
	if p.host == "" || p.db == "" {
		return mysqlParts{}, fmt.Errorf("mysql url needs host and database name")
	}
	return p, nil
}

func lastNonEmptyLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if t := strings.TrimSpace(lines[i]); t != "" {
			return t
		}
	}
	return "unknown error"
}
