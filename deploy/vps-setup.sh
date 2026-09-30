#!/usr/bin/env bash
# =====================================================================
#  KURDISH TANK — one-command server setup for your own VPS
#  (Ubuntu / Debian / Rocky / AlmaLinux / CentOS Stream)
#
#  On the server, as root:
#      bash vps-setup.sh play.example.com      <- with your own domain
#      bash vps-setup.sh                       <- no domain: plain http, for testing
#
#  It installs Node 22, puts the game in /opt/kurdish-tank, starts it as a
#  service that comes back after a reboot, and (with a domain) sets up free
#  HTTPS with Caddy, renewed automatically.
#
#  IMPORTANT: voice chat, "add to home screen" and offline play only work
#  over https, so a domain is worth the ~$10 a year.
# =====================================================================
set -euo pipefail
DOMAIN="${1:-}"
APP=/opt/kurdish-tank
PORT=8080

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mX %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Run this as root:  sudo bash $0 ${DOMAIN}"

if command -v apt-get >/dev/null; then PM=apt; elif command -v dnf >/dev/null; then PM=dnf; else die "This script needs apt or dnf."; fi

say "Installing what the server needs"
if [ "$PM" = apt ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates rsync ufw >/dev/null
else
  dnf install -y -q curl ca-certificates rsync firewalld >/dev/null || true
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
  say "Installing Node 22"
  if [ "$PM" = apt ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null
    dnf install -y -q nodejs >/dev/null
  fi
fi
node -v | sed 's/^/    node /'

say "Copying the game to $APP"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$APP"
if command -v rsync >/dev/null; then
  rsync -a --delete --exclude data --exclude .git "$SRC"/ "$APP"/
else                                    # rsync missing: plain tar copy (keeps the data folder)
  (cd "$SRC" && tar --exclude=./data --exclude=./.git -cf - .) | (cd "$APP" && tar xf -)
fi
mkdir -p "$APP/data"
id kurdishtank >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin kurdishtank 2>/dev/null || useradd --system --home "$APP" --shell /sbin/nologin kurdishtank
chown -R kurdishtank:kurdishtank "$APP"

say "Making it start by itself (and after a reboot)"
ENVFILE=/etc/kurdish-tank.env
if [ ! -f "$ENVFILE" ]; then
  cat > "$ENVFILE" <<ENV
# Settings for the game server. Change a value, then:  systemctl restart kurdish-tank
PORT=$PORT
DATA_DIR=$APP/data
# --- free off-site backup of player progress (optional but recommended) ---
# SUPABASE_URL=https://xxxx.supabase.co
# SUPABASE_KEY=your-service-role-key
# --- Google Play payments (only needed for the Android app) ---
# ANDROID_PACKAGE=com.kurdishtank.app
ENV
  chmod 600 "$ENVFILE"
fi
cat > /etc/systemd/system/kurdish-tank.service <<UNIT
[Unit]
Description=Kurdish Tank game server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kurdishtank
WorkingDirectory=$APP
EnvironmentFile=$ENVFILE
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP/data

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now kurdish-tank >/dev/null
sleep 2
systemctl is-active --quiet kurdish-tank || { journalctl -u kurdish-tank -n 30 --no-pager; die "The game server did not start (log above)."; }

if [ -n "$DOMAIN" ]; then
  say "Setting up https for $DOMAIN (free certificate, renews itself)"
  if ! command -v caddy >/dev/null; then
    if [ "$PM" = apt ]; then
      apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      apt-get update -qq && apt-get install -y -qq caddy >/dev/null
    else
      dnf install -y -q 'dnf-command(copr)' >/dev/null && dnf copr enable -y @caddy/caddy >/dev/null && dnf install -y -q caddy >/dev/null
    fi
  fi
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
  systemctl enable --now caddy >/dev/null
  systemctl reload caddy || systemctl restart caddy
fi

say "Opening the firewall"
if command -v ufw >/dev/null; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80,443/tcp >/dev/null 2>&1 || true
  [ -z "$DOMAIN" ] && { ufw allow ${PORT}/tcp >/dev/null 2>&1 || true; }
  yes | ufw enable >/dev/null 2>&1 || true
elif command -v firewall-cmd >/dev/null; then
  systemctl enable --now firewalld >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null 2>&1 || true
  [ -z "$DOMAIN" ] && firewall-cmd --permanent --add-port=${PORT}/tcp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

IP="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
say "Done"
if [ -n "$DOMAIN" ]; then
  echo "    Your game:   https://$DOMAIN"
  echo "    Point the domain's A record at $IP if you have not already."
else
  echo "    Your game:   http://$IP:$PORT"
  echo "    Voice chat and 'add to home screen' need https — run this again with a domain:"
  echo "        bash $0 yourdomain.com"
fi
cat <<TIPS

    Useful commands
      systemctl status kurdish-tank      how it is doing
      systemctl restart kurdish-tank     restart it
      journalctl -u kurdish-tank -f      watch the log live
      nano /etc/kurdish-tank.env         settings (backup keys, port)

    To update the game later: copy the new files over and run this script again.
    Player progress lives in $APP/data and is never touched by an update.
TIPS
