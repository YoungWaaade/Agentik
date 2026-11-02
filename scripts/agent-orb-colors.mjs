// Stills of the "blob with eyes" avatars (src/orbBlob.js) rendered to PNG, for the push notification icons:
//   public/agents/orbs/<colour>-<expression>.png  every colour × expression (target of an avatar spec)
//   public/agents/orbs/<colour>.png               colour with the neutral expression (old specs)
//   public/agents/<slug>-sm.png                   agents of AGENT_ORBS without a photo (their colour + expression)
// Run after changing src/orb.js or src/orbBlob.js.
//
//   npm i --no-save sharp && node scripts/agent-orb-colors.mjs     (SHARP=/chemin/vers/sharp possible)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ORB_COLORS, AGENT_ORBS, AGENT_EYES } from '../src/orb.js';
import { EYE_NAMES, blobSvg } from '../src/orbBlob.js';

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP || 'sharp');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'public/agents');
const PHOTOS = ['nami']; // keep in sync with BotAvatar.jsx
const SIZE = 192;

const render = (color, eyes) => sharp(Buffer.from(blobSvg({ bg: ORB_COLORS[color].bg, ink: ORB_COLORS[color].ink, eyes, anim: false, uid: 'p' })), { density: 72 * SIZE / 100 })
  .resize(SIZE, SIZE).png({ compressionLevel: 9 }).toBuffer();
fs.mkdirSync(path.join(DIR, 'orbs'), { recursive: true });
for (const f of fs.readdirSync(path.join(DIR, 'orbs'))) fs.unlinkSync(path.join(DIR, 'orbs', f));
let n = 0;
for (const c of Object.keys(ORB_COLORS)) {
  for (const e of EYE_NAMES) { fs.writeFileSync(path.join(DIR, 'orbs', `${c}-${e}.png`), await render(c, e)); n++; }
  fs.copyFileSync(path.join(DIR, 'orbs', `${c}-neutre.png`), path.join(DIR, 'orbs', `${c}.png`));
}
const agents = Object.entries(AGENT_ORBS).filter(([slug]) => !PHOTOS.includes(slug));
for (const [slug, c] of agents) fs.copyFileSync(path.join(DIR, 'orbs', `${c}-${AGENT_EYES[slug] || 'neutre'}.png`), path.join(DIR, `${slug}-sm.png`));
console.log(`${n} avatars, ${agents.length} icônes d'agents`);
