#!/usr/bin/env node
// `agentik` command (aliases: `agentic`, `supersept`) used by chat agents (through Claude Code's Bash tool) to drive Agentik.
import * as ops from './ops.js';

const HELP = `agentik — piloter Agentik (alias : agentic et supersept, mêmes commandes)

  agentik projects
  agentik create-project --name "Nom" [--github owner/repo | --folder ~/chemin]
  agentik start-session --task "mission complète" [--project ID] [--name "Nom"] [--mode local|worktree] [--agent slug]
  agentik sessions [--project ID] [--mine]
  agentik session ID
  agentik send ID "message"
  agentik archive ID
  agentik agents
  agentik ask-agent AGENT_ID "mission"
  agentik create-agent --name "Nom" --description "quand l'utiliser" --prompt "instructions" [--model sonnet]
  agentik update-agent AGENT_ID [--name "Nom"] [--description "…"] [--prompt "…"] [--model sonnet]   (agent chef ; seuls ces champs changent)
  agentik delete-agent AGENT_ID   (agent chef ; l'agent chef lui-même ne peut pas être supprimé)
  agentik memory PROJECT_ID
  agentik set-memory PROJECT_ID --content "texte"   (ou le texte sur l'entrée standard)

Résultats en JSON.`;

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[k] = true;
    else { flags[k] = next; i++; }
  } else pos.push(a);
}
const stdin = async () => {
  if (process.stdin.isTTY) return '';
  let s = '';
  for await (const c of process.stdin) s += c;
  return s;
};

const run = {
  projects: () => ops.listProjects(),
  'create-project': () => ops.createProject({ name: flags.name, github: flags.github, folder: flags.folder }),
  'start-session': () => ops.startSession({ project: flags.project, task: flags.task, name: flags.name, mode: flags.mode, agent: flags.agent }),
  sessions: () => ops.listSessions({ project: flags.project, mine: !!flags.mine }),
  session: () => ops.getSession(pos[0]),
  send: () => ops.sendToSession(pos[0], pos.slice(1).join(' ') || flags.message),
  archive: () => ops.archiveSession(pos[0]),
  memory: () => ops.readMemory(pos[0]),
  agents: () => ops.listAgents(),
  'ask-agent': () => ops.askAgent(pos[0], pos.slice(1).join(' ') || flags.mission),
  'create-agent': () => ops.createAgent({ name: flags.name, description: flags.description, prompt: flags.prompt, model: flags.model, avatar: flags.avatar }),
  'update-agent': () => ops.updateAgent(pos[0], { name: flags.name, description: flags.description, prompt: flags.prompt, model: flags.model }),
  'delete-agent': () => ops.deleteAgent(pos[0]),
  'set-memory': async () => ops.writeMemory(pos[0], flags.content ?? await stdin()),
};

if (!cmd || !run[cmd]) {
  console.log(HELP);
  process.exit(cmd && !['help', '--help', '-h'].includes(cmd) ? 1 : 0);
}
try {
  const out = await run[cmd]();
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
} catch (e) {
  console.error(`Erreur : ${e.message}`);
  process.exit(1);
}
