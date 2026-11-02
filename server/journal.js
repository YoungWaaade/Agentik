// `supersept journal` : what was done, day by day, read straight from the hub database (archived
// sessions included). Read-only and served by the CLI alone, so it works without restarting the service.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HUB_DIR = process.env.CLAUDE_HUB_DIR || path.join(os.homedir(), '.claude-hub');
const TZ = process.env.SUPERSEPT_TZ || 'Europe/Paris';
const DAY = 86400000;

const dayOf = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const hourOf = (ms) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(ms);
const stamp = (ms) => `${dayOf(ms)} ${hourOf(ms)}`;

// One readable line: drops markdown, keeps the first sentence when it is long enough.
function oneLine(text, max) {
  if (!text) return null;
  let s = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = s.match(/^(.{40,}?[^\d\s][.!?])\s/);
  if (m && m[1].length <= max) s = m[1];
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

const git = (cwd, args) => {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 << 20 }); }
  catch { return ''; }
};

// Claude Code keeps each session's transcript under ~/.claude/projects/<cwd with / and . as ->/<id>.jsonl.
const transcriptPath = (cwd, sid) => path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sid}.jsonl`);

// A commit belongs to a session when it was made during the session and the session's transcript
// quotes its hash (agents always report the hash; several sessions may share one folder).
function sessionCommits(ws, start, end, logs) {
  if (!fs.existsSync(ws.cwd)) return [];
  if (!logs.has(ws.cwd)) {
    const out = git(ws.cwd, ['log', '--all', '--no-merges', '--format=%h%x09%H%x09%ct%x09%s']);
    logs.set(ws.cwd, out.split('\n').filter(Boolean).map((l) => { const [h, H, t, s] = l.split('\t'); return { h, H, at: +t * 1000, s }; }));
  }
  const candidates = logs.get(ws.cwd).filter((c) => c.at >= start - 60000 && c.at <= end + 600000);
  if (!candidates.length) return [];
  let text = '';
  try { text = fs.readFileSync(transcriptPath(ws.cwd, ws.session_id), 'utf8'); } catch { return []; }
  return candidates.filter((c) => text.includes(c.h.slice(0, 7))).map((c) => `${c.h.slice(0, 7)} ${c.s}`).reverse();
}

function parseDay(s, flag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error(`date invalide pour --${flag} (format AAAA-MM-JJ) : ${s}`);
  return String(s);
}

export function journal(flags = {}) {
  const today = dayOf(Date.now());
  const rel = { "aujourd'hui": today, aujourdhui: today, hier: dayOf(Date.now() - DAY) };
  const norm = (v) => rel[String(v).toLowerCase()] || v;
  const untilFlag = ["jusqu-a", "jusqua", "jusqu'à", "jusqu'a", 'jusqu-à', 'au'].find((k) => flags[k]);
  let from, to;
  if (flags.date) from = to = parseDay(norm(flags.date), 'date');
  else if (flags.depuis || untilFlag) {
    from = flags.depuis ? parseDay(norm(flags.depuis), 'depuis') : '0000-00-00';
    to = untilFlag ? parseDay(norm(flags[untilFlag]), untilFlag) : today;
  } else if (flags.tout) { from = '0000-00-00'; to = '9999-99-99'; }
  else from = to = today;

  const db = new DatabaseSync(path.join(HUB_DIR, 'hub.db'), { readOnly: true });
  const projects = new Map(db.prepare('SELECT id, name FROM projects').all().map((p) => [p.id, p.name]));
  const wss = db.prepare('SELECT * FROM workspaces ORDER BY created_at').all();
  const evStmt = db.prepare('SELECT kind, text, at FROM events WHERE workspace_id = ? ORDER BY at');
  const logs = new Map();
  const days = new Map();

  for (const ws of wss) {
    const events = evStmt.all(ws.id);
    const times = [ws.created_at, ...events.map((e) => e.at)];
    const activeDays = [...new Set(times.map(dayOf))].filter((d) => d >= from && d <= to);
    if (!activeDays.length) continue;
    const end = Math.max(...times);
    const stopped = ['review', 'done', 'idle', 'error'].includes(ws.status);
    const entry = {
      id: ws.id,
      projet: projects.get(ws.project_id) ?? 'Sessions',
      nom: ws.name,
      debut: stamp(ws.created_at),
      fin: stopped || ws.archived ? stamp(end) : `en cours (dernière activité ${stamp(end)})`,
      mission: oneLine(ws.initial_prompt || events.find((e) => e.kind === 'prompt')?.text, 180),
      resultat: oneLine(ws.last_message, 240) || (ws.successor ? `relayée vers la session ${ws.successor} (contexte plein)` : null),
      lancee_par: ws.owner_agent || null,
      ...(ws.archived ? { archivee: true } : {}),
      ...(ws.successor ? { relayee_vers: ws.successor } : {}),
      ...(ws.predecessor ? { suite_de: ws.predecessor } : {}),
    };
    const commits = sessionCommits(ws, ws.created_at, end, logs);
    if (commits.length) entry.commits = commits;
    for (const d of activeDays) {
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(d === dayOf(ws.created_at) ? entry : { ...entry, suite: true });
    }
  }
  db.close();
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, sessions]) => ({ date, sessions }));
}

// Plain text, one block per day: what Nami reads back to Emre.
export function journalText(days) {
  if (!days.length) return 'Aucune session sur cette période.';
  return days.map(({ date, sessions }) => [
    `## ${date} — ${sessions.length} session${sessions.length > 1 ? 's' : ''}`,
    ...sessions.map((s) => [
      `- [${s.projet}] ${s.nom}${s.suite ? ' (suite)' : ''}${s.archivee ? ' (archivée)' : ''} — id ${s.id}, ${s.debut} → ${s.fin}${s.lancee_par ? `, lancée par ${s.lancee_par}` : ''}`,
      s.mission && `  Mission : ${s.mission}`,
      s.resultat && `  Résultat : ${s.resultat}`,
      s.commits && `  Commits : ${s.commits.join(' ; ')}`,
    ].filter(Boolean).join('\n')),
  ].join('\n')).join('\n\n');
}
