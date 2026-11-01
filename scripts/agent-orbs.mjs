// Still images of the glass orbs, rendered by the same WebGL shader (src/orbGL.js) in headless Chrome:
//  - public/agents/orbs/<palette>.png: target of an orb avatar spec ("/agents/orbs/<palette>.png"),
//    shown for small idle orbs, without WebGL, and as push notification icon;
//  - public/agents/<slug>-sm.png for the agents whose default orb comes from AGENT_ORBS (no photo),
//    found by server/push.js when the agent's avatar field is empty or a legacy spec.
// 256 px, rendered at 512 then reduced, transparent outside the round.
//
//   npm i --no-save puppeteer-core && CHROME=/path/to/chrome node scripts/agent-orbs.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PALETTES, AGENT_ORBS } from '../src/orb.js';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = path.join(ROOT, 'public/agents/');
const PHOTOS = ['nami']; // keep in sync with BotAvatar.jsx
const STILL_T = 2; // moment of the animation used for the still

const PAGE = `<!doctype html><script type="module">
import { createOrbRenderer } from '/src/orbGL.js';
const gl = document.createElement('canvas'), out = document.createElement('canvas');
const R = createOrbRenderer(gl); out.width = out.height = 256;
const ctx = out.getContext('2d');
window.still = (palette) => {
  R.draw(512, 512, palette, ${STILL_T});
  ctx.clearRect(0, 0, 256, 256); ctx.save(); ctx.beginPath(); ctx.arc(128, 128, 128, 0, 7); ctx.clip();
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(gl, 0, gl.height - 512, 512, 512, 0, 0, 256, 256); ctx.restore();
  return out.toDataURL('image/png');
};
window.ready = true;
</script>`;
const server = http.createServer((req, res) => {
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  const f = path.join(ROOT, path.normalize(decodeURIComponent(req.url)).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(path.join(ROOT, 'src')) || !fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const browser = await puppeteer.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction('window.ready');
  const png = async (palette) => Buffer.from((await page.evaluate((p) => window.still(p), palette)).split(',')[1], 'base64');
  fs.mkdirSync(path.join(DIR, 'orbs'), { recursive: true });
  for (const name of Object.keys(PALETTES)) fs.writeFileSync(path.join(DIR, 'orbs', `${name}.png`), await png(name));
  for (const [slug, name] of Object.entries(AGENT_ORBS)) if (!PHOTOS.includes(slug)) fs.writeFileSync(path.join(DIR, `${slug}-sm.png`), await png(name));
  console.log(`${Object.keys(PALETTES).length} orbes + ${Object.keys(AGENT_ORBS).length - PHOTOS.length} avatars d'agents`);
} finally {
  await browser.close();
  server.close();
}
