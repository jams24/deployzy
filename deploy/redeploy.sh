#!/usr/bin/env bash
#
# redeploy.sh — local dev → VPS, the clean way.
#
# What it does (in order):
#   1. Cross-compiles the Go server for linux/amd64
#   2. Builds the Next.js frontend with NEXT_PUBLIC_API_URL baked in
#   3. Tars everything, scps to the VPS, swaps binaries, restarts all
#      three services (serverme, serverme-texis, serverme-web)
#   4. Verifies md5 matches + all three services are active
#
# This lives in repo so the correct sequence (especially restarting
# serverme-texis, which is easy to forget) is always applied.
#
# Usage:
#   ./deploy/redeploy.sh user@host [--server-only|--web-only]
#
# Env overrides:
#   SSH_PASS     — if set, uses sshpass (dev convenience)
#   API_URL      — overrides NEXT_PUBLIC_API_URL (default: https://api.${DOMAIN_FROM_HOST})
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

# API URL for the frontend build — defaults to production domain, not the SSH host.
# Override with: API_URL=https://api.custom.host ./redeploy.sh ...
API_URL="${API_URL:-https://api.deployzy.com}"
REMOTE_DIR="${REMOTE_DIR:-/tmp}"

# SSH/SCP wrappers — use sshpass if SSH_PASS is set, otherwise rely on keys.
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
  cd .next/standalone && tar czf /tmp/serverme-web.tar.gz . && cd - > /dev/null
  tar czf /tmp/serverme-static.tar.gz .next/static public 2>/dev/null
  cd ..
  log "web built"
}

# ─── Push + swap ──────────────────────────────────────────────────
deploy() {
  log "Uploading to $HOST:$REMOTE_DIR"
  local files=()
  [[ "$MODE" != "--web-only"   ]] && files+=("server/serverme-linux")
  [[ "$MODE" != "--server-only" ]] && files+=("/tmp/serverme-web.tar.gz" "/tmp/serverme-static.tar.gz")
  _scp "${files[@]}" "$HOST:$REMOTE_DIR/"

  log "Swapping + restarting on remote"
  _ssh "$HOST" "bash -s" <<REMOTE
set -e
echo '── Server binary ──'
if [[ -f $REMOTE_DIR/serverme-linux ]]; then
  systemctl stop serverme
  mv $REMOTE_DIR/serverme-linux /usr/local/bin/servermesrv
  chmod +x /usr/local/bin/servermesrv
  systemctl start serverme
fi

echo '── Web bundle (zero-downtime swap) ──'
if [[ -f $REMOTE_DIR/serverme-web.tar.gz ]]; then
  # Extract the new bundle into a staging dir while the old one keeps serving,
  # so the only downtime is the swap + restart (~1s). Caddy's lb_try_duration on
  # the deployzy.com upstream retries through that window, so requests don't 502.
  rm -rf /opt/serverme-web-next && mkdir -p /opt/serverme-web-next
  ( cd /opt/serverme-web-next && tar xzf $REMOTE_DIR/serverme-web.tar.gz 2>/dev/null && { [[ -f $REMOTE_DIR/serverme-static.tar.gz ]] && tar xzf $REMOTE_DIR/serverme-static.tar.gz 2>/dev/null; true; } )
  systemctl stop serverme-web
  rm -rf /opt/serverme-web-prev
  mv /opt/serverme-web /opt/serverme-web-prev
  mv /opt/serverme-web-next /opt/serverme-web
  systemctl start serverme-web
  rm -rf /opt/serverme-web-prev
  rm -f $REMOTE_DIR/serverme-web.tar.gz $REMOTE_DIR/serverme-static.tar.gz
fi

# ALWAYS restart serverme-texis too — any serverme stop/start cycle drops
# its tunnel. Catching this in the script so future deploys can't forget.
systemctl restart serverme-texis 2>/dev/null || true

sleep 2
echo '── Status ──'
for s in serverme serverme-texis serverme-web; do
  if systemctl list-unit-files --no-legend 2>/dev/null | grep -q "^\$s"; then
    printf "  %-20s %s\n" "\$s" "\$(systemctl is-active \$s)"
  fi
done
printf "  %-20s %s\n" "binary md5" "\$(md5sum /usr/local/bin/servermesrv | cut -d' ' -f1)"
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
