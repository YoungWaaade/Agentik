import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRAS } from '../src/ras.js';

// "RAS" alone: a scheduled wake-up leaves no message in the chat, no unread, no report to the manager;
// only the task's last result. Any other answer goes through as before. Throwaway hub, fake claude.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-ras-'));
process.env.HOME = path.join(tmp, 'home');
process.env.CLAUDE_HUB_DIR = path.join(tmp, '.claude-hub');
process.env.SUPERSEPT_AGENTS_DIR = path.join(tmp, 'agents');
fs.mkdirSync(process.env.HOME, { recursive: true });
fs.mkdirSync(process.env.SUPERSEPT_AGENTS_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.SUPERSEPT_AGENTS_DIR, 'chef.md'), '---\nname: chef\ndescription: test\nmanager: true\n---\nTu coordonnes.\n');
fs.writeFileSync(path.join(process.env.SUPERSEPT_AGENTS_DIR, 'zero.md'), '---\nname: zero\ndescription: test\n---\nTu surveilles.\n');
os.homedir = () => process.env.HOME;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Fake claude: logs stdin; answers what ANSWER.txt says, after a tool call.
const log = path.join(tmp, 'calls.jsonl');
const answer = path.join(tmp, 'ANSWER.txt');
const fake = path.join(tmp, 'fake-claude.mjs');
fs.writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
let stdin = '';
for await (const c of process.stdin) stdin += c;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ stdin }) + '\\n');
const say = (o) => console.log(JSON.stringify(o));
say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'supersept sessions' } }] } });
say({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]' }] } });
say({ type: 'assistant', message: { content: [{ type: 'text', text: fs.readFileSync(${JSON.stringify(answer)}, 'utf8') }] } });
say({ type: 'result', is_error: false });
`);
fs.chmodSync(fake, 0o755);

const chat = await import('../server/chat.js');
const s = await import('../server/schedules.js');
const { db } = await import('../server/db.js');
const events = [];
chat.initChat({ claude: fake, port: 1, userName: 'Test', broadcast: (m) => events.push(m), env: () => ({ ...process.env }) });
const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const idle = async () => { while (chat.isBusy('zero') || chat.isBusy('chef')) await new Promise((r) => setTimeout(r, 20)); };
const msgs = (agent, conv) => db.prepare('SELECT role, text FROM chat_messages WHERE agent = ? AND conversation = ?').all(agent, conv);

// Zero works for the lead (its conversation is a mission of chef): its answers go back to chef.
const chefConv = chat.newConversation('chef');
const zeroConv = chat.newConversation('zero');
db.prepare('UPDATE agent_convs SET manager = ?, manager_conv = ? WHERE agent = ? AND conversation = ?').run('chef', chefConv, 'zero', zeroConv);
const task = s.createSchedule({ agent: 'zero', prompt: 'Check Slack', every: '15m', conversation: zeroConv });

test('isRAS : seul, sans casse, espaces, ponctuation ni Markdown', () => {
  for (const t of ['RAS', 'ras', 'ras.', ' RAS ! ', '**RAS**', 'Ras\n', '« RAS »', 'R.A.S.', '_ras_', '`RAS`']) assert.equal(isRAS(t), true, t);
  for (const t of ['RAS sauf X', 'Rien à signaler, sauf un message', 'rase', 'RAS RAS', '', null, undefined, 'Nouveau brief : X']) assert.equal(isRAS(t), false, String(t));
});

test('tâche qui répond RAS : seulement le dernier résultat, rien dans le chat, aucun relais', async () => {
  fs.writeFileSync(answer, ' **RAS** ');
  events.length = 0;
  s.runNow(task.id);
  await idle();
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(task.id);
  assert.equal(row.runs, 1);
  assert.equal(row.last_result.trim(), '**RAS**');
  assert.equal(s.describe(row).dernier_resultat.trim(), '**RAS**');
  assert.deepEqual(msgs('zero', zeroConv), [], 'ni le réveil ni la réponse dans le chat');
  assert.deepEqual(msgs('chef', chefConv), [], "rien chez l'agent chef");
  assert.ok(!events.some((e) => e.type === 'chat'), 'aucun message diffusé (donc aucun non-lu)');
  assert.equal(calls().length, 1, "l'agent chef n'a pas été réveillé");
});

test('tâche qui répond autre chose : tout le tour apparaît, en ordre, et remonte au chef', async () => {
  fs.writeFileSync(answer, 'Nouveau message de Paul sur #design');
  s.runNow(task.id);
  await idle();
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(task.id);
  assert.equal(row.last_result, 'Nouveau message de Paul sur #design');
  const z = msgs('zero', zeroConv);
  assert.deepEqual(z.map((m) => m.role), ['system', 'activity', 'assistant']);
  assert.match(z[0].text, /Tâche planifiée/);
  assert.equal(z[2].text, 'Nouveau message de Paul sur #design');
  const relayed = calls().find((c) => /Zero a répondu : Nouveau message de Paul/i.test(c.stdin));
  assert.ok(relayed, 'relayé au chef');
  assert.ok(msgs('chef', chefConv).some((m) => m.role === 'system' && /a répondu/.test(m.text)));
});

test("l'agent chef qui répond RAS à un relais : pas de message (donc pas de non-lu)", async () => {
  fs.writeFileSync(answer, 'ras.');
  events.length = 0;
  chat.sendToAgent('chef', '[Supersept] Zero a répondu : truc', { internal: true, conversation: chefConv });
  await idle();
  assert.ok(!msgs('chef', chefConv).some((m) => m.role === 'assistant' && /ras/i.test(m.text)));
  assert.ok(!events.some((e) => e.type === 'chat' && e.message.role === 'assistant'));
});
