// Renders the team's 3D portraits (studio.js) into public/agents/<slug>-bust.webp and -face.webp.
// Needs: three, esbuild and puppeteer-core (npm i --no-save three esbuild puppeteer-core) and a
// Chrome/Chromium with WebGL (SwiftShader is enough): CHROME=/path/to/chrome node scripts/agent-studio/render.mjs [slugs]
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, '../../public/agents');
const slugs = (process.argv[2] || 'nami,anastasia,katerina,hammer,robin,claude').split(',');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-'));
await build({ entryPoints: [path.join(DIR, 'studio.js')], bundle: true, format: 'iife', outfile: path.join(tmp, 'bundle.js'), logLevel: 'error' });
fs.writeFileSync(path.join(tmp, 'index.html'), '<body style="margin:0"><script src="bundle.js"></script>');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, protocolTimeout: 600000, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error(e.message));
await page.goto('file://' + path.join(tmp, 'index.html'));
await page.waitForFunction('window.studioReady');
fs.mkdirSync(OUT, { recursive: true });
for (const slug of slugs) for (const [framing, size] of [['bust', 640], ['face', 192]]) {
  const url = await page.evaluate((s, f, n) => window.renderAgent(s, f, n), slug, framing, size);
  fs.writeFileSync(path.join(OUT, `${slug}-${framing}.webp`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(slug, framing);
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
