#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server (Hetzner Cloud) to run YoungHub. Idempotent: run it again any time,
# it only does what is missing.
#
#   curl -fsSLO https://raw.githubusercontent.com/YoungWaaade/supersept/main/scripts/setup-vps.sh
#   sudo bash setup-vps.sh <utilisateur>
#
# Options (environment variables):
#   SUPERSEPT_REPO   git URL of YoungHub        (default: https://github.com/YoungWaaade/supersept.git)
#   SUPERSEPT_BRANCH branch to check out          (default: main)
#   TS_AUTHKEY       Tailscale auth key, to join the tailnet without opening a link (optional)
#   SWAP_SIZE        swap file size               (default: 4G, "0" = none)
#   TIMEZONE         server time zone             (default: Europe/Paris)
#   SKIP_SSH_HARDEN  1 = leave the SSH config alone
#
# What it does: system updates + automatic security updates, a sudo user with your SSH key, SSH without
# password nor root, ufw firewall (SSH + Tailscale only), fail2ban, swap, Node.js 22, git, gh, Claude Code,
# Tailscale (+ HTTPS through Tailscale Serve), YoungHub as a systemd service, nightly backup timer.
# What it does NOT do: log in to Claude, GitHub or Tailscale for you (see the end of the run).
set -euo pipefail

USER_NAME="${1:-}"
REPO="${SUPERSEPT_REPO:-https://github.com/YoungWaaade/supersept.git}"
BRANCH="${SUPERSEPT_BRANCH:-main}"
SWAP_SIZE="${SWAP_SIZE:-4G}"
TIMEZONE="${TIMEZONE:-Europe/Paris}"
NODE_MAJOR=22

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
as_user() { sudo -u "$USER_NAME" -H bash -lc "$*"; }

[ "$(id -u)" -eq 0 ] || die "Lance-le en root : sudo bash $0 <utilisateur>"
[ -n "$USER_NAME" ] || die "Usage : sudo bash $0 <utilisateur>   (ex. : sudo bash $0 emre)"
[[ "$USER_NAME" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || die "Nom d'utilisateur invalide : $USER_NAME"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "Testé pour Ubuntu 24.04, détecté : ${PRETTY_NAME:-inconnu}"
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- system
say "Paquets système"
apt-get update -q
apt-get -yq -o Dpkg::Options::=--force-confold upgrade
apt-get install -yq --no-install-recommends \
  ca-certificates curl gnupg git build-essential python3 sqlite3 jq ripgrep tmux rsync restic \
  ufw fail2ban unattended-upgrades apt-listchanges needrestart unzip less htop

timedatectl set-timezone "$TIMEZONE" 2>/dev/null || true

say "Mises à jour de sécurité automatiques"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
# No automatic reboot: it would cut every running Claude session. Reboot by hand when
# /var/run/reboot-required exists (the login message says so).
cat > /etc/apt/apt.conf.d/52supersept-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null
# needrestart must never restart YoungHub after a library update (same reason).
if [ -d /etc/needrestart ]; then
  mkdir -p /etc/needrestart/conf.d
  echo '$nrconf{override_rc}{qr(^supersept)} = 0;' > /etc/needrestart/conf.d/90-supersept.conf
fi

# ---------------------------------------------------------------- user
say "Utilisateur $USER_NAME"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$USER_NAME"
fi
usermod -aG sudo "$USER_NAME"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
# sudo without password: the setup scripts and the service installer need it, and the account has no password.
echo "$USER_NAME ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$USER_NAME"
chmod 440 "/etc/sudoers.d/90-$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
if [ -s /root/.ssh/authorized_keys ]; then
  touch "$HOME_DIR/.ssh/authorized_keys"
  # Add root's keys (the one given to Hetzner at creation) without duplicating them.
  sort -u "$HOME_DIR/.ssh/authorized_keys" /root/.ssh/authorized_keys -o "$HOME_DIR/.ssh/authorized_keys"
fi
[ -f "$HOME_DIR/.ssh/authorized_keys" ] && chown "$USER_NAME:$USER_NAME" "$HOME_DIR/.ssh/authorized_keys" && chmod 600 "$HOME_DIR/.ssh/authorized_keys"
# Keep the user's services (and the lingering systemd user session) alive after logout.
loginctl enable-linger "$USER_NAME"

# ---------------------------------------------------------------- ssh
if [ "${SKIP_SSH_HARDEN:-0}" != 1 ]; then
  say "SSH : clé uniquement, pas de root"
  if [ -s "$HOME_DIR/.ssh/authorized_keys" ]; then
    cat > /etc/ssh/sshd_config.d/99-supersept.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
EOF
    sshd -t && systemctl reload ssh
  else
    warn "Aucune clé SSH pour $USER_NAME : SSH laissé tel quel pour ne pas te bloquer dehors."
  fi
fi

say "fail2ban (bannit les IP qui essaient des mots de passe)"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

# ---------------------------------------------------------------- swap
if [ "$SWAP_SIZE" != 0 ] && ! swapon --show=NAME --noheadings | grep -q .; then
  say "Swap $SWAP_SIZE (évite qu'un pic de sessions tue un processus)"
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-supersept.conf
fi
# Each Claude session watches files: raise inotify limits for many parallel agents.
cat > /etc/sysctl.d/91-supersept-inotify.conf <<'EOF'
fs.inotify.max_user_watches=1048576
fs.inotify.max_user_instances=1024
EOF
sysctl --system >/dev/null

# ---------------------------------------------------------------- node, gh, tailscale
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".").map(Number).reduce((a,v,i)=>a+v*[1e6,1e3,1][i],0) >= 22013000')" != true ]; then
  say "Node.js $NODE_MAJOR"
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q && apt-get install -yq nodejs
fi
echo "node $(node -v)"

if ! command -v gh >/dev/null; then
  say "GitHub CLI"
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
  apt-get update -q && apt-get install -yq gh
fi

if ! command -v tailscale >/dev/null; then
  say "Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled >/dev/null
if ! tailscale status >/dev/null 2>&1; then
  if [ -n "${TS_AUTHKEY:-}" ]; then
    tailscale up --authkey "$TS_AUTHKEY" --ssh --hostname supersept
  else
    warn "Tailscale n'est pas connecté : lance « sudo tailscale up --ssh --hostname supersept » et ouvre le lien affiché."
  fi
fi

# ---------------------------------------------------------------- firewall
say "Pare-feu ufw : SSH + Tailscale uniquement"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 41641/udp comment 'Tailscale direct' >/dev/null
ufw allow in on tailscale0 >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed -n '1,20p'

# ---------------------------------------------------------------- user tools
say "Claude Code"
if ! as_user 'command -v claude' >/dev/null 2>&1; then
  as_user 'curl -fsSL https://claude.ai/install.sh | bash'
fi
as_user 'grep -q ".local/bin" ~/.profile || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.profile'
as_user 'claude --version' || warn "claude n'est pas dans le PATH de $USER_NAME"

as_user 'git config --global init.defaultBranch main; git config --global pull.rebase false'
as_user 'git config --global --get user.name >/dev/null' || warn "git : configure ton identité (git config --global user.name / user.email)"

# ---------------------------------------------------------------- supersept
say "YoungHub"
APP_DIR="$HOME_DIR/supersept"
if [ ! -d "$APP_DIR/.git" ]; then
  if ! as_user "git clone --branch '$BRANCH' '$REPO' '$APP_DIR'"; then
    warn "Clonage impossible (repo privé ?). Connecte GitHub (gh auth login) puis relance ce script."
  fi
fi
if [ -f "$APP_DIR/package.json" ]; then
  as_user "cd '$APP_DIR' && ./scripts/install-service-linux.sh"
  # HTTPS for the phone: Tailscale Serve proxies https://<machine>.<tailnet>.ts.net to YoungHub on loopback.
  if tailscale status >/dev/null 2>&1; then
    if ! tailscale serve status 2>/dev/null | grep -q '127.0.0.1:4317'; then
      tailscale serve --bg --https=443 http://127.0.0.1:4317 \
        || warn "Tailscale Serve a échoué : active HTTPS dans la console Tailscale (DNS → HTTPS Certificates), puis relance."
    fi
    TS_NAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
    ENV_FILE="$HOME_DIR/.config/supersept/env"
    if [ -n "$TS_NAME" ] && ! grep -q "^SUPERSEPT_PUBLIC_URL=https://" "$ENV_FILE"; then
      sed -i "s|^SUPERSEPT_PUBLIC_URL=.*|SUPERSEPT_PUBLIC_URL=https://$TS_NAME|" "$ENV_FILE"
      warn "Adresse publique enregistrée (https://$TS_NAME) : prise en compte au prochain redémarrage de YoungHub."
    fi
  fi

  # Nightly backup at 03:30 (does a local database snapshot until restic is configured).
  cat > /etc/systemd/system/supersept-backup.service <<EOF
[Unit]
Description=Sauvegarde YoungHub
After=network-online.target

[Service]
Type=oneshot
User=$USER_NAME
Environment=HOME=$HOME_DIR
ExecStart=$APP_DIR/scripts/backup.sh
Nice=10
IOSchedulingClass=idle
EOF
  cat > /etc/systemd/system/supersept-backup.timer <<'EOF'
[Unit]
Description=Sauvegarde YoungHub chaque nuit

[Timer]
OnCalendar=*-*-* 03:30
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now supersept-backup.timer >/dev/null
fi

# ---------------------------------------------------------------- what's left
say "Terminé. À faire toi-même (une seule fois), connecté en SSH avec $USER_NAME :"
cat <<EOF
  1. Claude Code : lance « claude », choisis la connexion par abonnement, ouvre le lien sur ton Mac
     ou ton téléphone et colle le code. Accepte le thème et quitte (/exit).
  2. GitHub : « gh auth login » (GitHub.com → HTTPS → navigateur, code à 8 caractères), puis « gh auth setup-git ».
     Identité git : git config --global user.name "…" ; git config --global user.email "…"
  3. Tailscale : si ce n'est pas fait, « sudo tailscale up --ssh --hostname supersept », puis relance ce script.
  4. Redémarre YoungHub pour prendre la config : sudo systemctl restart supersept
  5. Téléphone : « cd ~/supersept && npm run pair », scanne le QR code (Tailscale allumé sur l'iPhone).
  6. Sauvegardes distantes : remplis ~/.config/supersept/backup.env (voir docs/deploiement-vps.md).
EOF
[ -f /var/run/reboot-required ] && warn "Un redémarrage est nécessaire (noyau mis à jour) : sudo reboot"
exit 0
