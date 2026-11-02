// Avatars of the sub-agents: the 3 tiles of Emre's model (public/agents/source/model-tiles.jpeg, IMG_1678) cut out
// as they are (rounded square, soft halo, same eyes), upscaled; the other tints are the SAME tile hue-rotated.
//   public/agents/tiles/<tint>.png (512 px, transparent corners)   public/agents/<slug>-sm.png (192 px, push icons)
//   public/agents/tiles/<tint>-base.png  the same tile WITHOUT eyes (hole filled by diffusion of the blob's own colours)
//   public/agents/tiles/<tint>-eyeL.png / -eyeR.png  each eye cut from the tile (original pixels, soft edge, full-tile
//   size) → BotAvatar stacks them on the base and squashes them in Y to blink (src/orb.css).
// Run: SHARP=/chemin/sharp node scripts/agent-tiles.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { TINTS, AGENT_TINTS } from '../src/orb.js';

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP || 'sharp');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'public/agents');
const SRC = path.join(DIR, 'source/model-tiles.jpeg');
const XS = [66, 248, 431], Y = 258, W = 162; // exact cut of the 3 tiles of the model (1 px inside the edge)
// Centring: the content (blob + halo) of each tile of the model sits at a different place in its square (measured on
// the chroma map, bounding box at 40 % of the max: centres (81,92) / (80,80) / (79,81) of 162). Each cut is moved
// (SHIFT = [dx, dy]) so that the blob + halo are centred on the tile (80.5, 80.5): same margins for all of them.
const SHIFT = [[0, -11], [0, 0], [1, 0]];
async function crop(base) {
  const [dx, dy] = SHIFT[base];
  const src = await sharp(SRC).extract({ left: XS[base], top: Y, width: W, height: W }).removeAlpha().raw().toBuffer();
  if (!dx && !dy) return sharp(src, { raw: { width: W, height: W, channels: 3 } });
  const bg = [0, 1, 2].map((c) => src[(6 * W + 6) * 3 + c]); // flat colour of the tile's corner
  const out = Buffer.alloc(W * W * 3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const X = x - dx, Y2 = y - dy, ok = X >= 0 && Y2 >= 0 && X < W && Y2 < W;
    for (let c = 0; c < 3; c++) out[(y * W + x) * 3 + c] = ok ? src[(Y2 * W + X) * 3 + c] : bg[c];
  }
  return sharp(out, { raw: { width: W, height: W, channels: 3 } });
}
const R = 0.2; // corner radius / side of the model's tiles
const mask = (n) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}"><rect width="${n}" height="${n}" rx="${n * R}" fill="#fff"/></svg>`);

async function tile(t, size) {
  let img = (await crop(t.base)).resize(size, size, { kernel: 'lanczos3' });
  if (t.hue) img = img.modulate({ hue: t.hue });
  const rgb = await img.png().toBuffer();
  return sharp(rgb).ensureAlpha().composite([{ input: mask(size), blend: 'dest-in' }]).png({ compressionLevel: 9 }).toBuffer();
}
// ---- eyes: mask measured on the model's sky-blue tile (the 3 tiles have the eyes at the same place) ----------------
const N = W; // work at the size of the cut (162 px), then upscale
const EYES0 = [{ cx: 70, cy: 92, rx: 22, ry: 24, side: 'L' }, { cx: 115, cy: 87, rx: 22, ry: 24, side: 'R' }];
const component = (m, sx, sy) => { // only the blob of white pixels that contains (sx, sy): the eye, not the highlights around it
  const o = new Uint8Array(N * N), st = [[Math.round(sx), Math.round(sy)]];
  while (st.length) {
    const [x, y] = st.pop();
    if (x < 0 || y < 0 || x >= N || y >= N || !m[y * N + x] || o[y * N + x]) continue;
    o[y * N + x] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return o;
};
const MASKS = {};
{
  const base = 2; // (the pale pink tile has no usable contrast: its eyes are where the violet one's are, before the shift)
  const raw0 = await (await crop(base)).removeAlpha().raw().toBuffer();
  MASKS[2] = EYES0.map((e) => {
    const m = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (((x - e.cx - SHIFT[2][0]) / e.rx) ** 2 + ((y - e.cy - SHIFT[2][1]) / e.ry) ** 2 > 1) continue;
      const i = (y * N + x) * 3;
      if (Math.min(raw0[i], raw0[i + 1], raw0[i + 2]) >= 225) m[y * N + x] = 1;
    }
    return component(m, e.cx + SHIFT[2][0], e.cy + SHIFT[2][1]);
  });
  const raw1 = await (await crop(0)).removeAlpha().raw().toBuffer();
  MASKS[0] = EYES0.map((e) => {
    const m = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (((x - e.cx - SHIFT[0][0]) / e.rx) ** 2 + ((y - e.cy - SHIFT[0][1]) / e.ry) ** 2 > 1) continue;
      const i = (y * N + x) * 3;
      if (Math.min(raw1[i], raw1[i + 1], raw1[i + 2]) >= 225) m[y * N + x] = 1;
    }
    return component(m, e.cx + SHIFT[0][0], e.cy + SHIFT[0][1]);
  });
  const [dx, dy] = [SHIFT[1][0] - SHIFT[2][0], SHIFT[1][1] - SHIFT[2][1]];
  MASKS[1] = MASKS[2].map((m) => { const o = new Uint8Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x]) { const X = x + dx, Y2 = y + dy; if (X >= 0 && Y2 >= 0 && X < N && Y2 < N) o[Y2 * N + X] = 1; } return o; });
}
const EYES = EYES0;
const dilate = (m, r) => {
  const o = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x]) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) {
      const X = x + dx, Y2 = y + dy; if (X >= 0 && Y2 >= 0 && X < N && Y2 < N) o[Y2 * N + X] = 1;
    }
  }
  return o;
};
const blur = (a, r, passes = 3) => { // box blur of a float map
  let src = Float32Array.from(a);
  for (let p = 0; p < passes; p++) for (const horiz of [true, false]) {
    const dst = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let sum = 0, c = 0;
      for (let k = -r; k <= r; k++) { const X = horiz ? x + k : x, Y2 = horiz ? y : y + k; if (X >= 0 && Y2 >= 0 && X < N && Y2 < N) { sum += src[Y2 * N + X]; c++; } }
      dst[y * N + x] = sum / c;
    }
    src = dst;
  }
  return src;
};
const DATA = {};
for (const base of [0, 1, 2]) {
  const core = MASKS[base];
  const hole = new Uint8Array(N * N);
  for (const m of core) { const d = dilate(m, 7); for (let i = 0; i < d.length; i++) if (d[i]) hole[i] = 1; }
  // centre of each eye (transform origin of the blink), in % of the tile
  const origins = core.map((m) => { let sx = 0, sy = 0, c = 0; for (let i = 0; i < m.length; i++) if (m[i]) { sx += i % N; sy += Math.floor(i / N); c++; } return [+(100 * sx / c / N).toFixed(1), +(100 * sy / c / N).toFixed(1)]; });
  DATA[base] = { eyeAlpha: core.map((m) => blur(dilate(m, 4), 2)), hole, origins };
}
console.log('origines des yeux (%) par tuile', JSON.stringify(Object.fromEntries(Object.entries(DATA).map(([k, v]) => [k, v.origins]))));

function noEyes(rgb, hole) { // fill the hole with the surrounding colours (diffusion)
  const f = Float32Array.from(rgb);
  const known = [];
  for (let i = 0; i < N * N; i++) if (!hole[i]) known.push(i);
  // start: mean of the ring around the hole
  const ring = dilate(hole, 3);
  for (let c = 0; c < 3; c++) {
    let sum = 0, n = 0;
    for (let i = 0; i < N * N; i++) if (ring[i] && !hole[i]) { sum += rgb[i * 3 + c]; n++; }
    for (let i = 0; i < N * N; i++) if (hole[i]) f[i * 3 + c] = sum / n;
  }
  for (let it = 0; it < 900; it++) for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x; if (!hole[i]) continue;
    for (let c = 0; c < 3; c++) f[i * 3 + c] = (f[(i - 1) * 3 + c] + f[(i + 1) * 3 + c] + f[(i - N) * 3 + c] + f[(i + N) * 3 + c]) / 4;
  }
  return Buffer.from(f.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
}
const up = (buf, ch, size) => sharp(buf, { raw: { width: N, height: N, channels: ch } }).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
async function layers(t, size) {
  const { eyeAlpha, hole } = DATA[t.base];
  let img = (await crop(t.base)).removeAlpha();
  if (t.hue) img = img.modulate({ hue: t.hue });
  const rgb = await img.raw().toBuffer();
  const round = (png) => sharp(png).ensureAlpha().composite([{ input: mask(size), blend: 'dest-in' }]).png({ compressionLevel: 9 }).toBuffer();
  const out = { base: await round(await up(noEyes(rgb, hole), 3, size)) };
  for (const [k, e] of EYES.entries()) {
    const rgba = Buffer.alloc(N * N * 4);
    for (let i = 0; i < N * N; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = Math.round(255 * Math.min(1, eyeAlpha[k][i])); }
    out['eye' + e.side] = await sharp(rgba, { raw: { width: N, height: N, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
  }
  return out;
}

fs.mkdirSync(path.join(DIR, 'tiles'), { recursive: true });
for (const f of fs.readdirSync(path.join(DIR, 'tiles'))) fs.unlinkSync(path.join(DIR, 'tiles', f));
for (const [name, t] of Object.entries(TINTS)) {
  fs.writeFileSync(path.join(DIR, 'tiles', `${name}.png`), await tile(t, 512));
  const L = await layers(t, 512);
  for (const [k, v] of Object.entries(L)) fs.writeFileSync(path.join(DIR, 'tiles', `${name}-${k}.png`), v);
}
let n = 0;
for (const [slug, name] of Object.entries(AGENT_TINTS)) {
  if (slug === 'nami') continue; // photo
  fs.writeFileSync(path.join(DIR, `${slug}-sm.png`), await tile(TINTS[name], 192)); n++;
}
console.log(`${Object.keys(TINTS).length} teintes, ${n} icônes d'agents`);
