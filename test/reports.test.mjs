import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptKey, reportTargets, promptTracker, typedByUser } from '../server/reports.js';

test('the last sender hears back even if it did not launch the session', () => {
  assert.deepEqual(reportTargets({ sender_agent: 'nami', sender_conv: 4 }), [{ agent: 'nami', conv: 4 }]);
  assert.deepEqual(reportTargets({ owner_agent: 'nami', owner_conv: 2, sender_agent: 'git', sender_conv: 1 }),
    [{ agent: 'nami', conv: 2 }, { agent: 'git', conv: 1 }]);
  // Another conversation of the same agent is told too.
  assert.equal(reportTargets({ owner_agent: 'nami', owner_conv: 2, sender_agent: 'nami', sender_conv: 5 }).length, 2);
});

test('sender = owner: told once', () => {
  assert.deepEqual(reportTargets({ owner_agent: 'nami', owner_conv: 2, sender_agent: 'nami', sender_conv: 2 }), [{ agent: 'nami', conv: 2 }]);
  assert.deepEqual(reportTargets({ owner_agent: 'nami', owner_conv: null, sender_agent: 'nami' }), [{ agent: 'nami', conv: null }]);
});

test('unknown agents and empty fields are skipped', () => {
  assert.deepEqual(reportTargets({}), []);
  assert.deepEqual(reportTargets({ owner_agent: 'gone', sender_agent: 'nami', sender_conv: 1 }, (a) => a === 'nami'), [{ agent: 'nami', conv: 1 }]);
});

test('a prompt typed by Agentik is recognised once in its UserPromptSubmit, flattened or merged', () => {
  const t = promptTracker();
  t.typed('w', 'Fais\nla  suite : merci​', { logged: true });
  assert.deepEqual(t.submitted('w', 'autre chose'), []);
  const hit = t.submitted('w', 'Fais la suite : merci');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].logged, true);
  assert.deepEqual(t.submitted('w', 'Fais la suite : merci'), [], 'consumed');
  t.typed('w', 'un');
  t.typed('w', 'deux');
  assert.equal(t.submitted('w', 'un\ndeux').length, 2);
});

test('typed prompts expire', () => {
  let clock = 0;
  const t = promptTracker({ ttl: 1000, now: () => clock });
  t.typed('w', 'vieux');
  clock = 5000;
  t.typed('w', 'neuf');
  assert.deepEqual(t.submitted('w', 'vieux'), []);
});

test('typedByUser: not the initial prompt nor Agentik notices', () => {
  assert.equal(typedByUser('arrête-toi', 'Mission : corrige le bug'), true);
  assert.equal(typedByUser('Mission : corrige le bug', 'Mission :\ncorrige le bug'), false);
  assert.equal(typedByUser('[Supersept] relis', null), false);
  assert.equal(typedByUser('<task-notification>x', null), false);
  assert.equal(typedByUser('', null), false);
  assert.equal(promptKey(' a\tb c '), 'abc');
});
