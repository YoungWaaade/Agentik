// The agents' orb (every agent without a profile photo): one animated GIF (public/agents/originals/orb.gif,
// 520×520, 45 frames of 30 ms), used as is: cropped to a square on the sphere, edge to edge, so the round
// avatar matches the sphere's rim. No other change to its pixels or timing. Produces public/agents/orb/:
//   orb.gif   the cropped GIF (exact pixels, frames and delays)
//   orb.webp  lossless animated WebP of it (fallback when video can't autoplay: iOS Low Power Mode)
//   orb.mp4   H.264 + orb.webm VP9, muted, 2 loops back to back, 2× nearest-neighbour (494 px) so the
//             4:2:0 chroma keeps every pixel's colour; what the app plays (src/orbVideo.js)
//   orb.png   first frame, transparent outside the sphere: avatar spec, notification icon, reduced motion
// and copies orb.png to public/agents/<slug>-sm.png for each agent without a photo (push icon, server/push.js).
//
//   npm i --no-save ffmpeg-static gifsicle sharp && node scripts/agent-orb.mjs
// (or FFMPEG=/path/to/ffmpeg GIFSICLE=/path/to/gifsicle, with sharp resolvable)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'public/agents/originals/orb.gif');
const OUT = path.join(ROOT, 'public/agents/orb');
const FFMPEG = process.env.FFMPEG || require('ffmpeg-static');
const GIFSICLE = process.env.GIFSICLE || require('gifsicle');
const sharp = require('sharp');

// Sphere of the original: centre (262, 261), radius 123 px (measured on the minimum over all frames:
// the rim stays lit while the dotted background twinkles).
const CROP = { x: 139, y: 138, size: 247 };
const AGENTS_WITHOUT_PHOTO = ['anastasia', 'claude', 'hammer', 'katerina', 'robin', 'zero'];

fs.mkdirSync(OUT, { recursive: true });
const out = (f) => path.join(OUT, f);
const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'inherit'] });

run(GIFSICLE, ['--crop', `${CROP.x},${CROP.y}+${CROP.size}x${CROP.size}`, SRC, '-o', out('orb.gif')]);
const video = ['-v', 'error', '-y', '-stream_loop', '1', '-i', out('orb.gif'), '-vf', `scale=${CROP.size * 2}:${CROP.size * 2}:flags=neighbor,format=yuv420p`, '-r', '100/3', '-an'];
run(FFMPEG, [...video, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '16', '-profile:v', 'high', '-tune', 'animation', '-movflags', '+faststart', out('orb.mp4')]);
run(FFMPEG, [...video, '-c:v', 'libvpx-vp9', '-crf', '26', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '1', out('orb.webm')]);
run(FFMPEG, ['-v', 'error', '-y', '-i', out('orb.gif'), '-c:v', 'libwebp_anim', '-lossless', '1', '-compression_level', '6', '-loop', '0', out('orb.webp')]);

const first = path.join(OUT, '.first.png');
run(FFMPEG, ['-v', 'error', '-y', '-i', out('orb.gif'), '-frames:v', '1', first]);
const s = CROP.size, r = s / 2;
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`);
await sharp(first).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png({ compressionLevel: 9 }).toFile(out('orb.png'));
fs.unlinkSync(first);
for (const slug of AGENTS_WITHOUT_PHOTO) fs.copyFileSync(out('orb.png'), path.join(ROOT, `public/agents/${slug}-sm.png`));
console.log('ok', fs.readdirSync(OUT).map((f) => `${f} ${fs.statSync(out(f)).size}`).join(', '));
