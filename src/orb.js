// Orb avatars: the default avatar of every agent without a profile photo. A translucent glass sphere
// split into swollen lobes by thin dark slits, iridescent, with a warm light at its centre; the lobes
// swell and turn slowly. Drawn by a WebGL shader (src/orbGL.js) through one shared context; small idle
// orbs, notifications and browsers without WebGL use a still image of the same shader
// (public/agents/orbs/<palette>.png, rendered by scripts/agent-orbs.mjs).
//
// Avatar spec of an orb: "/agents/orbs/<palette>.png" — the still image's path, so the server (push.js)
// finds the notification icon without knowing about orbs, and the browser animates it.

// Colours (sRGB hex): bg = deep background inside the round, body = glass tint, edge = fresnel rim,
// accent = iridescent patches, light = the central light. The dominant hue changes per palette; the
// iridescent glass stays.
export const PALETTES = {
  electrique: { label: 'Électrique', bg: '#16152b', body: '#2a3cff', edge: '#3fb2ff', accent: '#d03cff', light: '#fff1dc' },
  menthe: { label: 'Menthe', bg: '#0f1b1d', body: '#0f9e82', edge: '#56ffd2', accent: '#3d8bff', light: '#f4ffe8' },
  magenta: { label: 'Magenta', bg: '#1d1224', body: '#c8238f', edge: '#ff7ab8', accent: '#ff9a3d', light: '#fff0dc' },
  iris: { label: 'Iris', bg: '#18142b', body: '#7a3cff', edge: '#c6a2ff', accent: '#ff5fc8', light: '#fff2ea' },
  corail: { label: 'Corail', bg: '#1e1414', body: '#e2522f', edge: '#ffb07a', accent: '#d8327a', light: '#fff2e0' },
  azur: { label: 'Azur', bg: '#121a2e', body: '#1f6bff', edge: '#7fd0ff', accent: '#8a5cff', light: '#f0f6ff' },
  aurore: { label: 'Aurore', bg: '#101a24', body: '#1fb59a', edge: '#7cf5ff', accent: '#9a5cff', light: '#f2fff8' },
  or: { label: 'Or', bg: '#1d170f', body: '#d98a12', edge: '#ffd77a', accent: '#ff5f6d', light: '#fff8e6' },
  braise: { label: 'Braise', bg: '#1e1015', body: '#d41f3d', edge: '#ff8a66', accent: '#a03cff', light: '#fff0e0' },
  lagune: { label: 'Lagune', bg: '#0e1a20', body: '#0a8fb0', edge: '#5cf0e6', accent: '#3d6bff', light: '#effffd' },
};

// Palette recalling each agent's role.
export const AGENT_ORBS = {
  hammer: 'electrique', // builds apps: electric blue
  robin: 'menthe', // everyday life, papers, budget: calm greens
  anastasia: 'magenta', // Instagram: magenta → orange
  katerina: 'iris', // portfolio, design: iridescent violet
  claude: 'corail', // the default assistant: Claude's coral
  nami: 'azur', // team lead (shown only if her photo is removed): the blue of her picture
};

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const defaultOrb = (slug) => AGENT_ORBS[slug] || Object.keys(PALETTES)[hash(slug || 'agent') % Object.keys(PALETTES).length];
export const orbPath = (name) => `/agents/orbs/${name}.png`;
const ORB_RE = /^\/?agents\/orbs\/([a-z0-9-]+)\.png$/;
// Palette name of an orb spec, or null when the spec is something else.
export function orbOf(spec) {
  const m = typeof spec === 'string' && spec.match(ORB_RE);
  return m && PALETTES[m[1]] ? m[1] : null;
}
// Stable per-orb time offset (seconds) so a row of orbs never moves in lockstep.
export const orbPhase = (seed) => (hash(`${seed}~`) % 997) / 10;
