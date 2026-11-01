// Animated orbs: the default avatar of every agent without a profile photo. A living, liquid sphere:
// soft colour blobs on layers that turn slowly in opposite directions under a fixed glass layer
// (specular highlight, depth, refracted rim light). One table of layers drives both renderers:
//  - the live orb (BotAvatar.jsx + orb.css): each layer is a div of radial gradients turned by a
//    compositor-only transform animation — cheap even with many orbs on an iPhone;
//  - the still image for push notifications (orbSvg → scripts/agent-orbs.mjs → public/agents/orbs/).
//
// Avatar spec of an orb: "/agents/orbs/<palette>.png" — the still image's path, so the server (push.js)
// finds the notification icon without knowing about orbs, and the browser animates it.

// [deep, mid, c1, c2, c3, c4]: background (edge → centre) then the four blob colours.
export const PALETTES = {
  electrique: { label: 'Électrique', c: ['#030a24', '#0b2a6b', '#22d3ee', '#3b6bff', '#7c5cff', '#b9f6ff'] },
  menthe: { label: 'Menthe', c: ['#03170f', '#0b4a3a', '#3dffb4', '#14b8a6', '#a3e635', '#e6fff4'] },
  magenta: { label: 'Magenta', c: ['#1a0420', '#5a0d4a', '#ff3d9a', '#ff8a3d', '#8b5cf6', '#ffd9a0'] },
  iris: { label: 'Iris', c: ['#0c0626', '#3a1a6e', '#c084fc', '#f472b6', '#60a5fa', '#f5e1ff'] },
  corail: { label: 'Corail', c: ['#1f0805', '#6b2010', '#ff6f4f', '#ffb347', '#e0457b', '#ffe6cc'] },
  azur: { label: 'Azur', c: ['#02061f', '#0d1f80', '#3d5bff', '#1aa3ff', '#8f6bff', '#dbe6ff'] },
  aurore: { label: 'Aurore', c: ['#020f17', '#0a3a4a', '#2df5c4', '#7c5cff', '#23b5ff', '#e2fff8'] },
  or: { label: 'Or', c: ['#1a0f02', '#5c3a06', '#ffc83d', '#ff8a3d', '#ffe9a8', '#fff6dc'] },
  braise: { label: 'Braise', c: ['#1a0206', '#5e0a18', '#ff2d45', '#ff7a3d', '#b81d6b', '#ffd0c0'] },
  lagune: { label: 'Lagune', c: ['#011418', '#06424f', '#00d1c7', '#2f80ff', '#7fffd4', '#d9fffb'] },
};

// Palette recalling each agent's role.
export const AGENT_ORBS = {
  hammer: 'electrique', // builds apps: electric blue
  robin: 'menthe', // everyday life, papers, budget: calm greens
  anastasia: 'magenta', // Instagram: magenta → orange
  katerina: 'iris', // portfolio, design: iridescent lilac
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
// Stable per-orb phase (negative delay, seconds) so a row of orbs never moves in lockstep.
export const orbPhase = (seed) => -(hash(`${seed}~`) % 997) / 10;

// Layers are 150% of the orb (inset -25%) so they cover it whatever their angle. Blobs: [x, y, rx, ry,
// colour index, opacity] in % of the layer; turn: seconds per turn (negative = counterclockwise).
// Layers are 150% of the orb (inset -25%) so they cover it whatever their angle. Blobs: [x, y, rx, ry,
// colour index, opacity] in % of the layer; turn: seconds per turn (negative = counterclockwise); morph: the
// layer also stretches like a liquid and is blended in screen mode.
export const LAYERS = [
  { turn: 26, blobs: [[37, 37, 30, 22, 2, 1], [66, 64, 26, 30, 4, 1]] },
  { turn: -17, blobs: [[64, 38, 24, 18, 3, 1], [36, 64, 22, 26, 2, 0.85]] },
  { turn: 11, morph: true, blobs: [[52, 58, 17, 11, 5, 0.42], [42, 44, 13, 17, 3, 0.45]] },
];
// Colour stops [offset, opacity factor]: a blob is dense at its heart and fades out well before its
// edge, so some deep base shows between blobs.
const BLOB = [[0, 1], [0.4, 0.55], [0.85, 0]];

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${+a.toFixed(3)})`;
}
export const layerCss = (layer, c) => layer.blobs
  .map(([x, y, rx, ry, i, o]) => `radial-gradient(ellipse ${rx}% ${ry}% at ${x}% ${y}%, ${BLOB.map(([at, f]) => `${rgba(c[i], o * f)} ${at * 100}%`).join(', ')})`)
  .join(', ');
const BASE = { x: 50, y: 64, r: 56 };
export const baseCss = (c) => `radial-gradient(ellipse ${BASE.r}% ${BASE.r}% at ${BASE.x}% ${BASE.y}%, ${c[1]} 0%, ${c[0]} 100%)`;

// Glass, over the colours (fixed): [x, y, rx, ry, [[offset, colour, opacity]…]] in % of the orb —
// specular highlight, wider sheen, light refracted at the bottom, depth at the edge.
const GLASS = [
  [36, 19, 17, 10, [[0, '#fff', 0.85], [0.5, '#fff', 0.3], [1, '#fff', 0]]],
  [40, 26, 30, 21, [[0, '#fff', 0.22], [1, '#fff', 0]]],
  [50, 102, 42, 23, [[0, '#fff', 0.38], [1, '#fff', 0]]],
  [50, 50, 50, 50, [[0.62, '#000', 0], [0.88, '#000', 0.25], [1, '#000', 0.55]]],
];
export const glassCss = GLASS
  .map(([x, y, rx, ry, st]) => `radial-gradient(ellipse ${rx}% ${ry}% at ${x}% ${y}%, ${st.map(([at, col, a]) => `${rgba(col === '#fff' ? '#ffffff' : '#000000', a)} ${at * 100}%`).join(', ')})`)
  .join(', ');

// Still frame (angle 0) as an SVG, for the notification icons. Same geometry as the CSS: a layer's
// point (x%, y%) lies at -25 + 1.5·x % of the orb.
export function orbSvg(name, size = 256) {
  const c = PALETTES[name].c;
  const s = size / 100;
  let defs = '', body = '', k = 0;
  const grad = (x, y, rx, ry, stops) => {
    const id = `g${k++}`;
    defs += `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${x * s} ${y * s}) scale(${rx * s} ${ry * s})">${stops
      .map(([at, col, a]) => `<stop offset="${at}" stop-color="${col}" stop-opacity="${+a.toFixed(3)}"/>`).join('')}</radialGradient>`;
    return `url(#${id})`;
  };
  const rect = (fill, blend) => `<rect width="${size}" height="${size}" fill="${fill}"${blend ? ` style="mix-blend-mode:${blend}"` : ''}/>`;
  body += rect(grad(BASE.x, BASE.y, BASE.r, BASE.r, [[0, c[1], 1], [1, c[0], 1]]));
  const L = (v) => -25 + 1.5 * v;
  for (const layer of LAYERS) for (const [x, y, rx, ry, i, o] of layer.blobs) {
    body += rect(grad(L(x), L(y), 1.5 * rx, 1.5 * ry, BLOB.map(([at, f]) => [at, c[i], o * f])), layer.morph && 'screen');
  }
  for (const [x, y, rx, ry, st] of GLASS) body += rect(grad(x, y, rx, ry, st));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs>${defs}<clipPath id="round"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></clipPath></defs>
<g clip-path="url(#round)">${body}</g></svg>`;
}
