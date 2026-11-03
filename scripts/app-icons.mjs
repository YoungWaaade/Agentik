// Icônes de l'app (opaques, fond Claw White #FCFFF2) à partir de la tête chromée de Nami détourée.
// Usage : SHARP=<chemin sharp> node scripts/app-icons.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const sharp = createRequire(import.meta.url)(process.env.SHARP || 'sharp');
const BG = '#FCFFF2';
const head = await sharp('public/agents/nami.webp').trim({ threshold: 8 }).png().toBuffer();
const hm = await sharp(head).metadata();
async function icon(size, fill) { // fill = part de la taille occupée par la plus grande dimension de la tête
  const k = (size * fill) / Math.max(hm.width, hm.height);
  const h = await sharp(head).resize(Math.round(hm.width * k), Math.round(hm.height * k), { kernel: 'lanczos3' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: BG } }).composite([{ input: h, gravity: 'centre' }]).png().toBuffer();
}
const out = (n, b) => fs.writeFileSync('public/icons/' + n, b);
out('icon-512.png', await icon(512, 0.74));
out('icon-192.png', await icon(192, 0.74));
out('icon-maskable-512.png', await icon(512, 0.56));
out('apple-touch-icon.png', await icon(180, 0.76));
const f = {}; for (const s of [16, 32, 48, 64]) f[s] = await icon(s, 0.9);
out('favicon-32.png', f[32]);
const ico = (sizes) => { const n = sizes.length, hd = Buffer.alloc(6 + 16 * n); hd.writeUInt16LE(1, 2); hd.writeUInt16LE(n, 4); let off = hd.length;
  sizes.forEach((s, i) => { const b = f[s], o = 6 + 16 * i; hd[o] = s; hd[o + 1] = s; hd.writeUInt16LE(1, o + 4); hd.writeUInt16LE(32, o + 6); hd.writeUInt32LE(b.length, o + 8); hd.writeUInt32LE(off, o + 12); off += b.length; });
  return Buffer.concat([hd, ...sizes.map((s) => f[s])]); };
out('favicon.ico', ico([16, 32, 48]));
const svgPng = (await icon(128, 0.9)).toString('base64');
out('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image width="128" height="128" href="data:image/png;base64,${svgPng}"/></svg>\n`);
