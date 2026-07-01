#!/usr/bin/env bash
#
# ServerMe — Self-Hosted Installation Script (v2 — full platform)
#
# Installs everything the live serverme.site runs:
#   • serverme (tunnel + API server)
#   • serverme-web (Next.js dashboard)
#   • PostgreSQL 16 (with external-access config for managed DBs)
#   • Caddy (TLS, on-demand cert for user custom domains)
#   • Docker (with icc=false + log rotation for multi-tenant safety)
#   • iptables sandbox (blocks container → host internal services)
#   • Daily cleanup + nightly backup (systemd timers)
#
# Usage:
#   sudo ./install.sh --domain serverme.site --email you@example.com
#
# Optional GitHub App / Billing / Telegram integrations — see --help.
#
# Requirements:
#   • Ubuntu 22.04+ or Debian 12+ (tested on 24.04)
#   • Root access
#   • Domain A record + wildcard CNAME pointing at this VPS
#

set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[ServerMe]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step() { echo -e "\n${CYAN}━━━ ${BOLD}$*${NC}"; }

# ─── Defaults ────────────────────────────────────────────────────────
DOMAIN=""
EMAIL=""
DB_PASS=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
AUTH_TOKEN="disabled-use-api-keys"
INSTALL_DIR="/opt/serverme"
WEB_DIR="/opt/serverme-web"

# Optional integrations — all skipped by default
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_APP_ID=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
GITHUB_WEBHOOK_SECRET=""
GITHUB_PRIVATE_KEY_PATH=""
INVENTPAY_KEY=""
INVENTPAY_WEBHOOK_SECRET=""
TELEGRAM_TOKEN=""
# Skippable steps
SKIP_DB=false
SKIP_CADDY=false
SKIP_WEB=false

# ─── Parse args ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)               DOMAIN="$2"; shift 2 ;;
    --email)                EMAIL="$2"; shift 2 ;;
    --db-pass)              DB_PASS="$2"; shift 2 ;;
    --jwt-secret)           JWT_SECRET="$2"; shift 2 ;;
    --google-id)            GOOGLE_CLIENT_ID="$2"; shift 2 ;;
    --google-secret)        GOOGLE_CLIENT_SECRET="$2"; shift 2 ;;
    --github-app-id)        GITHUB_APP_ID="$2"; shift 2 ;;
    --github-client-id)     GITHUB_CLIENT_ID="$2"; shift 2 ;;
    --github-client-secret) GITHUB_CLIENT_SECRET="$2"; shift 2 ;;
    --github-webhook-secret) GITHUB_WEBHOOK_SECRET="$2"; shift 2 ;;
    --github-private-key)   GITHUB_PRIVATE_KEY_PATH="$2"; shift 2 ;;
    --inventpay-key)        INVENTPAY_KEY="$2"; shift 2 ;;
    --inventpay-webhook-secret) INVENTPAY_WEBHOOK_SECRET="$2"; shift 2 ;;
    --telegram-token)       TELEGRAM_TOKEN="$2"; shift 2 ;;
    --skip-db)              SKIP_DB=true; shift ;;
    --skip-caddy)           SKIP_CADDY=true; shift ;;
    --skip-web)             SKIP_WEB=true; shift ;;
    -h|--help)
      cat <<EOF
ServerMe Self-Hosted Installer

Required:
  --domain <domain>              Base domain (e.g. serverme.site)
  --email <email>                Email for Let's Encrypt

Optional integrations — skip any you don't use:
  --google-id / --google-secret          Google OAuth for login
  --github-app-id / --github-client-id /
    --github-client-secret /
    --github-webhook-secret /
    --github-private-key <pem-path>      GitHub App (deploys from GitHub)
  --inventpay-key / --inventpay-webhook-secret   Billing
  --telegram-token <token>               Telegram notifications

Skip individual phases (if already present):
  --skip-db      Don't install PostgreSQL
  --skip-caddy   Don't install Caddy
  --skip-web     Don't build/install the dashboard

Advanced:
  --db-pass <p>          PostgreSQL password (random if omitted)
  --jwt-secret <s>       JWT secret (random if omitted)
EOF
      exit 0 ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

[[ -z "$DOMAIN" ]] && { err "Missing --domain"; exit 1; }
[[ -z "$EMAIL"  ]] && { err "Missing --email"; exit 1; }
[[ $EUID -ne 0  ]] && { err "Must run as root"; exit 1; }

FRONTEND_URL="https://${DOMAIN}"

# ─── Banner ──────────────────────────────────────────────────────────
cat <<EOF

${BOLD}╔══════════════════════════════════════════════════════╗
║              ServerMe Self-Hosted Setup               ║
║   tunneling + deploys + managed DBs + analytics       ║
╚══════════════════════════════════════════════════════╝${NC}

  Domain:       ${DOMAIN}
  Email:        ${EMAIL}
  Install dir:  ${INSTALL_DIR}
  Web dir:      ${WEB_DIR}

EOF

# ─── 1. System packages ──────────────────────────────────────────────
step "1/11 — System packages"
apt-get update -qq
apt-get install -y -qq \
  curl wget tar gzip openssl git ca-certificates \
  iptables iptables-persistent \
  netcat-openbsd dnsutils \
  sshpass rclone rsync > /dev/null 2>&1
# sshpass — password SSH for BYOC + remote pool servers
# rclone  — off-site backup sync (R2/B2/S3)
# rsync   — used by web-deploy layout flatten step
log "System packages ready"

# Node.js 20 for building the Next.js frontend
if ! command -v node &> /dev/null || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  log "Installing Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi
log "Node.js $(node -v) ready"

# ─── 2. Docker (with multi-tenant-safe daemon config) ────────────────
step "2/11 — Docker (with icc=false + log rotation)"

if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
fi

# icc:false blocks container-to-container traffic on the default bridge.
# log rotation caps per-container logs at 150 MB total.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DAEMON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "icc": false
}
DAEMON
systemctl enable docker > /dev/null 2>&1
systemctl restart docker
log "Docker configured (icc=false, 50m×3 log rotation)"

# ─── 3. PostgreSQL ───────────────────────────────────────────────────
if [[ "$SKIP_DB" == false ]]; then
  step "3/11 — PostgreSQL"

  if ! command -v psql &> /dev/null; then
    apt-get install -y -qq postgresql postgresql-contrib > /dev/null 2>&1
  fi
  systemctl enable postgresql > /dev/null 2>&1
  systemctl start postgresql

  PG_VER=$(ls /etc/postgresql/ | head -1)
  PG_CONF="/etc/postgresql/${PG_VER}/main/postgresql.conf"
  PG_HBA="/etc/postgresql/${PG_VER}/main/pg_hba.conf"

  # Listen on all interfaces so user containers can reach the managed DB.
  sed -i "s/^#\?listen_addresses.*/listen_addresses = '*'/" "$PG_CONF"

  # sameuser rule = role X can only connect to database X (cross-tenant
  # isolation for the managed-DB feature).
  grep -q 'host all all 172.17.0.0/16 md5'            "$PG_HBA" || echo 'host all all 172.17.0.0/16 md5'            >> "$PG_HBA"
  grep -q 'host sameuser all 0.0.0.0/0 scram-sha-256' "$PG_HBA" || echo 'host sameuser all 0.0.0.0/0 scram-sha-256' >> "$PG_HBA"
  systemctl restart postgresql

  sudo -u postgres psql -c "CREATE USER serverme WITH SUPERUSER PASSWORD '${DB_PASS}';" 2>/dev/null || \
    sudo -u postgres psql -c "ALTER USER serverme WITH PASSWORD '${DB_PASS}';" 2>/dev/null || true
  sudo -u postgres psql -c "CREATE DATABASE serverme OWNER serverme;" 2>/dev/null || true
  log "PostgreSQL ready (user=serverme, db=serverme, external access enabled)"
else
  step "3/11 — Skipping PostgreSQL (--skip-db)"
fi

# ─── 4. Build ServerMe binaries from source ──────────────────────────
step "4/11 — Building ServerMe from source"

mkdir -p "${INSTALL_DIR}" "${INSTALL_DIR}/backups" "${INSTALL_DIR}/project-data"

# Install Go if missing
if ! command -v go &> /dev/null; then
  log "Installing Go 1.24…"
  ARCH=$(uname -m); case "$ARCH" in x86_64) GOARCH=amd64;; aarch64) GOARCH=arm64;; *) err "unsupported arch $ARCH"; exit 1;; esac
  wget -q "https://go.dev/dl/go1.24.3.linux-${GOARCH}.tar.gz" -O /tmp/go.tar.gz
  rm -rf /usr/local/go
  tar -C /usr/local -xzf /tmp/go.tar.gz
  export PATH=$PATH:/usr/local/go/bin
fi
command -v go &> /dev/null || export PATH=$PATH:/usr/local/go/bin

if [[ ! -d /tmp/serverme-src/.git ]]; then
  rm -rf /tmp/serverme-src
  git clone --depth 1 https://github.com/jams24/deployzy.git /tmp/serverme-src > /dev/null 2>&1
else
  ( cd /tmp/serverme-src && git pull --quiet )
fi

cd /tmp/serverme-src
CGO_ENABLED=0 go build -C server -ldflags="-s -w" -o /usr/local/bin/servermesrv ./cmd/servermesrv
CGO_ENABLED=0 go build -C cli    -ldflags="-s -w" -o /usr/local/bin/serverme    ./cmd/serverme
chmod +x /usr/local/bin/servermesrv /usr/local/bin/serverme
log "servermesrv + serverme (CLI) installed"

# ─── 5. Build + install the Next.js dashboard ───────────────────────
if [[ "$SKIP_WEB" == false ]]; then
  step "5/11 — Building the dashboard (Next.js)"
  cd /tmp/serverme-src/web
  # Bake the API URL at build time (Next.js NEXT_PUBLIC_* is compile-time)
  echo "NEXT_PUBLIC_API_URL=https://api.${DOMAIN}" > .env.production
  npm ci --no-audit --no-fund --silent
  npm run build --silent
  mkdir -p "${WEB_DIR}"
  rm -rf "${WEB_DIR}"/*
  cp -r .next/standalone/* "${WEB_DIR}/"
  mkdir -p "${WEB_DIR}/.next/static"
  cp -r .next/static "${WEB_DIR}/.next/"
  [[ -d public ]] && cp -r public "${WEB_DIR}/"
  log "Dashboard built to ${WEB_DIR}"
else
  step "5/11 — Skipping dashboard build (--skip-web)"
fi

# ─── 6. Caddy (TLS + on-demand certs for user custom domains) ──────
if [[ "$SKIP_CADDY" == false ]]; then
  step "6/11 — Caddy"
  if ! command -v caddy &> /dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https > /dev/null 2>&1
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
      gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > \
      /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy > /dev/null 2>&1
  fi
  # On-demand TLS asks our server ("is this hostname ours?") before issuing
  # a cert, letting users bring their own domain without any Caddy reload.
  cat > /etc/caddy/Caddyfile <<CADDY
{
    on_demand_tls {
        ask http://localhost:9080/health
    }
    email ${EMAIL}
}

https:// {
    tls { on_demand }

    @www host www.${DOMAIN}
    handle @www {
        redir https://${DOMAIN}{uri} permanent
    }

    @root host ${DOMAIN}
    handle @root {
        reverse_proxy localhost:3000
    }

    @api host api.${DOMAIN}
    handle @api {
        reverse_proxy localhost:9081
    }

    handle {
        reverse_proxy localhost:9080
    }
}
CADDY
  systemctl enable caddy > /dev/null 2>&1
  systemctl restart caddy
  log "Caddy configured with on-demand TLS"
else
  step "6/11 — Skipping Caddy (--skip-caddy)"
fi

# ─── 7. Systemd services ─────────────────────────────────────────────
step "7/11 — Systemd services"

# Build optional CLI flags only if the user supplied them.
GOOGLE_FLAGS="" ;  [[ -n "$GOOGLE_CLIENT_ID"  ]] && GOOGLE_FLAGS="--google-client-id=${GOOGLE_CLIENT_ID} --google-client-secret=${GOOGLE_CLIENT_SECRET} --frontend-url=${FRONTEND_URL}"
GITHUB_FLAGS="" ;  [[ -n "$GITHUB_APP_ID"     ]] && GITHUB_FLAGS="--github-app-id=${GITHUB_APP_ID} --github-client-id=${GITHUB_CLIENT_ID} --github-client-secret=${GITHUB_CLIENT_SECRET} --github-webhook-secret=${GITHUB_WEBHOOK_SECRET} --github-private-key=${GITHUB_PRIVATE_KEY_PATH}"
BILLING_FLAGS="" ; [[ -n "$INVENTPAY_KEY"     ]] && BILLING_FLAGS="--inventpay-key=${INVENTPAY_KEY} --inventpay-webhook-secret=${INVENTPAY_WEBHOOK_SECRET}"
TELEGRAM_FLAGS="" ; [[ -n "$TELEGRAM_TOKEN"   ]] && TELEGRAM_FLAGS="--telegram-token=${TELEGRAM_TOKEN}"

cat > /etc/systemd/system/serverme.service <<EOF
[Unit]
Description=ServerMe Tunnel + API Server
After=network.target postgresql.service

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/servermesrv \\
  --domain=${DOMAIN} \\
  --addr=:8443 \\
  --http-addr=:9080 \\
  --api-addr=:9081 \\
  --database-url=postgres://serverme:${DB_PASS}@localhost:5432/serverme?sslmode=disable \\
  --jwt-secret=${JWT_SECRET} \\
  --auth-token=${AUTH_TOKEN} \\
  ${GOOGLE_FLAGS} \\
  ${GITHUB_FLAGS} \\
  ${BILLING_FLAGS} \\
  ${TELEGRAM_FLAGS} \\
  --log-level=info
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

if [[ "$SKIP_WEB" == false ]]; then
  cat > /etc/systemd/system/serverme-web.service <<EOF
[Unit]
Description=ServerMe Dashboard (Next.js)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${WEB_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_PUBLIC_API_URL=https://api.${DOMAIN}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable --now serverme > /dev/null 2>&1
[[ "$SKIP_WEB" == false ]] && systemctl enable --now serverme-web > /dev/null 2>&1
sleep 3
systemctl is-active --quiet serverme   || { err "serverme failed to start — see: journalctl -u serverme -n 50"; exit 1; }
[[ "$SKIP_WEB" == false ]] && (systemctl is-active --quiet serverme-web || warn "serverme-web not running yet — see: journalctl -u serverme-web -n 50")
log "Services started"

# ─── 8. Firewall + container sandbox (iptables) ─────────────────────
step "8/11 — Firewall + container sandbox"

if command -v ufw &> /dev/null; then
  ufw allow 22/tcp   > /dev/null 2>&1 || true
  ufw allow 80/tcp   > /dev/null 2>&1 || true
  ufw allow 443/tcp  > /dev/null 2>&1 || true
  ufw allow 8443/tcp > /dev/null 2>&1 || true   # tunnel control
  ufw allow from 172.17.0.0/16 to any port 5432 > /dev/null 2>&1 || true
  ufw --force enable > /dev/null 2>&1 || true
  log "UFW: 22/80/443/8443 open, 5432 for container bridge"
fi

# iptables INPUT chain: block container→host EXCEPT :5432 (managed DB) and
# :53 (DNS). Inter-container traffic already blocked by icc=false.
iptables -C INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -I INPUT 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -C INPUT -i docker0 -p tcp --dport 5432 -j ACCEPT 2>/dev/null || \
  iptables -I INPUT 2 -i docker0 -p tcp --dport 5432 -j ACCEPT
iptables -C INPUT -i docker0 -p udp --dport 53   -j ACCEPT 2>/dev/null || \
  iptables -I INPUT 3 -i docker0 -p udp --dport 53   -j ACCEPT
iptables -C INPUT -i docker0 -j REJECT --reject-with icmp-port-unreachable 2>/dev/null || \
  iptables -I INPUT 4 -i docker0 -j REJECT --reject-with icmp-port-unreachable
mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4
log "iptables rules set + persisted"

# ─── 9. Daily cleanup (systemd timer) ───────────────────────────────
# Note: switched off /etc/cron.daily because the cron daemon isn't installed
# on every base image (e.g. some KVM Ubuntu templates ship without it).
# systemd timers are always present on systemd-init systems.
step "9/11 — Daily cleanup timer"
cat > /usr/local/bin/serverme-cleanup <<'CLEANUP'
#!/bin/bash
docker image prune -af --filter 'until=48h' > /dev/null 2>&1
docker builder prune -af > /dev/null 2>&1
find /var/lib/docker/containers -name '*.log' -size +100M -exec truncate -s 0 {} \; 2>/dev/null
find /tmp/serverme-build -maxdepth 1 -mtime +1 -exec rm -rf {} + 2>/dev/null
rm -rf /tmp/serverme-web-build /tmp/serverme-web-deploy 2>/dev/null
find /tmp -maxdepth 1 -name 'serverme-*.tar.gz' -mtime +1 -delete 2>/dev/null
rm -f /usr/local/bin/servermesrv.bak 2>/dev/null
truncate -s 0 /var/log/btmp 2>/dev/null
rm -f /var/log/btmp.1 2>/dev/null
journalctl --vacuum-size=100M > /dev/null 2>&1
apt-get clean > /dev/null 2>&1
echo "$(date): cleanup done, disk: $(df -h / | tail -1 | awk '{print $5}')" >> /var/log/serverme-cleanup.log
CLEANUP
chmod +x /usr/local/bin/serverme-cleanup

cat > /etc/systemd/system/serverme-cleanup.service <<EOF
[Unit]
Description=ServerMe daily cleanup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/serverme-cleanup
EOF

cat > /etc/systemd/system/serverme-cleanup.timer <<EOF
[Unit]
Description=Run ServerMe cleanup daily
Requires=serverme-cleanup.service
[Timer]
OnCalendar=daily
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now serverme-cleanup.timer > /dev/null 2>&1
log "Daily cleanup timer installed"

# ─── 10. Nightly platform backup ────────────────────────────────────
step "10/11 — Nightly platform backup"
mkdir -p /etc/serverme /var/backups/serverme
# Copy backup script alongside the binary; install-backup.sh contains the
# full setup logic (cron-or-timer + env template).
if [ -f "$(dirname "$0")/backup.sh" ]; then
    cp "$(dirname "$0")/backup.sh" /opt/serverme/backup.sh
    chmod 750 /opt/serverme/backup.sh

    cat > /etc/systemd/system/serverme-backup.service <<EOF
[Unit]
Description=ServerMe nightly backup
After=postgresql.service
[Service]
Type=oneshot
ExecStart=/opt/serverme/backup.sh
StandardOutput=append:/var/log/serverme-backup.log
StandardError=append:/var/log/serverme-backup.log
EOF

    cat > /etc/systemd/system/serverme-backup.timer <<EOF
[Unit]
Description=Run ServerMe nightly backup at 02:00 UTC
Requires=serverme-backup.service
[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

    # Off-site env template — admin fills in REMOTE=r2:bucket-name to enable.
    if [ ! -f /etc/serverme/backup-remote.env ]; then
        cat > /etc/serverme/backup-remote.env <<'ENVEOF'
# Off-site backup target. Leave REMOTE empty for local-only.
# After running `rclone config create r2 s3 ...`, set:
#   REMOTE=r2:serverme-backups
REMOTE=
ENVEOF
        chmod 600 /etc/serverme/backup-remote.env
    fi

    systemctl daemon-reload
    systemctl enable --now serverme-backup.timer > /dev/null 2>&1
    log "Backup timer installed (next run: 02:00 UTC) — local-only until rclone is configured"
else
    log "WARNING: deploy/backup.sh not found alongside install.sh — skipping backup setup"
fi

# ─── 11. Save credentials + summary ─────────────────────────────────
step "11/11 — Saving credentials"
CREDS="${INSTALL_DIR}/credentials.txt"
cat > "$CREDS" <<CREDS
# ServerMe credentials — KEEP SAFE
Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

Domain:     ${DOMAIN}
API:        https://api.${DOMAIN}
Dashboard:  https://${DOMAIN}
Tunnel:     ${DOMAIN}:8443

PostgreSQL:
  Host: localhost:5432
  DB:   serverme
  User: serverme
  Pass: ${DB_PASS}

JWT secret: ${JWT_SECRET}
CREDS
chmod 600 "$CREDS"

# ─── Print summary ──────────────────────────────────────────────────
cat <<EOF

${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗
║         ServerMe installed successfully!              ║
╚══════════════════════════════════════════════════════╝${NC}

  ${BOLD}Dashboard:${NC}     https://${DOMAIN}
  ${BOLD}API:${NC}           https://api.${DOMAIN}
  ${BOLD}Tunnel port:${NC}   ${DOMAIN}:8443

  ${BOLD}Credentials:${NC}   ${CREDS}

  ${CYAN}DNS records to create:${NC}
    A      ${DOMAIN}      → $(curl -s ifconfig.me 2>/dev/null || echo '<this-server-ip>')
    CNAME  *.${DOMAIN}    → ${DOMAIN}
    CNAME  api.${DOMAIN}  → ${DOMAIN}
    CNAME  www.${DOMAIN}  → ${DOMAIN}

  ${CYAN}Register the first account + make it admin:${NC}
    curl -X POST https://api.${DOMAIN}/api/v1/auth/register \\
      -H 'Content-Type: application/json' \\
      -d '{"email":"you@example.com","name":"Admin","password":"changeme"}'
    sudo -u postgres psql -d serverme \\
      -c "UPDATE users SET is_admin=true WHERE email='you@example.com'"

  ${CYAN}Service management:${NC}
    systemctl status serverme serverme-web
    journalctl -u serverme -f

EOF
