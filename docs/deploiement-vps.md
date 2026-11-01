# Faire tourner Supersept sur un VPS Hetzner

Ce guide déplace Supersept du Mac vers un serveur Hetzner Cloud. À la fin :

- Supersept, Claude Code, la mémoire, les projets, les worktrees et les agents vivent **sur le serveur**, allumé 24 h/24 ;
- tu y accèdes depuis l'iPhone **et** depuis le Mac par une adresse HTTPS privée (Tailscale), jamais exposée sur internet ;
- tout est sauvegardé chaque nuit, et les données du Mac ont été reprises.

Durée : environ 1 h, dont 20 min d'attente (copie des données).

---

## 1. Ce qui dépend du Mac aujourd'hui

| Élément | Où | Sur le serveur |
|---|---|---|
| Base (projets, espaces, activité) | `~/.claude-hub/hub.db` (SQLite, chemins absolus dedans) | copiée, chemins réécrits `/Users/<toi>` → `/home/<toi>` |
| Mémoire des projets | `~/.claude-hub/memory/*.md` | copiée telle quelle |
| Worktrees git | `~/.claude-hub/worktrees/` (liens `.git` absolus) | copiés, liens réparés (`git worktree repair`) |
| Pièces jointes, maisons des agents, réglages | `~/.claude-hub/attachments`, `agent-home/`, `autotrust.json`, `relay.json`… | copiés |
| Accès téléphone | `~/.claude-hub/remote.json` | **pas copié** : on relie à nouveau le téléphone |
| Conversations Claude Code | `~/.claude/projects/<chemin-encodé>/*.jsonl` (dossier nommé d'après le chemin) | copiées, dossiers renommés, chemins réécrits, dates conservées |
| Agents Supersept | `~/.claude/agents/*.md` | copiés |
| Réglages Claude Code | `~/.claude/settings.json`, `CLAUDE.md`, `skills/`, `commands/` | copiés |
| Dossiers de confiance, serveurs MCP | `~/.claude.json` | fusionnés (les MCP propres au Mac comme Pencil sont ignorés) |
| Connexion Claude Code | Trousseau macOS | **à refaire** sur le serveur (`claude` puis /login) |
| Connexion GitHub | `gh` (Trousseau) | **à refaire** (`gh auth login`) |
| Dossiers de projets | chemins de la table `projects` (souvent `~/claude sessions/…`) | copiés sans `node_modules` |
| Service | LaunchAgent macOS (`install-service.sh`) | systemd (`install-service-linux.sh`) |
| Fonctions propres au Mac | choix de dossier (`osascript`), « Ouvrir dans VS Code / Finder » (`open -a`) | sans effet sur le serveur : tape le chemin, utilise VS Code Remote-SSH |

### Modifications de code faites pour le serveur

Elles ne changent rien sur le Mac tant que les variables ne sont pas définies :

| Variable | Rôle |
|---|---|
| `SUPERSEPT_HOST` | adresse d'écoute forcée. Sur le serveur : `127.0.0.1`, le port 4317 n'est jamais ouvert sur le réseau |
| `SUPERSEPT_BEHIND_PROXY=1` | derrière Tailscale Serve (ou Caddy), tout le monde arrive par 127.0.0.1 : une requête relayée (en-têtes `X-Forwarded-*`, ou nom d'hôte non local) est traitée comme un appareil distant et **exige le jeton d'appairage**. Seuls les hooks, la commande `supersept` des agents et un tunnel SSH restent « locaux » |
| `SUPERSEPT_PUBLIC_URL` | adresse HTTPS affichée avec le QR code d'appairage |
| `SUPERSEPT_ORIGINS` | origines supplémentaires autorisées pour l'accès local (séparées par des virgules) |
| `SUPERSEPT_PROJECTS_DIR` | où créer et cloner les projets (par défaut `~/claude sessions`) |
| `SUPERSEPT_USER_NAME` | ton nom affiché (Linux n'a pas `id -F`, Supersept lit sinon le champ GECOS) |

Autres changements : le shell par défaut bascule sur bash si zsh n'existe pas, le cookie d'appairage est marqué `Secure` en HTTPS, les WebSockets relayés sont coupés quand on révoque l'accès, et `npm run pair` affiche le QR code dans le terminal (le serveur n'a pas d'écran).

---

## 2. Choisir l'offre Hetzner

Chaque session Claude Code consomme environ 300 à 500 Mo de RAM, plus ce que lancent les agents (`npm run dev`, tests, navigateur). Le processeur est peu sollicité : le calcul se fait chez Anthropic. **La RAM décide du nombre de sessions en parallèle.**

| Offre | vCPU / RAM / disque | Prix HT/mois (oct. 2026, IPv4 compris) | Sessions en parallèle |
|---|---|---|---|
| **CX33** (Cost-Optimized, x86, Intel/AMD) | 4 / 8 Go / 80 Go | ≈ 9 € | 10 à 15 |
| CX43 | 8 / 16 Go / 160 Go | ≈ 16,50 € | 25 à 35 |
| CAX21 (ARM Ampere) | 4 / 8 Go / 80 Go | ≈ 8,50 € | 10 à 15 |
| CAX31 (ARM) | 8 / 16 Go / 160 Go | ≈ 16,50 € | 25 à 35 |

**Recommandation : CX33** en x86, à Nuremberg (`nbg1`) ou Falkenstein (`fsn1`) : environ 20 ms depuis la France. Passe en **CX43** quand le serveur commence à swapper (`free -h`). Le changement d'offre prend 2 minutes, depuis la console, serveur éteint : choisis « CPU et RAM uniquement » pour pouvoir redescendre ensuite.

- Hetzner a augmenté ses prix deux fois en 2026, et la gamme Cost-Optimized (CX) est par moments **indisponible** à la commande. Vérifie le prix sur la page de commande. Si les CX sont indisponibles, prends un **CAX21** (ARM) : Node, Claude Code, gh et Tailscale existent tous en ARM. Seul piège : Google Chrome n'existe pas en Linux ARM. Si tes projets lancent des tests navigateur, il faudra Chromium. Les CPX (« Regular Performance ») marchent aussi, mais coûtent environ 4 fois plus pour la même RAM.
- **Garde l'IPv4** (+0,50 €) : GitHub n'est pas joignable en IPv6 seul.
- Coche **Sauvegardes** (+20 % du prix du serveur) : instantanés quotidiens de tout le disque, 7 conservés. C'est le filet de sécurité numéro un.
- Image : **Ubuntu 24.04**.

---

## 3. Créer le serveur

1. Sur le Mac, crée une clé SSH si tu n'en as pas : `ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -C "mac"`.
2. [console.hetzner.cloud](https://console.hetzner.cloud) → nouveau projet « Supersept » → **Ajouter un serveur** :
   - Emplacement : Nuremberg ou Falkenstein ;
   - Image : Ubuntu 24.04 ;
   - Type : CX33 (ou CAX21) ;
   - Réseau : IPv4 + IPv6 ;
   - **Clés SSH** : colle le contenu de `~/.ssh/id_ed25519.pub` (pas de mot de passe root envoyé par e-mail) ;
   - **Pare-feu** : crée-en un (« supersept ») avec en entrée seulement **TCP 22** et **UDP 41641** (Tailscale). Tout le reste est fermé ;
   - **Sauvegardes** : activées ;
   - Nom : `supersept`.
3. Note l'IP publique, puis teste : `ssh root@<IP>`.

---

## 4. Installer et sécuriser : `setup-vps.sh`

Le script est **idempotent** : tu peux le relancer autant de fois que tu veux. Il ne fait que ce qui manque.

```bash
ssh root@<IP>
curl -fsSLO https://raw.githubusercontent.com/YoungWaaade/supersept/main/scripts/setup-vps.sh
less setup-vps.sh          # lis-le avant de l'exécuter
sudo bash setup-vps.sh emre        # « emre » = ton futur utilisateur
```

> Tant que cette branche n'est pas fusionnée dans `main`, copie le script depuis le Mac :
> `scp scripts/setup-vps.sh root@<IP>:` puis `SUPERSEPT_BRANCH=migration-vps-hetzner bash setup-vps.sh emre`.
> Si le repo est privé, le clonage échoue la première fois : connecte GitHub (étape 5), puis relance le script.

Ce qu'il fait :

- **Mises à jour** : `apt upgrade`, puis mises à jour de sécurité automatiques (`unattended-upgrades`), **sans redémarrage automatique** (il couperait les sessions). Quand la connexion SSH affiche « System restart required », redémarre à un moment calme : `sudo reboot`. Supersept repart seul et relance les agents qui tournaient ;
- **Utilisateur non-root** `emre`, membre de `sudo` (sans mot de passe : le compte n'en a pas, il n'est joignable que par clé), qui reçoit ta clé SSH ;
- **SSH** : connexion par clé uniquement, root interdit (seulement si ta clé est bien en place, pour ne pas te bloquer dehors), et **fail2ban** ;
- **Pare-feu ufw** : tout fermé sauf SSH et Tailscale, en plus du pare-feu Hetzner ;
- **Swap** de 4 Go et limites `inotify` relevées, pour beaucoup d'agents en parallèle ;
- **Node.js 22**, git, **gh**, sqlite3, ripgrep, restic, outils de compilation (pour `node-pty`) ;
- **Tailscale**, et **Claude Code** (installeur officiel, dans `~/.local/bin`) ;
- **Supersept** cloné dans `~/supersept`, compilé et installé comme **service systemd** (`supersept.service`) : il démarre au boot et redémarre s'il plante ;
- **Tailscale Serve** : `https://supersept.<ton-tailnet>.ts.net` → `127.0.0.1:4317`, avec un vrai certificat HTTPS ;
- **Sauvegarde** chaque nuit à 3 h 30 (`supersept-backup.timer`).

Options : `TS_AUTHKEY=tskey-…` (rejoindre Tailscale sans ouvrir de lien), `SWAP_SIZE=8G`, `TIMEZONE=…`, `SUPERSEPT_REPO=…`, `SUPERSEPT_BRANCH=…`.

À partir de maintenant, connecte-toi avec ton utilisateur : `ssh emre@<IP>`. `ssh root@…` est refusé.

### Pourquoi systemd et pas Docker

Supersept lance de vrais terminaux, avec Claude Code, git, gh, npm, ta clé SSH et tes outils. Dans un conteneur, chaque outil dont un agent a besoin (Python, un navigateur, une base…) devrait être ajouté à l'image, et les chemins seraient encore différents. systemd fait la même chose plus simplement : démarrage au boot, redémarrage en cas de plantage, logs (`journalctl -u supersept -f`).

Commandes utiles :

```bash
systemctl status supersept           # état
journalctl -u supersept -f           # logs en direct
sudo systemctl restart supersept     # redémarrer (coupe les sessions en cours !)
nano ~/.config/supersept/env         # configuration (puis restart)
```

---

## 5. Connecter les comptes (une fois, en SSH)

```bash
ssh emre@<IP>

# Tailscale (si le script l'a signalé) : ouvre le lien affiché, sur ton Mac ou ton téléphone
sudo tailscale up --ssh --hostname supersept

# Claude Code : abonnement Pro/Max
claude
#   → choisis « Claude account with subscription », ouvre le lien sur le Mac ou l'iPhone,
#     connecte-toi, colle le code. Accepte le thème, puis /exit.
#   Les identifiants vont dans ~/.claude/.credentials.json (lisible par toi seul).

# GitHub
gh auth login          # GitHub.com → HTTPS → Login with a web browser (code à 8 caractères)
gh auth setup-git      # git push/pull passent par gh, sans clé SSH supplémentaire
git config --global user.name  "Ton Nom"
git config --global user.email "toi@exemple.fr"

# Relance le script pour finir ce qui attendait ces connexions (clone, Tailscale Serve)
sudo bash /root/setup-vps.sh emre
sudo systemctl restart supersept
```

Pour Tailscale Serve, active **HTTPS Certificates** une fois dans la console Tailscale : *DNS* → *HTTPS Certificates* → *Enable*. Le nom de la machine est publié dans les journaux publics de certificats (Certificate Transparency), mais elle reste injoignable hors de ton tailnet.

Clés des services externes (voix, etc.) : mets-les dans `~/.config/supersept/env` (fichier en `600`). Toutes les sessions en héritent. Puis `sudo systemctl restart supersept`.

> **Abonnement Claude et sessions en parallèle** : toutes les sessions partagent les limites d'usage de ton abonnement. Avec 10 sessions et plus en parallèle, un Max (x20) évite d'atteindre la limite en milieu de journée. L'onglet **Utilisation** des réglages montre la consommation.

---

## 6. Migrer les données du Mac

À faire **depuis le Mac**, dans le dossier de Supersept, une fois le serveur prêt.

```bash
# 0. Pour taper « supersept » au lieu de l'IP : ajoute dans ~/.ssh/config
#    Host supersept
#      HostName <IP ou supersept.<tailnet>.ts.net>
#      User emre

# 1. Simulation : liste ce qui sera copié, et la taille
./scripts/migrate-to-vps.sh emre@supersept

# 2. Arrêter les deux Supersept (choisis un moment sans session en cours)
launchctl bootout gui/$(id -u)/sh.supersept.local
ssh emre@supersept sudo systemctl stop supersept

# 3. Copie + réécriture des chemins
./scripts/migrate-to-vps.sh emre@supersept --apply

# 4. Sur le serveur : dépendances, compilation, démarrage
ssh emre@supersept 'cd ~/supersept && ./scripts/install-service-linux.sh'
```

Ce que fait le script :

1. il vérifie que les deux Supersept sont arrêtés (base et conversations copiées dans un état cohérent) ;
2. il archive ce qui existe déjà sur le serveur (`~/avant-migration-<date>.tgz`) ;
3. il copie `~/.claude-hub`, les conversations, agents, réglages et skills de `~/.claude`, et chaque dossier de projet enregistré, **sans** `node_modules` ni `.next` ;
4. il envoie `~/.claude.json` sous le nom `~/.claude.json.from-mac` ;
5. sur le serveur, il lance `scripts/rewrite-paths.mjs`, qui remplace `/Users/<toi>` par `/home/<toi>` dans la base, renomme les dossiers de conversations, met à jour transcriptions et mémoires en gardant leurs dates, répare les worktrees, et fusionne dossiers de confiance et serveurs MCP. Le code des projets n'est jamais modifié. Relancer le script ne change rien.

Après la migration :

- dans chaque projet qui en a besoin, refais `npm install` (ou demande-le à un agent) ;
- **ne relance pas** Supersept sur le Mac : deux copies qui tournent en même temps divergeraient. Pour le désactiver pour de bon : `rm ~/Library/LaunchAgents/sh.supersept.local.plist` ;
- les **plugins** Claude Code ne sont pas copiés (beaucoup sont propres au Mac) : réinstalle ceux que tu veux avec `/plugin` ;
- un projet situé hors de ton dossier perso (disque externe…) est signalé : copie-le à la main ;
- garde les données du Mac quelques semaines avant de les supprimer.

---

## 7. Accès depuis l'iPhone (et le Mac)

### Recommandé : Tailscale + HTTPS (déjà configuré par le script)

Rien n'est ouvert sur internet. Seuls tes appareils connectés à ton compte Tailscale voient le serveur, et le trafic est chiffré (WireGuard + HTTPS). En plus, chaque appareil doit être relié par le jeton secret de Supersept.

1. Installe **Tailscale** sur l'iPhone (App Store), connecte-toi avec le **même compte**, et active le VPN.
2. En SSH sur le serveur :
   ```bash
   cd ~/supersept && npm run pair
   ```
   Un QR code noir sur blanc s'affiche pour `https://supersept.<tailnet>.ts.net/pair?token=…`.
   Si l'iPhone ne le lit pas (espacement des lignes du Terminal), essaie `npm run pair -- --compact`, ou affiche-le en image sur le Mac :
   ```bash
   ssh emre@supersept 'cd ~/supersept && node scripts/pair-phone.mjs --png -' > ~/Desktop/pair.png && open ~/Desktop/pair.png
   ```
   Autre option : copie le lien sur le Mac et colle-le dans Safari sur l'iPhone (presse-papiers universel).
3. Scanne-le avec l'appareil photo, ouvre le lien dans Safari, puis **Partager → Sur l'écran d'accueil**.
4. Pour **révoquer** tous les appareils (téléphone perdu…) : `npm run pair -- --rotate`.

L'HTTPS compte pour la voix : Safari ne donne accès au micro (dictée, services vocaux dans la page) qu'en HTTPS.

**Depuis le Mac**, deux options :
- ouvre la même adresse `https://supersept.<tailnet>.ts.net/pair?token=…` dans Chrome ou Safari (Tailscale allumé sur le Mac), puis installe-la comme app ;
- ou passe par un tunnel SSH, avec un accès « local » complet, réglages d'appairage compris :
  `ssh -N -L 4317:127.0.0.1:4317 emre@supersept`, puis http://localhost:4317.

**Vérification de sécurité** (à faire une fois) : depuis le téléphone, en navigation privée, ouvre `https://supersept.<tailnet>.ts.net/` sans le lien d'appairage. Tu dois voir « Appareil non relié ». Si l'interface s'ouvre, `SUPERSEPT_BEHIND_PROXY=1` manque dans `~/.config/supersept/env`.

Pour aller plus loin : une fois Tailscale validé partout, tu peux fermer le port 22 dans le pare-feu Hetzner et te connecter uniquement par `ssh emre@supersept` via Tailscale SSH (`tailscale up --ssh`). Le serveur devient alors totalement invisible sur internet. Garde la console Hetzner (accès « Console » dans le navigateur) comme porte de secours.

### Alternative : domaine + HTTPS public (déconseillé)

Seulement si tu ne peux pas installer Tailscale sur un appareil. Supersept peut lancer des commandes sur le serveur : l'exposer sur internet revient à confier tout le serveur à un seul jeton. Si tu le fais quand même :

- Caddy en reverse proxy (`supersept.ton-domaine.fr { reverse_proxy 127.0.0.1:4317 }`, certificat automatique), ports 80/443 ouverts dans les deux pare-feux ;
- garde `SUPERSEPT_HOST=127.0.0.1` et `SUPERSEPT_BEHIND_PROXY=1`, et mets `SUPERSEPT_PUBLIC_URL=https://supersept.ton-domaine.fr` ;
- ajoute **une authentification devant** (Cloudflare Access, ou `basic_auth` dans Caddy), en plus du jeton de Supersept.

---

### Notifications push sur l'iPhone (écran verrouillé)

Supersept envoie de vraies notifications Web Push (même l'app fermée) : session terminée / en attente / en erreur, et chaque réponse d'un agent dans tes conversations (Nami…). Pas de notif pour l'écran que tu as déjà sous les yeux, ni pour les missions qu'un agent délègue à un autre.

- **Clés VAPID** : `SUPERSEPT_VAPID_PUBLIC_KEY` / `SUPERSEPT_VAPID_PRIVATE_KEY` (+ `SUPERSEPT_VAPID_SUBJECT`, par défaut `SUPERSEPT_PUBLIC_URL`) dans `~/.config/supersept/env`, écrites par `node scripts/vapid-keys.mjs` (appelé aussi par `install-service-linux.sh`, idempotent). Sans elles, le serveur en génère dans `~/.claude-hub/vapid.json`. Les changer invalide les abonnements (les téléphones se réabonnent seuls à l'ouverture suivante).
- **iPhone (iOS 16.4+)** : Safari → `https://supersept.<tailnet>.ts.net/pair?token=…` (QR de `npm run pair`) → Partager → **Sur l'écran d'accueil** → ouvrir l'app depuis l'icône → cloche en haut → **Activer les notifications** → Autoriser. Une notif de test arrive aussitôt.
- **Test depuis le serveur** : `curl -X POST http://127.0.0.1:4317/api/push/test` (envoie à tous les appareils abonnés).
- Réglages par appareil (sessions / agents) sur l'écran Notifications du téléphone, ou Réglages → Notifications sur ordinateur.

## 8. Sauvegardes

Deux niveaux :

1. **Sauvegardes Hetzner** (cochées à la création) : image complète du disque chaque jour, 7 conservées. Restauration en un clic, mais tout le serveur revient en arrière d'un coup.
2. **restic chaque nuit** (`scripts/backup.sh`, 3 h 30) : sauvegarde chiffrée et incrémentale de `~/.claude-hub` (avec une copie cohérente de la base SQLite, faite même pendant que Supersept tourne), `~/.claude` (conversations, agents, identifiants), `~/.claude.json`, `~/.config/supersept` et tous les dossiers de projets, sans `node_modules`. Elle garde 7 jours, 4 semaines et 6 mois, et permet de récupérer un seul fichier, par exemple une mémoire écrasée.

Destination conseillée : une **Storage Box Hetzner BX11** (1 To, environ 4 €/mois) dans un autre centre de données que le serveur.

```bash
# Console Hetzner → Storage Box → créer BX11 → activer SSH, ajouter ta clé publique du SERVEUR :
ssh emre@supersept 'test -f ~/.ssh/id_ed25519 || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519; cat ~/.ssh/id_ed25519.pub'

# Sur le serveur :
umask 077
openssl rand -base64 32 > ~/.config/supersept/restic-password   # garde une COPIE de ce mot de passe ailleurs (gestionnaire de mots de passe) !
cat > ~/.config/supersept/backup.env <<'EOF'
RESTIC_REPOSITORY=sftp:u123456@u123456.your-storagebox.de:supersept
RESTIC_PASSWORD_FILE=/home/emre/.config/supersept/restic-password
EOF
ssh -p 23 u123456@u123456.your-storagebox.de exit   # accepte l'empreinte une fois
#   (ajoute dans ~/.ssh/config : Host u123456.your-storagebox.de / Port 23)
~/supersept/scripts/backup.sh                       # première sauvegarde
```

Contrôles :

```bash
systemctl list-timers supersept-backup      # prochaine exécution
journalctl -u supersept-backup -n 50        # dernier résultat
set -a; . ~/.config/supersept/backup.env; set +a
restic snapshots                             # liste des sauvegardes
restic restore latest --target /tmp/restore --include /home/emre/.claude-hub/memory
~/supersept/scripts/backup.sh --check        # vérifie l'intégrité (une fois par mois)
```

Sans `backup.env`, le timer fait quand même une copie cohérente de la base dans `~/.claude-hub/backup/hub.db`, couverte par les sauvegardes Hetzner.

---

## 9. Mettre à jour Supersept sur le serveur

```bash
cd ~/supersept && git pull && ./scripts/install-service-linux.sh
# change uniquement le front : c'est appliqué tout de suite (les pages se rechargent)
# change le serveur : sudo systemctl restart supersept quand aucune session ne tourne
```

## 10. Dépannage

| Symptôme | Piste |
|---|---|
| « origine refusée » en local | tunnel SSH : ouvre `http://localhost:4317`, pas `127.0.0.1:<autre port>` ; sinon ajoute l'origine à `SUPERSEPT_ORIGINS` |
| « Appareil non relié » sur l'iPhone | relance `npm run pair` et rescanne ; vérifie que Tailscale est actif sur l'iPhone |
| Sessions qui demandent de se connecter | `claude` en SSH puis `/login` : le jeton a expiré |
| `gh` : « not logged in » dans une session | `gh auth status`, puis `gh auth login` |
| Le serveur rame, sessions tuées | `free -h` ; si le swap est plein, passe en CX43 / CAX31 |
| `node-pty` ne compile pas | `sudo apt install build-essential python3`, puis `npm ci` |
| Pas de notification sur l'iPhone | L'app doit être ouverte depuis l'écran d'accueil (pas Safari) ; Réglages iOS → Notifications → Supersept ; `curl -X POST http://127.0.0.1:4317/api/push/test` ; `journalctl -u supersept \| grep 'Web Push'` |
| Rien ne répond | `systemctl status supersept`, `journalctl -u supersept -n 100` |

## Coût mensuel estimé (HT, octobre 2026 : à vérifier à la commande)

| Poste | 8 Go (CX33) | 16 Go (CX43) |
|---|---|---|
| Serveur (IPv4 comprise) | ≈ 9 € | ≈ 16,50 € |
| Sauvegardes Hetzner (+20 %) | ≈ 1,80 € | ≈ 3,30 € |
| Storage Box BX11 (restic) | ≈ 4 € | ≈ 4 € |
| Tailscale (offre Personal) | 0 € | 0 € |
| **Total HT** | **≈ 15 €** | **≈ 24 €** |
| Total TTC (TVA 20 %) | ≈ 18 € | ≈ 29 € |

Non compris : l'abonnement Claude et les services de voix externes.
