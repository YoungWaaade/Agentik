// Agent profile photos: the user's own images, used as is. The only operations are a square crop
// (on the face / head) and a resize — no filter, no retouch. Originals are kept, byte for byte, in
// public/agents/originals/. Output: public/agents/<slug>.webp (large, ≤512px) and
// <slug>-sm.webp (128px, for small sizes), both lossless WebP.
//
//   npm i --no-save sharp && node scripts/agent-photos.mjs
//
// Crop boxes are in pixels of the original image: [left, top, side].
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)(process.env.SHARP || 'sharp');
import { mkdirSync } from 'node:fs';

const DIR = new URL('../public/agents/', import.meta.url).pathname;
const SRC = (name) => `${DIR}originals/${name}.jpeg`;
export const PHOTOS = {
  // Square on the face, with some hair and the blue background. The other agents are animated orbs
  // (src/orb.js, assets by scripts/agent-orb.mjs).
  // nami: black chrome head on white. `cutout`: the white background is made transparent by a flood fill from the
  // image edges (the chrome's white reflections inside the head are kept), anti-aliased edge; the crop is the
  // head's bounding box as a square plus a margin (fraction of its larger side).
  nami: { src: 'nami', cutout: { margin: 0.08, bg: '#0D0FDD' } }, // bg: solid colour behind the head (Nami's reserved blue, src/orb.js PALETTE.namiBlue)
};

// Flood fill of the near-white background from the borders → RGBA buffer (+ bounding box of what remains).
async function cutout(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const lo = (i) => Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => { if (!bg[i] && lo(i) >= 236) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  // Anti-aliased edge: foreground pixels touching the background get an alpha from how far from white they are,
  // and their colour is un-mixed from the white (so no pale halo).
  const out = Buffer.alloc(w * h * 4);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let a = 255;
    if (bg[i]) a = 0;
    else {
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && bg[yy * w + xx]) { near = true; break; }
      }
      if (near) a = Math.round(Math.max(0, Math.min(1, (255 - lo(i)) / 150)) * 255);
    }
    for (let c = 0; c < 3; c++) {
      let v = data[i * 3 + c];
      if (a > 0 && a < 255) v = Math.max(0, Math.min(255, (v - 255 * (1 - a / 255)) / (a / 255)));
      out[i * 4 + c] = v;
    }
    out[i * 4 + 3] = a;
    if (a > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { out, w, h, box: [x0, y0, x1, y1] };
}

mkdirSync(DIR, { recursive: true });
for (const [slug, { src, crop, cutout: cut }] of Object.entries(PHOTOS)) {
  let base, side;
  if (cut) {
    const { out, w, h, box: [x0, y0, x1, y1] } = await cutout(SRC(src));
    side = Math.round(Math.max(x1 - x0, y1 - y0) * (1 + 2 * cut.margin));
    const left = Math.round((x0 + x1) / 2 - side / 2), top = Math.round((y0 + y1) / 2 - side / 2);
    // pad the canvas so the square never leaves the image
    const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const pad = Math.max(0, -left, -top, left + side - w, top + side - h);
    const padded = await sharp(png).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    base = () => sharp(padded).extract({ left: left + pad, top: top + pad, width: side, height: side });
  } else {
    side = crop[2];
    base = () => sharp(SRC(src)).extract({ left: crop[0], top: crop[1], width: side, height: side });
  }
  const big = Math.min(side, 512);
  const fill = (img) => (cut?.bg ? img.flatten({ background: cut.bg }) : img);
  await fill(base().resize(big, big, { kernel: 'lanczos3' })).webp({ lossless: true }).toFile(`${DIR}${slug}.webp`);
  await fill(base().resize(128, 128, { kernel: 'lanczos3' })).webp({ lossless: true }).toFile(`${DIR}${slug}-sm.webp`);
  console.log(slug, `${side}px → ${big}px + 128px`);
}
