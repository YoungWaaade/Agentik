// Open sessions cost memory (each Claude Code is ~150 MB, plus whatever its status line runs), and dozens of
// finished ones left open slowed the whole Mac down. Finished sessions are closed after a while (Claude stops,
// the conversation resumes when the session is opened again), then archived later on. Never one at work,
// waiting for an answer, recently in error, or being looked at; archiving also skips any session whose folder
// still holds uncommitted changes or commits that are neither pushed nor merged.
//
// Pure functions: the hub feeds them its sessions, they say what to close or archive.
import fs from 'node:fs';

// closeAfterHours / archiveAfterDays / maxOpen: 0 turns the rule off.
// statuslineRefresh: false = the user's status line runs on events only in Agentik sessions (no refreshInterval).
export const DEFAULTS = { closeAfterHours: 2, archiveAfterDays: 7, maxOpen: 20, statuslineRefresh: false };
const LIMITS = { closeAfterHours: [0, 24 * 30], archiveAfterDays: [0, 365], maxOpen: [0, 500] };
const H = 3600e3;
export const RECENT_ERROR_MS = 48 * H;
// Just started or just used: never closed for the cap (it would close the session the user is opening).
export const GRACE_MS = 10 * 60e3;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const clamp = (v, [lo, hi], d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Number(v))) : d);

export function makeConfig(file) {
  const get = () => {
    const raw = { ...DEFAULTS, ...readJson(file) };
    const c = { statuslineRefresh: !!raw.statuslineRefresh };
    for (const k of Object.keys(LIMITS)) c[k] = clamp(raw[k], LIMITS[k], DEFAULTS[k]);
    return c;
  };
  const set = (patch = {}) => {
    const c = { ...get() };
    for (const k of Object.keys(DEFAULTS)) if (patch[k] !== undefined) c[k] = patch[k];
    fs.writeFileSync(file, JSON.stringify(c, null, 2));
    return get();
  };
  return { get, set };
}

// Why a session must stay as it is, or null. `s`: { status, statusSince, viewed, held } (held: trust question,
// relay, messages waiting to be delivered…).
export function protectedReason(s, now) {
  if (s.status === 'working') return 'au travail';
  if (s.status === 'waiting') return 'en attente de réponse';
  if (s.status === 'error' && now - (s.statusSince || 0) < RECENT_ERROR_MS) return 'erreur récente';
  if (s.viewed) return 'ouverte dans l’app';
  if (s.held) return s.held;
  if (now - (s.lastActive || 0) < GRACE_MS) return 'active à l’instant';
  return null;
}

// Sessions to close: `open` lists the sessions whose Claude runs, each { id, status, statusSince, lastActive, viewed, held }.
// Inactive past closeAfterHours, then the oldest inactive ones while more than maxOpen are open.
export function planClose(open, cfg, now) {
  const close = new Map();
  const closable = open.filter((s) => !protectedReason(s, now)).sort((a, b) => a.lastActive - b.lastActive);
  if (cfg.closeAfterHours > 0) {
    for (const s of closable) if (now - s.lastActive >= cfg.closeAfterHours * H) close.set(s.id, `inactive depuis plus de ${cfg.closeAfterHours} h`);
  }
  if (cfg.maxOpen > 0) {
    let over = open.length - close.size - cfg.maxOpen;
    for (const s of closable) {
      if (over <= 0) break;
      if (close.has(s.id)) continue;
      close.set(s.id, `plus de ${cfg.maxOpen} sessions ouvertes`);
      over--;
    }
  }
  return [...close].map(([id, reason]) => ({ id, reason }));
}

// Archive candidates among sessions not archived and not running; the hub still checks their git state.
export function planArchive(closed, cfg, now) {
  if (!(cfg.archiveAfterDays > 0)) return [];
  return closed.filter((s) => !protectedReason(s, now) && now - s.lastActive >= cfg.archiveAfterDays * 24 * H).map((s) => s.id);
}

// On hub start: which sessions to bring back. Those cut while working or waiting always; the others only if
// active within closeAfterHours, most recent first, up to maxOpen. The rest resume when opened.
export function planBoot(rows, cfg, now) {
  const must = rows.filter((r) => r.status === 'working' || r.status === 'waiting');
  const rest = rows.filter((r) => !must.includes(r) && (!(cfg.closeAfterHours > 0) || now - r.lastActive < cfg.closeAfterHours * H))
    .sort((a, b) => b.lastActive - a.lastActive);
  const room = cfg.maxOpen > 0 ? Math.max(0, cfg.maxOpen - must.length) : rest.length;
  const start = [...must, ...rest.slice(0, room)].map((r) => r.id);
  return { start, skip: rows.map((r) => r.id).filter((id) => !start.includes(id)) };
}

// Settings passed to Agentik's Claude sessions so the user's status line stops re-running every few seconds
// (refreshInterval) in each of them: it still updates on every event. Settings sources are merged, and an invalid
// value (0) is dropped, so the override is a long valid interval. null when there is nothing to override.
export const STATUSLINE_IDLE_SECONDS = 3600;
export function statusLineOverride(userStatusLine, cfg) {
  if (cfg.statuslineRefresh || !userStatusLine || typeof userStatusLine !== 'object' || !userStatusLine.refreshInterval) return null;
  return { ...userStatusLine, refreshInterval: STATUSLINE_IDLE_SECONDS };
}
