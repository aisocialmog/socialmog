#!/usr/bin/env bash
# Update Socialmog HQ to the latest code: backs up the database first, then rebuilds and restarts.
# Run as:  sudo bash /opt/socialmoghq/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/socialmoghq; DATA_DIR=/var/lib/socialmoghq
git config --global --add safe.directory "$APP_DIR"
BRANCH="${BRANCH:-$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}"
mkdir -p "$DATA_DIR/backups"
sqlite3 "$DATA_DIR/hq.sqlite" ".backup '$DATA_DIR/backups/pre-update-$(date +%F-%H%M).sqlite'"
git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
cd "$APP_DIR" && npm ci && npm run build
chown -R socialmog:socialmog "$APP_DIR" "$DATA_DIR"
systemctl restart socialmoghq
sleep 3 && systemctl is-active --quiet socialmoghq && echo "Updated and running." || echo "Not running: journalctl -u socialmoghq -n 50"
