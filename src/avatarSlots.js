// Which avatar (shape + colour) each agent gets, shared by the server and the app. Plain JS, no
// imports: the server loads it too. Every agent must have its own pair; once given, a pair is saved
// in the agent's file so adding agents later never moves anyone.

// Shapes with their own colour (the one drawn in src/assets/bots), and the palette in display order.
export const SHAPE_COLORS = { fleur: 'blanc', sceau: 'vert', trio: 'emeraude', lunes: 'ecume', pile: 'menthe', etoile: 'sapin', soleil: 'canard' };
export const SHAPE_KEYS = Object.keys(SHAPE_COLORS);
export const COLOR_KEYS = ['blanc', 'ecume', 'menthe', 'vert', 'emeraude', 'canard', 'sapin', 'jaune', 'peche', 'corail', 'rose', 'lilas', 'ciel'];
// The default Claude agent isn't a file but shows an avatar too: its look is never handed out.
export const RESERVED = ['claude'];

export const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const avatarSpec = ({ shape, color }) => `${shape},${color}`;

// A saved "shape,colour" spec, or null when there is none (empty, or an older pixel-bot spec).
export function savedAvatar(spec) {
  const [s, c] = String(spec || '').split(',').map((x) => x.trim());
  if (!SHAPE_COLORS[s]) return null;
  return { shape: s, color: COLOR_KEYS.includes(c) ? c : SHAPE_COLORS[s] };
}

// The look an agent has on its own: a shape from its name, in that shape's colour.
export function naturalAvatar(seed) {
  const shape = SHAPE_KEYS[hash(String(seed || 'bot').toLowerCase()) % SHAPE_KEYS.length];
  return { shape, color: SHAPE_COLORS[shape] };
}

// The closest free look for `seed`: its natural one, else the same shape in another free colour,
// else any free pair. `taken` is a Set of specs. Only when all 91 pairs are used does it repeat one.
export function freeAvatar(seed, taken) {
  const nat = naturalAvatar(seed);
  if (!taken.has(avatarSpec(nat))) return nat;
  const h = hash(String(seed || 'bot').toLowerCase());
  const shapes = [nat.shape, ...SHAPE_KEYS.filter((s) => s !== nat.shape)];
  for (const shape of shapes) {
    const free = COLOR_KEYS.filter((color) => !taken.has(avatarSpec({ shape, color })));
    if (free.length) return { shape, color: free[h % free.length] };
  }
  return nat;
}

// Looks that belong to someone already, for the editor: Map spec → who has it.
export function takenAvatars(agents, except) {
  const taken = new Map(RESERVED.map((r) => [avatarSpec(naturalAvatar(r)), 'Claude (agent par défaut)']));
  for (const a of agents) {
    const s = savedAvatar(a.avatar);
    if (s && a.slug !== except) taken.set(avatarSpec(s), a.label || a.slug);
  }
  return taken;
}

// One unique look per agent. `agents` = [{ slug, avatar, created }]. Saved looks are kept (the
// oldest wins if two agents saved the same one); the others take, oldest first, their natural look
// or the closest free one. Returns Map slug → spec.
export function assignAvatars(agents) {
  const byAge = [...agents].sort((a, b) => (a.created || 0) - (b.created || 0) || a.slug.localeCompare(b.slug));
  const taken = new Set(RESERVED.map((r) => avatarSpec(naturalAvatar(r))));
  const out = new Map();
  for (const a of byAge) {
    const s = savedAvatar(a.avatar);
    if (s && !taken.has(avatarSpec(s))) { out.set(a.slug, avatarSpec(s)); taken.add(avatarSpec(s)); }
  }
  for (const a of byAge) {
    if (out.has(a.slug)) continue;
    const spec = avatarSpec(freeAvatar(a.slug, taken));
    out.set(a.slug, spec);
    taken.add(spec);
  }
  return out;
}
