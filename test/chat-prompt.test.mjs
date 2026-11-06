import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The chat turn must hand the user's text to `claude -p` through stdin: as an argument, a message
// starting with "-" was read as an option ("Je n'ai pas pu répondre (... unknown option ...)").
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-chat-'));
process.env.HOME = path.join(tmp, 'home');
process.env.CLAUDE_HUB_DIR = path.join(tmp, '.claude-hub');
process.env.SUPERSEPT_AGENTS_DIR = path.join(tmp, 'agents');
fs.mkdirSync(process.env.HOME, { recursive: true });
fs.mkdirSync(process.env.SUPERSEPT_AGENTS_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.SUPERSEPT_AGENTS_DIR, 'bot.md'), '---\nname: bot\ndescription: test\n---\nTu es un bot de test.\n');

// Fake claude: logs argv and stdin, fails like the real one on an unknown dash argument, echoes stdin.
const log = path.join(tmp, 'calls.jsonl');
const fake = path.join(tmp, 'fake-claude.mjs');
fs.writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
const argv = process.argv.slice(2);
let stdin = '';
for await (const c of process.stdin) stdin += c;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, stdin }) + '\\n');
const bad = argv.find((a) => /^-[^-]|^--\\S*\\s/.test(a) && !/^-[pn]$/.test(a));
if (bad) { process.stderr.write("error: unknown option '" + bad + "'\\n"); process.exit(1); }
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'reçu: ' + stdin }] } }));
console.log(JSON.stringify({ type: 'result', is_error: false }));
`);
fs.chmodSync(fake, 0o755);

const MESSAGES = [
  "- oui\n-met l'accent\n- ordre alphabetique\n- on verra apres\n\nniveau design faut que tu reprennes le max de composants...",
  'ligne 1\nligne 2\n\nligne 4',
  `"guillemets" 'apostrophes' $HOME $(echo nope) \`whoami\` \\ fin`,
  '--help',
];

test('chat prompts reach claude untouched through stdin', async () => {
  const chat = await import('../server/chat.js');
  chat.initChat({ claude: fake, port: 1, userName: 'Test', broadcast: () => {}, env: () => ({ ...process.env }) });
  for (const text of MESSAGES) {
    const conv = chat.sendToAgent('bot', text, { conversation: chat.newConversation('bot') });
    while (chat.isBusy('bot', conv)) await new Promise((r) => setTimeout(r, 20));
    const msgs = chat.chatHistory('bot', conv).messages ?? chat.chatHistory('bot', conv);
    const call = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    assert.equal(call.stdin, text);
    assert.ok(!call.argv.includes(text), 'the prompt must not be an argument');
    assert.ok(!msgs.some((m) => m.role === 'error'), JSON.stringify(msgs));
    assert.ok(msgs.some((m) => m.role === 'assistant' && m.text === `reçu: ${text}`.trim()));
  }
});
