// First-run onboarding: sets up the team lead agent (the one that receives every mission and hands it
// out). Done once, remembered in onboarding.json; an install that already has agents counts as done.
import fs from 'node:fs';
import path from 'node:path';
import { HUB_DIR } from './db.js';
import { listAgents, getAgent, saveAgent, slugify } from './agents.js';

const FILE = path.join(HUB_DIR, 'onboarding.json');
const LEAD = path.join(HUB_DIR, 'lead.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}

export function status() {
  const saved = read();
  const agents = listAgents();
  const lead = agents.find((a) => a.manager);
  return {
    done: !!saved?.done || agents.length > 0,
    firstName: saved?.firstName || '',
    lead: lead ? { slug: lead.slug, label: lead.label, avatar: lead.avatar || '', gender: lead.gender || '' } : null,
  };
}

export const firstName = () => read()?.firstName || '';

// What the team lead may do beyond delegating. manageAgents: edit and delete agents from the CLI (on by default).
export function leadSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(LEAD, 'utf8')); } catch {}
  return { manageAgents: saved.manageAgents !== false };
}

export function setLeadSettings(patch = {}) {
  const s = leadSettings();
  if (patch.manageAgents !== undefined) s.manageAgents = !!patch.manageAgents;
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.writeFileSync(LEAD, JSON.stringify(s, null, 2) + '\n');
  return s;
}

// Agreement variants of the coordination prompt, kept faithful to the original team lead's role.
const WORDS = {
  f: { role: "la cheffe d'équipe", Role: "Cheffe d'équipe", traits: 'organisée, directe et efficace', ready: 'prête' },
  m: { role: "le chef d'équipe", Role: "Chef d'équipe", traits: 'organisé, direct et efficace', ready: 'prêt' },
};

export function leadAgent({ gender, name, firstName: user }) {
  const w = WORDS[gender] || WORDS.f;
  const who = user || "l'utilisateur";
  return {
    description: `${w.Role} : reçoit toutes les missions, les confie à l'agent le plus adapté (ou lance une session), suit l'avancement et fait la synthèse.`,
    prompt: [
      `Tu es ${name}, ${w.role} des agents de ${who}. Tu es son point d'entrée unique : c'est à toi que ${who} confie ce qu'il faut faire, et tu t'occupes de tout.`,
      '',
      'Ta façon de faire :',
      '1. Comprends la demande. S\'il manque une information vraiment indispensable, pose une seule question courte ; sinon, avance.',
      '2. Confie la mission à l\'agent dont le rôle correspond le mieux, avec une consigne complète et autonome. Découpe une grosse demande en plusieurs missions, en parallèle si c\'est possible.',
      '3. Si aucun agent ne convient, lance toi-même une session Claude Code dans le bon projet.',
      `4. Quand les réponses arrivent, fais une synthèse d'une ou deux phrases : ce qui est fait, ce qui reste, ce dont tu as besoin de sa part.`,
      '',
      `Tu es ${w.traits}. Tu ne noies jamais ${who} sous les détails : le détail reste disponible dans les sessions et dans le chat de chaque agent.`,
      `${user ? `Appelle ${user} par son prénom. ` : ''}La première fois qu'on t'écrit, présente-toi en une phrase et dis que tu es ${w.ready} à recevoir la première mission.`,
    ].join('\n'),
  };
}

// Creates the lead agent, or updates it when re-run; never overwrites an agent that isn't a team lead.
export function complete({ gender, name, avatar, firstName: user }) {
  gender = gender === 'm' ? 'm' : 'f';
  name = String(name || '').trim();
  user = String(user || '').trim().slice(0, 60);
  if (!name) throw new Error("donne un nom à l'agent");
  const slug = slugify(name);
  const existing = getAgent(slug);
  if (existing && !existing.manager) {
    throw new Error(`un agent « ${existing.label} » existe déjà : choisis un autre nom`);
  }
  const { slug: _, prompt, description, ...kept } = existing || {};
  const agent = saveAgent(slug, { ...kept, ...leadAgent({ gender, name, firstName: user }), label: name, avatar, gender, manager: 'true' });
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ done: true, at: new Date().toISOString(), agent: slug, firstName: user }, null, 2) + '\n');
  return agent;
}
