// Scheduled tasks against a throwaway hub (CLAUDE_HUB_DIR + HOME in a temp dir): never the real hub.db.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-schedules-'));
process.env.CLAUDE_HUB_DIR = path.join(tmp, 'hub');
process.env.HOME = path.join(tmp, 'home');
process.env.SUPERSEPT_AGENTS_DIR = path.join(tmp, 'home', '.claude', 'agents');
fs.mkdirSync(path.join(tmp, 'home', '.claude', 'agents'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'home', '.claude', 'agents', 'testeur.md'), '---\nname: testeur\nlabel: Testeur\ndescription: test\n---\nTu testes.\n');
os.homedir = () => path.join(tmp, 'home');

const s = await import('../server/schedules.js');
const { db } = await import('../server/db.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let events = 0;
s.onSchedulesChange(() => { events++; });
const row = (id) => db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);

test('création, liste pour la page et événement en direct', () => {
  const before = events;
  const t = s.createSchedule({ agent: 'testeur', prompt: 'Vérifie les mails', every: '2h', until: '2099-01-01' });
  assert.equal(t.quand, 'toutes les 2 h');
  assert.equal(events, before + 1);
  const ui = s.forUi(row(t.id));
  assert.equal(ui.every_min, 120);
  assert.equal(typeof ui.next_run, 'number');
  assert.equal(typeof ui.until, 'number');
  assert.equal(ui.busy, false);
});

test('modifier : prompt, passage en cron, date de fin effacée', () => {
  const t = s.createSchedule({ agent: 'testeur', prompt: 'A', every: '30m', until: '2099-01-01' });
  const n = s.updateSchedule(t.id, { prompt: 'B', cron: '0 9 * * 1-5', until: '' });
  assert.equal(n.prompt, 'B');
  assert.equal(n.quand, 'en semaine à 9 h');
  assert.equal(n.jusqu_au, undefined);
  const r = row(t.id);
  assert.equal(r.every_min, null);
  assert.equal(r.cron, '0 9 * * 1-5');
  assert.equal(new Date(r.next_run).getHours(), 9);
  // Champs absents = conservés ; retour à un intervalle.
  const m = s.updateSchedule(t.id, { every: '1h' });
  assert.equal(m.prompt, 'B');
  assert.equal(row(t.id).cron, null);
  assert.equal(row(t.id).every_min, 60);
});

test('modifier : erreurs claires', () => {
  const t = s.createSchedule({ agent: 'testeur', prompt: 'A', every: '1h' });
  assert.throws(() => s.updateSchedule(t.id, { prompt: '  ' }), /message de réveil/);
  assert.throws(() => s.updateSchedule(t.id, { cron: '99 * * * *' }), /cron invalide/);
  assert.throws(() => s.updateSchedule(t.id, { cron: '0 9 * * *', every: '2h' }), /pas les deux/);
  assert.throws(() => s.updateSchedule(t.id, { until: '2001-01-01' }), /déjà passée/);
  assert.throws(() => s.updateSchedule('t000000', { prompt: 'x' }), /introuvable/);
  assert.equal(row(t.id).prompt, 'A');
});

test('pause / reprise recalcule la prochaine exécution', () => {
  const t = s.createSchedule({ agent: 'testeur', prompt: 'A', every: '1h' });
  assert.equal(s.setActive(t.id, false).active, false);
  assert.equal(s.forUi(row(t.id)).next_run, null);
  db.prepare('UPDATE schedules SET next_run = 1 WHERE id = ?').run(t.id);
  const back = s.setActive(t.id, true);
  assert.equal(back.active, true);
  assert.ok(row(t.id).next_run > Date.now() + 59 * 60_000);
});

test('lancer maintenant : agent introuvable refusé, rien ne bouge', () => {
  const t = s.createSchedule({ agent: 'testeur', prompt: 'A', every: '1h' });
  db.prepare("UPDATE schedules SET agent = 'fantome' WHERE id = ?").run(t.id);
  const next = row(t.id).next_run;
  assert.throws(() => s.runNow(t.id), /agent introuvable/);
  assert.equal(row(t.id).runs, 0);
  assert.equal(row(t.id).next_run, next);
});

test('suppression', () => {
  const t = s.createSchedule({ agent: 'testeur', prompt: 'A', every: '1h' });
  const before = events;
  s.deleteSchedule(t.id);
  assert.equal(row(t.id), undefined);
  assert.equal(events, before + 1);
});

test('planificateur : une tâche en pause ne part jamais, même échue', () => {
  const t = s.createSchedule({ agent: 'testeur', prompt: 'A', every: '1h' });
  s.setActive(t.id, false);
  db.prepare('UPDATE schedules SET next_run = ? WHERE id = ?').run(Date.now() - 60_000, t.id);
  s.tick(Date.now());
  assert.equal(row(t.id).runs, 0);
  assert.equal(row(t.id).skipped, 0);
  assert.equal(row(t.id).last_status, null);
});

test('planificateur : une échéance est traitée une seule fois, la suivante est recalculée', () => {
  const t = s.createSchedule({ agent: 'testeur', prompt: 'A', every: '2h' });
  // Agent absent: the tick records the due time without starting a turn (no claude in the tests).
  db.prepare("UPDATE schedules SET agent = 'fantome', next_run = ? WHERE id = ?").run(Date.now() - 1000, t.id);
  const now = Date.now();
  s.tick(now);
  s.tick(now);
  assert.equal(row(t.id).skipped, 1);
  assert.equal(row(t.id).last_status, 'agent introuvable');
  assert.equal(row(t.id).next_run, now + 2 * 3600_000);
});
