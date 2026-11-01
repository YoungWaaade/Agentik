// The orb: default avatar of every agent without a profile photo. One animation for all of them, the
// original GIF (public/agents/originals/orb.gif) cropped on its pink glass sphere and played as a muted
// looping video (public/agents/orb/, made by scripts/agent-orb.mjs; playback in src/orbVideo.js).
//
// Avatar spec of the orb: "/agents/orb/orb.png", its still image, so the server (push.js) finds the
// notification icon without knowing about orbs. Specs of the former WebGL orbs ("/agents/orbs/<palette>.png")
// still mean the orb.
export const ORB_SPEC = '/agents/orb/orb.png';
export const ORB_STILL = ORB_SPEC;
export const ORB_ACCENT = '#ff3d9a';
export const ORB_SOURCES = [['/agents/orb/orb.mp4', 'video/mp4'], ['/agents/orb/orb.webm', 'video/webm']];
// Animated image fallbacks (video can't autoplay, e.g. iOS Low Power Mode): lossless WebP, else the GIF.
export const ORB_WEBP = '/agents/orb/orb.webp';
export const ORB_GIF = '/agents/orb/orb.gif';
const ORB_RE = /^\/?agents\/orbs?\/[a-z0-9-]+\.png$/;
export const isOrb = (spec) => typeof spec === 'string' && ORB_RE.test(spec);

// ---- one colour per agent --------------------------------------------------------------------------
// Every agent has its own colour of the same animation: a hue rotation of the pink original (CSS
// `filter: hue-rotate()` in the app, the same matrix applied to the stills by scripts/agent-orb-colors.mjs).
// Spec of a coloured orb: "/agents/orbs/<colour>.png" (its still, also the push icon). Rotations picked on
// renders so the colours stay clearly apart; `hue` = perceived hue, used to keep new agents' colours far from
// the ones already taken.
export const ORB_COLORS = {
  rose: { label: 'Rose', rotate: 0, hue: 330 },
  corail: { label: 'Corail', rotate: 40, hue: 10 },
  or: { label: 'Or', rotate: 85, hue: 45 },
  vert: { label: 'Vert', rotate: 140, hue: 120 },
  cyan: { label: 'Cyan', rotate: 210, hue: 190 },
  bleu: { label: 'Bleu', rotate: 235, hue: 225 },
  violet: { label: 'Violet', rotate: 295, hue: 280 },
  // Spare colours, for the next agents (between the ones above: the most distant free one is picked).
  lime: { label: 'Lime', rotate: 112, hue: 80 },
  emeraude: { label: 'Émeraude', rotate: 168, hue: 155 },
  indigo: { label: 'Indigo', rotate: 262, hue: 250 },
  magenta: { label: 'Magenta', rotate: 318, hue: 305 },
  rouge: { label: 'Rouge', rotate: 22, hue: 355 },
};
// Colour of the agents whose .md has no orb spec. Every agent its own colour: keep this list free of
// duplicates, and give a new agent a free colour (server/agents.js does it on creation via freeOrbColor).
export const AGENT_ORBS = {
  anastasia: 'rose', // Instagram pink, the original
  claude: 'corail', // Claude's coral
  zero: 'or', // folders, files and paperwork: archive gold
  robin: 'vert', // everyday life, lists, budget
  nami: 'cyan', // team lead (photo; colour kept so no one else takes it)
  hammer: 'bleu', // builds apps: electric blue
  katerina: 'violet', // portfolio, design
};
// Names of the former WebGL palettes, still found in old specs.
const OLD_PALETTES = { electrique: 'bleu', menthe: 'vert', iris: 'violet', azur: 'cyan', aurore: 'emeraude', braise: 'rouge', lagune: 'cyan' };

export const orbSpec = (color) => `/agents/orbs/${color}.png`;
const hashOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
// Colour of an agent's orb: the one in its spec, else its default, else one derived from its id.
export function orbColor(spec, slug) {
  const m = typeof spec === 'string' && /^\/?agents\/orbs\/([a-z0-9-]+)\.png$/.exec(spec);
  const named = m && (ORB_COLORS[m[1]] ? m[1] : OLD_PALETTES[m[1]]);
  if (named) return named;
  if (AGENT_ORBS[slug]) return AGENT_ORBS[slug];
  const names = Object.keys(ORB_COLORS);
  return names[hashOf(slug || 'agent') % names.length];
}
// The free colour farthest (in hue) from those already taken by `agents` ([{ slug, avatar }]) or reserved in
// AGENT_ORBS (Claude, the built-in agent, has no .md); when all are taken, the least used one.
export function freeOrbColor(agents) {
  const used = [...new Set([...Object.keys(AGENT_ORBS), ...agents.map((a) => a.slug)])]
    .map((slug) => orbColor(agents.find((a) => a.slug === slug)?.avatar, slug));
  const dist = (a, b) => { const d = Math.abs(ORB_COLORS[a].hue - ORB_COLORS[b].hue) % 360; return Math.min(d, 360 - d); };
  const score = (c) => [-used.filter((u) => u === c).length, used.length ? Math.min(...used.map((u) => dist(c, u))) : 0];
  return Object.keys(ORB_COLORS).reduce((best, c) => {
    const [n, d] = score(c), [bn, bd] = score(best);
    return n > bn || (n === bn && d > bd) ? c : best;
  });
}
// CSS hue-rotate() as a 3×3 sRGB matrix (Filter Effects spec), for the stills and the accent colours.
export function hueMatrix(deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [
    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
  ];
}
// Accent of a colour (rings, headers): the pink accent turned like the orb.
export function orbAccent(color) {
  const rgb = [1, 3, 5].map((i) => parseInt(ORB_ACCENT.slice(i, i + 2), 16));
  const m = hueMatrix(ORB_COLORS[color]?.rotate || 0);
  return `#${m.map((row) => Math.round(Math.max(0, Math.min(255, row.reduce((t, k, i) => t + k * rgb[i], 0)))).toString(16).padStart(2, '0')).join('')}`;
}
