#!/usr/bin/env bash
# Disaster-recovery restore for ServerMe.
#
# Assumes `install.sh` has already run on this host (Postgres + Docker + Caddy
# + serverme services exist and are healthy). The restore wipes the platform's
# SaaS state (users, projects, env vars, configs) and replaces it with the
# contents of a nightly backup. Project CONTAINERS are NOT restored — they're
# rebuilt on demand by redeploying each project from its GitHub repo.
#
# Usage:
#   restore.sh latest                         # use newest backup in /var/backups/serverme
#   restore.sh 20260418-050000                # use exact backup TS
#   restore.sh /path/to/backup/dir            # use a directory (for R2-pulled backups)
#   restore.sh latest --redeploy-all          # also call admin API to redeploy every project
#
# Safety: refuses to run unless SERVERME_RESTORE_CONFIRM=yes is exported. This
# is a destructive op — `pg_dumpall --clean` drops every database in the
# cluster before recreating it.

set -euo pipefail

LOG_TAG="serverme-restore"
log() { logger -t "$LOG_TAG" "$1" 2>/dev/null || true; echo "[$(date -u +%FT%TZ)] $1"; }
die() { log "FATAL: $1"; exit 1; }

BACKUP_DIR_DEFAULT="/var/backups/serverme"
TARGET=""
DO_REDEPLOY="no"

for arg in "$@"; do
    case "$arg" in
        --redeploy-all) DO_REDEPLOY="yes" ;;
        --help|-h)
            sed -n '2,18p' "$0"
            exit 0
            ;;
        *) TARGET="${TARGET:-$arg}" ;;
    esac
done

[ -n "$TARGET" ] || die "usage: restore.sh <latest|TIMESTAMP|DIR> [--redeploy-all]"

if [ "${SERVERME_RESTORE_CONFIRM:-}" != "yes" ]; then
    cat >&2 <<MSG
Refusing to run without SERVERME_RESTORE_CONFIRM=yes.
This command will WIPE the current platform database and replace it with
the contents of the chosen backup. Run:

    SERVERME_RESTORE_CONFIRM=yes $0 $*
MSG
    exit 2
fi

# ── Locate backup artifacts ───────────────────────────────────────────────
if [ -d "$TARGET" ]; then
    BDIR="$TARGET"
    # Derive TS from the pg file inside
    PG_FILE=$(ls -1 "$BDIR"/pg-*.sql.gz 2>/dev/null | head -1) || true
    [ -n "$PG_FILE" ] || die "no pg-*.sql.gz in $BDIR"
    TS=$(basename "$PG_FILE" .sql.gz | sed 's/^pg-//')
elif [ "$TARGET" = "latest" ]; then
    BDIR="$BACKUP_DIR_DEFAULT"
    PG_FILE=$(ls -1t "$BDIR"/pg-*.sql.gz 2>/dev/null | head -1) || true
    [ -n "$PG_FILE" ] || die "no backups in $BDIR"
    TS=$(basename "$PG_FILE" .sql.gz | sed 's/^pg-//')
else
    BDIR="$BACKUP_DIR_DEFAULT"
    TS="$TARGET"
    PG_FILE="$BDIR/pg-${TS}.sql.gz"
    [ -f "$PG_FILE" ] || die "not found: $PG_FILE"
fi

CONFIG_FILE="$BDIR/config-${TS}.tar.gz"
DATA_FILE="$BDIR/data-${TS}.tar.gz"

log "backup dir : $BDIR"
log "timestamp  : $TS"
log "pg dump    : $PG_FILE        ($([ -f "$PG_FILE"    ] && stat -c%s "$PG_FILE" || echo missing) bytes)"
log "config tar : $CONFIG_FILE    ($([ -f "$CONFIG_FILE" ] && stat -c%s "$CONFIG_FILE" || echo missing) bytes)"
log "data tar   : $DATA_FILE      ($([ -f "$DATA_FILE"   ] && stat -c%s "$DATA_FILE" || echo missing) bytes)"

# ── Stop services to avoid writes during restore ──────────────────────────
log "stopping serverme services"
systemctl stop serverme serverme-web serverme-texis 2>/dev/null || true
# Pause the backup timer so a cron run doesn't race with the restore.
systemctl stop serverme-backup.timer 2>/dev/null || true

# ── 1. Restore Postgres cluster ───────────────────────────────────────────
# pg_dumpall was run with --clean --if-exists, so it DROP-then-CREATEs
# everything. We just pipe it into `psql` as the postgres superuser.
log "restoring Postgres cluster from $PG_FILE (this may take a while)"
gunzip -c "$PG_FILE" | sudo -u postgres psql -v ON_ERROR_STOP=1 -q >/var/log/serverme-restore-pg.log 2>&1 \
    || die "psql restore failed — see /var/log/serverme-restore-pg.log"
log "postgres restore done"

# ── 2. Restore /etc/serverme, systemd units, Caddyfile ────────────────────
if [ -f "$CONFIG_FILE" ]; then
    log "restoring config from $CONFIG_FILE"
    # Extract to / — tar was created with absolute paths (/etc/serverme/, etc.)
    tar xzf "$CONFIG_FILE" -C / 2>/dev/null || log "config extract had warnings (continuing)"
    systemctl daemon-reload
    # Caddy may need a reload too
    systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
    log "config restore done"
else
    log "no config tar — skipping"
fi

# ── 3. Restore project-data (deploy logs, transient state) ────────────────
if [ -f "$DATA_FILE" ]; then
    log "restoring project-data from $DATA_FILE"
    mkdir -p /opt/serverme
    tar xzf "$DATA_FILE" -C /opt/serverme 2>/dev/null || log "data extract had warnings (continuing)"
    log "project-data restore done"
else
    log "no data tar — skipping"
fi

# ── 4. Restart services ───────────────────────────────────────────────────
log "starting services"
systemctl start serverme
# Wait for serverme to be listening before starting the others — they depend
# on the API being up to register with it.
for i in $(seq 1 20); do
    if curl -fsS --max-time 2 http://127.0.0.1:9081/health >/dev/null 2>&1; then break; fi
    sleep 1
done
systemctl start serverme-web serverme-texis serverme-backup.timer 2>/dev/null || true

sleep 3
for s in serverme serverme-web serverme-texis; do
    log "$s: $(systemctl is-active $s 2>/dev/null || echo unknown)"
done

# ── 5. Post-restore reconciliation notes ──────────────────────────────────
PROJECT_COUNT=$(PGPASSWORD=$(awk -F'database-url=postgres://[^:]+:' '/database-url=/{print}' /etc/systemd/system/serverme.service 2>/dev/null | head -1 | sed 's/@.*//') psql -h localhost -U serverme -d serverme -tAc "SELECT COUNT(*) FROM projects WHERE github_repo IS NOT NULL AND github_repo <> '';" 2>/dev/null || echo "?")

log "restore complete."
log "projects with a github_repo : $PROJECT_COUNT (each needs a redeploy to rebuild its container)"

if [ "$DO_REDEPLOY" = "yes" ]; then
    log "triggering mass redeploy via admin API"
    # The admin API requires an admin JWT. Emit a one-shot token via a small
    # helper inside the server binary — this is scoped so the script can
    # drive the API without requiring the operator to log in first.
    TOKEN=$(/usr/local/bin/servermesrv admin-token 2>/dev/null || true)
    if [ -n "$TOKEN" ]; then
        curl -fsS -X POST "http://127.0.0.1:9081/api/v1/admin/redeploy-all" \
            -H "Authorization: Bearer $TOKEN" \
            && echo "" \
            || log "redeploy-all call failed — run it from the admin UI instead"
    else
        log "couldn't mint an admin token — click 'Redeploy all running' in /admin instead"
    fi
fi

cat <<NEXT

────────────────────────────────────────────────────────────────────────
Restore finished. Next steps:

  • Verify at https://deployzy.com/admin that users & projects are present.
  • Point DNS at this host if it's a new box.
  • Every project with a GitHub repo needs its container rebuilt. Either:
      - click "Redeploy all running" in the admin UI, or
      - re-run this script with --redeploy-all.
  • BYOC projects (user-owned VPSes) restore themselves on the user's next
    push or manual redeploy — their images live on their own infra.
────────────────────────────────────────────────────────────────────────
NEXT
