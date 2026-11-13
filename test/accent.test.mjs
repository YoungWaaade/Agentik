import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ACCENT_PRESETS, normalizeAccent, contrast, accentVars } from '../src/accentColors.js';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const BG = { dark: rgb('#151110'), light: rgb('#ffffff') };
const custom = ACCENT_PRESETS.map(([v]) => v).filter(Boolean).concat(['#000000', '#ffffff', '#ffff00', '#123456']);

test('normalizeAccent accepts #abc, ABCDEF and rejects the rest', () => {
  assert.equal(normalizeAccent('#ABC'), '#aabbcc');
  assert.equal(normalizeAccent('ABCDEF'), '#abcdef');
  assert.equal(normalizeAccent(' #4a9eff '), '#4a9eff');
  for (const bad of ['', null, undefined, 'red', '#12345', '#ggg000', 'url(x)']) assert.equal(normalizeAccent(bad), null, String(bad));
});

test('no accent = the default orange, nothing overridden', () => {
  assert.equal(accentVars(null, 'dark'), null);
  assert.equal(accentVars('nope', 'light'), null);
  assert.equal(ACCENT_PRESETS[0][0], null);
});

test('accent text stays readable on the page, marks stay visible, text on the accent too', () => {
  for (const c of custom) for (const theme of ['dark', 'light']) {
    const v = accentVars(c, theme);
    const where = `${c} ${theme}`;
    assert.ok(contrast(rgb(v['--primary-fg']), BG[theme]) >= 4.5, `primary-fg ${where}`);
    assert.ok(contrast(rgb(v['--status-working']), BG[theme]) >= 3, `status ${where}`);
    assert.ok(contrast(rgb(v['--primary']), BG[theme]) >= 3, `primary ${where}`);
    const on = v['--on-accent'] === '#fff' ? '#ffffff' : v['--on-accent'];
    assert.ok(contrast(rgb(on), rgb(v['--primary'])) >= 4.5, `on-accent ${where}`);
  }
});

test('white on a dark accent, dark text on yellow', () => {
  assert.equal(accentVars('#1d4ed8', 'light')['--on-accent'], '#fff');
  assert.notEqual(accentVars('#e5b62b', 'dark')['--on-accent'], '#fff');
});

test('the choice is saved in appearance.json, invalid colours refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-accent-'));
  process.env.CLAUDE_HUB_DIR = dir;
  const { appearance, setAppearance } = await import('../server/appearance.js');
  assert.deepEqual(appearance(), { accent: null });
  assert.deepEqual(setAppearance({ accent: '#4A9EFF' }), { accent: '#4a9eff' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'appearance.json'), 'utf8')).accent, '#4a9eff');
  assert.throws(() => setAppearance({ accent: 'bleu' }), /couleur invalide/);
  assert.deepEqual(appearance(), { accent: '#4a9eff' });
  assert.deepEqual(setAppearance({ accent: null }), { accent: null });
  fs.rmSync(dir, { recursive: true, force: true });
});
