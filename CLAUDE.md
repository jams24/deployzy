# Deployzy — Agent Guide

Everything an agent needs to work in this repo without asking the user for context.

---

## Monorepo Layout

| Directory | What it is | Where it deploys |
|-----------|-----------|-----------------|
| `server/` | Go backend (API, tunnel server, deploy engine, proxy) | VPS via binary swap |
| `web/` | Next.js dashboard + marketing site | VPS via rsync of `.next/` |
| `cli/` | Go CLI binary source (`deployzy` command) | GitHub Releases via GoReleaser |
| `npm-package/` | npm wrapper (`deployzy` on npm) — downloads the Go binary on install | npm via CI |
| `sdk-js/` | JavaScript/TypeScript SDK (`deployzy-sdk` on npm) | npm via CI |
| `sdk-python/` | Python SDK (`deployzy` on PyPI) | PyPI via CI |
| `proto/` | Shared Go protocol types (used by both `server/` and `cli/`) | n/a |
| `homebrew-tap/` | Homebrew formula stub — **not the live tap**; GoReleaser pushes to `jams24/homebrew-deployzy` | separate repo |
| `.github/workflows/` | CI/CD — see Release Flow below | GitHub Actions |

---

## Release Flow — ALWAYS use this, never publish manually

**Trigger: push a `v*` tag to `main`.** That's it. CI handles everything else.

```bash
# 1. Make code changes on a branch, get them merged to main first.

# 2. Bump ALL of these version strings to the same value:
#    - proto/messages.go          → var Version = "X.Y.Z"
#    - npm-package/package.json   → "version": "X.Y.Z"
#    - sdk-js/package.json        → "version": "X.Y.Z"
#    - sdk-python/pyproject.toml  → version = "X.Y.Z"

# 3. Commit, tag, push:
git add proto/messages.go npm-package/package.json sdk-js/package.json sdk-python/pyproject.toml
git commit -m "chore: bump to vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

### What the pipeline does automatically

| Job | Trigger | Output |
|-----|---------|--------|
| `release` (GoReleaser) | tag push | Builds 10 binaries (CLI + server, 5 platforms), creates GitHub release with archives + checksums, **updates `jams24/homebrew-deployzy` Formula** |
| `npm-cli` | after `release` | Publishes `deployzy@X.Y.Z` to npm (the CLI wrapper) |
| `npm-sdk` | after `release` | Publishes `deployzy-sdk@X.Y.Z` to npm |
| `pypi` | after `release` | Publishes `deployzy@X.Y.Z` to PyPI |

### Required GitHub secrets (already set)
- `HOMEBREW_TAP_TOKEN` — write access to `jams24/homebrew-deployzy`
- `NPM_TOKEN` — npm publish token

### Archive naming (GoReleaser)
GoReleaser produces archives named `deployzy_<os>_<arch>.tar.gz` (or `.zip` on Windows).
The npm `postinstall` script downloads exactly this pattern. **Do not rename them.**

---

## Deploying the Server Binary to VPS

The server binary is NOT handled by CI — it's a manual rsync + swap.
Do this every time `server/` changes are ready to go live.

```bash
# 1. Cross-compile
cd server
GOOS=linux GOARCH=amd64 go build -o /tmp/deployzysrv ./cmd/servermesrv/

# 2. Upload (rsync is more reliable than scp on flaky connections)
rsync -az -e "sshpass -p 'PASSWORD' ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=15" \
  /tmp/deployzysrv root@163.245.208.218:/usr/local/bin/deployzysrv.new

# 3. Stop → swap → start ALL THREE services (never restart just one)
sshpass -p 'PASSWORD' ssh root@163.245.208.218 '
  systemctl stop deployzy deployzy-texis &&
  cp /usr/local/bin/deployzysrv.new /usr/local/bin/deployzysrv &&
  cp /usr/local/bin/deployzysrv /usr/local/bin/servermesrv &&
  systemctl start deployzy deployzy-texis deployzy-web
'
```

**Never restart only `deployzy` or only `deployzy-texis`.**
`deployzy-texis` has `Requires=deployzy`, so restarting texis restarts deployzy.
Restart all 3 in one shot to avoid cascading failures.

## Deploying the Web Frontend to VPS

```bash
# 1. Build (must have .env.production present)
cd web
NODE_ENV=production npm run build

# 2. Stage to -next dir (rsync, NOT tar — tar silently drops .next/ on Linux)
rsync -az -e "sshpass -p 'PASSWORD' ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30" \
  web/.next/ root@163.245.208.218:/opt/deployzy-web-next/.next/
rsync -az -e "sshpass -p 'PASSWORD' ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30" \
  web/public/ root@163.245.208.218:/opt/deployzy-web-next/public/

# 3. Atomic swap
sshpass -p 'PASSWORD' ssh root@163.245.208.218 '
  mv /opt/deployzy-web /opt/deployzy-web-old &&
  mv /opt/deployzy-web-next /opt/deployzy-web &&
  systemctl restart deployzy-web &&
  rm -rf /opt/deployzy-web-old
'
```

---

## VPS Reference

| Item | Value |
|------|-------|
| IP | `163.245.208.218` |
| SSH user | `root` |
| Go binary path | `/usr/local/bin/deployzysrv` (also symlinked as `servermesrv`) |
| Web app path | `/opt/deployzy-web` |
| Services | `deployzy`, `deployzy-texis`, `deployzy-web` |
| API port | `9081` (internal) |
| Tunnel control port | `8443` (TLS, direct — not through Cloudflare) |
| HTTP proxy port | `9080` |

---

## Tunnel Control Endpoint

The CLI connects to `ctrl.deployzy.com:8443` — a **DNS-only** Cloudflare record (not proxied).

**Why not `deployzy.com:8443`?** Port 8443 is in Cloudflare's proxied HTTPS port list.
Cloudflare intercepts TLS on that port expecting HTTP, but gets smux protocol frames → "invalid protocol" error.
`ctrl.deployzy.com` bypasses Cloudflare entirely (DNS-only A → VPS IP).

Never change the CLI default server to `deployzy.com:8443`.

---

## Cloudflare DNS

Zone ID: `e8554572439824d89a6e9d7578192acf`
Account ID: `16c36f55ebf111581bf53aadfcd971b7`
API Token: stored in systemd unit env and `secrets/` (gitignored)

Key DNS records:
- `deployzy.com` — proxied (Cloudflare)
- `*.deployzy.com` — proxied wildcard (subdomains for tunnels/apps)
- `cname.deployzy.com` — **DNS-only** A record → VPS (custom domain CNAME target)
- `ctrl.deployzy.com` — **DNS-only** A record → VPS (tunnel control endpoint)
- `database.deployzy.com` — **DNS-only** A record → VPS (DB connection strings)

When adding a new platform server, the API auto-creates a DNS-only A record
(`database-<label>.deployzy.com`) via `server/internal/cloudflare/dns.go`.

---

## Key Architectural Rules

### Database / service_host
Worker servers have a `service_host` column. Always use `server.ServiceHost` (not `server.Host`)
for connection strings and external URLs. `Host` may be a Cloudflare-proxied domain that blocks TCP.

### BYOC proxy routing
`GetProjectRouting` returns `(serverHost, port, projectID, ok)`. If `serverHost` is empty,
proxy to `127.0.0.1` (local). If non-empty, proxy to that IP (BYOC remote VPS).

### Email
All emails go through Brevo SMTP. Use `notify.BroadcastEmail()` or `notify.DeployFailedEmail()`
which wrap content in the brand shell (real logo via `https://deployzy.com/logo-dark.svg`, footer
with `support@deployzy.com`). Never send raw HTML without the brand shell.

### Database schema changes
Use `npx prisma db push` — NOT `prisma migrate`. Production has schema drift; migrations fail.

### Bulk DB updates
Never run broad `UPDATE`/`DELETE` without a narrow `WHERE` clause and explicit user approval.
A wide UPDATE on prod tables caused a customer outage (2026-04-15).

### pgx scan errors
Never silently continue on scan errors — one failing row hides all subsequent rows.
Always `COALESCE` nullable columns in SELECT queries.

---

## Support Email

`support@deployzy.com` — Cloudflare Email Routing forwards to `deployzy@gmail.com`.
Use this in all user-facing content (footer, billing page, landing page Team CTA).

---

## What NOT to Do

- **Don't publish npm/PyPI/Homebrew manually** — use the tag-based CI pipeline.
- **Don't use `tar` to deploy the web build** — `--strip-components` silently drops `.next/` on Linux. Use `rsync`.
- **Don't restart only one service** — always restart all 3 (`deployzy`, `deployzy-texis`, `deployzy-web`).
- **Don't use `deployzy.com:8443`** as the tunnel endpoint — it goes through Cloudflare proxy.
- **Don't add Co-Authored-By Claude trailer** to commits in this project.
- **Don't run `prisma migrate`** — use `prisma db push`.
