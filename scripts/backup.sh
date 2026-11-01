#!/usr/bin/env bash
# Nightly backup of everything Supersept needs (memory, database, agents, conversations, projects) with restic.
# Configuration: ~/.config/supersept/backup.env (see docs/deploiement-vps.md), for example
#   RESTIC_REPOSITORY=sftp:u123456@u123456.your-storagebox.de:supersept
#   RESTIC_PASSWORD_FILE=/home/<toi>/.config/supersept/restic-password
# Without that file it still writes a consistent local copy of the database to ~/.claude-hub/backup/.
#   ./scripts/backup.sh          back up now
#   ./scripts/backup.sh --check  verify the repository
set -euo pipefail
CONF="$HOME/.config/supersept/backup.env"
HUB="${CLAUDE_HUB_DIR:-$HOME/.claude-hub}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && set -a && . "$CONF" && set +a
# shellcheck disable=SC1091
[ -f "$HOME/.config/supersept/env" ] && PROJECTS_DIR="$(sed -n 's/^SUPERSEPT_PROJECTS_DIR=//p' "$HOME/.config/supersept/env")"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/claude sessions}"
PROJECTS_DIR="${PROJECTS_DIR/#\~/$HOME}"

# 1. Consistent snapshot of the SQLite database (safe while Supersept is running, WAL included).
mkdir -p "$HUB/backup"
if [ -f "$HUB/hub.db" ]; then
  sqlite3 "$HUB/hub.db" ".backup '$HUB/backup/hub.db'"
  echo "base copiée → $HUB/backup/hub.db"
fi

if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  echo "Pas de dépôt restic configuré ($CONF) : seule la copie locale de la base a été faite."
  exit 0
fi

if [ "${1:-}" = "--check" ]; then restic check; exit; fi
restic cat config >/dev/null 2>&1 || restic init

# 2. Every project folder known to Supersept (outside the home too).
mapfile -t PROJECTS < <(sqlite3 "$HUB/backup/hub.db" "SELECT path FROM projects" 2>/dev/null || true)

PATHS=("$HUB" "$HOME/.claude" "$HOME/.config/supersept")
[ -f "$HOME/.claude.json" ] && PATHS+=("$HOME/.claude.json")
[ -d "$PROJECTS_DIR" ] && PATHS+=("$PROJECTS_DIR")
for p in "${PROJECTS[@]}"; do [ -d "$p" ] && PATHS+=("$p"); done

restic backup --one-file-system --tag supersept \
  --exclude node_modules --exclude .next --exclude .turbo --exclude .cache --exclude '*.log' \
  --exclude "$HUB/hub.db" --exclude "$HUB/hub.db-wal" --exclude "$HUB/hub.db-shm" \
  --exclude "$HOME/.claude/shell-snapshots" --exclude "$HOME/.claude/debug" --exclude "$HOME/.claude/statsig" \
  "${PATHS[@]}"

# 3. Keep 7 daily, 4 weekly and 6 monthly snapshots.
restic forget --tag supersept --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
echo "Sauvegarde terminée."
