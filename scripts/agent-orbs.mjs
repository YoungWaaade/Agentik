// Still images of the animated orbs (src/orb.js), for push notifications, where nothing can move:
//  - public/agents/orbs/<palette>.png: target of an orb avatar spec ("/agents/orbs/<palette>.png");
//  - public/agents/<slug>-sm.png for the agents whose default orb comes from AGENT_ORBS (no photo),
//    found by server/push.js when the agent's avatar field is empty or a legacy spec.
//
//   npm i --no-save sharp && node scripts/agent-orbs.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { PALETTES, AGENT_ORBS, orbSvg } from '../src/orb.js';

const DIR = new URL('../public/agents/', import.meta.url).pathname;
const PHOTOS = ['nami']; // keep in sync with BotAvatar.jsx
const png = (name, file) => sharp(Buffer.from(orbSvg(name, 256))).png({ compressionLevel: 9 }).toFile(file);

mkdirSync(`${DIR}orbs`, { recursive: true });
for (const name of Object.keys(PALETTES)) await png(name, `${DIR}orbs/${name}.png`);
for (const [slug, name] of Object.entries(AGENT_ORBS)) if (!PHOTOS.includes(slug)) await png(name, `${DIR}${slug}-sm.png`);
console.log(`${Object.keys(PALETTES).length} orbes + ${Object.keys(AGENT_ORBS).length - PHOTOS.length} avatars d'agents`);
