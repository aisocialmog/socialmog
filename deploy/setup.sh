#!/usr/bin/env bash
# One-time setup of Socialmog HQ on a fresh Ubuntu server (Oracle Cloud Always Free, or any VPS).
# Run as:  sudo bash setup.sh hq.yourdomain.tech you@youremail.com
# Safe to re-run: it keeps an existing .env and data, and only refreshes code, service and proxy.
# Moving from another host: add RESTORE_FROM=/path/to/socialmog-hq-everything-….tar.gz (Settings > Data & backups >
# Download everything) and APP_SECRET=<the old host's value>, e.g.  sudo RESTORE_FROM=… APP_SECRET=… bash setup.sh …
set -euo pipefail

DOMAIN="${1:-}"; FOUNDER_EMAIL="${2:-}"
REPO="${REPO:-https://github.com/Agdevesh/socialmoghq.git}"
BRANCH="${BRANCH:-claude/serene-wright-w0ubi0}"
APP_DIR=/opt/socialmoghq
DATA_DIR=/var/lib/socialmoghq
APP_USER=socialmog

if [[ $EUID -ne 0 ]]; then echo "Run with sudo: sudo bash setup.sh <domain> <founder-email>"; exit 1; fi
if [[ -z "$DOMAIN" || -z "$FOUNDER_EMAIL" ]]; then echo "Usage: sudo bash setup.sh <domain, e.g. hq.socialmog.tech, or auto> <founder email>"; exit 1; fi
# No domain? "auto" uses a free address that points at this server's IP (sslip.io), and HTTPS still works.
if [[ "$DOMAIN" == "auto" ]]; then
  IP="$(curl -fsS4 https://api.ipify.org)" || { echo "Could not find this server's public IP; pass a domain instead of auto."; exit 1; }
  DOMAIN="hq-${IP//./-}.sslip.io"
  echo "Using the address $DOMAIN"
fi

echo "==> 1/7 System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates gnupg sqlite3 debian-keyring debian-archive-keyring apt-transport-https netfilter-persistent iptables-persistent rclone

# Small machines (1 GB) need swap for the build.
if [[ $(free -m | awk '/^Mem:/{print $2}') -lt 2000 && ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> 2/7 Node.js 22"
if ! node -v 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> 3/7 Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> 4/7 Open ports 80 and 443 in the server firewall (Oracle images block them by default)"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport $p -j ACCEPT
done
netfilter-persistent save

echo "==> 5/7 App code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR" && chown "$APP_USER:$APP_USER" "$DATA_DIR" && chmod 700 "$DATA_DIR"
if [[ -n "${RESTORE_FROM:-}" ]]; then
  if [[ -f "$DATA_DIR/hq.sqlite" ]]; then echo "Not restoring: $DATA_DIR already has a database (nothing was changed)."
  else
    tar -xzf "$RESTORE_FROM" -C "$DATA_DIR" && chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
    echo "Restored the database and files from $RESTORE_FROM"
  fi
fi
git config --global --add safe.directory "$APP_DIR"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -d "$APP_DIR/.git" && -d "$SRC/.git" && "$SRC" != "$APP_DIR" ]]; then
  # Reuse the copy this script came from (no second download or password prompt).
  git config --global --add safe.directory "$SRC"
  git clone --branch "$BRANCH" "$SRC" "$APP_DIR"
  git -C "$APP_DIR" remote set-url origin "$(git -C "$SRC" remote get-url origin)"
elif [[ ! -d "$APP_DIR/.git" ]]; then
  if ! git clone --branch "$BRANCH" "$REPO" "$APP_DIR" 2>/dev/null; then
    echo "The repository is private. Paste a GitHub token with read access (input hidden):"
    read -rs TOKEN
    git clone --branch "$BRANCH" "https://x-access-token:${TOKEN}@${REPO#https://}" "$APP_DIR"
  fi
else
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi
cd "$APP_DIR"
npm ci
npm run build
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

if [[ ! -f "$APP_DIR/.env" ]]; then
  FOUNDER_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=' )Aa1"
  cat > "$APP_DIR/.env" <<ENV
PORT=4000
DATA_DIR=$DATA_DIR
APP_BASE_URL=https://$DOMAIN
APP_SECRET=${APP_SECRET:-$(openssl rand -hex 32)}
FOUNDER_EMAIL=$FOUNDER_EMAIL
FOUNDER_PASSWORD=$FOUNDER_PASSWORD
FOUNDER_NAME=Founder
SEED_DEMO=0
COOKIE_SECURE=1
ENV
  # Moving from the free Render + Supabase setup: the first start brings the database and files down from Supabase,
  # and the server keeps saving there afterwards (a free off-site copy).
  if [[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_KEY:-}" ]]; then
    printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_KEY=%s\n' "$SUPABASE_URL" "$SUPABASE_SERVICE_KEY" >> "$APP_DIR/.env"
  fi
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
  echo "$FOUNDER_PASSWORD" > /root/socialmog-founder-password.txt; chmod 600 /root/socialmog-founder-password.txt
fi

echo "==> 6/7 Run the app as a service, behind HTTPS"
cat > /etc/systemd/system/socialmoghq.service <<UNIT
[Unit]
Description=Socialmog HQ
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:4000
}
CADDY
systemctl daemon-reload
systemctl enable --now socialmoghq
systemctl restart socialmoghq
systemctl reload caddy || systemctl restart caddy

echo "==> 7/7 Daily off-server backup (runs once you connect a cloud drive with: sudo rclone config, remote name 'offsite')"
install -m 755 "$APP_DIR/deploy/offsite-backup.sh" /usr/local/bin/socialmog-offsite-backup
echo "30 3 * * * root /usr/local/bin/socialmog-offsite-backup >> /var/log/socialmog-backup.log 2>&1" > /etc/cron.d/socialmog-backup

sleep 3
systemctl is-active --quiet socialmoghq && echo "App is running." || { echo "App failed to start. See: journalctl -u socialmoghq -n 50"; exit 1; }
echo
echo "Done. Open https://$DOMAIN in a few minutes (HTTPS appears once the address points at this server)."
if [[ -n "${RESTORE_FROM:-}" ]] || grep -q '^SUPABASE_URL=' "$APP_DIR/.env"; then
  echo "Your data was brought over: sign in with the same logins as before and check recent records."
  rm -f /root/socialmog-founder-password.txt
elif [[ -f /root/socialmog-founder-password.txt ]]; then
  echo "Sign in as $FOUNDER_EMAIL with password: $(cat /root/socialmog-founder-password.txt)"
  echo "Change it straight away under Settings > My account, then run: sudo rm /root/socialmog-founder-password.txt"
fi
