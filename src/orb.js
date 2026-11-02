// Avatar of every sub-agent (all but Nami, who keeps her photo): a rounded tile cut from the model of Emre
// (public/agents/source/model-tiles.jpeg → public/agents/tiles/<tint>.png, scripts/agent-tiles.mjs). The 3 tiles of
// the model are used as they are; the other tints are the SAME tile hue-rotated. Same eyes for everyone.
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
  indigo: { label: 'Bleu-violet', base: 2, hue: 0, accent: '#4a4af0' },
  corail: { label: 'Corail', base: 0, hue: 140, accent: '#ee8a62' },
  framboise: { label: 'Framboise', base: 2, hue: 60, accent: '#e0245e' },
  vert: { label: 'Vert', base: 0, hue: -110, accent: '#4aa86a' },
  turquoise: { label: 'Turquoise', base: 0, hue: -60, accent: '#19b4b0' },
  ambre: { label: 'Ambre', base: 0, hue: 180, accent: '#c9964a' },
  mauve: { label: 'Mauve', base: 0, hue: 60, accent: '#b87fc8' },
  azur: { label: 'Cyan profond', base: 2, hue: 120, accent: '#12a4ee' },
};
// Tint of the team (one each, never twice the same; nami = photo, tint reserved).
export const AGENT_TINTS = {
  zero: 'ciel',
  robin: 'rose',
  hammer: 'indigo',
  anastasia: 'corail',
  claude: 'framboise',
  katerina: 'vert',
  nami: 'mauve',
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
