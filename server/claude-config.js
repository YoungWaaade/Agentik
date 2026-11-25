// Safe edits of Claude Code's user config (~/.claude.json), shared by the integrations (mcpServers) and the
// trust of Agentik's own folders: read, change in memory, back up, write a temp file and rename it over
// (atomic). Every other key (Claude Code's own state) is kept as it was just read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUB_DIR } from './db.js';

const BACKUPS = path.join(HUB_DIR, 'backups');
const KEEP_BACKUPS = 5;

// Read at call time: tests (and HOME=/tmp copies) point it elsewhere.
const configFile = () => path.join(os.homedir(), '.claude.json');

// A symlinked ~/.claude.json (dotfiles repo) is written through, never replaced by a plain file.
function realConfig() {
  const f = configFile();
  try { return fs.realpathSync(f); } catch { return f; }
}

export function readConfig() {
  let raw;
  try { raw = fs.readFileSync(realConfig(), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`lecture de ~/.claude.json impossible : ${e.code || e.message}`);
  }
  try { return JSON.parse(raw); } catch { throw new Error("~/.claude.json n'est pas un JSON valide : rien n'a été modifié"); }
}

// Copy before every change (chmod 600: the file holds account data), the last few kept.
function backup(file) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(BACKUPS, { recursive: true, mode: 0o700 });
  const to = path.join(BACKUPS, `claude.json.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
  fs.copyFileSync(file, to);
  fs.chmodSync(to, 0o600);
  const old = fs.readdirSync(BACKUPS).filter((n) => n.startsWith('claude.json.')).sort();
  for (const n of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUPS, n), { force: true });
  return to;
}

// fn(cfg) changes cfg in place and returns false to skip the write (nothing to change).
export function updateConfig(fn) {
  const file = realConfig();
  const cfg = readConfig();
  if (fn(cfg) === false) return cfg;
  backup(file);
  let mode = 0o600;
  try { mode = fs.statSync(file).mode & 0o777; } catch {}
  const tmp = `${file}.agentik-${process.pid}-${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w', mode);
    fs.writeSync(fd, JSON.stringify(cfg, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`écriture de ~/.claude.json impossible : ${e.code || e.message}`);
  }
  return cfg;
}

// Claude Code 2.1.326 asks, at every launch, whether each --add-dir folder never trusted before may be added
// (and a message pasted on that question quits Claude). A folder trusted once in Claude Code is not asked
// again: Agentik's own folders (memory, prompts…) are marked so, only when missing.
export function trustDirs(dirs) {
  const want = [...new Set(dirs.map((d) => { try { return fs.realpathSync(d); } catch { return d; } }))];
  let added = [];
  updateConfig((cfg) => {
    const projects = cfg.projects && typeof cfg.projects === 'object' ? cfg.projects : (cfg.projects = {});
    added = want.filter((d) => projects[d]?.hasTrustDialogAccepted !== true);
    if (!added.length) return false;
    for (const d of added) projects[d] = { ...(projects[d] || {}), hasTrustDialogAccepted: true };
  });
  return added;
}
