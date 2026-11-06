import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignAvatars, naturalAvatar, avatarSpec, takenAvatars, SHAPE_KEYS, COLOR_KEYS } from '../src/avatarSlots.js';

// The team as it was when the bug showed up (creation order = `created`).
const TEAM = [
  ['katrina', 'corail,endormis,sourire,boule,loupe'], ['franky', 'ciel,ronds,neutre,double,aucun'], ['nami', 'fleur,corail'],
  ['adi', ''], ['robin', 'lilas,ronds,sourire,boule,casque'], ['git', 'etoile,ciel'], ['dummy', ''], ['moshi', ''], ['sky', ''],
].map(([slug, avatar], i) => ({ slug, avatar, created: i }));
const unique = (m) => new Set(m.values()).size === m.size;

test('every agent of the team gets its own shape + colour', () => {
  const m = assignAvatars(TEAM);
  assert.ok(unique(m), JSON.stringify([...m]));
  assert.ok(![...m.values()].includes(avatarSpec(naturalAvatar('claude'))), 'the default Claude look stays free');
});

test('saved looks and unique natural looks are kept', () => {
  const m = assignAvatars(TEAM);
  assert.equal(m.get('nami'), 'fleur,corail');
  assert.equal(m.get('git'), 'etoile,ciel');
  for (const slug of ['katrina', 'franky', 'robin', 'moshi']) assert.equal(m.get(slug), avatarSpec(naturalAvatar(slug)), slug);
});

test('adding agents never moves anyone nor repeats a look', () => {
  // Once given, looks are saved: feed them back, then add agents one by one.
  let agents = [...assignAvatars(TEAM)].map(([slug, avatar], i) => ({ slug, avatar, created: i }));
  for (let n = 0; n < 60; n++) {
    const before = new Map(agents.map((a) => [a.slug, a.avatar]));
    agents.push({ slug: `agent-${n}`, avatar: '', created: 100 + n });
    const m = assignAvatars(agents);
    assert.ok(unique(m), `after ${n + 1} new agents`);
    for (const [slug, spec] of before) assert.equal(m.get(slug), spec, slug);
    agents = agents.map((a) => ({ ...a, avatar: m.get(a.slug) }));
  }
});

test('two agents that saved the same look: the oldest keeps it', () => {
  const m = assignAvatars([{ slug: 'b', avatar: 'pile,rose', created: 2 }, { slug: 'a', avatar: 'pile,rose', created: 1 }]);
  assert.equal(m.get('a'), 'pile,rose');
  assert.notEqual(m.get('b'), 'pile,rose');
});

test('the editor sees the other agents\' looks as taken, not its own', () => {
  const t = takenAvatars([{ slug: 'nami', label: 'Nami', avatar: 'fleur,corail' }, { slug: 'git', label: 'Git', avatar: 'etoile,ciel' }], 'git');
  assert.equal(t.get('fleur,corail'), 'Nami');
  assert.ok(!t.has('etoile,ciel'));
  assert.equal(SHAPE_KEYS.length * COLOR_KEYS.length, 91);
});
