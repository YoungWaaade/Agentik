// Agent profile photos: the user's own images, used as is. The only operations are a square crop
// (on the face / head) and a resize — no filter, no retouch. Originals are kept, byte for byte, in
// public/agents/originals/. Output: public/agents/<slug>.webp (large, ≤512px) and
// <slug>-sm.webp (128px, for small sizes), both lossless WebP.
//
//   npm i --no-save sharp && node scripts/agent-photos.mjs
//
// Crop boxes are in pixels of the original image: [left, top, side].
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const DIR = new URL('../public/agents/', import.meta.url).pathname;
const SRC = (name) => `${DIR}originals/${name}.jpeg`;
export const PHOTOS = {
  nami: { src: 'nami', crop: [177, 67, 808] }, // Pinterest capture: stays clear of the « < » and « ••• » buttons
  hammer: { src: 'hammer', crop: [108, 200, 648] },
  robin: { src: 'robin', crop: [130, 7, 698] }, // head + hat
  claude: { src: 'claude', crop: [43, 7, 671] },
  // Stand-ins until the user sends their own images: other crops of the same pictures.
  anastasia: { src: 'hammer', crop: [201, 386, 339] }, // close-up on the eye
  katerina: { src: 'robin', crop: [287, 219, 301] }, // close-up on the face under the hat
};

mkdirSync(DIR, { recursive: true });
for (const [slug, { src, crop: [left, top, side] }] of Object.entries(PHOTOS)) {
  const base = () => sharp(SRC(src)).extract({ left, top, width: side, height: side });
  const big = Math.min(side, 512);
  await base().resize(big, big, { kernel: 'lanczos3' }).webp({ lossless: true }).toFile(`${DIR}${slug}.webp`);
  await base().resize(128, 128, { kernel: 'lanczos3' }).webp({ lossless: true }).toFile(`${DIR}${slug}-sm.webp`);
  console.log(slug, `${side}px → ${big}px + 128px`);
}
