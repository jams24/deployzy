#!/usr/bin/env bash
# Installs the nightly platform backup on the primary host as a systemd
# service + timer (deployzy-backup.{service,timer}) — the units the admin
# console's Backups tab reads and triggers ("Run Now"). Idempotent — safe to
# re-run after updating backup.sh.
#
# History: the old installer used cron + /opt/serverme paths; the 2026-08-25
# VPS migration never re-ran it, so the new host had no backups at all until
# 2026-10-17. Re-run this on every new platform host.
set -euo pipefail

INSTALL_DIR=/opt/deployzy
SCRIPT_PATH=$INSTALL_DIR/backup.sh
ENV_DIR=/etc/deployzy
BACKUP_DIR=/var/backups/deployzy

mkdir -p "$INSTALL_DIR" "$ENV_DIR" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

install -m 750 "$(dirname "$0")/backup.sh" "$SCRIPT_PATH"
# Legacy path kept as a pointer so old docs/notes still work.
# (On hosts where /opt/serverme already points at /opt/deployzy, skip it.)
if [ ! /opt/serverme/backup.sh -ef "$SCRIPT_PATH" ]; then
    mkdir -p /opt/serverme && ln -sf "$SCRIPT_PATH" /opt/serverme/backup.sh
fi

# rclone for the off-site copy (no-op if already installed).
if ! command -v rclone >/dev/null 2>&1; then
    apt-get update -qq >/dev/null
    apt-get install -y -qq rclone >/dev/null
fi

# Low priority so a backup never competes with customer apps for CPU/disk.
cat > /etc/systemd/system/deployzy-backup.service <<EOF
[Unit]
Description=Deployzy nightly platform backup
After=network-online.target postgresql.service docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$SCRIPT_PATH
Nice=15
IOSchedulingClass=idle
TimeoutStartSec=3h
EOF

cat > /etc/systemd/system/deployzy-backup.timer <<'EOF'
[Unit]
Description=Run the Deployzy platform backup nightly at 02:00 UTC

[Timer]
OnCalendar=*-*-* 02:00:00 UTC
Persistent=true
RandomizedDelaySec=5m

[Install]
WantedBy=timers.target
EOF

# Retire the old cron entry if a previous installer left one.
rm -f /etc/cron.d/serverme-backup

systemctl daemon-reload
systemctl enable --now deployzy-backup.timer >/dev/null

# Off-site credentials template (never overwritten once filled in).
if [ ! -f "$ENV_DIR/backup-remote.env" ]; then
    cat > "$ENV_DIR/backup-remote.env" <<'EOF'
# Off-site backup target, used by backup.sh after each run.
# Leave REMOTE empty to keep backups local-only.
#
# Cloudflare R2:
#   rclone config create r2 s3 provider Cloudflare \
#     access_key_id KEY secret_access_key SECRET \
#     endpoint https://<account-id>.r2.cloudflarestorage.com no_check_bucket true
#   REMOTE=r2:deployzy-backups
REMOTE=
EOF
    chmod 600 "$ENV_DIR/backup-remote.env"
fi

echo "Installed:  $SCRIPT_PATH"
echo "Timer:      deployzy-backup.timer (02:00 UTC nightly) — $(systemctl is-active deployzy-backup.timer)"
echo "Local:      $BACKUP_DIR (7-day retention)"
echo "Off-site:   $ENV_DIR/backup-remote.env"
echo "Run now:    systemctl start deployzy-backup.service   (logs: journalctl -u deployzy-backup)"
