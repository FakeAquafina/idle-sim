#!/usr/bin/env bash
# Sets up (or updates) the village on a Debian/Ubuntu/Raspberry Pi OS box.
# Run it ON THE BOX, as your normal user, from the folder the code was copied to:
#
#   bash ~/idle-sim/deploy/install.sh
#
# It is safe to run again after every update: it installs Node 22 if missing,
# installs dependencies, builds the viewer, creates /etc/idle-sim/env on first
# run (moving a server/.env there if one exists), installs the systemd service
# and (re)starts it. sudo is used for apt, Node, the env file and systemd.
# Nothing in server/data is ever touched.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=idle-sim
RUN_USER="$(id -un)"
NODE_MAJOR_WANTED=22

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

if [ "$RUN_USER" = root ]; then
  echo "Run this as your normal user, not root; it will sudo where needed." >&2
  exit 1
fi

# ---- Node 22 ------------------------------------------------------------------
node_major() { node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0; }
if ! command -v node >/dev/null || [ "$(node_major)" -lt "$NODE_MAJOR_WANTED" ]; then
  say "Installing Node $NODE_MAJOR_WANTED from NodeSource (needs sudo)"
  if ! command -v apt-get >/dev/null; then
    echo "This script only knows apt-based systems. Install Node $NODE_MAJOR_WANTED yourself and rerun." >&2
    exit 1
  fi
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl gnupg rsync
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_WANTED}.x" | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
say "Node $(node -v), npm $(npm -v)"

# ---- Dependencies and the viewer build -----------------------------------------
cd "$DIR"
say "Installing dependencies"
npm ci --no-audit --no-fund
say "Building the viewer"
npm run build

# ---- Config: /etc/idle-sim/env, outside the checkout ---------------------------------
ENV_FILE=/etc/idle-sim/env
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$DIR/server/.env" ]; then
    say "Moving server/.env to $ENV_FILE (needs sudo)"
    sudo install -D -o root -g "$RUN_USER" -m 640 "$DIR/server/.env" "$ENV_FILE"
    rm -f "$DIR/server/.env"
  else
    say "Creating $ENV_FILE with a fresh admin token (needs sudo)"
    TOKEN="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
    TMP="$(mktemp)"
    sed -e "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$TOKEN|" "$DIR/.env.example" > "$TMP"
    sudo install -D -o root -g "$RUN_USER" -m 640 "$TMP" "$ENV_FILE"
    rm -f "$TMP"
  fi
fi
NEED_KEY=0
grep -q '^ANTHROPIC_API_KEY=.\+' "$ENV_FILE" || NEED_KEY=1
mkdir -p "$DIR/server/data"

# ---- systemd ----------------------------------------------------------------------
say "Installing the $SERVICE service (needs sudo)"
NPM_BIN="$(command -v npm)"
sed -e "s|__USER__|$RUN_USER|g" -e "s|__DIR__|$DIR|g" -e "s|__NPM__|$NPM_BIN|g" \
  "$DIR/deploy/idle-sim.service" | sudo tee "/etc/systemd/system/$SERVICE.service" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null
sudo systemctl restart "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  PORT="$(grep '^SIM_PORT=' "$ENV_FILE" | cut -d= -f2)"
  say "Running. Local address: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT:-3000}"
else
  say "The service did not start. Last log lines:"
  journalctl -u "$SERVICE" -n 30 --no-pager
  exit 1
fi

if [ "$NEED_KEY" = 1 ]; then
  cat <<EOF

NEXT: villagers are on autopilot until the server has a Claude key.
  sudo nano $ENV_FILE     # fill in ANTHROPIC_API_KEY (and NTFY_URL if you want phone pings)
  sudo systemctl restart $SERVICE
Your admin token is in that file too (for scripts/admin.ts and the SSH-tunnel admin UI).
EOF
fi
