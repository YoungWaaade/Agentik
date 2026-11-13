import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A team lead renamed after onboarding (Nova → Dali) must introduce itself under its new name in a new
// conversation: its onboarding instructions used to say « Tu es Nova, … », which won over the new name.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-lead-'));
process.env.HOME = path.join(tmp, 'home');
process.env.CLAUDE_HUB_DIR = path.join(tmp, '.claude-hub');
process.env.SUPERSEPT_AGENTS_DIR = path.join(tmp, 'agents');
fs.mkdirSync(process.env.HOME, { recursive: true });

// Fake claude: logs its system prompt and greets with the name it was given there.
const log = path.join(tmp, 'calls.jsonl');
const fake = path.join(tmp, 'fake-claude.mjs');
fs.writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
const argv = process.argv.slice(2);
for await (const c of process.stdin) {}
const system = argv[argv.indexOf('--append-system-prompt') + 1] || '';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ system }) + '\\n');
const names = [...system.matchAll(/Tu es ([A-ZÉ][\\wé]+)/g)].map((m) => m[1]);
const name = /Ton nom est « ([^»]+) »/.exec(system)?.[1] || names[0];
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Bonjour Alessandra, je suis ' + name + '.' } ] } }));
console.log(JSON.stringify({ type: 'result', is_error: false }));
`);
fs.chmodSync(fake, 0o755);

const onboarding = await import('../server/onboarding.js');
const agents = await import('../server/agents.js');
const chat = await import('../server/chat.js');
const { db } = await import('../server/db.js');
chat.initChat({ claude: fake, port: 1, get userName() { return onboarding.firstName(); }, broadcast: () => {}, env: () => ({ ...process.env }) });

async function greet(slug) {
  const conv = chat.newConversation(slug);
  chat.sendToAgent(slug, 'Salut', { conversation: conv });
  while (chat.isBusy(slug, conv)) await new Promise((r) => setTimeout(r, 20));
  const reply = chat.chatHistory(slug, conv).find((m) => m.role === 'assistant')?.text;
  const { system } = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop());
  return { reply, system };
}
const rename = (from, label) => chat.saveAgentAs(from, agents.slugify(label), { ...agents.getAgent(from), label });

test('a renamed lead greets with its new name in a new tab', async () => {
  onboarding.complete({ gender: 'f', name: 'Nova', avatar: '', firstName: 'Alessandra' });
  assert.doesNotMatch(agents.getAgent('nova').prompt, /Nova/);
  assert.match((await greet('nova')).reply, /je suis Nova/);

  db.prepare('INSERT INTO schedules (id, agent, conversation, prompt, every_min, active, created_by, created_at, next_run) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
    .run('t1', 'nova', 0, 'point', 60, 'nova', Date.now(), Date.now() + 3600e3);
  const look = agents.getAgent('nova').avatar;
  const a = rename('nova', 'Dali');
  assert.equal(a.avatar, look, 'the renamed lead keeps its avatar');
  assert.equal(a.slug, 'dali');
  assert.equal(agents.getAgent('nova'), null);

  const { reply, system } = await greet('dali');
  assert.match(reply, /je suis Dali/);
  assert.doesNotMatch(system, /Nova|nova/);
  assert.match(system, /Ton nom est « Dali »/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_HUB_DIR, 'onboarding.json'), 'utf8')).agent, 'dali');
  assert.deepEqual({ ...db.prepare('SELECT agent, created_by FROM schedules WHERE id = ?').get('t1') }, { agent: 'dali', created_by: 'dali' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_convs WHERE agent = 'nova'").get().n, 0);
});

test('a lead set up by an older onboarding loses the name written in its instructions', async () => {
  fs.writeFileSync(path.join(process.env.SUPERSEPT_AGENTS_DIR, 'iris.md'), `---\nname: iris\ndescription: "Cheffe d'équipe"\nmanager: true\nlabel: "Iris"\n---\n\nTu es Iris, la cheffe d'équipe des agents d'Alessandra. Tu es son point d'entrée unique.\n`);
  onboarding.fixLeadPrompts();
  assert.equal(agents.getAgent('iris').prompt.split('\n')[0], "Tu es la cheffe d'équipe des agents d'Alessandra. Tu es son point d'entrée unique.");

  // Renamed with the old instructions still sent back (editor or update-agent): the name is dropped too.
  fs.writeFileSync(path.join(process.env.SUPERSEPT_AGENTS_DIR, 'iris.md'), `---\nname: iris\ndescription: "Cheffe d'équipe"\nmanager: true\nlabel: "Iris"\n---\n\nTu es Iris, la cheffe d'équipe des agents d'Alessandra.\n`);
  rename('iris', 'Luna');
  const { reply, system } = await greet('luna');
  assert.match(reply, /je suis Luna/);
  assert.doesNotMatch(system, /Iris/);
});

test('redoing the onboarding after a rename updates the lead, never adds a second one', async () => {
  for (const f of fs.readdirSync(process.env.SUPERSEPT_AGENTS_DIR)) fs.rmSync(path.join(process.env.SUPERSEPT_AGENTS_DIR, f));
  chat.onboard({ gender: 'f', name: 'Nova', avatar: '', firstName: 'Alessandra' });
  rename('nova', 'Dali');
  db.prepare("INSERT INTO agent_convs (agent, conversation, session_id, created_at, updated_at) VALUES ('dali', 99, 's', 0, 0)").run();
  const a = chat.onboard({ gender: 'm', name: 'Atlas', avatar: '', firstName: 'Alessandra' });
  assert.equal(a.slug, 'atlas');
  assert.deepEqual(agents.listAgents().filter((x) => x.manager).map((x) => x.slug), ['atlas']);
  assert.equal(agents.getAgent('dali'), null);
  assert.equal(a.gender, 'm');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_convs WHERE agent = 'atlas' AND conversation = 99").get().n, 1);
  assert.match((await greet('atlas')).reply, /je suis Atlas/);
  // Same name again: updated in place.
  chat.onboard({ gender: 'm', name: 'Atlas', avatar: '', firstName: 'Ale' });
  assert.equal(agents.listAgents().filter((x) => x.manager).length, 1);
  // A name taken by another agent is refused, the lead stays as it is.
  agents.saveAgent('git', { label: 'Git', description: 'd', prompt: 'p' });
  assert.throws(() => chat.onboard({ gender: 'f', name: 'Git', avatar: '' }), /existe déjà/);
  assert.ok(agents.getAgent('atlas')?.manager);
});
