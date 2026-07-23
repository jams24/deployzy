#!/usr/bin/env bash
# Nightly backup for Deployzy platform.
#
# Backs up:
#   - Platform Postgres cluster (pg_dumpall covers the serverme DB + every
#     project_database + every standalone Postgres service in one pass)
#   - User project data volumes at /opt/deployzy/project-data/
#   - Critical config: /etc/deployzy/, GitHub App key, systemd units
#
# Local retention: 7 days at /var/backups/deployzy/
# Offsite (R2/B2/S3): if /etc/deployzy/backup-remote.env exists with rclone
# credentials, sync to the configured remote. Otherwise local-only.
set -euo pipefail

LOG_TAG="deployzy-backup"
log() { logger -t "$LOG_TAG" "$1"; echo "[$(date -u +%FT%TZ)] $1"; }

BACKUP_DIR="/var/backups/deployzy"
RETENTION_DAYS=7
TS=$(date -u +%Y%m%d-%H%M%S)
DAY=$(date -u +%Y%m%d)

mkdir -p "$BACKUP_DIR"
cd "$BACKUP_DIR"

# ── 1. Postgres cluster dump ─────────────────────────────────────────────
log "starting pg_dumpall"
PG_FILE="pg-${TS}.sql.gz"
sudo -u postgres pg_dumpall --clean --if-exists | gzip -9 > "$PG_FILE.tmp"
mv "$PG_FILE.tmp" "$PG_FILE"
PG_BYTES=$(stat -c%s "$PG_FILE")
log "pg_dumpall done: $PG_FILE ($PG_BYTES bytes)"

# ── 2. Project data volumes ──────────────────────────────────────────────
DATA_FILE="data-${TS}.tar.gz"
if [ -d /opt/deployzy/project-data ]; then
    log "tarring project data volumes"
    tar czf "$DATA_FILE.tmp" -C /opt/deployzy project-data 2>/dev/null || true
    mv "$DATA_FILE.tmp" "$DATA_FILE"
    DATA_BYTES=$(stat -c%s "$DATA_FILE" 2>/dev/null || echo 0)
    log "project data done: $DATA_FILE ($DATA_BYTES bytes)"
else
    log "no /opt/deployzy/project-data — skipping"
fi

# ── 2a. Standalone service volumes (Redis / MongoDB / MySQL) ──────────────
# pg_dumpall above covers every Postgres database, but Redis/Mongo/MySQL keep
# their data in Docker volumes named sm-svc-<id>-data — not under project-data,
# so they were previously never backed up. Bundle all of them into one
# svc-<TS>.tar.gz per run (single file keeps the admin backup listing clean and
# the run's files grouped by timestamp). No helper image: the local volume
# driver stores data on disk, so we tar the mountpoint directly.
log "backing up standalone service volumes"
SVC_STAGE=$(mktemp -d)
SVC_COUNT=0
for VOL in $(docker volume ls --format '{{.Name}}' | grep '^sm-svc-' || true); do
    MP=$(docker volume inspect -f '{{.Mountpoint}}' "$VOL" 2>/dev/null || true)
    { [ -z "$MP" ] || [ ! -d "$MP" ]; } && continue
    # tar exits 1 when a file changes mid-read (a live DB always writes), so we
    # can't trust its exit code — a valid archive is still produced. Count by
    # whether a non-empty file landed instead. `|| true` keeps set -e happy.
    tar czf "$SVC_STAGE/$VOL.tar.gz" -C "$MP" . 2>/dev/null || true
    [ -s "$SVC_STAGE/$VOL.tar.gz" ] && SVC_COUNT=$((SVC_COUNT + 1))
done
if [ "$SVC_COUNT" -gt 0 ]; then
    SVC_FILE="svc-${TS}.tar.gz"
    tar czf "$SVC_FILE.tmp" -C "$SVC_STAGE" . 2>/dev/null && mv "$SVC_FILE.tmp" "$SVC_FILE"
    log "local service volumes backed up: $SVC_COUNT volume(s) → $SVC_FILE"
else
    log "no standalone service volumes on this host"
fi
rm -rf "$SVC_STAGE"

# ── 2b. Platform-pool overflow servers ───────────────────────────────────
# When the admin adds extra platform servers (priority>=2) for overflow,
# customer projects deployed there have data volumes on the REMOTE host,
# invisible to the local tar above. SSH in, tar /opt/deployzy/project-data,
# stream the bytes back, and stage them for the same off-site sync.
#
# Excludes:
#   - is_local=true (covered above)
#   - user_id IS NOT NULL (user's BYOC — their backup responsibility)
#   - status != active (offline/draining hosts skipped to avoid hanging)
log "checking for platform-pool overflow servers"
mapfile -t POOL_ROWS < <(sudo -u postgres psql -t -A -F'|' serverme -c \
    "SELECT label, host, port, ssh_user, COALESCE(ssh_password,''), COALESCE(ssh_key,'')
     FROM worker_servers
     WHERE user_id IS NULL AND COALESCE(is_local,false) = false AND status = 'active'" 2>/dev/null || true)

for row in "${POOL_ROWS[@]}"; do
    [ -z "$row" ] && continue
    IFS='|' read -r LABEL HOST PORT SSH_USER SSH_PW SSH_KEY <<< "$row"
    SAFE_LABEL=$(echo "$LABEL" | tr -c 'A-Za-z0-9-' '_')
    REMOTE_FILE="data-${SAFE_LABEL}-${TS}.tar.gz"
    log "backing up remote pool server: $LABEL ($HOST)"

    if [ -n "$SSH_PW" ]; then
        sshpass -p "$SSH_PW" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
            "$SSH_USER@$HOST" -p "$PORT" \
            'tar czf - -C /opt/deployzy project-data 2>/dev/null || true' \
            > "$REMOTE_FILE.tmp" 2>/dev/null
    elif [ -n "$SSH_KEY" ]; then
        KEYFILE=$(mktemp)
        echo "$SSH_KEY" > "$KEYFILE"
        chmod 600 "$KEYFILE"
        ssh -i "$KEYFILE" -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
            "$SSH_USER@$HOST" -p "$PORT" \
            'tar czf - -C /opt/deployzy project-data 2>/dev/null || true' \
            > "$REMOTE_FILE.tmp" 2>/dev/null
        rm -f "$KEYFILE"
    else
        log "no credentials for $LABEL, skipping"
        continue
    fi

    if [ -s "$REMOTE_FILE.tmp" ]; then
        mv "$REMOTE_FILE.tmp" "$REMOTE_FILE"
        REMOTE_BYTES=$(stat -c%s "$REMOTE_FILE")
        log "remote $LABEL done: $REMOTE_FILE ($REMOTE_BYTES bytes)"
    else
        rm -f "$REMOTE_FILE.tmp"
        log "remote $LABEL FAILED or empty (continuing)"
    fi

    # Standalone service volumes on this platform server. The remote script
    # tars each sm-svc volume from its mountpoint into a staging dir, then
    # streams that dir back as one tar-of-tars: svc-<label>-<ts>.tar.
    SVC_REMOTE_FILE="svc-${SAFE_LABEL}-${TS}.tar"
    REMOTE_SVC_CMD='STAGE=$(mktemp -d); for V in $(docker volume ls --format "{{.Name}}" | grep "^sm-svc-"); do MP=$(docker volume inspect -f "{{.Mountpoint}}" "$V" 2>/dev/null); [ -d "$MP" ] && tar czf "$STAGE/$V.tar.gz" -C "$MP" . 2>/dev/null; done; tar cf - -C "$STAGE" . 2>/dev/null; rm -rf "$STAGE"'
    if [ -n "$SSH_PW" ]; then
        sshpass -p "$SSH_PW" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
            "$SSH_USER@$HOST" -p "$PORT" "$REMOTE_SVC_CMD" > "$SVC_REMOTE_FILE.tmp" 2>/dev/null
    elif [ -n "$SSH_KEY" ]; then
        KEYFILE=$(mktemp); echo "$SSH_KEY" > "$KEYFILE"; chmod 600 "$KEYFILE"
        ssh -i "$KEYFILE" -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
            "$SSH_USER@$HOST" -p "$PORT" "$REMOTE_SVC_CMD" > "$SVC_REMOTE_FILE.tmp" 2>/dev/null
        rm -f "$KEYFILE"
    fi
    if [ -s "$SVC_REMOTE_FILE.tmp" ]; then
        mv "$SVC_REMOTE_FILE.tmp" "$SVC_REMOTE_FILE"
        log "remote $LABEL service volumes: $(stat -c%s "$SVC_REMOTE_FILE") bytes"
    else
        rm -f "$SVC_REMOTE_FILE.tmp"
    fi
done

# ── 3. Critical config ───────────────────────────────────────────────────
CONFIG_FILE="config-${TS}.tar.gz"
log "tarring config (etc/deployzy, GitHub App key, systemd units)"
tar czf "$CONFIG_FILE.tmp" \
    /etc/deployzy/ \
    /etc/systemd/system/deployzy*.service \
    /etc/caddy/Caddyfile \
    2>/dev/null || true
mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
log "config done: $CONFIG_FILE"

# ── 4. Manifest ──────────────────────────────────────────────────────────
{
    echo "backup_timestamp: $TS"
    echo "hostname: $(hostname)"
    echo "postgres_dump: $PG_FILE"
    echo "project_data: $DATA_FILE"
    echo "config: $CONFIG_FILE"
    echo "postgres_size_bytes: $PG_BYTES"
    echo "remote_pool_backups:"
    for f in "$BACKUP_DIR"/data-*-"$TS".tar.gz; do
        [ -f "$f" ] || continue
        echo "  - $(basename "$f") ($(stat -c%s "$f") bytes)"
    done
} > "manifest-${TS}.txt"

# ── 5. Local retention sweep ─────────────────────────────────────────────
log "pruning local backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f -mtime +"$RETENTION_DAYS" -name '*.gz' -delete
# Remote service-volume bundles are plain .tar (a tar-of-tars); prune those too
# or they'd accumulate forever.
find "$BACKUP_DIR" -maxdepth 1 -type f -mtime +"$RETENTION_DAYS" -name 'svc-*.tar' -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -mtime +"$RETENTION_DAYS" -name 'manifest-*.txt' -delete

# ── 6. Off-site sync (only if credentials are present) ───────────────────
REMOTE_ENV=/etc/deployzy/backup-remote.env
# Note: backup-remote.env contains REMOTE=r2:serverme-backups (bucket name unchanged — R2 can't rename)
if [ -f "$REMOTE_ENV" ] && command -v rclone >/dev/null 2>&1; then
    # shellcheck disable=SC1090
    source "$REMOTE_ENV"
    if [ -n "${REMOTE:-}" ]; then
        log "uploading today's backups to $REMOTE"
        for f in "$BACKUP_DIR"/*"$TS"*; do
            [ -f "$f" ] || continue
            rclone copy "$f" "$REMOTE/$DAY/" --quiet || log "rclone copy $(basename "$f") FAILED (continuing)"
        done
        log "offsite upload done"
    fi
else
    log "no offsite remote configured — keeping local-only"
fi

log "backup run finished"
