// The avatar of every agent without a profile photo: a plain circle with two flat robot eyes (src/orbBlob.js).
// Each agent has its own COMBINATION (ORB_COLORS: circle colour + eye colour, taken ONLY from the official palette
// below) and its own EYE SHAPE (EYES in orbBlob.js: AGENT_EYES / freeEyes).
//
// Avatar spec: "/agents/orbs/<combination>-<shape>.png" (PNG = the still, also the push notification icon, made by
// scripts/agent-orb-colors.mjs). "/agents/orbs/<combination>.png" (no shape) = the agent's default shape; the former
// specs ("/agents/orb/orb.png", WebGL palettes) still mean an avatar.
import { EYE_NAMES } from './orbBlob.js';

export const ORB_SPEC = '/agents/orb/orb.png';
const ORB_RE = /^\/?agents\/orbs?\/[a-z0-9]+(-[a-z0-9]+)?\.png$/;
export const isOrb = (spec) => typeof spec === 'string' && ORB_RE.test(spec);

// ---- official palette (Emre): no other colour on the avatars ----------------------------------------
export const PALETTE = {
  tennisYellow: '#EAFF0A',
  clawWhite: '#FCFFF2',
  scrubsBlueLight: '#C6D0FF',
  scrubsBlue: '#8A96EE',
  snoutBlack: '#1A0009',
  cocoaRust: '#2B1A16',
  electricCobalt: '#637BFF',
};
const P = PALETTE;

// ---- one combination per agent ----------------------------------------------------------------------
// bg = colour of the circle, ink = colour of the eyes (well contrasted). Keys = letters/digits only (they are
// part of the spec). The first ones belong to the team, the others are spare for new agents.
export const ORB_COLORS = {
  cobalt: { label: 'Cobalt, yeux noirs', bg: P.electricCobalt, ink: P.snoutBlack },
  noir: { label: 'Noir, yeux jaunes', bg: P.snoutBlack, ink: P.tennisYellow },
  jaune: { label: 'Jaune, yeux noirs', bg: P.tennisYellow, ink: P.snoutBlack },
  bleu: { label: 'Bleu, yeux noirs', bg: P.scrubsBlue, ink: P.snoutBlack },
  bleuclair: { label: 'Bleu clair, yeux cacao', bg: P.scrubsBlueLight, ink: P.cocoaRust },
  cacao: { label: 'Cacao, yeux bleu clair', bg: P.cocoaRust, ink: P.scrubsBlueLight },
  blanc: { label: 'Blanc, yeux noirs', bg: P.clawWhite, ink: P.snoutBlack },
  // Spare combinations (new agents).
  cobaltjaune: { label: 'Cobalt, yeux jaunes', bg: P.electricCobalt, ink: P.tennisYellow },
  noirblanc: { label: 'Noir, yeux blancs', bg: P.snoutBlack, ink: P.clawWhite },
  jaunecacao: { label: 'Jaune, yeux cacao', bg: P.tennisYellow, ink: P.cocoaRust },
  cacaojaune: { label: 'Cacao, yeux jaunes', bg: P.cocoaRust, ink: P.tennisYellow },
  blancbleu: { label: 'Blanc, yeux cobalt', bg: P.clawWhite, ink: P.electricCobalt },
  bleuclairnoir: { label: 'Bleu clair, yeux noirs', bg: P.scrubsBlueLight, ink: P.snoutBlack },
};
// Combination of the agents whose .md has no avatar spec. Every agent its own: keep this list free of duplicates
// (server/agents.js gives a new agent a free one via freeOrbColor).
export const AGENT_ORBS = {
  hammer: 'cobalt',
  zero: 'noir',
  robin: 'jaune',
  katerina: 'bleu',
  anastasia: 'bleuclair',
  claude: 'cacao',
  nami: 'blanc', // team lead (photo; combination kept so no one else takes it)
};
// Shape of the eyes of each agent (one each, never two the same; EYES in orbBlob.js).
export const AGENT_EYES = {
  anastasia: 'petillant', // filled circles
  claude: 'neutre', // slightly tilted, offset bars: curious
  zero: 'serieux', // flat dashes
  robin: 'souriant', // ^ ^
  nami: 'malicieux', // team lead (photo; shape kept so no one else takes it)
  hammer: 'concentre', // straight vertical bars
  katerina: 'reveur', // half-closed arcs ∪ ∪
};
// Former names (WebGL palettes, hue-rotated orbs) still found in old specs.
const OLD_PALETTES = { rose: 'bleuclair', corail: 'cacao', or: 'noir', vert: 'jaune', cyan: 'blanc', violet: 'bleu', electrique: 'cobalt', menthe: 'jaune', iris: 'bleu', azur: 'blanc', aurore: 'jaune', braise: 'cacao', lagune: 'blanc', lime: 'jaune', emeraude: 'jaune', indigo: 'bleu', magenta: 'bleu', rouge: 'cacao' };

export const orbSpec = (color, eyes) => `/agents/orbs/${color}${eyes ? `-${eyes}` : ''}.png`;
const hashOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
// Combination of an agent: the one in its spec, else its default, else one derived from its id.
export function orbColor(spec, slug) {
  const m = typeof spec === 'string' && /^\/?agents\/orbs\/([a-z0-9]+)(?:-[a-z0-9]+)?\.png$/.exec(spec);
  const named = m && (ORB_COLORS[m[1]] ? m[1] : OLD_PALETTES[m[1]]);
  if (named) return named;
  if (AGENT_ORBS[slug]) return AGENT_ORBS[slug];
  const names = Object.keys(ORB_COLORS);
  return names[hashOf(slug || 'agent') % names.length];
}
// Shape of an agent's eyes: the one in its spec, else its default, else one derived from its id.
export function orbEyes(spec, slug) {
  const m = typeof spec === 'string' && /^\/?agents\/orbs\/[a-z0-9]+-([a-z0-9]+)\.png$/.exec(spec);
  if (m && EYE_NAMES.includes(m[1])) return m[1];
  if (AGENT_EYES[slug]) return AGENT_EYES[slug];
  return EYE_NAMES[hashOf(slug || 'agent') % EYE_NAMES.length];
}
const takenBy = (agents, pick) => [...new Set([...Object.keys(AGENT_ORBS), ...agents.map((a) => a.slug)])]
  .map((slug) => pick(agents.find((a) => a.slug === slug)?.avatar, slug));
// A shape no other agent has (the first free one); when all are taken, the least used.
export function freeEyes(agents) {
  const used = takenBy(agents, orbEyes);
  const n = (e) => used.filter((u) => u === e).length;
  return EYE_NAMES.reduce((best, e) => (n(e) < n(best) ? e : best));
}
// A combination no other agent has: first one whose circle colour is not used yet, else the first unused combination;
// when all are taken, the least used.
export function freeOrbColor(agents) {
  const used = takenBy(agents, orbColor);
  const names = Object.keys(ORB_COLORS);
  const free = names.filter((c) => !used.includes(c));
  return free.find((c) => !used.some((u) => ORB_COLORS[u].bg === ORB_COLORS[c].bg))
    || free[0]
    || names.reduce((best, c) => (used.filter((u) => u === c).length < used.filter((u) => u === best).length ? c : best));
}
// Accent of an agent (rings, headers, dots): the lighter of its two colours (the dark ones vanish on the dark UI).
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11; };
export function orbAccent(color) {
  const c = ORB_COLORS[color];
  if (!c) return PALETTE.electricCobalt;
  return lum(c.bg) >= lum(c.ink) ? c.bg : c.ink;
}
