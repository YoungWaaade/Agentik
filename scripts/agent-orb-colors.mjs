// Stills of the orb in every agent colour (src/orb.js ORB_COLORS): public/agents/orb/orb.png turned by the
// same hue rotation as the app's CSS filter (hueMatrix). Writes
//   public/agents/orbs/<colour>.png  target of a coloured orb spec, push notification icon
//   public/agents/<slug>-sm.png      for the agents of AGENT_ORBS without a photo (push icon when their
//                                    .md has no orb spec, server/push.js)
// Run after scripts/agent-orb.mjs, and after adding a colour or an agent to src/orb.js.
//
//   npm i --no-save sharp && node scripts/agent-orb-colors.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ORB_COLORS, AGENT_ORBS, hueMatrix } from '../src/orb.js';

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP || 'sharp');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'public/agents');
const STILL = path.join(DIR, 'orb/orb.png');
const PHOTOS = ['nami']; // keep in sync with BotAvatar.jsx

const tint = async (color) => {
  const img = sharp(STILL);
  const alpha = await img.clone().extractChannel('alpha').toBuffer();
  const rgb = await sharp(STILL).removeAlpha().recomb(hueMatrix(ORB_COLORS[color].rotate)).png().toBuffer(); // sharp runs recomb after joinChannel: two passes
  return sharp(rgb).joinChannel(alpha).png({ compressionLevel: 9 }).toBuffer();
};
fs.mkdirSync(path.join(DIR, 'orbs'), { recursive: true });
for (const f of fs.readdirSync(path.join(DIR, 'orbs'))) if (!ORB_COLORS[f.replace(/\.png$/, '')]) fs.unlinkSync(path.join(DIR, 'orbs', f));
for (const c of Object.keys(ORB_COLORS)) fs.writeFileSync(path.join(DIR, 'orbs', `${c}.png`), await tint(c));
const agents = Object.entries(AGENT_ORBS).filter(([slug]) => !PHOTOS.includes(slug));
for (const [slug, c] of agents) fs.copyFileSync(path.join(DIR, 'orbs', `${c}.png`), path.join(DIR, `${slug}-sm.png`));
console.log(`${Object.keys(ORB_COLORS).length} couleurs, ${agents.length} avatars d'agents`);
