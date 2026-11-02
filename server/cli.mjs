#!/usr/bin/env node
// `supersept` command used by chat agents (through Claude Code's Bash tool) to drive YoungHub.
import * as ops from './ops.js';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HELP = `supersept (alias : younghub) — piloter YoungHub

  supersept projects
  supersept create-project --name "Nom" [--github owner/repo | --folder ~/chemin]
  supersept start-session --task "mission complète" [--project ID] [--name "Nom"] [--mode local|worktree] [--agent slug]
  supersept sessions [--project ID] [--mine] [--archives]   (--archives : y compris les sessions archivées)
  supersept session ID                      (marche aussi sur une session archivée)
  supersept journal [--date AAAA-MM-JJ|hier] [--depuis AAAA-MM-JJ] [--jusqu-a AAAA-MM-JJ] [--tout] [--json]
                                            (ce qui a été fait, jour par jour, sessions archivées comprises ; défaut : aujourd'hui)
  supersept send ID "message"
  supersept archive ID
  supersept attach CHEMIN                   (image ou vidéo locale → renvoie la ligne markdown à coller dans ta réponse)
  supersept agents
  supersept ask-agent AGENT_ID "mission"
  supersept create-agent --name "Nom" --description "quand l'utiliser" --prompt "instructions" [--model sonnet]
  supersept robot status|start|pause|stop|dock|rooms|clean --room NOM   (aspirateur Roborock ; « supersept robot » seul = aide)
  supersept memory PROJECT_ID
  supersept set-memory PROJECT_ID --content "texte"   (ou le texte sur l'entrée standard)

Résultats en JSON.`;

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'robot') {
  // Pilotage Roborock : script Python (python-roborock) dans son propre venv.
  const py = process.env.SUPERSEPT_ROBOT_PYTHON || `${homedir()}/.local/share/supersept/robot-venv/bin/python`;
  if (!existsSync(py)) { console.error('Erreur : le module robot n\'est pas installé sur ce serveur.'); process.exit(1); }
  const script = fileURLToPath(new URL('./robot.py', import.meta.url));
  const r = spawnSync(py, ['-I', script, ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
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
  sessions: () => ops.listSessions({ project: flags.project, mine: !!flags.mine, archives: !!flags.archives }),
  journal: async () => {
    // node:sqlite still prints an ExperimentalWarning: keep the agent's output clean.
    const emit = process.emitWarning;
    process.emitWarning = (w, ...a) => (/SQLite/.test(String(w)) ? undefined : emit.call(process, w, ...a));
    const { journal, journalText } = await import('./journal.js');
    return flags.json ? journal(flags) : journalText(journal(flags));
  },
  session: () => ops.getSession(pos[0]),
  send: () => ops.sendToSession(pos[0], pos.slice(1).join(' ') || flags.message),
  attach: () => ops.attachMedia(pos[0]),
  archive: () => ops.archiveSession(pos[0]),
  memory: () => ops.readMemory(pos[0]),
  agents: () => ops.listAgents(),
  'ask-agent': () => ops.askAgent(pos[0], pos.slice(1).join(' ') || flags.mission),
  'create-agent': () => ops.createAgent({ name: flags.name, description: flags.description, prompt: flags.prompt, model: flags.model, avatar: flags.avatar }),
  'set-memory': async () => ops.writeMemory(pos[0], flags.content ?? await stdin()),
};

if (!cmd || !run[cmd]) {
  console.log(HELP);
  process.exit(cmd && cmd !== 'help' ? 1 : 0);
}
try {
  const out = await run[cmd]();
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
} catch (e) {
  console.error(`Erreur : ${e.message}`);
  process.exit(1);
}
