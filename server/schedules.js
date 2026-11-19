// Scheduled tasks for chat agents ("every 2h, wake me up with this prompt"). Stored in hub.db (table
// `schedules`), so they survive closed conversations and restarts. A timer checks every 20 s; each due task
// sends its prompt to the agent's conversation as an automatic "[Supersept]" message, which runs a normal turn.
import crypto from 'node:crypto';
import { db } from './db.js';
import { getAgent } from './agents.js';
import { sendToAgent, isBusy } from './chat.js';
import { parseCron, parseEvery, parseUntil, nextRun, describeFrequency } from './cron.js';

const TICK_MS = 20_000;
const get = (id) => db.prepare('SELECT * FROM schedules WHERE id = ?').get(String(id || '').trim());
const fmt = (ms) => (ms ? new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : null);
const when = describeFrequency;

// Live updates: the server passes its broadcast (the Tasks page refreshes on { type: 'schedules' }).
let notify = () => {};
export function onSchedulesChange(fn) { notify = fn; }
const changed = (v) => { try { notify(); } catch {} return v; };

export function describe(t) {
  return {
    id: t.id, agent: t.agent, conversation: t.conversation, prompt: t.prompt, quand: when(t),
    ...(t.until ? { jusqu_au: fmt(t.until) } : {}),
    active: !!t.active,
    prochaine: t.active ? fmt(t.next_run) : null,
    derniere: fmt(t.last_run), dernier_statut: t.last_status, dernier_resultat: t.last_result ?? null, executions: t.runs, reportees: t.skipped,
    creee_par: t.created_by || 'utilisateur',
  };
}

// Raw fields too, for the web page (dates as ms, frequency to prefill the edit form).
export const forUi = (t) => ({
  ...describe(t), cron: t.cron, every_min: t.every_min, until: t.until, next_run: t.active ? t.next_run : null,
  last_run: t.last_run, created_at: t.created_at, busy: isBusy(t.agent),
});

// by: slug of the agent calling (null = the user / a shell). conv: its conversation.
export function createSchedule({ agent, prompt, cron, every, until, conversation = null }, { by = null, conv = null } = {}) {
  const slug = agent || by;
  if (!slug) throw new Error("il faut l'agent à réveiller (--agent SLUG)");
  if (!getAgent(slug)) throw new Error(`agent introuvable : ${slug}`);
  const text = String(prompt || '').trim();
  if (!text) throw new Error('il faut le message de réveil (--prompt "…")');
  if (!cron === !every) throw new Error('donne soit --cron "min heure jour mois jour-semaine", soit --every 2h');
  if (cron) parseCron(cron);
  const task = {
    id: `t${crypto.randomBytes(3).toString('hex')}`, agent: slug, prompt: text.slice(0, 8000),
    cron: cron ? String(cron).trim() : null, every_min: every ? parseEvery(every) : null, until: parseUntil(until),
    // Self-scheduling: wake up in the conversation that asked for it.
    conversation: conversation ?? (by === slug ? conv : null),
  };
  if (task.until && task.until < Date.now()) throw new Error('la date de fin est déjà passée');
  task.next_run = nextRun(task, Date.now());
  if (!task.next_run) throw new Error("cette planification ne se déclenche jamais avant la date de fin");
  db.prepare(`INSERT INTO schedules (id, agent, conversation, prompt, cron, every_min, until, active, created_by, created_at, next_run)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(task.id, task.agent, task.conversation, task.prompt, task.cron, task.every_min, task.until, by, Date.now(), task.next_run);
  return changed(describe(get(task.id)));
}

// An agent sees its own tasks (and those it created); the lead and the user see everything.
const isLead = (slug) => { const m = slug && getAgent(slug)?.manager; return !!m && m !== 'false'; };
const canSee = (t, by) => !by || t.agent === by || t.created_by === by || isLead(by);

export function listSchedules({ agent = null, all = false } = {}, { by = null } = {}) {
  return db.prepare('SELECT * FROM schedules ORDER BY active DESC, next_run').all()
    .filter((t) => (agent ? t.agent === agent : all || !by || t.agent === by || t.created_by === by) && canSee(t, by))
    .map(describe);
}

export function deleteSchedule(id, { by = null } = {}) {
  const t = get(id);
  if (!t) throw new Error(`tâche planifiée introuvable : ${id}`);
  if (!canSee(t, by)) throw new Error("cette tâche planifiée appartient à un autre agent");
  db.prepare('DELETE FROM schedules WHERE id = ?').run(t.id);
  return changed({ id: t.id, statut: 'supprimée' });
}

export function setActive(id, active, { by = null } = {}) {
  const t = get(id);
  if (!t) throw new Error(`tâche planifiée introuvable : ${id}`);
  if (!canSee(t, by)) throw new Error("cette tâche planifiée appartient à un autre agent");
  const next = active ? nextRun(t, Date.now()) : t.next_run;
  db.prepare('UPDATE schedules SET active = ?, next_run = ? WHERE id = ?').run(active && next ? 1 : 0, next, t.id);
  return changed(describe(get(t.id)));
}

// Edit the prompt, the frequency (cron OR every) and/or the end date ('' / null = no end). Fields left
// undefined are kept. An active task gets its next run recomputed from now.
export function updateSchedule(id, { prompt, cron, every, until } = {}, { by = null } = {}) {
  const t = get(id);
  if (!t) throw new Error(`tâche planifiée introuvable : ${id}`);
  if (!canSee(t, by)) throw new Error("cette tâche planifiée appartient à un autre agent");
  const n = { ...t };
  if (prompt !== undefined) {
    n.prompt = String(prompt || '').trim().slice(0, 8000);
    if (!n.prompt) throw new Error('il faut le message de réveil');
  }
  if (cron && every) throw new Error('donne soit un cron, soit un intervalle, pas les deux');
  if (cron) { parseCron(cron); n.cron = String(cron).trim(); n.every_min = null; }
  if (every) { n.every_min = parseEvery(every); n.cron = null; }
  if (until !== undefined) {
    n.until = parseUntil(until);
    if (n.until && n.until < Date.now()) throw new Error('la date de fin est déjà passée');
  }
  const timing = n.cron !== t.cron || n.every_min !== t.every_min || n.until !== t.until;
  if (timing || !t.active) n.next_run = nextRun(n, Date.now());
  if (t.active && !n.next_run) throw new Error("cette planification ne se déclenche jamais avant la date de fin");
  db.prepare('UPDATE schedules SET prompt = ?, cron = ?, every_min = ?, until = ?, next_run = ? WHERE id = ?')
    .run(n.prompt, n.cron, n.every_min, n.until, n.next_run, t.id);
  return changed(describe(get(t.id)));
}

// Send the wake-up message now (also for a paused task); the regular due times don't move.
export function runNow(id, { by = null, now = Date.now() } = {}) {
  const t = get(id);
  if (!t) throw new Error(`tâche planifiée introuvable : ${id}`);
  if (!canSee(t, by)) throw new Error("cette tâche planifiée appartient à un autre agent");
  if (!getAgent(t.agent)) throw new Error(`agent introuvable : ${t.agent}`);
  if (isBusy(t.agent)) throw new Error("l'agent est déjà en train de travailler : réessaie quand il a fini");
  fire(t, now, 'lancée (à la main)');
  return changed(describe(get(t.id)));
}

function fire(t, now, status = 'lancée') {
  try {
    // Quiet turn: an answer "RAS" is only recorded here, never shown, relayed or notified.
    const onReply = (text) => changed(db.prepare('UPDATE schedules SET last_result = ? WHERE id = ?').run(text ? String(text).slice(0, 4000) : null, t.id));
    const conv = sendToAgent(t.agent, wakeText(t), { internal: true, quiet: true, conversation: t.conversation, onReply });
    db.prepare('UPDATE schedules SET runs = runs + 1, last_run = ?, last_status = ?, conversation = COALESCE(conversation, ?) WHERE id = ?').run(now, status, conv, t.id);
  } catch (e) {
    db.prepare('UPDATE schedules SET last_run = ?, last_status = ? WHERE id = ?').run(now, `erreur : ${e.message}`.slice(0, 200), t.id);
  }
}

function wakeText(t) {
  return `[Supersept] Tâche planifiée ${t.id} (${when(t)}${t.until ? `, jusqu'au ${fmt(t.until)}` : ''}) : ${t.prompt}\n\n`
    + `(Réveil automatique. Fais ce qui est demandé avec tes outils. Ta réponse s'affiche dans le chat et notifie l'utilisateur : `
    + `s'il n'y a rien d'utile à lui dire, réponds seulement « RAS », sans rien d'autre (rien ne lui sera alors montré). Quand cette tâche est accomplie ou n'a plus lieu d'être, `
    + `supprime-la : supersept delete-task ${t.id}.)`;
}

// One pass: fire every due task once. The next run is written BEFORE sending, so a task never fires twice
// for the same due time (several ticks, restart in between). Missed runs while the hub was down fire once.
export function tick(now = Date.now()) {
  const due = db.prepare('SELECT * FROM schedules WHERE active = 1 AND next_run IS NOT NULL AND next_run <= ?').all(now);
  for (const t of due) {
    const next = nextRun(t, Math.max(now, t.next_run));
    const claimed = db.prepare('UPDATE schedules SET next_run = ?, active = ? WHERE id = ? AND next_run = ?').run(next, next ? 1 : 0, t.id, t.next_run);
    if (!claimed.changes) continue;
    if (t.until && t.next_run > t.until) { db.prepare("UPDATE schedules SET active = 0, last_status = 'terminée (date de fin)' WHERE id = ?").run(t.id); continue; }
    if (!getAgent(t.agent)) { db.prepare("UPDATE schedules SET skipped = skipped + 1, last_status = 'agent introuvable' WHERE id = ?").run(t.id); continue; }
    // The agent is already working: don't stack a turn, wait for the next due time.
    if (isBusy(t.agent)) { db.prepare("UPDATE schedules SET skipped = skipped + 1, last_status = 'reportée (agent occupé)' WHERE id = ?").run(t.id); continue; }
    fire(t, now);
  }
  // Past their end date without a run left: off.
  const ended = db.prepare("UPDATE schedules SET active = 0, last_status = COALESCE(last_status, 'terminée (date de fin)') WHERE active = 1 AND next_run IS NULL").run();
  if (due.length || ended.changes) changed();
}

let timer = null;
export function startScheduler() {
  if (timer) return;
  const run = () => { try { tick(); } catch (e) { console.error('planificateur :', e.message); } };
  // Give the boot (interrupted turns resuming) a head start, then check regularly.
  setTimeout(run, 5_000);
  timer = setInterval(run, TICK_MS);
  timer.unref?.();
}
