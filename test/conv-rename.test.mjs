import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Renaming a conversation: the name is stored in hub.db (agent_convs.title), trimmed, and an empty
// name is refused instead of silently resetting the title.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-conv-rename-'));
process.env.HOME = path.join(tmp, 'home');
process.env.CLAUDE_HUB_DIR = path.join(tmp, '.claude-hub');
process.env.SUPERSEPT_AGENTS_DIR = path.join(tmp, 'agents');
fs.mkdirSync(process.env.HOME, { recursive: true });

const agents = await import('../server/agents.js');
const chat = await import('../server/chat.js');
const { db } = await import('../server/db.js');
chat.initChat({ claude: '/bin/false', port: 1, userName: 'Test', broadcast: () => {}, env: () => ({ ...process.env }) });
agents.saveAgent('robin', { label: 'Robin', description: 'test', prompt: 'test' });

test('renaming stores a trimmed name, empty names are refused', () => {
  const conv = chat.newConversation('robin');
  chat.updateConversation('robin', conv, { title: '   Revue   du  site  ' });
  const title = () => db.prepare('SELECT title FROM agent_convs WHERE agent = ? AND conversation = ?').get('robin', conv).title;
  assert.equal(title(), 'Revue du site');
  assert.equal(chat.conversations('robin').find((c) => c.conversation === conv).title, 'Revue du site');
  assert.throws(() => chat.updateConversation('robin', conv, { title: '   ' }), /vide/);
  assert.throws(() => chat.updateConversation('robin', conv, { title: null }), /vide/);
  assert.equal(title(), 'Revue du site');
  chat.updateConversation('robin', conv, { open: false });
  assert.equal(title(), 'Revue du site');
  chat.updateConversation('robin', conv, { title: 'x'.repeat(200) });
  assert.equal(title().length, 80);
  assert.throws(() => chat.updateConversation('robin', 999, { title: 'a' }), /introuvable/);
});
