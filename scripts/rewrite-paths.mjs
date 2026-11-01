// Rewrites the Mac's absolute paths (/Users/<toi>) into the server's (/home/<toi>) once the data is copied,
// so projects, workspaces, conversations, memories and git worktrees keep working. Run it ON THE SERVER,
// with YoungHub stopped:
//   node scripts/rewrite-paths.mjs --from /Users/emre --to /home/emre [--dry-run]
// migrate-to-vps.sh runs it for you. Re-running it is harmless (nothing left to replace).
//
// What it touches:
//   ~/.claude-hub/hub.db                    every text column (projects.path, workspaces.cwd, …)
//   ~/.claude/projects/<-Users-toi-…>       folder names (Claude Code names them after the cwd)
//   transcripts, memories, agents, settings  text replacement, modification dates kept
//   git worktrees                            .git links both ways, then `git worktree repair`
//   ~/.claude.json.from-mac                  folder trust and MCP servers merged into ~/.claude.json
// Project source code is never modified.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const FROM = (arg('--from') || '').replace(/\/+$/, '');
const TO = (arg('--to') || os.homedir()).replace(/\/+$/, '');
const DRY = process.argv.includes('--dry-run');
if (!FROM || !TO || FROM === TO) {
  console.error('Usage : node rewrite-paths.mjs --from /Users/toi --to /home/toi [--dry-run]');
  process.exit(1);
}
const enc = (p) => p.replace(/[^a-zA-Z0-9]/g, '-'); // Claude Code's folder naming
const ENC_FROM = enc(FROM), ENC_TO = enc(TO);
const HOME = os.homedir();
const HUB = process.env.CLAUDE_HUB_DIR || path.join(HOME, '.claude-hub');
const CLAUDE = path.join(HOME, '.claude');
const stats = { db: 0, dirs: 0, files: 0, gitLinks: 0 };
const tag = DRY ? '[simulation] ' : '';

// ---------- 1. database ----------
const dbFile = path.join(HUB, 'hub.db');
const repos = new Set();
if (fs.existsSync(dbFile)) {
  const db = new DatabaseSync(dbFile);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  db.exec('BEGIN');
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all().filter((c) => !c.type || /TEXT|CHAR|CLOB/i.test(c.type));
    for (const { name: col } of cols) {
      for (const [a, b] of [[FROM, TO], [ENC_FROM, ENC_TO]]) {
        const where = `instr("${col}", ?) > 0`;
        const n = db.prepare(`SELECT count(*) AS n FROM "${name}" WHERE ${where}`).get(a).n;
        if (!n) continue;
        stats.db += n;
        console.log(`${tag}base : ${name}.${col} → ${n} ligne(s)`);
        if (!DRY) db.prepare(`UPDATE "${name}" SET "${col}" = replace("${col}", ?, ?) WHERE ${where}`).run(a, b, a);
      }
    }
  }
  db.exec(DRY ? 'ROLLBACK' : 'COMMIT');
  for (const { path: p } of db.prepare('SELECT path FROM projects').all()) repos.add(DRY ? p.replace(FROM, TO) : p);
  db.close();
} else console.log(`pas de base ${dbFile}`);

// ---------- 2. Claude Code project folders ----------
const projRoot = path.join(CLAUDE, 'projects');
function moveInto(src, dst) {
  // Destination already exists (sessions started on the server before the migration): merge file by file.
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (!fs.existsSync(d)) fs.renameSync(s, d);
    else if (e.isDirectory() && fs.statSync(d).isDirectory()) moveInto(s, d);
    else console.log(`  conservé côté serveur (doublon) : ${d}`);
  }
  fs.rmSync(src, { recursive: true, force: true });
}
if (fs.existsSync(projRoot)) {
  for (const name of fs.readdirSync(projRoot)) {
    if (!name.startsWith(ENC_FROM)) continue;
    const to = ENC_TO + name.slice(ENC_FROM.length);
    stats.dirs++;
    console.log(`${tag}dossier : ${name} → ${to}`);
    if (DRY) continue;
    const src = path.join(projRoot, name), dst = path.join(projRoot, to);
    if (fs.existsSync(dst)) moveInto(src, dst); else fs.renameSync(src, dst);
  }
}

// ---------- 3. text files (transcripts, memories, agents, settings) ----------
const TEXT = /\.(jsonl?|md|txt|ya?ml|toml)$/i;
function rewriteFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { return; }
  if (!st.isFile() || st.size > 512 * 1024 * 1024) return;
  const buf = fs.readFileSync(file);
  if (buf.indexOf(FROM) < 0 && buf.indexOf(ENC_FROM) < 0) return;
  stats.files++;
  if (DRY) return;
  const out = buf.toString('utf8').split(FROM).join(TO).split(ENC_FROM).join(ENC_TO);
  fs.writeFileSync(file, out);
  fs.utimesSync(file, st.atime, st.mtime); // history is sorted by modification date
}
function walk(dir, { skip = [], depth = 50 } = {}) {
  if (!fs.existsSync(dir) || depth < 0) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.includes(e.name)) continue;
    if (e.isDirectory()) walk(p, { skip, depth: depth - 1 });
    else if (e.isFile() && TEXT.test(e.name)) rewriteFile(p);
  }
}
// In dry-run the folders above were not renamed: walk them under their current name.
walk(projRoot);
walk(path.join(CLAUDE, 'agents'));
walk(path.join(CLAUDE, 'commands'));
walk(path.join(CLAUDE, 'skills'), { skip: ['node_modules'] });
walk(path.join(CLAUDE, 'plugins'), { skip: ['node_modules', 'cache', 'marketplaces'], depth: 2 });
for (const f of ['CLAUDE.md', 'settings.json', 'settings.local.json']) rewriteFile(path.join(CLAUDE, f));
walk(HUB, { skip: ['worktrees', 'attachments', 'backup', 'hooks', 'node_modules'] });
rewriteFile(path.join(HOME, '.claude.json.from-mac'));
console.log(`${tag}fichiers texte réécrits : ${stats.files}`);

// ---------- 4. git worktrees ----------
// A worktree's .git file says "gitdir: <repo>/.git/worktrees/<name>", and <repo>/.git/worktrees/<name>/gitdir
// points back at the worktree: both hold absolute paths.
function fixLink(file) {
  try {
    const s = fs.readFileSync(file, 'utf8');
    if (!s.includes(FROM)) return;
    stats.gitLinks++;
    if (!DRY) fs.writeFileSync(file, s.split(FROM).join(TO));
  } catch {}
}
const wtRoot = path.join(HUB, 'worktrees');
if (fs.existsSync(wtRoot)) {
  for (const proj of fs.readdirSync(wtRoot)) {
    const pdir = path.join(wtRoot, proj);
    if (!fs.statSync(pdir).isDirectory()) continue;
    for (const wt of fs.readdirSync(pdir)) fixLink(path.join(pdir, wt, '.git'));
  }
}
for (const repo of repos) {
  const wts = path.join(repo, '.git', 'worktrees');
  if (fs.existsSync(wts)) for (const w of fs.readdirSync(wts)) fixLink(path.join(wts, w, 'gitdir'));
  if (!DRY && fs.existsSync(path.join(repo, '.git'))) {
    try { execFileSync('git', ['-C', repo, 'worktree', 'repair'], { stdio: 'ignore' }); } catch {}
    try { execFileSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'ignore' }); } catch {}
  }
}
console.log(`${tag}liens git corrigés : ${stats.gitLinks}`);

// ---------- 5. ~/.claude.json: trusted folders and MCP servers from the Mac ----------
const fromMac = path.join(HOME, '.claude.json.from-mac');
const live = path.join(HOME, '.claude.json');
if (fs.existsSync(fromMac)) {
  const mac = JSON.parse(fs.readFileSync(fromMac, 'utf8'));
  const cur = fs.existsSync(live) ? JSON.parse(fs.readFileSync(live, 'utf8')) : {};
  let added = 0;
  // Keep the server's account and settings, only add what it doesn't know yet.
  cur.projects ||= {};
  for (const [dir, conf] of Object.entries(mac.projects || {})) {
    const d = DRY ? dir.split(FROM).join(TO) : dir;
    if (!d.startsWith(TO) || cur.projects[d]) continue;
    cur.projects[d] = { ...conf, hasTrustDialogAccepted: !!conf.hasTrustDialogAccepted };
    added++;
  }
  const mcp = Object.entries(mac.mcpServers || {});
  cur.mcpServers ||= {};
  const macOnly = [];
  for (const [name, conf] of mcp) {
    if (cur.mcpServers[name]) continue;
    // Servers launched from /Applications or Homebrew binaries won't exist on Linux.
    if (/\/Applications\/|\/opt\/homebrew\/|\.app\//.test(JSON.stringify(conf))) { macOnly.push(name); continue; }
    cur.mcpServers[name] = conf;
    added++;
  }
  console.log(`${tag}~/.claude.json : ${added} entrée(s) ajoutée(s)${macOnly.length ? ` · ignorés (propres au Mac) : ${macOnly.join(', ')}` : ''}`);
  if (!DRY && added) {
    if (fs.existsSync(live)) fs.copyFileSync(live, `${live}.before-migration`);
    fs.writeFileSync(live, JSON.stringify(cur, null, 2), { mode: 0o600 });
  }
}

const outside = [...repos].filter((p) => !p.startsWith(TO + '/') && !p.startsWith(HUB));
if (outside.length) console.log(`\nProjets hors de ${TO} (à déplacer à la main) :\n  ${outside.join('\n  ')}`);
const missing = [...repos].filter((p) => !fs.existsSync(p));
if (missing.length) console.log(`\nProjets absents sur le serveur :\n  ${missing.join('\n  ')}`);
console.log(`\n${tag}Terminé : ${stats.db} ligne(s) en base, ${stats.dirs} dossier(s) renommé(s), ${stats.files} fichier(s), ${stats.gitLinks} lien(s) git.`);
