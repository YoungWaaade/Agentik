// Avatar of every sub-agent (all but Nami, who keeps her photo): a rounded tile cut from the model of Emre
// (public/agents/source/model-tiles.jpeg → public/agents/tiles/<tint>.png, scripts/agent-tiles.mjs). The 3 tiles of
// the model are used as they are; the other tints are the SAME tile hue-rotated, kept in the model's family (cyan, sky blue, pale pink, magenta, violet, deep blue). Same eyes for everyone.
//
// Avatar spec: "/agents/tiles/<tint>.png" (also the push notification icon: public/agents/<slug>-sm.png).
// Old specs ("/agents/orbs/…", "/agents/orb/orb.png") still mean "an avatar": the agent's own tint is used.

export const ORB_SPEC = '/agents/tiles/ciel.png';
const ORB_RE = /^\/?agents\/(?:tiles|orbs?)\/[a-z0-9]+(-[a-z0-9]+)?\.png$/;
export const isOrb = (spec) => typeof spec === 'string' && ORB_RE.test(spec);

// base = tile of the model (0 sky blue, 1 pale pink, 2 deep blue-violet), hue = rotation in degrees (sharp modulate),
// accent = colour of the halo, used for rings/dots of the UI. Keys = letters/digits only (they are part of the spec).
export const TINTS = {
  ciel: { label: 'Bleu ciel', base: 0, hue: 0, accent: '#27a8f7' },
  rose: { label: 'Rose pâle', base: 1, hue: 0, accent: '#f0a6f2' },
  indigo: { label: 'Bleu-violet profond', base: 2, hue: 0, accent: '#4a4af0' },
  cyan: { label: 'Cyan', base: 0, hue: -25, accent: '#16b6d8' },
  lavande: { label: 'Lavande pâle', base: 1, hue: -25, accent: '#b9a4f0' },
  magenta: { label: 'Magenta', base: 2, hue: 35, accent: '#c43ad8' },
  // Spare tints (new agents), same family.
  violet: { label: 'Violet', base: 2, hue: 20, accent: '#8a4af0' },
  royal: { label: 'Bleu royal', base: 2, hue: -30, accent: '#1f7cf0' },
  pervenche: { label: 'Pervenche', base: 0, hue: 25, accent: '#8a92f0' },
  bleuet: { label: 'Bleu pâle', base: 1, hue: -45, accent: '#a8c0f4' },
};
// Tint of the team (one each, never twice the same; nami = photo, tint reserved).
export const AGENT_TINTS = {
  zero: 'ciel',
  robin: 'rose',
  hammer: 'indigo',
  anastasia: 'cyan',
  katerina: 'lavande',
  claude: 'magenta',
  nami: 'violet',
};

export const orbSpec = (tint) => `/agents/tiles/${tint}.png`;
const hashOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
// Tint of an agent: the one in its spec, else its default, else one derived from its id.
export function orbColor(spec, slug) {
  const m = typeof spec === 'string' && /^\/?agents\/tiles\/([a-z0-9]+)\.png$/.exec(spec);
  if (m && TINTS[m[1]]) return m[1];
  if (AGENT_TINTS[slug]) return AGENT_TINTS[slug];
  const names = Object.keys(TINTS);
  return names[hashOf(slug || 'agent') % names.length];
}
// A tint no other agent has (the first free one); when all are taken, the least used.
export function freeOrbColor(agents) {
  const used = [...new Set([...Object.keys(AGENT_TINTS), ...agents.map((a) => a.slug)])]
    .map((slug) => orbColor(agents.find((a) => a.slug === slug)?.avatar, slug));
  const names = Object.keys(TINTS);
  return names.find((c) => !used.includes(c))
    || names.reduce((best, c) => (used.filter((u) => u === c).length < used.filter((u) => u === best).length ? c : best));
}
export const orbAccent = (tint) => TINTS[tint]?.accent || TINTS.ciel.accent;

// Blink: each tint is also cut in layers (tiles/<tint>-base.png without eyes, -eyeL.png, -eyeR.png; scripts/agent-tiles.mjs).
// Centre of each eye, in % of the tile, per tile of the model (transform origin of the squash).
const EYE_ORIGINS = { 0: [[42.2, 53.3], [70.9, 47.3]], 1: [[42.2, 57.8], [68.8, 53]], 2: [[42.2, 57.8], [68.8, 53]] };
export const eyeOrigins = (tint) => EYE_ORIGINS[TINTS[tint]?.base ?? 0];
// Blink timing of an agent: a cycle of 3 to 6 s and a random phase (from its id) so they never blink together.
export function blinkTiming(seed) {
  const h = hashOf(seed || 'agent');
  const dur = 3 + ((h % 1000) / 1000) * 3;
  const phase = (((h >>> 10) % 1000) / 1000) * dur;
  return { dur: +dur.toFixed(2), delay: -+phase.toFixed(2) };
}
