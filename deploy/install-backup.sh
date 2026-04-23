#!/usr/bin/env bash
# Installs the nightly backup script + cron entry on the platform host.
# Idempotent — safe to re-run.
set -euo pipefail

INSTALL_DIR=/opt/serverme
SCRIPT_PATH=$INSTALL_DIR/backup.sh
CRON_FILE=/etc/cron.d/serverme-backup

mkdir -p "$INSTALL_DIR" /etc/serverme /var/backups/serverme

cp "$(dirname "$0")/backup.sh" "$SCRIPT_PATH"
chmod 750 "$SCRIPT_PATH"

# Install rclone if missing — needed for offsite sync. apt is fine on Ubuntu.
if ! command -v rclone >/dev/null 2>&1; then
    apt-get update -qq >/dev/null
    apt-get install -y -qq rclone >/dev/null
fi

# Cron @ 02:00 UTC daily. Output goes to syslog via the script's logger calls.
cat > "$CRON_FILE" <<EOF
# ServerMe nightly backup
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 2 * * * root $SCRIPT_PATH >> /var/log/serverme-backup.log 2>&1
EOF
chmod 644 "$CRON_FILE"

# Create the offsite-credentials env file if it doesn't exist, with a
# template — admin fills it in to enable R2/B2/S3 upload.
if [ ! -f /etc/serverme/backup-remote.env ]; then
    cat > /etc/serverme/backup-remote.env <<'EOF'
# Off-site backup target. Leave REMOTE empty to keep backups local-only.
#
# Example for Cloudflare R2 (recommended — free egress):
#   1. rclone config create r2 s3 provider Cloudflare \
#        access_key_id YOUR_ACCESS_KEY \
#        secret_access_key YOUR_SECRET \
#        endpoint https://<account>.r2.cloudflarestorage.com \
#        no_check_bucket true
#   2. Set REMOTE below to "r2:serverme-backups"
#
# Example for Backblaze B2:
#   rclone config create b2 b2 \
#       account YOUR_ACCOUNT_ID \
#       key YOUR_APP_KEY
#   Then REMOTE="b2:serverme-backups"

REMOTE=
EOF
    chmod 600 /etc/serverme/backup-remote.env
fi

echo "Installed: $SCRIPT_PATH"
echo "Cron:      $CRON_FILE (runs daily at 02:00 UTC)"
echo "Logs:      /var/log/serverme-backup.log"
echo "Local:    /var/backups/serverme/ (7-day retention)"
echo "Offsite:  edit /etc/serverme/backup-remote.env to enable"
echo
echo "Test it now: $SCRIPT_PATH"
