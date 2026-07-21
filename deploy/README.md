# Deploy scripts

Two scripts, two jobs.

## `install.sh` — fresh VPS → running platform

Use once, on a clean Ubuntu 22.04+ / Debian 12+ VPS, as root.

```bash
sudo ./install.sh \
  --domain deployzy.com \
  --email you@example.com \
  # optional integrations below
  --google-id "<client-id>" --google-secret "<secret>" \
  --github-app-id "<id>" --github-client-id "<id>" \
  --github-client-secret "<s>" --github-webhook-secret "<s>" \
  --github-private-key /path/to/app.pem \
  --telegram-token "<bot-token>"
```

It installs **everything the live platform runs**:

| Component | Why |
|---|---|
| Go 1.24 + builds `servermesrv` + `serverme` CLI from source | avoids stale release binaries |
| Node.js 20 + builds the Next.js dashboard to `/opt/serverme-web/` | `NEXT_PUBLIC_API_URL` is baked at build time |
| PostgreSQL 16 | `listen_addresses='*'` + `pg_hba` `sameuser` rule for managed user databases |
| Docker with `icc: false` + 50 MB×3 log rotation | blocks container↔container traffic, caps disk per container |
| iptables INPUT sandbox: docker0 → host allowed only on `:5432` (DB) + `:53` (DNS) | user containers can't reach host SSH / API / tunnel control |
| UFW: 22, 80, 443, 8443 + `from 172.17.0.0/16 to any port 5432` | public ports + container→DB bridge |
| Caddy with on-demand TLS | user custom domains get automatic Let's Encrypt certs |
| `/etc/cron.daily/serverme-cleanup` | docker image prune, log trim, /tmp cleanup, journal vacuum |
| 3 systemd services: `serverme`, `serverme-web` (both enabled + started); `serverme-texis` added later if needed | |
| `/opt/serverme/{backups,project-data}` directories | persistent volumes for managed DBs |
| Random 256-bit JWT secret + 128-bit DB password saved to `/opt/serverme/credentials.txt` (0600) | |

Migrations run automatically on first server start (embedded via goose).

### After install

1. Point DNS: `A deployzy.com → <vps-ip>` + `CNAME *.deployzy.com → deployzy.com` + `CNAME api.deployzy.com → deployzy.com`.
2. Register the first account with a regular `curl POST /auth/register`.
3. Mark that user admin:
   ```bash
   sudo -u postgres psql -d serverme \
     -c "UPDATE users SET is_admin=true WHERE email='you@example.com'"
   ```

## `redeploy.sh` — iterate: local dev → VPS

Use every time you want to push local changes.

```bash
SSH_PASS='...' ./redeploy.sh root@deployzy.com            # full (server + web)
SSH_PASS='...' ./redeploy.sh root@deployzy.com --server-only
SSH_PASS='...' ./redeploy.sh root@deployzy.com --web-only
```

What it does:

1. Cross-compiles the Go server (`GOOS=linux GOARCH=amd64 CGO_ENABLED=0`)
2. Builds the Next.js app with `NEXT_PUBLIC_API_URL=https://api.<host>` baked in (derived from the SSH target if not overridden via `API_URL=…`)
3. Tars + scps the artifacts
4. On the remote: stops each service, swaps, restarts, **and always restarts `serverme-texis` too** — that service loses its tunnel whenever `serverme` is stopped; codifying the restart here avoids the easily-forgotten "why is texis.deployzy.com down?" class of incidents.
5. Prints final service status + running binary MD5 so you can confirm the swap actually happened.

## VPS drift — what to do if the live server was changed by hand

The install script writes the canonical versions of:
- `/etc/docker/daemon.json`
- `/etc/caddy/Caddyfile`
- `/etc/cron.daily/serverme-cleanup`
- `/etc/systemd/system/serverme.service`
- `/etc/systemd/system/serverme-web.service`
- `iptables -> /etc/iptables/rules.v4`

If the VPS has hand-edits you want to keep, re-run `install.sh` with `--skip-*` flags for the phases you don't want to overwrite.
