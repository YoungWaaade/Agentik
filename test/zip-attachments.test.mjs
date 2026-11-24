import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Zip archives attached in the chat: accepted by the shared filter (MIME type or, when empty, the
// extension), handed to the agent by path with how to read them, and only read-only unzip allowed.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-zip-'));
process.env.HOME = path.join(tmp, 'home');
process.env.CLAUDE_HUB_DIR = path.join(tmp, '.claude-hub');
process.env.SUPERSEPT_AGENTS_DIR = path.join(tmp, 'agents');
fs.mkdirSync(process.env.HOME, { recursive: true });

const { attachableFiles, ATTACH_ACCEPT } = await import('../src/api.js');
const agents = await import('../server/agents.js');
const chat = await import('../server/chat.js');

test('the shared filter takes zip archives by MIME type, or by extension when the type is empty', () => {
  const f = (name, type) => ({ name, type });
  const kept = attachableFiles([
    f('a.zip', 'application/zip'), f('b.zip', 'application/x-zip-compressed'), f('c.zip', ''), f('d.ZIP', 'application/octet-stream'),
    f('noext', 'application/zip'), f('e.zip', 'text/html'), f('f.exe', ''), f('g.tar.gz', 'application/gzip'), f('h.png', 'image/png'), f('i.md', ''),
  ]).map((x) => x.name);
  assert.deepEqual(kept, ['a.zip', 'b.zip', 'c.zip', 'd.ZIP', 'noext', 'h.png', 'i.md']);
  for (const t of ['.zip', 'application/zip', 'application/x-zip-compressed', '.md', 'image/*']) assert.ok(ATTACH_ACCEPT.split(',').includes(t), t);
});

test('the agent receives the zip path, how to read it, and may only run read-only unzip', async () => {
  // A real archive, as /api/attachments would have saved it.
  const dir = path.join(process.env.CLAUDE_HUB_DIR, 'attachments', 'abc123');
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'notes.txt'), 'bonjour');
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'docs.zip');
  execFileSync('zip', ['-q', '-j', zip, path.join(tmp, 'src', 'notes.txt')]);
  const png = path.join(dir, 'x.png');
  fs.writeFileSync(png, 'x');

  const note = chat.attachmentNote([{ path: zip, name: 'docs.zip' }, { path: png, name: 'x.png' }]);
  assert.match(note, new RegExp(`lis-les avec l'outil Read : ${png.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`));
  assert.ok(!note.split('Archive zip')[0].includes(zip), 'the zip is not listed as a file to Read');
  assert.ok(note.includes(`archive zip : liste son contenu avec « unzip -l ${zip} »`));
  assert.ok(note.includes(`unzip -p ${zip} <chemin dans l'archive>`));
  assert.match(note, /extraction \(unzip -d\) n'est pas autorisée/);
  // The commands given work as written.
  assert.match(execFileSync('sh', ['-c', `unzip -l ${zip}`]).toString(), /notes\.txt/);
  assert.equal(execFileSync('sh', ['-c', `unzip -p ${zip} notes.txt`]).toString(), 'bonjour');

  // A real turn: the fake claude records its arguments and the prompt it got on stdin.
  const log = path.join(tmp, 'call.json');
  const fake = path.join(tmp, 'fake-claude.mjs');
  fs.writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
let input = ''; for await (const c of process.stdin) input += c;
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), input }));
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Vu.' }] } }));
console.log(JSON.stringify({ type: 'result', is_error: false }));
`);
  fs.chmodSync(fake, 0o755);
  chat.initChat({ claude: fake, port: 1, userName: 'Test', broadcast: () => {}, env: () => ({ ...process.env }) });
  agents.saveAgent('zippy', { label: 'Zippy', description: 'test', prompt: 'test' });
  const conv = chat.sendToAgent('zippy', 'Regarde cette archive.', { images: [{ path: zip, name: 'docs.zip' }] });
  while (chat.isBusy('zippy', conv)) await new Promise((r) => setTimeout(r, 20));
  const { argv, input } = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.ok(input.includes(zip) && input.includes('unzip -l'), 'path and hint in the prompt');
  const allowed = argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--disallowedTools'));
  assert.ok(allowed.includes('Bash(unzip -l:*)') && allowed.includes('Bash(unzip -p:*)'));
  assert.ok(!allowed.some((t) => /unzip(:| -d| -o| -q)/.test(t)), 'no unzip rule that can write');
});
