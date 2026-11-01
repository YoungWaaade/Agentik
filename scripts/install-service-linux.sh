#!/usr/bin/env bash
# Installs YoungHub as a systemd service on Linux (the counterpart of install-service.sh on macOS):
# starts at boot, restarts if it crashes, logs in journald (journalctl -u supersept -f).
# Run it as the user YoungHub belongs to (not root); it uses sudo for the unit file.
# Idempotent: never restarts a running service on its own (that would kill the live sessions).
#   ./scripts/install-service-linux.sh            install / update
#   ./scripts/install-service-linux.sh --restart  also restart now
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
[ "$(id -u)" -ne 0 ] || { echo "Lance ce script avec ton utilisateur, pas root." >&2; exit 1; }
USER_NAME="$(id -un)"
NODE="$(command -v node)" || { echo "node introuvable" >&2; exit 1; }
CONF_DIR="$HOME/.config/supersept"
ENV_FILE="$CONF_DIR/env"
UNIT=/etc/systemd/system/supersept.service

mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"
if [ ! -f "$ENV_FILE" ]; then
  TS_NAME="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1 || true)"
  cat > "$ENV_FILE" <<EOF
# YoungHub configuration (read by systemd at start: sudo systemctl restart supersept after a change).
PORT=4317
# Listen on loopback only: phones come through Tailscale Serve (HTTPS), never directly.
SUPERSEPT_HOST=127.0.0.1
# Requests forwarded by Tailscale Serve count as remote: they need the pairing token (npm run pair).
SUPERSEPT_BEHIND_PROXY=1
# Address shown with the pairing QR code.
SUPERSEPT_PUBLIC_URL=${TS_NAME:+https://$TS_NAME}
# Where "new project" and "clone from GitHub" put folders (default: ~/claude sessions).
#SUPERSEPT_PROJECTS_DIR=$HOME/projets
#SUPERSEPT_USER_NAME=Prénom Nom
# Keys for external services (voice, etc.) go here: every session inherits them.
#ELEVENLABS_API_KEY=
#OPENAI_API_KEY=
EOF
  chmod 600 "$ENV_FILE"
  echo "→ configuration créée : $ENV_FILE"
fi

echo "→ dépendances et compilation"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm ci --no-audit --no-fund; fi
npm run build >/dev/null
# Web Push keys (iPhone notifications), kept in the env file; never regenerated once there.
node scripts/vapid-keys.mjs

TMP="$(mktemp)"
cat > "$TMP" <<EOF
[Unit]
Description=YoungHub (sessions Claude Code)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Group=$(id -gn)
WorkingDirectory=$ROOT
Environment=HOME=$HOME
Environment=SHELL=/bin/bash
Environment=PATH=$HOME/.local/bin:$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
EnvironmentFile=-$ENV_FILE
ExecStart=$NODE $ROOT/server/index.js
Restart=always
RestartSec=3
# Many parallel agents: lots of processes, files and terminals.
LimitNOFILE=65536
TasksMax=infinity
# On stop, give Claude sessions a moment to flush their transcripts.
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF

changed=1
if sudo test -f "$UNIT" && sudo cmp -s "$TMP" "$UNIT"; then changed=0; fi
if [ "$changed" = 1 ]; then
  sudo install -m 644 "$TMP" "$UNIT"
  sudo systemctl daemon-reload
  echo "→ service écrit : $UNIT"
fi
rm -f "$TMP"
sudo systemctl enable supersept >/dev/null 2>&1

if ! systemctl is-active --quiet supersept; then
  sudo systemctl start supersept
  echo "→ YoungHub démarré"
elif [ "${1:-}" = "--restart" ]; then
  sudo systemctl restart supersept
  echo "→ YoungHub redémarré"
else
  echo "→ YoungHub tourne déjà : pas de redémarrage automatique (les sessions en cours seraient coupées)."
  echo "  Pour appliquer le nouveau code : sudo systemctl restart supersept (quand aucune session ne tourne)."
fi
echo "Logs : journalctl -u supersept -f"
