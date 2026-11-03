// Builds every app icon in public/ from scripts/icon-source.png (square, black full-bleed background):
// favicons (png 16/32/48 + .ico), apple-touch-icon 180, PWA 192/512 and a maskable 512.
// Usage: node scripts/make-icons.mjs   (macOS: resizing is done by sips)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';

const root = path.join(import.meta.dirname, '..');
const out = path.join(root, 'public');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));

// The export has a half-transparent last row/column: make the master fully opaque.
const src = PNG.sync.read(fs.readFileSync(path.join(import.meta.dirname, 'icon-source.png')));
for (let i = 3; i < src.data.length; i += 4) src.data[i] = 255;
const master = path.join(tmp, 'master.png');
fs.writeFileSync(master, PNG.sync.write(src));

const resize = (size, file) => {
  execFileSync('sips', ['-z', String(size), String(size), master, '--out', file], { stdio: 'ignore' });
  return file;
};

for (const [size, name] of [[16, 'favicon-16.png'], [32, 'favicon.png'], [48, 'favicon-48.png'], [180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
  resize(size, path.join(out, name));
}

// Maskable: the mark must sit inside the central 80% circle, so shrink it onto a larger black square.
const inner = PNG.sync.read(fs.readFileSync(resize(400, path.join(tmp, 'inner.png'))));
const mask = new PNG({ width: 512, height: 512 });
for (let i = 0; i < mask.data.length; i += 4) mask.data.set([0, 0, 0, 255], i);
PNG.bitblt(inner, mask, 0, 0, 400, 400, 56, 56);
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), PNG.sync.write(mask));

// .ico holding PNG images (supported by every current browser and by Windows Vista+).
const imgs = [16, 32, 48].map((s) => [s, fs.readFileSync(resize(s, path.join(tmp, `ico-${s}.png`)))]);
const head = Buffer.alloc(6 + 16 * imgs.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(imgs.length, 4);
let offset = head.length;
imgs.forEach(([s, buf], i) => {
  const e = 6 + 16 * i;
  head[e] = s; head[e + 1] = s;
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(buf.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += buf.length;
});
fs.writeFileSync(path.join(out, 'favicon.ico'), Buffer.concat([head, ...imgs.map(([, b]) => b)]));
fs.rmSync(tmp, { recursive: true, force: true });
