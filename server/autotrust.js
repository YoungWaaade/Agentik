// Sessions that never block: before launching, YoungHub marks the session folder as trusted in Claude
// Code (~/.claude.json, projects[dir].hasTrustDialogAccepted) and, unless the workspace or its agent chose
// a permission mode, starts Claude Code in bypassPermissions. Both are on by default and can be turned off
// in Réglages (stored in ~/.claude-hub/autotrust.json).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUB_DIR } from './db.js';

const CONFIG = path.join(HUB_DIR, 'autotrust.json');
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');
const DEFAULTS = { trustFolders: true, skipPermissions: true };

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

export function config() {
  const c = { ...DEFAULTS, ...readJson(CONFIG, {}) };
  return { trustFolders: !!c.trustFolders, skipPermissions: !!c.skipPermissions };
}

export function setConfig(patch = {}) {
  const c = config();
  if (patch.trustFolders !== undefined) c.trustFolders = !!patch.trustFolders;
  if (patch.skipPermissions !== undefined) c.skipPermissions = !!patch.skipPermissions;
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  return config();
}

// Permission mode to launch with: an explicit choice (workspace, then agent) always wins.
export function permissionMode(explicit) {
  return explicit || (config().skipPermissions ? 'bypassPermissions' : null);
}

// Record the folder as trusted, the way Claude Code does when you answer "Yes, I trust this folder".
// ~/.claude.json is also written by running Claude Code instances: re-read right before writing, touch
// only this folder's flag, and replace the file atomically. Never throws (the PTY watcher is the fallback).
export function markTrusted(dir) {
  if (!config().trustFolders || !dir) return false;
  try {
    const raw = fs.readFileSync(CLAUDE_JSON, 'utf8');
    const data = JSON.parse(raw);
    data.projects ||= {};
    let changed = false;
    for (const key of new Set([real(dir), dir])) {
      const entry = data.projects[key] ||= {};
      if (entry.hasTrustDialogAccepted !== true) { entry.hasTrustDialogAccepted = true; changed = true; }
    }
    if (!changed) return true;
    const tmp = `${CLAUDE_JSON}.supersept-${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: fs.statSync(CLAUDE_JSON).mode });
    // Bail out if Claude Code rewrote the file meanwhile, rather than overwrite its changes.
    if (fs.readFileSync(CLAUDE_JSON, 'utf8') !== raw) { fs.unlinkSync(tmp); return false; }
    fs.renameSync(tmp, CLAUDE_JSON);
    return true;
  } catch {
    return false;
  }
}
