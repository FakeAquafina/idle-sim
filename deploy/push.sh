#!/usr/bin/env bash
# Copies this checkout to the home box over SSH and runs the installer there.
# Run it FROM YOUR MAC (or any machine that can ssh to the box, e.g. over
# Tailscale). The first run installs everything; later runs are updates.
#
#   deploy/push.sh pi@homebox              # copy code, install/update, restart
#   deploy/push.sh pi@homebox --with-env   # also copy your local server/.env
#                                          # (API key + admin token); the installer
#                                          # moves it to /etc/idle-sim/env on the box
#
# Saved worlds, settings and the event log on the box are never overwritten.
set -euo pipefail

TARGET="${1:-}"
WITH_ENV=0
[ "${2:-}" = "--with-env" ] && WITH_ENV=1
if [ -z "$TARGET" ]; then
  echo "usage: deploy/push.sh user@host [--with-env]" >&2
  exit 1
fi
REMOTE_DIR="idle-sim"   # relative to the remote user's home
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

EXCLUDES=(node_modules dist .git .DS_Store .claude server/.env
  server/data/world.json server/data/world.json.tmp server/data/events.jsonl
  server/data/settings.json 'server/data/*.backup.json')

echo "==> Copying code to $TARGET:~/$REMOTE_DIR"
if ssh "$TARGET" 'command -v rsync >/dev/null'; then
  ARGS=()
  for e in "${EXCLUDES[@]}"; do ARGS+=(--exclude "$e"); done
  rsync -az --delete --info=progress2 "${ARGS[@]}" "$HERE/" "$TARGET:$REMOTE_DIR/"
else
  # Minimal LXC templates ship without rsync; a tar pipe works everywhere.
  echo "    (no rsync on the box, using tar)"
  ARGS=()
  for e in "${EXCLUDES[@]}"; do ARGS+=(--exclude "./$e"); done
  tar -C "$HERE" "${ARGS[@]}" -czf - . | ssh "$TARGET" "mkdir -p ~/$REMOTE_DIR && tar -xzf - -C ~/$REMOTE_DIR"
fi

if [ "$WITH_ENV" = 1 ]; then
  if [ ! -f "$HERE/server/.env" ]; then
    echo "No local server/.env to copy." >&2
    exit 1
  fi
  echo "==> Copying server/.env"
  scp -q "$HERE/server/.env" "$TARGET:$REMOTE_DIR/server/.env"
fi

echo "==> Running the installer on the box"
ssh -t "$TARGET" "bash ~/$REMOTE_DIR/deploy/install.sh"
