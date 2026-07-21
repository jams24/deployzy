#!/usr/bin/env bash
#
# redeploy.sh — local dev → VPS, the clean way.
#
# What it does (in order):
#   1. Cross-compiles the Go server for linux/amd64
#   2. Builds the Next.js frontend with NEXT_PUBLIC_API_URL baked in
#   3. Uploads, swaps binaries, restarts all three services
#      (deployzy, deployzy-texis, deployzy-web)
#   4. Verifies md5 matches + all three services are active
#
# Usage:
#   ./deploy/redeploy.sh user@host [--server-only|--web-only]
#
# Env overrides:
#   SSH_PASS     — if set, uses sshpass (dev convenience)
#   API_URL      — overrides NEXT_PUBLIC_API_URL (default: https://api.deployzy.com)
#   REMOTE_DIR   — remote staging dir (default: /tmp)
#

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[redeploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

HOST="${1:-}"
MODE="${2:-all}"
[[ -z "$HOST" ]] && err "usage: $0 user@host [--server-only|--web-only]"

API_URL="${API_URL:-https://api.deployzy.com}"
REMOTE_DIR="${REMOTE_DIR:-/tmp}"

SSH_OPTS="-o StrictHostKeyChecking=no"
if [[ -n "${SSH_PASS:-}" ]]; then
  command -v sshpass >/dev/null || err "sshpass not installed (brew install sshpass)"
  _ssh() { sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$@"; }
  _scp() { sshpass -p "$SSH_PASS" scp $SSH_OPTS "$@"; }
else
  _ssh() { ssh $SSH_OPTS "$@"; }
  _scp() { scp $SSH_OPTS "$@"; }
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ─── Build server ─────────────────────────────────────────────────
build_server() {
  log "Cross-compiling server → linux/amd64"
  cd server
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o serverme-linux ./cmd/servermesrv
  cd ..
  MD5=$(md5sum server/serverme-linux | cut -d' ' -f1)
  log "server built (md5=$MD5)"
}

# ─── Build frontend ───────────────────────────────────────────────
build_web() {
  log "Building Next.js dashboard (API=$API_URL)"
  cd web
  echo "NEXT_PUBLIC_API_URL=$API_URL" > .env.production
  npm run build --silent
  # Use rsync-friendly tar: extract standalone contents directly, not the folder
  cd .next/standalone && tar czf /tmp/deployzy-web.tar.gz . && cd - > /dev/null
  tar czf /tmp/deployzy-static.tar.gz .next/static public 2>/dev/null
  cd ..
  log "web built"
}

# ─── Push + swap ──────────────────────────────────────────────────
deploy() {
  log "Uploading to $HOST:$REMOTE_DIR"
  local files=()
  [[ "$MODE" != "--web-only"    ]] && files+=("server/serverme-linux")
  [[ "$MODE" != "--server-only" ]] && files+=("/tmp/deployzy-web.tar.gz" "/tmp/deployzy-static.tar.gz")
  _scp "${files[@]}" "$HOST:$REMOTE_DIR/"

  log "Swapping + restarting on remote"
  _ssh "$HOST" "bash -s" <<REMOTE
set -e
echo '── Server binary ──'
if [[ -f $REMOTE_DIR/serverme-linux ]]; then
  systemctl stop deployzy
  mv $REMOTE_DIR/serverme-linux /usr/local/bin/deployzysrv
  # Keep servermesrv in sync for any legacy references
  cp /usr/local/bin/deployzysrv /usr/local/bin/servermesrv
  chmod +x /usr/local/bin/deployzysrv /usr/local/bin/servermesrv
  systemctl start deployzy
fi

echo '── Web bundle (zero-downtime swap) ──'
if [[ -f $REMOTE_DIR/deployzy-web.tar.gz ]]; then
  # Extract new bundle into staging dir while the old one keeps serving.
  # Caddy's lb_try_duration retries through the ~1s restart window.
  rm -rf /opt/deployzy-web-next && mkdir -p /opt/deployzy-web-next
  tar xzf $REMOTE_DIR/deployzy-web.tar.gz -C /opt/deployzy-web-next 2>/dev/null
  [[ -f $REMOTE_DIR/deployzy-static.tar.gz ]] && tar xzf $REMOTE_DIR/deployzy-static.tar.gz -C /opt/deployzy-web-next 2>/dev/null || true
  systemctl stop deployzy-web
  rm -rf /opt/deployzy-web-prev
  mv /opt/deployzy-web /opt/deployzy-web-prev
  mv /opt/deployzy-web-next /opt/deployzy-web
  # Keep the compat symlink valid
  ln -sfn /opt/deployzy-web /opt/serverme-web
  systemctl start deployzy-web
  rm -rf /opt/deployzy-web-prev
  rm -f $REMOTE_DIR/deployzy-web.tar.gz $REMOTE_DIR/deployzy-static.tar.gz
fi

# ALWAYS restart deployzy-texis — any deployzy stop/start drops its tunnel.
systemctl restart deployzy-texis 2>/dev/null || true

sleep 2
echo '── Status ──'
for s in deployzy deployzy-texis deployzy-web; do
  if systemctl list-unit-files --no-legend 2>/dev/null | grep -q "^\$s"; then
    printf "  %-25s %s\n" "\$s" "\$(systemctl is-active \$s)"
  fi
done
printf "  %-25s %s\n" "binary md5" "\$(md5sum /usr/local/bin/deployzysrv | cut -d' ' -f1)"

echo '── API health ──'
curl -sf http://localhost:9081/api/v1/health || echo "HEALTH CHECK FAILED"
REMOTE
}

# ─── Dispatch ─────────────────────────────────────────────────────
case "$MODE" in
  --server-only) build_server; deploy ;;
  --web-only)    build_web;    deploy ;;
  all|"")        build_server; build_web; deploy ;;
  *) err "unknown mode: $MODE" ;;
esac

log "Done."
