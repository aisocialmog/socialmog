#!/usr/bin/env bash
# Copies the app's backups, uploads and reports to the cloud drive configured as rclone remote "offsite".
set -euo pipefail
DATA_DIR=/var/lib/socialmoghq
if ! rclone listremotes 2>/dev/null | grep -q '^offsite:'; then echo "$(date) no 'offsite' remote yet; run: sudo rclone config"; exit 0; fi
for d in backups uploads reports; do
  [[ -d "$DATA_DIR/$d" ]] && rclone copy "$DATA_DIR/$d" "offsite:SocialmogHQ/$d" --quiet
done
echo "$(date) off-site copy done"
