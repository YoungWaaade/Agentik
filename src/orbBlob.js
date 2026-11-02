// The "eyes" avatar of every sub-agent: a plain white circle (faint outline so it shows on light backgrounds) with
// two black oval eyes, the same for all; only the EXPRESSION differs per agent. Each agent has its own COLOUR
// (src/orb.js ORB_COLORS) and its own EXPRESSION (EYES below: lids, tilt, gaze).
// One pure function builds the SVG text; the app shows it as a data-URI <img> (the CSS animation inside
// the SVG — float, blink, halo breathing — runs in an <img> too, and is off with prefers-reduced-motion),
// scripts/agent-orb-colors.mjs renders the same drawing to PNG (static) for the push notification icons.

// Expression = how each eye is drawn. Per eye (mirrored for the right one):
//  rx, ry   half width / height of the oval       rot   tilt in degrees (+ = top towards the inside)
//  dx, dy   gaze offset                            lid   top lid height cut off (0 = open)
//  slant    lid slope, + = inner side lower (frown), − = outer side lower (soft)
//  lidB     bottom lid height cut off (squint / smile of the cheeks)
//  shine    big tinted iris + sparkles (sparkling look)       arc  closed smiling crescent ("^")
// Optional `R` overrides the right eye, `y` moves both vertically.
export const EYES = {
  neutre: { label: 'Neutre, curieux', L: { rx: 4.6, ry: 7, rot: -9, dx: 0.8 }, R: { rx: 4.9, ry: 7.6, rot: -7, dx: 0.8, dy: -1 } },
  concentre: { label: 'Concentré, déterminé', L: { rx: 5, ry: 6.4, rot: 9, lid: 1.2, slant: 5.2, dy: 1 } },
  serieux: { label: 'Sérieux, méticuleux', L: { rx: 5.4, ry: 6.4, rot: 0, lid: 2.6, lidB: 1.4, slant: 0.8 } },
  souriant: { label: 'Doux, souriant', L: { arc: true, rx: 5.2, ry: 4.6, dy: 1 } },
  reveur: { label: 'Rêveur, créatif', L: { rx: 4.5, ry: 7, rot: 10, dx: 2.2, dy: -4.2, lidB: 1.2 } },
  petillant: { label: 'Pétillant', L: { rx: 5.8, ry: 8.4, rot: -5, shine: true, dy: -0.5 } },
  malicieux: { label: 'Malicieux', L: { rx: 4.8, ry: 7, rot: -10, dx: 1.2 }, R: { rx: 5, ry: 5, rot: 8, lid: 1.4, slant: 3.2, dx: 1.2, dy: 1.4 } },
  surpris: { label: 'Surpris', L: { rx: 4, ry: 8.8, rot: 0, dy: -1 } },
  calme: { label: 'Calme, posé', L: { rx: 5.2, ry: 6.8, rot: -4, lid: 3.4, slant: -1.2, dy: 1.4 } },
  timide: { label: 'Timide', L: { rx: 4.3, ry: 5.8, rot: -8, dx: -2.6, dy: 3.2, lid: 0.6, slant: -1.4 } },
};
export const EYE_NAMES = Object.keys(EYES);

const f = (n) => +n.toFixed(2);
const hsl = (h, s, l, a = 1) => `hsla(${Math.round(((h % 360) + 360) % 360)},${s}%,${l}%,${a})`;

// One eye, drawn around (0,0) then placed. s = -1 left, +1 right.
function eye(p, s, cx, cy, uid, tint, deep) {
  let { rx = 4.6, ry = 7, rot = 0, dx = 0, dy = 0, lid = 0, lidB = 0, slant = 0, shine, arc } = p;
  if (!arc) { rx *= 0.82; ry *= 1.3; } // tech look: long vertical pills
  const place = `translate(${f(cx + dx)}, ${f(cy + dy)}) rotate(${f(-s * rot * 0.7)})`;
  if (arc) {
    // happy crescent: ∩ with a soft glow
    const d = `M${-rx},${f(ry * 0.5)} Q0,${f(-ry * 1.3)} ${rx},${f(ry * 0.5)}`;
    return `<g transform="${place}"><path d="${d}" fill="none" stroke="${deep}" stroke-width="5.4" stroke-linecap="round" opacity=".45" filter="url(#${uid}g)"/><path d="${d}" fill="none" stroke="url(#${uid}e)" stroke-width="3.4" stroke-linecap="round"/></g>`;
  }
  // clip: the oval minus its lids (polygon in the eye's own frame)
  const top = -ry + lid, bot = ry - lidB;
  // line y at x: top + slant * (-s * x / rx)  → inner side (x = -s*rx … sign handled by rot mirroring) lower when slant > 0
  const y1 = top + slant * (-s) * (-1), y2 = top + slant * (-s) * 1;
  const pts = `${-rx - 1},${f(y1 - 0)} ${rx + 1},${f(y2)} ${rx + 1},${f(bot)} ${-rx - 1},${f(bot)}`;
  const sp = shine ? `
    
    <circle cx="${f(-rx * 0.28)}" cy="${f(-ry * 0.05)}" r="${f(rx * 0.3)}" fill="#fff"/>
    <circle cx="${f(rx * 0.32)}" cy="${f(ry * 0.5)}" r="${f(rx * 0.16)}" fill="#fff"/>` : '';
  const id = `${uid}c${s < 0 ? 'l' : 'r'}`;
  return `<g transform="${place}">
    <ellipse rx="${rx + 1.4}" ry="${ry + 1.4}" fill="${deep}" opacity=".5" filter="url(#${uid}g)"/>
    <clipPath id="${id}"><polygon points="${pts}"/></clipPath>
    <g clip-path="url(#${id})"><rect x="${f(-rx)}" y="${f(-ry)}" width="${f(rx * 2)}" height="${f(ry * 2)}" rx="${f(rx * 0.75)}" fill="url(#${uid}e)"/>${sp}
    <rect x="${f(-rx)}" y="${f(ry * 0.3)}" width="${f(rx * 2)}" height=".5" fill="#fff" opacity=".16"/>
    <rect x="${f(-rx * 0.62)}" y="${f(-ry * 0.8)}" width="${f(rx * 0.55)}" height="${f(ry * 0.32)}" rx=".5" fill="#fff" opacity=".4"/></g></g>`;
}

// colour = { hue } (from ORB_COLORS), eyes = name in EYES. `anim` false → static (PNG). `phase` 0..1 shifts the
// animation so the avatars on a screen don't blink together.
export function blobSvg({ hue = 225, eyes = 'neutre', phase = 0, anim = true, uid = 'b' } = {}) {
  const e = EYES[eyes] || EYES.neutre;
  const L = e.L, R = e.R || e.L;
  const base = '#050505', deep = 'none', light = '#2a2a2a'; // same black eyes for every agent (the colour is no longer drawn)
  const tint = '#555';
  const y = e.y || 0;
  const delay = f(-phase * 6), delay2 = f(-phase * 5.3);
  const css = anim ? `<style>
.fl{animation:fl 5.6s ease-in-out ${delay}s infinite}
.bk{transform-box:fill-box;transform-origin:center;animation:bk 5.3s ease-in-out ${delay2}s infinite}
@keyframes fl{0%,100%{transform:translateY(.8px)}50%{transform:translateY(-.8px)}}
@keyframes bk{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
@media (prefers-reduced-motion:reduce){.fl,.bk{animation:none}}
</style>` : '';
  const eyesSvg = `${eye(L, -1, 39.5, 52 + y, uid, tint, deep)}${eye(R, 1, 60.5, 52 + y, uid, tint, deep)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${css}
<defs>
<linearGradient id="${uid}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${base}"/></linearGradient>
<filter id="${uid}g" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.1"/></filter>
</defs>
<rect width="100" height="100" fill="none"/><circle cx="50" cy="50" r="49.4" fill="#fff" stroke="#000" stroke-opacity=".14" stroke-width="1.2"/>
<g transform="translate(50 52) scale(2.05) translate(-50 -52)"><g class="fl"><g class="bk">${eyesSvg}</g></g></g>
</svg>`;
}

const cache = new Map();
export function blobUrl(hue, eyes, phase = 0) {
  const key = `${hue}|${eyes}|${Math.round(phase * 8)}`;
  if (!cache.has(key)) cache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(blobSvg({ hue, eyes, phase: Math.round(phase * 8) / 8 }))}`);
  return cache.get(key);
}
