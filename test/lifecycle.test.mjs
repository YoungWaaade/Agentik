import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, makeConfig, planClose, planArchive, planBoot, protectedReason, statusLineOverride, STATUSLINE_IDLE_SECONDS } from '../server/lifecycle.js';

const H = 3600e3, NOW = 1_800_000_000_000;
const cfg = { ...DEFAULTS }; // 2 h, 7 days, 20 open
const s = (id, hoursAgo, extra = {}) => ({ id, status: 'review', statusSince: NOW - hoursAgo * H, lastActive: NOW - hoursAgo * H, viewed: false, held: null, ...extra });

test('finished sessions idle for more than 2 h are closed, the others stay', () => {
  const out = planClose([s('old', 3), s('recent', 1)], cfg, NOW);
  assert.deepEqual(out.map((o) => o.id), ['old']);
});

test('never closes a session at work, waiting, recently in error, looked at or held', () => {
  const open = [
    s('working', 50, { status: 'working' }),
    s('waiting', 50, { status: 'waiting' }),
    s('error', 50, { status: 'error', statusSince: NOW - 2 * H }),
    s('viewed', 50, { viewed: true }),
    s('trust', 50, { held: 'question de confiance' }),
  ];
  assert.deepEqual(planClose(open, cfg, NOW), []);
  // An old error is no reason to keep Claude running.
  assert.deepEqual(planClose([s('olderror', 50, { status: 'error', statusSince: NOW - 72 * H })], cfg, NOW).map((o) => o.id), ['olderror']);
});

test('over the cap, the oldest inactive sessions close first; working ones never', () => {
  const c = { ...cfg, closeAfterHours: 0, maxOpen: 3 };
  const open = [s('a', 1.5), s('b', 0.5), s('c', 1), s('w1', 9, { status: 'working' }), s('w2', 9, { status: 'waiting' })];
  // 5 open, 3 allowed: the two oldest closable (a then c) go.
  assert.deepEqual(planClose(open, c, NOW).map((o) => o.id), ['a', 'c']);
  // Only protected sessions over the cap: nothing to close.
  assert.deepEqual(planClose([s('w1', 9, { status: 'working' }), s('w2', 9, { status: 'waiting' })], { ...c, maxOpen: 1 }, NOW), []);
});

test('a session just opened is never closed to make room', () => {
  const c = { ...cfg, closeAfterHours: 0, maxOpen: 1 };
  assert.equal(protectedReason(s('new', 0.01), NOW), 'active à l’instant');
  assert.deepEqual(planClose([s('new', 0.01), s('w', 1, { status: 'working' })], c, NOW), []);
});

test('0 turns each rule off', () => {
  const off = { ...cfg, closeAfterHours: 0, maxOpen: 0, archiveAfterDays: 0 };
  assert.deepEqual(planClose([s('a', 500)], off, NOW), []);
  assert.deepEqual(planArchive([s('a', 5000)], off, NOW), []);
});

test('archive candidates: closed, inactive for 7 days, not protected', () => {
  const closed = [s('week', 8 * 24), s('day', 24), s('err', 8 * 24, { status: 'error', statusSince: NOW - H }), s('wait', 8 * 24, { status: 'waiting' })];
  assert.deepEqual(planArchive(closed, cfg, NOW), ['week']);
});

test('boot brings back sessions cut at work, then the recent ones up to the cap', () => {
  const rows = [s('w', 30, { status: 'working' }), s('r1', 0.5), s('r2', 1), s('r3', 1.5), s('stale', 10)];
  assert.deepEqual(planBoot(rows, cfg, NOW), { start: ['w', 'r1', 'r2', 'r3'], skip: ['stale'] });
  assert.deepEqual(planBoot(rows, { ...cfg, maxOpen: 2 }, NOW), { start: ['w', 'r1'], skip: ['r2', 'r3', 'stale'] });
  assert.deepEqual(planBoot(rows, { ...cfg, closeAfterHours: 0, maxOpen: 0 }, NOW).skip, []);
});

test('status line: refreshInterval replaced by a long one in Agentik sessions, unless the setting keeps it', () => {
  const user = { type: 'command', command: 'node sl.mjs', refreshInterval: 5 };
  assert.deepEqual(statusLineOverride(user, cfg), { ...user, refreshInterval: STATUSLINE_IDLE_SECONDS });
  assert.equal(statusLineOverride(user, { ...cfg, statuslineRefresh: true }), null);
  assert.equal(statusLineOverride({ type: 'command', command: 'x' }, cfg), null);
  assert.equal(statusLineOverride(undefined, cfg), null);
});

test('config: defaults, bounds, saved in the file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-')), 'lifecycle.json');
  const c = makeConfig(file);
  assert.deepEqual(c.get(), DEFAULTS);
  assert.deepEqual(c.set({ closeAfterHours: 4, maxOpen: -3, archiveAfterDays: 'x' }), { ...DEFAULTS, closeAfterHours: 4, maxOpen: 0 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).closeAfterHours, 4);
  assert.equal(c.set({ statuslineRefresh: true }).statuslineRefresh, true);
});
