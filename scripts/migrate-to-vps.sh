#!/usr/bin/env bash
# Copies YoungHub's data from this Mac to the server, then rewrites the paths there (/Users/… → /home/…).
# Run it ON THE MAC, once the server is ready (setup-vps.sh done, SSH works):
#   ./scripts/migrate-to-vps.sh emre@supersept            # simulation: shows what would be copied
#   ./scripts/migrate-to-vps.sh emre@supersept --apply    # does it
# Both YoungHubs must be stopped (the Mac one and the server one), so the database and the
# conversations are copied in a consistent state.
#
# Copied: ~/.claude-hub (database, memories, worktrees, attachments, agents' homes), ~/.claude (conversations,
# agents, CLAUDE.md, settings, skills, commands), every project folder registered in YoungHub, and
# ~/.claude.json as ~/.claude.json.from-mac (only folder trust and MCP servers are merged).
# Not copied: node_modules / .next (reinstall on the server), Claude and GitHub logins (log in again on the
# server), the phone pairing (pair again), plugins (reinstall the ones you want), live session files.
set -euo pipefail
HOST="${1:-}"
APPLY=0; [ "${2:-}" = "--apply" ] && APPLY=1
[ -n "$HOST" ] || { echo "Usage : $0 <utilisateur@serveur> [--apply]" >&2; exit 1; }
cd "$(dirname "$0")/.."
HUB="${CLAUDE_HUB_DIR:-$HOME/.claude-hub}"
[ "$HUB" = "$HOME/.claude-hub" ] || { echo "CLAUDE_HUB_DIR personnalisé : non géré par ce script." >&2; exit 1; }
PORT="${PORT:-4317}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

say "Vérifications"
command -v sqlite3 >/dev/null || die "sqlite3 introuvable"
# One connection for both checks (fail2ban counts connections).
REMOTE_INFO="$(ssh -o BatchMode=yes "$HOST" 'echo "$HOME"; command -v node >/dev/null && echo node-ok')" || die "SSH vers $HOST impossible (clé SSH ?)"
REMOTE_HOME="$(printf '%s\n' "$REMOTE_INFO" | head -1)"
echo "serveur : $HOST, dossier perso $REMOTE_HOME"
printf '%s\n' "$REMOTE_INFO" | grep -q '^node-ok$' || die "node absent du serveur : lance d'abord setup-vps.sh"
if [ "$APPLY" = 1 ]; then
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/state"; then
    die "YoungHub tourne encore sur ce Mac. Arrête-le d'abord (les sessions en cours seront coupées) :
    launchctl bootout gui/\$(id -u)/sh.supersept.local"
  fi
  if ssh "$HOST" 'systemctl is-active --quiet supersept'; then
    die "YoungHub tourne sur le serveur. Arrête-le : ssh $HOST sudo systemctl stop supersept"
  fi
fi

# Paths relative to the home folder, so they land at the same place under /home/<toi>.
REL=(.claude-hub)
for d in .claude/projects .claude/agents .claude/commands .claude/skills .claude/CLAUDE.md .claude/settings.json; do
  [ -e "$HOME/$d" ] && REL+=("$d")
done
OUTSIDE=()
while IFS= read -r p; do
  [ -n "$p" ] && [ -d "$p" ] || continue
  case "$p" in
    "$HUB"/*) ;;                                   # already inside ~/.claude-hub
    "$HOME") warn "projet = dossier perso, ignoré : $p" ;;
    "$HOME"/*) REL+=("${p#"$HOME"/}") ;;
    *) OUTSIDE+=("$p") ;;
  esac
done < <(sqlite3 "$HUB/hub.db" 'SELECT path FROM projects' 2>/dev/null)

EXCLUDES=(
  --exclude node_modules --exclude .next --exclude .turbo --exclude .DS_Store
  --exclude .claude-hub/hooks --exclude .claude-hub/remote.json --exclude .claude-hub/usage-cache.json
  --exclude .claude-hub/hub.db-wal --exclude .claude-hub/hub.db-shm --exclude '*.log'
)

say "À copier (tailles node_modules compris, ils ne seront pas copiés)"
for r in "${REL[@]}"; do printf '  %8s  ~/%s\n' "$(du -sh "$HOME/$r" 2>/dev/null | cut -f1)" "$r"; done
[ -f "$HOME/.claude.json" ] && echo "            ~/.claude.json → ~/.claude.json.from-mac"
# bash 3.2 (macOS) + set -u: an empty array expanded as "${a[@]}" is an "unbound variable".
for p in ${OUTSIDE[@]+"${OUTSIDE[@]}"}; do warn "hors du dossier perso, à copier à la main : $p"; done

if [ "$APPLY" = 0 ]; then
  echo
  echo "Simulation uniquement. Relance avec --apply pour copier (les deux YoungHub doivent être arrêtés)."
  exit 0
fi

say "Sauvegarde de ce qui existe déjà sur le serveur"
ssh "$HOST" 'set -e; cd ~; [ -e .claude-hub ] || [ -e .claude ] || exit 0
  f=avant-migration-$(date +%Y%m%d-%H%M%S).tgz; tar czf "$f" --ignore-failed-read .claude-hub .claude .claude.json 2>/dev/null || true; echo "→ ~/$f"'

say "Base de données"
sqlite3 "$HUB/hub.db" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null

say "Copie (peut être long la première fois)"
COPYFILE_DISABLE=1 tar -C "$HOME" --no-xattrs --no-mac-metadata "${EXCLUDES[@]}" -czf - "${REL[@]}" \
  | ssh "$HOST" 'tar -C ~ --warning=no-unknown-keyword -xzf -'
if [ -f "$HOME/.claude.json" ]; then
  ssh "$HOST" 'umask 077; cat > ~/.claude.json.from-mac' < "$HOME/.claude.json"
fi

say "Réécriture des chemins sur le serveur ($HOME → $REMOTE_HOME)"
ssh "$HOST" "node --input-type=module - --from '$HOME' --to '$REMOTE_HOME'" < scripts/rewrite-paths.mjs

say "Terminé. Sur le serveur :"
cat <<EOF
  ssh $HOST
  cd ~/supersept && ./scripts/install-service-linux.sh   # réinstalle les dépendances, recompile, démarre
  # puis, dans chaque projet qui en a besoin : npm install (les node_modules n'ont pas été copiés)
  npm run pair                                           # relie à nouveau le téléphone
Sur ce Mac, YoungHub reste arrêté : ne le relance pas en parallèle (deux copies divergeraient).
EOF
