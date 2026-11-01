// Agent avatars, always a plain circle (no shadow, glow, border or hover effect; only a small green
// dot while the agent works). Four kinds, from the avatar field of the agent's .md:
//  - "/agents/orbs/<palette>.png" → animated orb (src/orb.js) — the default of every agent;
//  - an image path or URL (an uploaded photo: /api/attachments/…) → that picture;
//  - "" / legacy spec / "photo" for an agent with a profile photo (PHOTOS, scripts/agent-photos.mjs:
//    public/agents/<slug>.webp large, <slug>-sm.webp small) → the photo;
//  - "v2:accent,skin,…" → the older illustrated portrait, still drawn for agents that have one.
// Anything else → the agent's default orb.

import { memo, useEffect, useRef } from 'react';
import { PALETTES, LAYERS, layerCss, baseCss, glassCss, orbOf, defaultOrb, orbPhase } from '../orb.js';
import '../orb.css';

export const ACCENTS = {
  mandarine: '#ff8a3d',
  rose: '#ff3d9a',
  acide: '#c6ff3d',
  cyan: '#2de2ff',
  violet: '#a67bff',
  corail: '#ff6f4f',
  menthe: '#3dffb4',
  or: '#ffc83d',
  rouge: '#ff2d45',
  azur: '#3d8bff',
};
// Kept for older imports.
export const BOT_COLORS = ACCENTS;
export const SKINS = ['porcelaine', 'sable', 'graphite', 'chrome'];
export const HAIRS = ['carre', 'afro', 'banane', 'longs', 'boucles', 'cornes', 'crete', 'crane'];
export const EYES = ['ouverts', 'calmes', 'visiere', 'lunettes', 'ronds'];
export const MARKS = ['aucune', 'barres', 'lignes', 'point', 'circuit', 'etincelle'];
export const ACCESSORIES = ['aucun', 'casque', 'boucle', 'lunettes-front', 'antenne'];
export const MOUTHS = ['neutre', 'sourire', 'moue'];
export const PARTS = ['accent', 'skin', 'hair', 'eyes', 'marks', 'accessory', 'mouth'];
export const PART_OPTIONS = { accent: Object.keys(ACCENTS), skin: SKINS, hair: HAIRS, eyes: EYES, marks: MARKS, accessory: ACCESSORIES, mouth: MOUTHS };
export const BOT_LABELS = {
  mandarine: 'Mandarine', rose: 'Rose néon', acide: 'Acide', cyan: 'Cyan', violet: 'Violet', corail: 'Corail', menthe: 'Menthe', or: 'Or', rouge: 'Rouge', azur: 'Azur',
  porcelaine: 'Porcelaine', sable: 'Sable', graphite: 'Graphite', chrome: 'Chrome',
  carre: 'Carré chrome', afro: 'Afro', banane: 'Banane', longs: 'Longs', boucles: 'Boucles', cornes: 'Cornes', crete: 'Crête', crane: 'Crâne lisse',
  ouverts: 'Ouverts', calmes: 'Calmes', visiere: 'Visière', lunettes: 'Lunettes', ronds: 'Ronds',
  aucune: 'Aucune', barres: 'Barres', lignes: 'Lignes', point: 'Point', circuit: 'Circuit', etincelle: 'Étincelle',
  aucun: 'Aucun', casque: 'Casque audio', boucle: 'Boucle d’oreille', 'lunettes-front': 'Lunettes de visée', antenne: 'Antenne',
  neutre: 'Neutre', sourire: 'Sourire', moue: 'Moue',
};

// The team's designed portraits (accent recalls the role).
export const PRESETS = {
  nami: { accent: 'mandarine', skin: 'porcelaine', hair: 'carre', eyes: 'ouverts', marks: 'lignes', accessory: 'boucle', mouth: 'sourire' },
  anastasia: { accent: 'rose', skin: 'graphite', hair: 'afro', eyes: 'lunettes', marks: 'aucune', accessory: 'casque', mouth: 'sourire' },
  katerina: { accent: 'acide', skin: 'sable', hair: 'boucles', eyes: 'ronds', marks: 'point', accessory: 'lunettes-front', mouth: 'sourire' },
  hammer: { accent: 'cyan', skin: 'sable', hair: 'banane', eyes: 'visiere', marks: 'barres', accessory: 'aucun', mouth: 'neutre' },
  robin: { accent: 'violet', skin: 'porcelaine', hair: 'longs', eyes: 'calmes', marks: 'barres', accessory: 'boucle', mouth: 'neutre' },
  claude: { accent: 'corail', skin: 'chrome', hair: 'crane', eyes: 'ouverts', marks: 'etincelle', accessory: 'antenne', mouth: 'sourire' },
};

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const OLD_COLORS = { roux: 'mandarine', jaune: 'acide', ember: 'corail', sable: 'or', sauge: 'menthe', ciel: 'cyan', lilas: 'violet', corail: 'rouge', galet: 'azur' };
const OLD_EYES = { ronds: 'ronds', joyeux: 'calmes', pixels: 'visiere', endormis: 'calmes', etoiles: 'lunettes', cils: 'ouverts' };
const OLD_HAIR = { boule: 'crane', double: 'cornes', eclair: 'crete', aucune: 'boucles', meche: 'carre' };
const OLD_ACC = { casque: 'casque', palette: 'lunettes-front', loupe: 'lunettes-front', noeud: 'boucle', ruban: 'boucle', cle: 'antenne', plume: 'boucle', aucun: 'aucun' };

export function parseAvatar(spec, seed = '') {
  if (spec && typeof spec === 'object') return { ...PRESETS.claude, ...spec };
  const s = String(spec || '');
  const h = hash(seed || s || 'bot');
  const pick = (part, i) => PART_OPTIONS[part][(h >> (i * 3)) % PART_OPTIONS[part].length];
  if (s.startsWith('v2:')) {
    const v = s.slice(3).split(',');
    return Object.fromEntries(PARTS.map((p, i) => [p, PART_OPTIONS[p].includes(v[i]) ? v[i] : pick(p, i)]));
  }
  if (PRESETS[seed]) return { ...PRESETS[seed] };
  const [color, eyes, mouth, antenna, accessory] = s.split(',');
  return {
    accent: OLD_COLORS[color] || pick('accent', 0),
    skin: pick('skin', 1),
    hair: OLD_HAIR[antenna] || pick('hair', 2),
    eyes: OLD_EYES[eyes] || pick('eyes', 3),
    marks: pick('marks', 4),
    accessory: OLD_ACC[accessory] || 'aucun',
    mouth: { sourire: 'sourire', o: 'moue', langue: 'sourire' }[mouth] || 'neutre',
  };
}
export const avatarSpec = (a) => `v2:${PARTS.map((p) => a[p]).join(',')}`;
export function randomAvatar() {
  const r = (l) => l[Math.floor(Math.random() * l.length)];
  return Object.fromEntries(PARTS.map((p) => [p, r(PART_OPTIONS[p])]));
}
// Agents with a profile photo (scripts/agent-photos.mjs); the others are orbs.
export const PHOTOS = ['nami'];
export const hasPhoto = (slug) => PHOTOS.includes(slug);
const isImage = (s) => /^data:image\//.test(s) || (/^(\/|https?:\/\/)/.test(s) && !orbOf(s));
// { kind: 'orb', palette } | { kind: 'photo', src(size) } | { kind: 'portrait', a }
export function avatarKind(spec, slug) {
  if (spec && typeof spec === 'object') return { kind: 'portrait' };
  const s = String(spec || '');
  if (s.startsWith('v2:')) return { kind: 'portrait' };
  const orb = orbOf(s);
  if (orb) return { kind: 'orb', palette: orb };
  if (isImage(s)) return { kind: 'photo', src: () => s };
  if (hasPhoto(slug)) return { kind: 'photo', src: (size) => `/agents/${slug}${size >= 72 ? '' : '-sm'}.webp` };
  return { kind: 'orb', palette: defaultOrb(slug) };
}
export const usesPhoto = (spec, slug) => avatarKind(spec, slug).kind === 'photo';
export function accentOf(spec, seed) {
  const k = avatarKind(spec, seed);
  if (k.kind === 'orb') return PALETTES[k.palette].c[2];
  return ACCENTS[parseAvatar(spec, seed).accent];
}

// ---- drawing ---------------------------------------------------------------------------------

const mix = (hex, to, t) => {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const SKIN = {
  porcelaine: ['#fffaf5', '#efe2d8', '#c4a99c', '#6e5248'],
  sable: ['#ffd7b0', '#e3a374', '#a8653f', '#4d2818'],
  graphite: ['#9aa0b3', '#585e72', '#2b2f3c', '#0e0f15'],
  chrome: ['#ffffff', '#d4d7e2', '#6c7184', '#161821'],
};
const INK = '#07070a';

// Face outline (toy proportions: big head, small chin).
const FACE = 'M33,41 C33,25 40,19 50,19 C60,19 67,25 67,41 C67,53 62,62 50,66 C38,62 33,53 33,41 Z';

function hairParts(hair) {
  // [back layer drawn behind the face, front layer drawn over it]
  switch (hair) {
    case 'carre': return [
      'M29,36 C29,20 38,12 50,12 C62,12 71,20 71,36 L71.5,63 L63,63 L64,46 L36,46 L37,63 L28.5,63 Z',
      'M50,12 C62,12 71,20 71,36 L70.5,62 L64.5,62 L65,39 C58,36.5 44,37 35.5,41.5 L35.5,62 L29.5,62 L29.5,36 C29.5,20 38,12 50,12 Z',
    ];
    case 'afro': return [
      'M50,4 C60,3 66,8 69,13 C77,13 82,21 80,29 C86,35 84,45 77,48 C77,54 71,57 66,55 L67,38 L33,38 L34,55 C29,57 23,54 23,48 C16,45 14,35 20,29 C18,21 23,13 31,13 C34,8 40,3 50,4 Z',
      'M33,37 C33,30 38,26 44,27 C47,24 53,24 56,27 C62,26 67,30 67,37 C64,33 58,32 55,33 C52,31 48,31 45,33 C42,32 36,33 33,37 Z',
    ];
    case 'banane': return [
      'M31,48 C30,40 30,30 34,25 L66,25 C70,30 70,40 69,48 Z',
      'M32.5,40 C30,26 38,10 57,8.5 C71,7.5 80,13 78.5,20.5 C76,17.5 70,17.5 67.5,21 C69,26 68,32 67.2,38 C63,30.5 54,28 46,30.5 C40,32.5 35.5,36 32.5,40 Z',
    ];
    case 'longs': return [
      'M28,38 C28,20 38,12 50,12 C62,12 72,20 72,38 L74,84 C66,88 60,86 58,84 L58,68 L42,68 L42,84 C40,86 34,88 26,84 Z',
      'M50,12 C62,12 71.5,20 71.5,38 L70,58 L65.5,52 L65.5,36 C60,34.5 40,34.5 34.5,36 L34.5,52 L30,58 L28.5,38 C28.5,20 38,12 50,12 Z',
    ];
    case 'boucles': return [
      'M30,40 C25,34 27,26 32,24 C32,17 38,13 44,15 C47,10 54,10 57,14 C63,12 69,16 69,23 C74,26 75,34 70,40 Z',
      'M33,35 C31,30 34,26 37,27 C37,22 42,20 45,23 C47,19 53,19 55,23 C58,20 63,22 63,27 C66,26 69,30 67,35 C63,31 59,31 56,32 C53,29 47,29 44,32 C40,30 36,31 33,35 Z',
    ];
    case 'cornes': return [
      null,
      'M50,14 C61,14 69,21 68.5,34 L67,30 L56,31 L58,24 L50,31 L42,30 L36,32 L32,36 C31,22 39,14 50,14 Z M34,22 L36,3 L42,17 Z M60,18 L72,5 L66,24 Z',
    ];
    case 'crete': return [
      null,
      'M46,30 C45,20 46,10 48,2 C51,6 53,14 54,30 C52,28.5 48,28.5 46,30 Z',
    ];
    default: return [null, null];
  }
}

function eyesSvg(eyes, acc) {
  const L = 42, R = 58, Y = 46.5;
  switch (eyes) {
    case 'calmes': return `
      <path d="M38.2,46.4 C40,48.6 43.6,48.8 45.6,46.6" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M54.4,46.6 C56.4,48.8 60,48.6 61.8,46.4" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M37.6,41.6 L45.4,43.2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M54.6,43.2 L62.4,41.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`;
    case 'visiere': return `
      <path d="M34,42.5 C42,40.5 58,40.5 66,42.5 L65.5,50 C58,51.5 42,51.5 34.5,50 Z" fill="url(#visor)" stroke="${INK}" stroke-width=".8"/>
      <path d="M37,46.5 L63,46.5" stroke="${acc}" stroke-width="1.6" stroke-linecap="round" filter="url(#glow)"/>
      <path d="M37,46.5 L63,46.5" stroke="#fff" stroke-width=".5" stroke-linecap="round" opacity=".9"/>
      <path d="M38,43.2 C44,42.2 50,42.2 54,42.6" stroke="#fff" stroke-width=".7" opacity=".55" fill="none"/>`;
    case 'lunettes': return `
      <path d="M35,43 L48,43 C48,49 46,51 41,51 C36.5,51 35,48 35,43 Z M52,43 L65,43 C65,48 63.5,51 59,51 C54,51 52,49 52,43 Z" fill="url(#visor)" stroke="${INK}" stroke-width=".9"/>
      <path d="M48,44 L52,44" stroke="${INK}" stroke-width="1"/>
      <path d="M36.5,44.2 L46.5,44.2 M53.5,44.2 L63.5,44.2" stroke="${acc}" stroke-width=".9" filter="url(#glow)"/>
      <path d="M38,49 L42,44.5 M55,49 L59,44.5" stroke="#fff" stroke-width=".9" opacity=".7"/>`;
    case 'ronds': return [L, R].map((x) => `
      <ellipse cx="${x}" cy="${Y}" rx="3.6" ry="4" fill="${INK}"/>
      <ellipse cx="${x}" cy="${Y + 1.6}" rx="2.2" ry="1.2" fill="${acc}" opacity=".55"/>
      <circle cx="${x - 1.2}" cy="${Y - 1.5}" r="1.15" fill="#fff"/>`).join('');
    default: return [L, R].map((x, i) => {
      const d = i ? 1 : -1;
      return `
      <path d="M${x - 4.4},${Y} C${x - 2},${Y - 3.4} ${x + 2},${Y - 3.4} ${x + 4.4},${Y - 0.4 * d} C${x + 2},${Y + 2.8} ${x - 2},${Y + 2.8} ${x - 4.4},${Y} Z" fill="#f7f4f2"/>
      <circle cx="${x}" cy="${Y - 0.2}" r="2.3" fill="${acc}"/>
      <circle cx="${x}" cy="${Y - 0.2}" r="1.1" fill="${INK}"/>
      <circle cx="${x - 0.8}" cy="${Y - 1.1}" r=".6" fill="#fff"/>
      <path d="M${x - 4.6},${Y} C${x - 2},${Y - 3.6} ${x + 2},${Y - 3.6} ${x + 4.6},${Y - 0.4 * d}" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M${x + 4.4 * d},${Y - 0.6} l${1.6 * d},-1.4" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`;
    }).join('');
  }
}

function marksSvg(marks, acc) {
  switch (marks) {
    case 'barres': return `
      <rect x="48.9" y="30" width="2.6" height="9" rx=".4" fill="${acc}" transform="rotate(6 50 34)"/>
      <path d="M35.4,51 L40.6,52.4 L40.2,54.4 L35.6,53.2 Z M36,55.4 L41,56.8 L40.5,58.6 L36.6,57.4 Z" fill="${acc}"/>`;
    case 'lignes': return `
      <path d="M37.5,52 L41.5,55 M40,51.2 L44,54.2 M56,54.2 L60,51.2 M58.5,55 L62.5,52" stroke="${acc}" stroke-width="1.1" stroke-linecap="round"/>`;
    case 'point': return `<path d="M50,33 L51.8,35.4 L50,37.8 L48.2,35.4 Z" fill="${acc}"/>`;
    case 'circuit': return `<path d="M64.5,44 L61,48 L61,54 L57.5,57" fill="none" stroke="${acc}" stroke-width=".9"/><circle cx="57.3" cy="57.2" r="1.1" fill="${acc}"/><circle cx="64.6" cy="43.9" r=".9" fill="${acc}"/>`;
    case 'etincelle': return `<g transform="translate(50 33)" fill="${acc}">${[0, 45, 90, 135, 180, 225, 270, 315].map((r, i) => `<rect x="-.6" y="${i % 2 ? -3.4 : -4.6}" width="1.2" height="${i % 2 ? 3.4 : 4.6}" rx=".6" transform="rotate(${r})"/>`).join('')}</g>`;
    default: return '';
  }
}

function mouthSvg(mouth) {
  if (mouth === 'sourire') return `<path d="M46.8,59 C48.6,60.6 51.4,60.6 53.2,59" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/>`;
  if (mouth === 'moue') return `<ellipse cx="50" cy="59.6" rx="1.3" ry="1.1" fill="${INK}"/>`;
  return `<path d="M47.6,59.6 L52.4,59.4" stroke="${INK}" stroke-width="1.1" stroke-linecap="round"/>`;
}

function accessorySvg(acc, kind, phase) {
  if (kind === 'casque' && phase === 'front') return `
    <path d="M30,44 C27,20 73,20 70,44" fill="none" stroke="${INK}" stroke-width="4.2"/>
    <path d="M30,44 C27,20 73,20 70,44" fill="none" stroke="url(#chrome)" stroke-width="2.8"/>
    ${[29, 71].map((x) => `<rect x="${x - 4.5}" y="40" width="9" height="13" rx="4" fill="url(#chrome)" stroke="${INK}" stroke-width=".9"/>
    <rect x="${x - 2.2}" y="42.5" width="4.4" height="8" rx="2.2" fill="${acc}" filter="url(#glow)"/>
    <rect x="${x - 1.2}" y="43.5" width="2.4" height="6" rx="1.2" fill="#fff" opacity=".85"/>`).join('')}`;
  if (kind === 'boucle' && phase === 'front') return `
    <path d="M33.5,52 L33.5,55" stroke="${INK}" stroke-width=".8"/>
    <rect x="31.2" y="55" width="4.6" height="9" rx=".8" fill="${INK}"/>
    <rect x="32.6" y="56.6" width="1.8" height="5.8" fill="${acc}" filter="url(#glow)"/>`;
  if (kind === 'lunettes-front' && phase === 'front') return `
    <path d="M31,33 C40,29 60,29 69,33" fill="none" stroke="${INK}" stroke-width="3"/>
    ${[42, 58].map((x) => `<circle cx="${x}" cy="30.5" r="5" fill="url(#chrome)" stroke="${INK}" stroke-width=".9"/>
    <circle cx="${x}" cy="30.5" r="3.3" fill="${acc}" opacity=".9" filter="url(#glow)"/>
    <path d="M${x - 2},${32} L${x + 1.6},${28.6}" stroke="#fff" stroke-width=".9" opacity=".8"/>`).join('')}`;
  if (kind === 'antenne' && phase === 'back') return `
    <path d="M60,22 L67,6" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M60,22 L67,6" stroke="url(#chrome)" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="67.5" cy="5.5" r="4.5" fill="${acc}" opacity=".45" filter="url(#glow)"/>
    <circle cx="67.5" cy="5.5" r="2.4" fill="${acc}"/><circle cx="66.8" cy="4.8" r=".9" fill="#fff"/>`;
  return '';
}

const VIEWS = { xl: '0 0 100 100', md: '9 4 82 82', sm: '22 12 56 56' };
function buildSvg(a, tier = 'xl') {
  const acc = ACCENTS[a.accent] || ACCENTS.corail;
  const sk = SKIN[a.skin] || SKIN.porcelaine;
  const [back, front] = hairParts(a.hair);
  const bgTop = mix(acc, '#14121c', 0.55);
  const bgMid = mix(acc, '#0c0b10', 0.82);
  const pinkish = mix(acc, '#ffe6f0', 0.7);
  const chromeHair = a.hair === 'cornes' ? 'url(#matte)' : 'url(#chrome)';
  const hairShape = (d, cls = '') => d ? `
    <path d="${d}" fill="${chromeHair}" stroke="${INK}" stroke-width="1" stroke-linejoin="round" ${cls}/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWS[tier]}">
<defs>
  <radialGradient id="bg" cx="50%" cy="34%" r="78%">
    <stop offset="0" stop-color="${bgTop}"/><stop offset=".55" stop-color="${bgMid}"/><stop offset="1" stop-color="#060509"/>
  </radialGradient>
  <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${acc}" stop-opacity=".55"/><stop offset="1" stop-color="${acc}" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="skin" cx="38%" cy="30%" r="80%">
    <stop offset="0" stop-color="${sk[0]}"/><stop offset=".38" stop-color="${sk[1]}"/><stop offset=".78" stop-color="${sk[2]}"/><stop offset="1" stop-color="${sk[3]}"/>
  </radialGradient>
  <linearGradient id="chrome" x1="0" y1="0" x2=".9" y2="1">
    <stop offset="0" stop-color="#1a1b22"/><stop offset=".14" stop-color="#8d92a3"/><stop offset=".24" stop-color="#ffffff"/>
    <stop offset=".31" stop-color="#e6e4ee"/><stop offset=".38" stop-color="#1b1c24"/><stop offset=".5" stop-color="#4c5060"/>
    <stop offset=".6" stop-color="${pinkish}"/><stop offset=".66" stop-color="#ffffff"/><stop offset=".74" stop-color="#5b5f70"/>
    <stop offset=".86" stop-color="${mix(acc, '#20222b', 0.55)}"/><stop offset="1" stop-color="#0b0b10"/>
  </linearGradient>
  <linearGradient id="matte" x1="0" y1="0" x2=".4" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e4e6ee"/><stop offset="1" stop-color="#9da2b4"/>
  </linearGradient>
  <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2c2e3a"/><stop offset=".45" stop-color="#14151c"/><stop offset="1" stop-color="#08080c"/>
  </linearGradient>
  <linearGradient id="visor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a2c38"/><stop offset=".5" stop-color="#07070b"/><stop offset="1" stop-color="${mix(acc, '#000000', 0.5)}"/>
  </linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>
  <filter id="soft1"><feGaussianBlur stdDeviation=".7"/></filter>
  <clipPath id="face"><path d="${FACE}"/></clipPath>
  <clipPath id="bodyClip"><path d="M8,100 C9,86 20,78 36,76 L64,76 C80,78 91,86 92,100 Z"/></clipPath>
</defs>
<rect x="-10" y="-10" width="120" height="120" fill="url(#bg)"/>
<g opacity=".9">
  <circle cx="50" cy="40" r="31" fill="url(#sun)"/>
  ${[44, 51, 57, 62, 66].map((y, i) => `<rect x="10" y="${y}" width="80" height="${0.9 + i * 0.5}" fill="${bgMid}"/>`).join('')}
</g>
<path d="M0,78 L100,78 M0,84 L100,84 M0,91 L100,91 M50,72 L20,100 M50,72 L80,100 M50,72 L50,100 M50,72 L0,96 M50,72 L100,96" stroke="${acc}" stroke-width=".35" opacity=".22"/>
${accessorySvg(acc, a.accessory, 'back')}
${hairShape(back)}
<ellipse cx="50" cy="96" rx="44" ry="10" fill="#000" opacity=".5" filter="url(#soft)"/>
<path d="M8,100 C9,86 20,78 36,76 L64,76 C80,78 91,86 92,100 Z" fill="url(#body)" stroke="${INK}" stroke-width=".8"/>
<g clip-path="url(#bodyClip)">
  <path d="M86,100 C86,90 80,82 70,79" fill="none" stroke="${acc}" stroke-width="2.4" opacity=".55" filter="url(#soft1)"/>
  <path d="M18,86 C26,80 34,79 40,79" fill="none" stroke="#fff" stroke-width="1.2" opacity=".18"/>
  <path d="M56,77 C57,85 56,93 54,100" fill="none" stroke="${acc}" stroke-width=".7"/>
  <path transform="translate(23 85.5) scale(.55)" d="M3,12 C5,6 11,4 15,6 C19,4 23,8 21,12 C24,13 23,18 19,18 L5,18 C1,18 0,13 3,12 Z" fill="${acc}" stroke="#fff" stroke-width="1.2"/>
  <path d="M10,100 C12,90 22,82 36,79" fill="none" stroke="#fff" stroke-width="1.6" opacity=".22" filter="url(#soft1)"/>
</g>
<path d="M41,70 L41,78 C44,81 56,81 59,78 L59,70 Z" fill="url(#body)" stroke="${INK}" stroke-width=".8"/>
<path d="M43.5,60 L43.5,71 C46,73 54,73 56.5,71 L56.5,60 Z" fill="${sk[2]}"/>
<path d="M43.5,64 C46,67 54,67 56.5,64 L56.5,69 C54,71 46,71 43.5,69 Z" fill="${sk[3]}" opacity=".5"/>
${[33, 67].map((x, i) => `<ellipse cx="${x + (i ? 0.4 : -0.4)}" cy="47" rx="3" ry="4.2" fill="${i ? mix(sk[1], acc, 0.55) : sk[1]}" stroke="${INK}" stroke-width=".7"/>`).join('')}
<path d="${FACE}" fill="url(#skin)"/>
<g clip-path="url(#face)">
  <ellipse cx="69" cy="47" rx="5" ry="17" fill="${acc}" opacity=".75" filter="url(#soft)"/>
  <ellipse cx="50" cy="22" rx="18" ry="5" fill="#000" opacity=".28" filter="url(#soft)"/>
  <ellipse cx="41" cy="31" rx="6" ry="3.5" fill="#fff" opacity="${a.skin === 'chrome' ? '.95' : '.45'}" filter="url(#soft1)"/>
  ${a.skin === 'chrome' ? `<path d="M33,45 C40,49 60,49 67,45 L67,49 C60,53 40,53 33,49 Z" fill="${pinkish}" opacity=".5"/><path d="M33,53 C40,56 60,56 67,53" stroke="#0c0d12" stroke-width="1.4" fill="none" opacity=".35" filter="url(#soft1)"/>` : ''}
  <ellipse cx="38.5" cy="53.5" rx="3" ry="1.8" fill="${acc}" opacity=".22" filter="url(#soft1)"/>
  <ellipse cx="61.5" cy="53.5" rx="3" ry="1.8" fill="${acc}" opacity=".22" filter="url(#soft1)"/>
</g>
<path d="${FACE}" fill="none" stroke="${INK}" stroke-width="1"/>
${marksSvg(a.marks, acc)}
${eyesSvg(a.eyes, acc)}
<ellipse cx="50" cy="54.6" rx="1.1" ry=".8" fill="${mix(sk[2], '#ff5a5a', 0.45)}"/>
<circle cx="49.6" cy="54.3" r=".35" fill="#fff" opacity=".8"/>
${mouthSvg(a.mouth)}
${hairShape(front)}
${front && a.hair !== 'cornes' && a.hair !== 'crete' ? `<path d="M37,18 C42,14.5 49,13.6 54,14.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".95"/>` : ''}
${a.hair === 'crane' ? `<path d="M40,23.5 C44,21 50,20.6 54,21.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" fill="none"/>` : ''}
${accessorySvg(acc, a.accessory, 'front')}
</svg>`;
}

const cache = new Map();
export function portraitUrl(a, tier = 'xl') {
  const key = `${avatarSpec(a)}|${tier}`;
  if (!cache.has(key)) cache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSvg(a, tier))}`);
  return cache.get(key);
}

// Busy agents' orbs turn faster: the playback rate of the running CSS animations is changed in place
// (no jump, unlike swapping the animation-duration).
const BUSY_RATE = 2.6;
function Orb({ palette, seed, size, busy, className }) {
  const ref = useRef(null);
  const c = PALETTES[palette].c;
  // Small orbs (message avatars, lists: often many at once) stay still unless the agent is working.
  const tier = size <= 28 && !busy ? 'o-sm' : '';
  useEffect(() => {
    const el = ref.current;
    if (!el?.getAnimations) return;
    for (const a of el.getAnimations({ subtree: true })) {
      if (a.updatePlaybackRate) a.updatePlaybackRate(busy ? BUSY_RATE : 1);
      else a.playbackRate = busy ? BUSY_RATE : 1;
    }
  }, [busy, palette, tier]);
  return (
    <span ref={ref} className={`bot-avatar orb ${tier} ${busy ? 'busy' : ''} ${className}`}
      style={{ width: size, height: size, '--acc': c[2], '--phase': `${orbPhase(seed)}s` }} aria-hidden="true">
      <span className="orb-core" style={{ background: baseCss(c) }}>
        {LAYERS.map((l, i) => (
          <i key={i} className={`orb-layer ${l.morph ? 'morph' : ''}`}
            style={{ background: layerCss(l, c), '--turn': `${Math.abs(l.turn)}s`, animationDirection: l.morph ? 'alternate' : l.turn < 0 ? 'reverse' : 'normal' }} />
        ))}
        <i className="orb-glass" style={{ background: glassCss }} />
      </span>
      {busy && size >= 24 && <i className="portrait-dot" />}
    </span>
  );
}

function BotAvatar({ spec, seed, size = 16, className = '', busy = false }) {
  const k = avatarKind(spec, seed);
  if (k.kind === 'orb') return <Orb palette={k.palette} seed={seed || ''} size={size} busy={busy} className={className} />;
  const a = parseAvatar(spec, seed);
  const tier = size >= 72 ? 'xl' : size >= 36 ? 'md' : 'sm';
  const src = k.kind === 'photo' ? k.src(size) : portraitUrl(a, tier);
  return (
    <span className={`bot-avatar portrait p-${tier} ${busy ? 'busy' : ''} ${className}`}
      style={{ width: size, height: size, '--acc': ACCENTS[a.accent] }} aria-hidden="true">
      <img src={src} alt="" draggable="false" width={size} height={size} decoding="async" />
      {busy && size >= 24 && <i className="portrait-dot" />}
    </span>
  );
}
export default memo(BotAvatar);
