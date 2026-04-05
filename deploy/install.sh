#!/usr/bin/env bash
#
# ServerMe — Self-Hosted Installation Script
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/serverme/serverme/main/deploy/install.sh | bash -s -- \
#     --domain tunnel.yourdomain.com \
#     --email you@example.com
#
# Or download and run:
#   chmod +x install.sh
#   ./install.sh --domain tunnel.yourdomain.com --email you@example.com
#
# Requirements:
#   - Ubuntu 22.04+ or Debian 12+
#   - Root access
#   - Domain pointing to this server (A record + wildcard)
#

set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ServerMe]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step() { echo -e "\n${CYAN}━━━ ${BOLD}$*${NC}"; }

# ─── Defaults ────────────────────────────────────────────────
DOMAIN=""
EMAIL=""
DB_PASS=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
AUTH_TOKEN=$(openssl rand -hex 16)
INSTALL_DIR="/opt/serverme"
VERSION="latest"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
FRONTEND_URL=""
SKIP_CADDY=false
SKIP_DB=false

# ─── Parse args ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)        DOMAIN="$2"; shift 2 ;;
    --email)         EMAIL="$2"; shift 2 ;;
    --db-pass)       DB_PASS="$2"; shift 2 ;;
    --jwt-secret)    JWT_SECRET="$2"; shift 2 ;;
    --auth-token)    AUTH_TOKEN="$2"; shift 2 ;;
    --google-id)     GOOGLE_CLIENT_ID="$2"; shift 2 ;;
    --google-secret) GOOGLE_CLIENT_SECRET="$2"; shift 2 ;;
    --version)       VERSION="$2"; shift 2 ;;
    --skip-caddy)    SKIP_CADDY=true; shift ;;
    --skip-db)       SKIP_DB=true; shift ;;
    -h|--help)
      echo "ServerMe Self-Hosted Installer"
      echo ""
      echo "Usage: $0 --domain <domain> --email <email> [options]"
      echo ""
      echo "Required:"
      echo "  --domain <domain>        Base domain (e.g., tunnel.yourdomain.com)"
      echo "  --email <email>          Email for Let's Encrypt certificates"
      echo ""
      echo "Optional:"
      echo "  --db-pass <password>     PostgreSQL password (random if omitted)"
      echo "  --jwt-secret <secret>    JWT signing secret (random if omitted)"
      echo "  --auth-token <token>     Fallback auth token (random if omitted)"
      echo "  --google-id <id>         Google OAuth Client ID"
      echo "  --google-secret <secret> Google OAuth Client Secret"
      echo "  --version <version>      Version to install (default: latest)"
      echo "  --skip-caddy             Skip Caddy installation (if already installed)"
      echo "  --skip-db                Skip PostgreSQL installation (if already installed)"
      echo "  -h, --help               Show this help"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Validate ────────────────────────────────────────────────
if [[ -z "$DOMAIN" ]]; then
  err "Missing required --domain flag"
  echo "Usage: $0 --domain tunnel.yourdomain.com --email you@example.com"
  exit 1
fi

if [[ -z "$EMAIL" ]]; then
  err "Missing required --email flag"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root"
  exit 1
fi

FRONTEND_URL="https://${DOMAIN}"

# ─── Banner ──────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║         ServerMe Self-Hosted Setup        ║"
echo "  ║       Open-Source Tunneling Platform       ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Domain:   ${DOMAIN}"
echo "  Email:    ${EMAIL}"
echo ""

# ─── Step 1: System packages + Docker ──────────────────────
step "1/8 — Installing system packages"

apt-get update -qq
apt-get install -y -qq curl wget tar gzip openssl git > /dev/null 2>&1
log "System packages ready"

# Install Docker if not present (needed for ServerMe Deploy)
if ! command -v docker &> /dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
  systemctl enable docker > /dev/null 2>&1
  systemctl start docker
  log "Docker installed"
else
  log "Docker already installed"
fi

# ─── Step 2: PostgreSQL ─────────────────────────────────────
if [[ "$SKIP_DB" == false ]]; then
  step "2/8 — Installing PostgreSQL"

  if ! command -v psql &> /dev/null; then
    apt-get install -y -qq postgresql postgresql-contrib > /dev/null 2>&1
  fi

  systemctl enable postgresql > /dev/null 2>&1
  systemctl start postgresql

  sudo -u postgres psql -c "CREATE USER serverme WITH PASSWORD '${DB_PASS}';" 2>/dev/null || true
  sudo -u postgres psql -c "CREATE DATABASE serverme OWNER serverme;" 2>/dev/null || true
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE serverme TO serverme;" 2>/dev/null || true

  log "PostgreSQL ready (user: serverme, db: serverme)"
else
  step "2/8 — Skipping PostgreSQL (--skip-db)"
fi

# ─── Step 3: Download ServerMe binaries ─────────────────────
step "3/8 — Downloading ServerMe"

mkdir -p "${INSTALL_DIR}"

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  GOARCH="amd64" ;;
  aarch64) GOARCH="arm64" ;;
  *) err "Unsupported architecture: $ARCH"; exit 1 ;;
esac

if [[ "$VERSION" == "latest" ]]; then
  DOWNLOAD_URL="https://github.com/jams24/serverme/releases/latest/download"
else
  DOWNLOAD_URL="https://github.com/jams24/serverme/releases/download/${VERSION}"
fi

# Try GitHub releases first, fall back to building from source
if curl -fsSL -o /tmp/servermesrv.tar.gz "${DOWNLOAD_URL}/servermesrv_linux_${GOARCH}.tar.gz" 2>/dev/null; then
  tar -xzf /tmp/servermesrv.tar.gz -C /usr/local/bin/ servermesrv 2>/dev/null || \
    mv /tmp/servermesrv.tar.gz /dev/null
  log "Server binary downloaded"
else
  warn "GitHub release not found. Downloading from source..."

  if ! command -v go &> /dev/null; then
    log "Installing Go..."
    GO_VERSION="1.24.3"
    wget -q "https://go.dev/dl/go${GO_VERSION}.linux-${GOARCH}.tar.gz" -O /tmp/go.tar.gz
    rm -rf /usr/local/go
    tar -C /usr/local -xzf /tmp/go.tar.gz
    export PATH=$PATH:/usr/local/go/bin
  fi

  log "Building from source..."
  cd /tmp
  if [[ ! -d serverme-src ]]; then
    git clone --depth 1 https://github.com/jams24/serverme.git serverme-src 2>/dev/null
  fi
  cd serverme-src
  CGO_ENABLED=0 go build -C server -ldflags="-s -w" -o /usr/local/bin/servermesrv ./cmd/servermesrv
  CGO_ENABLED=0 go build -C cli -ldflags="-s -w" -o /usr/local/bin/serverme ./cmd/serverme
  cd /
  rm -rf /tmp/serverme-src
fi

# Also get the CLI
if curl -fsSL -o /tmp/serverme.tar.gz "${DOWNLOAD_URL}/serverme_linux_${GOARCH}.tar.gz" 2>/dev/null; then
  tar -xzf /tmp/serverme.tar.gz -C /usr/local/bin/ serverme 2>/dev/null || true
fi

chmod +x /usr/local/bin/servermesrv /usr/local/bin/serverme 2>/dev/null || true
log "Binaries installed"
/usr/local/bin/serverme version 2>/dev/null || log "(CLI not available, server-only install)"

# ─── Step 4: Caddy ──────────────────────────────────────────
if [[ "$SKIP_CADDY" == false ]]; then
  step "4/8 — Installing Caddy"

  if ! command -v caddy &> /dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https > /dev/null 2>&1
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    apt-get update -qq
    apt-get install -y -qq caddy > /dev/null 2>&1
  fi

  # Configure Caddy
  cat > /etc/caddy/Caddyfile << CADDY
${DOMAIN} {
    reverse_proxy localhost:9080
}

api.${DOMAIN} {
    reverse_proxy localhost:9081
}
CADDY

  caddy fmt --overwrite /etc/caddy/Caddyfile 2>/dev/null || true
  systemctl enable caddy > /dev/null 2>&1
  systemctl restart caddy

  log "Caddy installed and configured"
else
  step "4/8 — Skipping Caddy (--skip-caddy)"
fi

# ─── Step 5: Create systemd services ────────────────────────
step "5/8 — Creating systemd services"

# Build Google OAuth flags if provided
GOOGLE_FLAGS=""
if [[ -n "$GOOGLE_CLIENT_ID" ]]; then
  GOOGLE_FLAGS="--google-client-id=${GOOGLE_CLIENT_ID} --google-client-secret=${GOOGLE_CLIENT_SECRET} --frontend-url=${FRONTEND_URL}"
fi

cat > /etc/systemd/system/serverme.service << EOF
[Unit]
Description=ServerMe Tunnel Server
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
  --log-level=info
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable serverme > /dev/null 2>&1
systemctl start serverme

sleep 3

if systemctl is-active --quiet serverme; then
  log "ServerMe server is running"
else
  err "ServerMe failed to start. Check: journalctl -u serverme -n 20"
  exit 1
fi

# ─── Step 6: Firewall ───────────────────────────────────────
step "6/8 — Configuring firewall"

if command -v ufw &> /dev/null; then
  ufw allow 22/tcp   > /dev/null 2>&1 || true
  ufw allow 80/tcp   > /dev/null 2>&1 || true
  ufw allow 443/tcp  > /dev/null 2>&1 || true
  ufw allow 8443/tcp > /dev/null 2>&1 || true
  ufw --force enable > /dev/null 2>&1 || true
  log "Firewall configured (22, 80, 443, 8443)"
else
  warn "ufw not found, skipping firewall setup"
fi

# ─── Step 7: Done! ──────────────────────────────────────────
step "7/8 — Verifying installation"

HEALTH=$(curl -s http://localhost:9080/health 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q "ok"; then
  log "Health check passed"
else
  warn "Health check failed — server may still be starting"
fi

# ─── Save credentials ───────────────────────────────────────
CREDS_FILE="${INSTALL_DIR}/credentials.txt"
cat > "${CREDS_FILE}" << CREDS
# ServerMe Credentials — KEEP THIS SAFE
# Generated on $(date -u +"%Y-%m-%d %H:%M:%S UTC")

Domain:          ${DOMAIN}
API URL:         https://api.${DOMAIN}
Control Port:    ${DOMAIN}:8443

Database:
  Host:          localhost:5432
  Database:      serverme
  User:          serverme
  Password:      ${DB_PASS}

JWT Secret:      ${JWT_SECRET}
Auth Token:      ${AUTH_TOKEN}

Google OAuth:    ${GOOGLE_CLIENT_ID:-"not configured"}
CREDS
chmod 600 "${CREDS_FILE}"

# ─── Print summary ──────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║        ServerMe installed successfully!    ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "  ${BOLD}Tunnel Server:${NC}   https://${DOMAIN}"
echo -e "  ${BOLD}REST API:${NC}        https://api.${DOMAIN}"
echo -e "  ${BOLD}CLI Control:${NC}     ${DOMAIN}:8443"
echo ""
echo -e "  ${BOLD}Credentials saved to:${NC} ${CREDS_FILE}"
echo ""
echo -e "  ${CYAN}Connect from your local machine:${NC}"
echo ""
echo "    serverme authtoken ${AUTH_TOKEN}"
echo "    serverme http 3000 --server ${DOMAIN}:8443"
echo ""
echo -e "  ${CYAN}DNS Setup (if not done yet):${NC}"
echo ""
echo "    A     ${DOMAIN}       → $(curl -s ifconfig.me 2>/dev/null || echo '<this-server-ip>')"
echo "    CNAME *.${DOMAIN}     → ${DOMAIN}"
echo "    CNAME api.${DOMAIN}   → ${DOMAIN}"
echo ""
echo -e "  ${CYAN}Manage services:${NC}"
echo ""
echo "    systemctl status serverme"
echo "    journalctl -u serverme -f"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo "    1. Make sure DNS A and wildcard records point to this server"
echo "    2. Register an account: curl -X POST https://api.${DOMAIN}/api/v1/auth/register \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"email\":\"you@example.com\",\"name\":\"Admin\",\"password\":\"yourpassword\"}'"
echo "    3. Start tunneling!"
echo ""
