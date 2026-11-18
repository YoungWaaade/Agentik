import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyedQueue } from '../server/queue.js';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('never runs more than the limit at once', async () => {
  let live = 0, peak = 0, done = 0;
  const q = keyedQueue(async () => { live++; peak = Math.max(peak, live); await tick(); live--; done++; }, 2);
  for (let i = 0; i < 20; i++) q.push(`ws${i}`);
  while (q.size) await tick();
  assert.equal(peak, 2);
  assert.equal(done, 20);
});

test('a key pushed many times while waiting runs once', async () => {
  const runs = [];
  const q = keyedQueue(async (k) => { runs.push(k); await tick(); }, 1);
  q.push('a'); q.push('b'); q.push('b'); q.push('b');
  while (q.size) await tick();
  assert.deepEqual(runs, ['a', 'b']);
});

test('a key pushed while running runs once more afterwards, never in parallel with itself', async () => {
  let live = 0, peak = 0, runs = 0;
  const q = keyedQueue(async () => { live++; peak = Math.max(peak, live); runs++; await tick(); live--; }, 4);
  q.push('a');
  await tick(1);
  q.push('a'); q.push('a');
  while (q.size) await tick();
  assert.equal(peak, 1);
  assert.equal(runs, 2);
});

test('a failing run does not stall the queue', async () => {
  const runs = [];
  const q = keyedQueue(async (k) => { runs.push(k); if (k === 'bad') throw new Error('x'); }, 1);
  q.push('bad'); q.push('ok');
  while (q.size) await tick();
  assert.deepEqual(runs, ['bad', 'ok']);
});
