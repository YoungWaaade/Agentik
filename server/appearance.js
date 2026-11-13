// Look of the interface shared by every device (Réglages → Apparence): today only the accent colour.
// null = Agentik's default orange.
import fs from 'node:fs';
import path from 'node:path';
import { HUB_DIR } from './db.js';
import { normalizeAccent } from '../src/accentColors.js';

const FILE = path.join(HUB_DIR, 'appearance.json');

export function appearance() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  return { accent: normalizeAccent(saved.accent) };
}

export function setAppearance(patch = {}) {
  const s = appearance();
  if (patch.accent !== undefined) {
    const a = patch.accent === null || patch.accent === '' ? null : normalizeAccent(patch.accent);
    if (patch.accent && !a) throw new Error('couleur invalide : attendu #rrggbb');
    s.accent = a;
  }
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2) + '\n');
  return s;
}
