// Avatars of the sub-agents: the 3 tiles of Emre's model (public/agents/source/model-tiles.jpeg, IMG_1678) cut out
// as they are (rounded square, soft halo, same eyes), upscaled; the other tints are the SAME tile hue-rotated.
//   public/agents/tiles/<tint>.png (512 px, transparent corners)   public/agents/<slug>-sm.png (192 px, push icons)
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
const R = 0.2; // corner radius / side of the model's tiles
const mask = (n) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}"><rect width="${n}" height="${n}" rx="${n * R}" fill="#fff"/></svg>`);

async function tile(t, size) {
  let img = sharp(SRC).extract({ left: XS[t.base], top: Y, width: W, height: W }).resize(size, size, { kernel: 'lanczos3' });
  if (t.hue) img = img.modulate({ hue: t.hue });
  const rgb = await img.png().toBuffer();
  return sharp(rgb).ensureAlpha().composite([{ input: mask(size), blend: 'dest-in' }]).png({ compressionLevel: 9 }).toBuffer();
}
fs.mkdirSync(path.join(DIR, 'tiles'), { recursive: true });
for (const f of fs.readdirSync(path.join(DIR, 'tiles'))) fs.unlinkSync(path.join(DIR, 'tiles', f));
for (const [name, t] of Object.entries(TINTS)) fs.writeFileSync(path.join(DIR, 'tiles', `${name}.png`), await tile(t, 512));
let n = 0;
for (const [slug, name] of Object.entries(AGENT_TINTS)) {
  if (slug === 'nami') continue; // photo
  fs.writeFileSync(path.join(DIR, `${slug}-sm.png`), await tile(TINTS[name], 192)); n++;
}
console.log(`${Object.keys(TINTS).length} teintes, ${n} icônes d'agents`);
