// Custom agents, stored in Claude Code's native format (~/.claude/agents/<slug>.md) so they
// also work outside Supersept (`claude --agent <slug>`, or as subagents inside a session).
// Supersept-only settings (icon, effort, permission mode, first message) live in the same
// frontmatter; Claude Code ignores keys it doesn't know.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assignAvatars, savedAvatar, takenAvatars, freeAvatar, avatarSpec } from '../src/avatarSlots.js';

// SUPERSEPT_AGENTS_DIR points a test instance at a throwaway folder (Claude Code itself still reads ~/.claude/agents).
export const AGENTS_DIR = process.env.SUPERSEPT_AGENTS_DIR || path.join(os.homedir(), '.claude', 'agents');
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const FIELDS = ['name', 'description', 'model', 'tools', 'color', 'icon', 'avatar', 'effort', 'permissionMode', 'initialPrompt', 'manager', 'gender'];

export const isSlug = (s) => SLUG.test(String(s || ''));
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 62) || 'agent';

function parse(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return { prompt: text.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch {} }
    meta[kv[1]] = v;
  }
  return { ...meta, prompt: m[2].trim() };
}

// Values are written as JSON strings when needed, so multi-line or ':'-containing text survives.
const yamlValue = (v) => (/^[\w .,/()@#&+'’éèêàùçôîÉÀ-]*$/.test(v) && !/^\s|\s$/.test(v) ? v : JSON.stringify(v));

// Writes just the avatar line of an agent's frontmatter, leaving the rest of the file untouched.
function writeAvatar(file, spec) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return;
  const head = /^avatar:.*$/m.test(m[1]) ? m[1].replace(/^avatar:.*$/m, `avatar: ${spec}`) : `${m[1]}\navatar: ${spec}`;
  fs.writeFileSync(file, text.replace(m[1], () => head));
}

export function listAgents() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  const agents = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).map((f) => {
    const slug = f.slice(0, -3);
    try {
      const file = path.join(AGENTS_DIR, f);
      const st = fs.statSync(file);
      const a = parse(fs.readFileSync(file, 'utf8'));
      return { slug, ...a, label: a.label || a.name || slug, file, created: st.birthtimeMs || st.mtimeMs };
    } catch {
      return null;
    }
  }).filter(Boolean);
  // Every agent gets its own shape + colour. A look that had to be given (none saved yet, or the
  // same as an older agent's) is saved in the file, so it stays put when agents are added later.
  const looks = assignAvatars(agents);
  for (const a of agents) {
    const spec = looks.get(a.slug);
    if (a.avatar !== spec) { try { writeAvatar(a.file, spec); } catch {} }
    a.avatar = spec;
    delete a.file;
    delete a.created;
  }
  return agents.sort((a, b) => a.label.localeCompare(b.label));
}

export const getAgent = (slug) => (isSlug(slug) ? listAgents().find((a) => a.slug === slug) || null : null);

// `previous` is the agent's slug before a rename: its own look doesn't count as taken.
export function saveAgent(slug, data, previous = slug) {
  if (!isSlug(slug)) throw new Error("identifiant d'agent invalide (minuscules, chiffres et tirets)");
  const others = listAgents().filter((a) => a.slug !== slug && a.slug !== previous);
  const taken = takenAvatars(others);
  const look = savedAvatar(data.avatar);
  if (look && taken.has(avatarSpec(look))) throw new Error(`cet avatar (forme et couleur) est déjà pris par ${taken.get(avatarSpec(look))} : choisis une autre couleur ou une autre forme`);
  data = { ...data, avatar: avatarSpec(look || freeAvatar(slug, new Set(taken.keys()))) };
  const meta = { ...data, name: slug };
  if (!String(data.description || '').trim()) throw new Error('ajoute une description : elle dit à Claude quand utiliser cet agent');
  if (!String(data.prompt || '').trim()) throw new Error("ajoute des instructions à l'agent");
  const lines = ['---'];
  for (const k of FIELDS) {
    const v = k === 'name' ? slug : String(meta[k] ?? '').trim();
    if (v) lines.push(`${k}: ${k === 'description' || k === 'initialPrompt' ? JSON.stringify(v) : yamlValue(v)}`);
  }
  // Keys this app doesn't manage (added by hand or by Claude Code) are kept as they are.
  for (const [k, v] of Object.entries(data)) {
    if (!FIELDS.includes(k) && !['slug', 'label', 'prompt'].includes(k) && /^[A-Za-z][\w-]*$/.test(k) && typeof v === 'string' && v.trim()) lines.push(`${k}: ${yamlValue(v.trim())}`);
  }
  // The display name may differ from the slug: keep it as a Supersept label.
  if (String(data.label || '').trim()) lines.push(`label: ${JSON.stringify(String(data.label).trim())}`);
  lines.push('---', '', String(data.prompt).trim(), '');
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(AGENTS_DIR, `${slug}.md`), lines.join('\n'));
  return getAgent(slug);
}

export function deleteAgent(slug) {
  if (!isSlug(slug)) throw new Error('agent invalide');
  fs.rmSync(path.join(AGENTS_DIR, `${slug}.md`), { force: true });
}
