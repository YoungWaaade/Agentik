// The "blob with eyes" avatar of every sub-agent: a soft rounded body (light-to-colour gradient, blurred
// coloured halo, pale background) and two glossy white oval eyes. Each agent has its own COLOUR
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
function eye(p, s, cx, cy, uid, tint) {
  const { rx = 4.6, ry = 7, rot = 0, dx = 0, dy = 0, lid = 0, lidB = 0, slant = 0, shine, arc } = p;
  const place = `translate(${f(cx + dx)}, ${f(cy + dy)}) rotate(${f(-s * rot)})`;
  if (arc) {
    // happy crescent: ∩ with a soft glow
    const d = `M${-rx},${f(ry * 0.5)} Q0,${f(-ry * 1.3)} ${rx},${f(ry * 0.5)}`;
    return `<g transform="${place}"><path d="${d}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55" filter="url(#${uid}g)"/><path d="${d}" fill="none" stroke="url(#${uid}e)" stroke-width="3.4" stroke-linecap="round"/></g>`;
  }
  // clip: the oval minus its lids (polygon in the eye's own frame)
  const top = -ry + lid, bot = ry - lidB;
  // line y at x: top + slant * (-s * x / rx)  → inner side (x = -s*rx … sign handled by rot mirroring) lower when slant > 0
  const y1 = top + slant * (-s) * (-1), y2 = top + slant * (-s) * 1;
  const pts = `${-rx - 1},${f(y1 - 0)} ${rx + 1},${f(y2)} ${rx + 1},${f(bot)} ${-rx - 1},${f(bot)}`;
  const sp = shine ? `
    <ellipse cx="0" cy="${f(ry * 0.28)}" rx="${f(rx * 0.7)}" ry="${f(ry * 0.52)}" fill="${tint}" opacity=".45"/>
    <circle cx="${f(-rx * 0.28)}" cy="${f(-ry * 0.05)}" r="${f(rx * 0.3)}" fill="#fff"/>
    <circle cx="${f(rx * 0.32)}" cy="${f(ry * 0.5)}" r="${f(rx * 0.16)}" fill="#fff"/>` : '';
  const id = `${uid}c${s < 0 ? 'l' : 'r'}`;
  return `<g transform="${place}">
    <ellipse rx="${rx + 1.6}" ry="${ry + 1.6}" fill="#fff" opacity=".5" filter="url(#${uid}g)"/>
    <clipPath id="${id}"><polygon points="${pts}"/></clipPath>
    <g clip-path="url(#${id})"><ellipse rx="${rx}" ry="${ry}" fill="url(#${uid}e)"/>${sp}
    <ellipse cx="${f(-rx * 0.3)}" cy="${f(-ry * 0.45)}" rx="${f(rx * 0.35)}" ry="${f(ry * 0.22)}" fill="#fff" opacity=".9"/></g></g>`;
}

// colour = { hue } (from ORB_COLORS), eyes = name in EYES. `anim` false → static (PNG). `phase` 0..1 shifts the
// animation so the avatars on a screen don't blink together.
export function blobSvg({ hue = 225, eyes = 'neutre', phase = 0, anim = true, uid = 'b' } = {}) {
  const e = EYES[eyes] || EYES.neutre;
  const L = e.L, R = e.R || e.L;
  const base = hsl(hue, 88, 60), deep = hsl(hue, 85, 49), light = hsl(hue, 100, 86), pale = hsl(hue, 100, 95);
  const halo = hsl(hue + 55, 100, 72, 0.9), rim = hsl(hue - 40, 100, 70);
  const tint = hsl(hue, 90, 60);
  const y = e.y || 0;
  const delay = f(-phase * 6), delay2 = f(-phase * 5.3);
  const css = anim ? `<style>
.fl{animation:fl 5.6s ease-in-out ${delay}s infinite}
.ha{animation:ha 5.6s ease-in-out ${delay}s infinite}
.bk{transform-box:fill-box;transform-origin:center;animation:bk 5.3s ease-in-out ${delay2}s infinite}
@keyframes fl{0%,100%{transform:translateY(1.4px)}50%{transform:translateY(-1.4px)}}
@keyframes ha{0%,100%{opacity:.75}50%{opacity:1}}
@keyframes bk{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
@media (prefers-reduced-motion:reduce){.fl,.ha,.bk{animation:none}}
</style>` : '';
  const eyesSvg = `${eye(L, -1, 39.5, 52 + y, uid, tint)}${eye(R, 1, 60.5, 52 + y, uid, tint)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${css}
<defs>
<radialGradient id="${uid}bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ecebf3"/></radialGradient>
<linearGradient id="${uid}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".45" stop-color="${base}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
<radialGradient id="${uid}h" cx="42%" cy="22%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="${uid}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${pale}"/></linearGradient>
<filter id="${uid}g" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.3"/></filter>
<filter id="${uid}B" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="${uid}r" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>
<clipPath id="${uid}k"><path d="M21,60 C21,38 33,27 50,27 C67,27 79,38 79,60 C79,73 69,78 50,78 C31,78 21,73 21,60 Z"/></clipPath>
</defs>
<rect width="100" height="100" fill="url(#${uid}bg)"/>
<g transform="translate(50 54) scale(1.17) translate(-50 -54)"><g class="fl">
<g class="ha"><ellipse cx="50" cy="40" rx="33" ry="17" fill="${halo}" filter="url(#${uid}B)"/>
<ellipse cx="50" cy="80" rx="26" ry="8" fill="${hsl(hue, 100, 70, 0.55)}" filter="url(#${uid}B)"/></g>
<path d="M21,60 C21,38 33,27 50,27 C67,27 79,38 79,60 C79,73 69,78 50,78 C31,78 21,73 21,60 Z" fill="url(#${uid}b)"/>
<g clip-path="url(#${uid}k)"><path d="M22,50 C26,33 38,28 50,28 C62,28 74,33 78,50" fill="none" stroke="${rim}" stroke-width="5" filter="url(#${uid}r)" opacity=".95"/>
<ellipse cx="42" cy="36" rx="22" ry="12" fill="url(#${uid}h)"/>
<ellipse cx="50" cy="78" rx="26" ry="7" fill="${hsl(hue + 30, 100, 65, 0.5)}" filter="url(#${uid}r)"/></g>
<g class="bk">${eyesSvg}</g>
</g></g></svg>`;
}

const cache = new Map();
export function blobUrl(hue, eyes, phase = 0) {
  const key = `${hue}|${eyes}|${Math.round(phase * 8)}`;
  if (!cache.has(key)) cache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(blobSvg({ hue, eyes, phase: Math.round(phase * 8) / 8 }))}`);
  return cache.get(key);
}
