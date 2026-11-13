// Accent colour chosen by the user (Réglages → Apparence): pure colour maths, no DOM, shared by the app and tests.
// From one hex colour, accentVars() derives every accent token of styles.css for a theme, nudged so text stays
// readable: accent text against the page background, and white or dark text on top of the accent.

// null = Agentik's own orange: no override at all, styles.css keeps its tuned values.
export const ACCENT_PRESETS = [
  [null, 'Orange', '#e07850'],
  ['#4a9eff', 'Bleu'],
  ['#8b7cf6', 'Violet'],
  ['#2fb47c', 'Vert'],
  ['#e0569b', 'Rose'],
  ['#e5b62b', 'Jaune'],
];

const BG = { dark: [21, 17, 16], light: [255, 255, 255] }; // --background of each theme
const DARK_TEXT = [17, 17, 19];
const WHITE = [255, 255, 255];

export function normalizeAccent(v) {
  const s = String(v ?? '').trim().toLowerCase();
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(s);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h}`;
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function luminance(c) {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// Move `c` toward `to` (white or black) by small steps until it reaches `ratio` against `bg`.
function reach(c, bg, ratio, to) {
  let out = c;
  for (let t = 0; t <= 1 && contrast(out, bg) < ratio; t += 0.04) out = mix(c, to, t);
  return out;
}
// White or dark text on the accent, whichever reads better.
export const textOn = (c) => (contrast(c, WHITE) >= contrast(c, DARK_TEXT) ? '#fff' : hexOf(DARK_TEXT));

export function accentVars(value, theme) {
  const hex = normalizeAccent(value);
  if (!hex) return null;
  const c = rgbOf(hex);
  const bg = BG[theme] || BG.dark;
  const dark = theme !== 'light';
  // Marks (arcs, dots, outlines) need 3:1 against the page, accent text 4.5:1.
  const mark = reach(c, bg, 3, dark ? WHITE : [0, 0, 0]);
  const text = dark ? reach(mix(c, WHITE, 0.3), bg, 4.5, WHITE) : reach(c, bg, 4.5, [0, 0, 0]);
  const primary = dark ? mark : text;
  return {
    '--primary': hexOf(primary),
    '--primary-fg': hexOf(text),
    '--primary-rgb': c.join(', '),
    '--on-primary': textOn(primary),
    '--on-accent': textOn(primary),
    '--event-fg': hexOf(dark ? text : reach(c, bg, 6, [0, 0, 0])),
    '--status-working': hexOf(mark),
    '--status-working-ping': hexOf(dark ? mix(mark, WHITE, 0.15) : mark),
  };
}
