// The avatar of every sub-agent: a plain white circle (faint outline so it shows on light backgrounds) with two
// FLAT black robot eyes (no gradient, shine or glow), simple geometric shapes inspired by robot-face sheets:
// vertical bars, dashes, arcs, chevrons, dots, stars. Each agent has its own shape (EYES; src/orb.js AGENT_EYES /
// freeEyes) and its own colour entry (ORB_COLORS, kept as the agent's identity colour but no longer drawn).
// One pure function builds the SVG text; the app shows it as a data-URI <img> (the CSS blink — eyes squash to a
// dash — and float run inside the SVG, and are off with prefers-reduced-motion); scripts/agent-orb-colors.mjs
// renders the same drawing to PNG (static) for the push notification icons.

const f = (n) => +n.toFixed(2);
const INK = '#000';
const rect = (cx, cy, w, h, r, rot = 0) => `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${w}" height="${h}" rx="${r}" fill="${INK}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`;
const line = (d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>`;
const dot = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK}"/>`;
const star = (cx, cy, R) => {
  const k = R * 0.2;
  return `<path d="M${cx},${cy - R} Q${cx + k},${cy - k} ${cx + R},${cy} Q${cx + k},${cy + k} ${cx},${cy + R} Q${cx - k},${cy + k} ${cx - R},${cy} Q${cx - k},${cy - k} ${cx},${cy - R} Z" fill="${INK}"/>`;
};
const up = (cx, cy) => line(`M${cx - 9},${cy + 5} L${cx},${cy - 5} L${cx + 9},${cy + 5}`); // ^
const cup = (cx, cy) => line(`M${cx - 9},${cy - 3} Q${cx},${cy + 9} ${cx + 9},${cy - 3}`); // ∪ (sleepy)
const gt = (cx, cy) => line(`M${cx - 5},${cy - 9} L${cx + 5},${cy} L${cx - 5},${cy + 9}`); // >
const lt = (cx, cy) => line(`M${cx + 5},${cy - 9} L${cx - 5},${cy} L${cx + 5},${cy + 9}`); // <
const X1 = 33, X2 = 67, Y = 50;

// Expression = the shape of the two eyes (centres at 33 and 67, y = 50 in a 100 box).
export const EYES = {
  concentre: { label: 'Rectangles droits (concentré)', draw: () => [rect(X1, Y, 10, 30, 3.5), rect(X2, Y, 10, 30, 3.5)] },
  serieux: { label: 'Tirets plats (sérieux)', draw: () => [rect(X1, Y + 2, 19, 6.5, 2), rect(X2, Y + 2, 19, 6.5, 2)] },
  souriant: { label: 'Arcs ^ ^ (souriant)', draw: () => [up(X1, Y + 1), up(X2, Y + 1)] },
  reveur: { label: 'Étoiles (créatif)', draw: () => [star(X1, Y, 15), star(X2, Y, 15)] },
  petillant: { label: 'Cercles pleins (pétillant)', draw: () => [dot(X1, Y, 10.5), dot(X2, Y, 10.5)] },
  neutre: { label: 'Rectangles inclinés (curieux)', draw: () => [rect(X1, Y + 1, 9.5, 28, 3.5, -9), rect(X2, Y - 2, 9.5, 31, 3.5, 7)] },
  malicieux: { label: 'Barre et chevron | <', draw: () => [rect(X1 - 2, Y, 8, 28, 3), lt(X2 - 1, Y)] },
  timide: { label: 'Chevrons > <', draw: () => [gt(X1, Y), lt(X2, Y)] },
  surpris: { label: 'Barres fines (surpris)', draw: () => [rect(X1, Y, 6, 36, 3), rect(X2, Y, 6, 36, 3)] },
  calme: { label: 'Arcs ∪ (calme, endormi)', draw: () => [cup(X1, Y - 1), cup(X2, Y - 1)] },
};
export const EYE_NAMES = Object.keys(EYES);

// `anim` false → static (PNG). `phase` 0..1 shifts the animation so avatars on a screen don't blink together.
export function blobSvg({ eyes = 'neutre', phase = 0, anim = true } = {}) {
  const e = EYES[eyes] || EYES.neutre;
  const delay = f(-phase * 6), delay2 = f(-phase * 5.3);
  const css = anim ? `<style>
.fl{animation:fl 5.6s ease-in-out ${delay}s infinite}
.bk{transform-box:fill-box;transform-origin:center;animation:bk 5.3s ease-in-out ${delay2}s infinite}
@keyframes fl{0%,100%{transform:translateY(.8px)}50%{transform:translateY(-.8px)}}
@keyframes bk{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}
@media (prefers-reduced-motion:reduce){.fl,.bk{animation:none}}
</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${css}
<circle cx="50" cy="50" r="49.4" fill="#fff" stroke="#000" stroke-opacity=".14" stroke-width="1.2"/>
<g class="fl"><g class="bk">${e.draw().join('')}</g></g></svg>`;
}

const cache = new Map();
export function blobUrl(hue, eyes, phase = 0) {
  const key = `${eyes}|${Math.round(phase * 8)}`;
  if (!cache.has(key)) cache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(blobSvg({ eyes, phase: Math.round(phase * 8) / 8 }))}`);
  return cache.get(key);
}
