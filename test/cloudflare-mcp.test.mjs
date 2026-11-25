import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Cloudflare MCP Portal: the "cloudflare" entry of ~/.claude.json is added, updated and removed without
// touching anything else; the optional token stays in a 600 file, never in the config nor in status().
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-cf-'));
process.env.HOME = path.join(tmp, 'home');
process.env.CLAUDE_HUB_DIR = path.join(tmp, '.claude-hub');
fs.mkdirSync(process.env.HOME, { recursive: true });
os.homedir = () => process.env.HOME;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const cf = await import('../server/integrations.js');
const file = path.join(process.env.HOME, '.claude.json');
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const original = { numStartups: 12, oauthAccount: { email: 'x@y.z' }, mcpServers: { figma: { type: 'http', url: 'https://mcp.figma.com/mcp' } }, projects: { '/a': { mcpServers: {} } } };

test('checkUrl: https only, a host, no credentials', () => {
  assert.equal(cf.checkUrl(' https://portal.example.com/mcp '), 'https://portal.example.com/mcp');
  for (const bad of ['', 'portal.example.com', 'http://portal.example.com/mcp', 'https://user:pw@portal.example.com/mcp', 'https://nodot/mcp', 'ftp://a.b']) {
    assert.throws(() => cf.checkUrl(bad), undefined, bad);
  }
});

test('save adds the entry, keeps every other key, backs up first, file mode kept', () => {
  fs.writeFileSync(file, JSON.stringify(original), { mode: 0o600 });
  const s = cf.save({ url: 'https://portal.example.com/mcp' });
  assert.deepEqual(s, { configured: true, url: 'https://portal.example.com/mcp', type: 'http', hasToken: false, error: null });
  const c = read();
  assert.deepEqual(c.mcpServers.cloudflare, { type: 'http', url: 'https://portal.example.com/mcp' });
  assert.deepEqual(c.mcpServers.figma, original.mcpServers.figma);
  assert.equal(c.numStartups, 12);
  assert.deepEqual(c.oauthAccount, original.oauthAccount);
  assert.deepEqual(c.projects, original.projects);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const backups = fs.readdirSync(path.join(process.env.CLAUDE_HUB_DIR, 'backups'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_HUB_DIR, 'backups', backups[0]), 'utf8')), original);
  assert.equal(fs.readdirSync(process.env.HOME).filter((n) => n.endsWith('.tmp')).length, 0);
});

test('token: in a 600 file read by headersHelper, never in ~/.claude.json nor in status()', async () => {
  const secret = 'tok_ABCdef123456789';
  const s = cf.save({ url: 'https://portal.example.com/mcp', token: secret });
  assert.equal(s.hasToken, true);
  assert.ok(!JSON.stringify(s).includes(secret));
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(secret));
  assert.equal(read().mcpServers.cloudflare.headersHelper, cf.HELPER);
  const tokFile = path.join(process.env.CLAUDE_HUB_DIR, 'secrets', 'cloudflare-mcp.token');
  assert.equal(fs.statSync(tokFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(tokFile)).mode & 0o777, 0o700);
  const { execFileSync } = await import('node:child_process');
  assert.deepEqual(JSON.parse(execFileSync(cf.HELPER, { encoding: 'utf8' })), { Authorization: `Bearer ${secret}` });
  assert.throws(() => cf.save({ url: 'https://portal.example.com/mcp', token: 'a b"}' }));
  // Back to OAuth: helper and token gone.
  const o = cf.save({ url: 'https://portal.example.com/mcp', clearToken: true });
  assert.equal(o.hasToken, false);
  assert.equal(read().mcpServers.cloudflare.headersHelper, undefined);
  assert.ok(!fs.existsSync(tokFile));
});

test('update keeps hand-added fields; disconnect removes only the entry; backups capped', () => {
  const c = read();
  c.mcpServers.cloudflare.oauth = { clientId: 'abc' };
  fs.writeFileSync(file, JSON.stringify(c));
  cf.save({ url: 'https://other.example.com/mcp' });
  assert.deepEqual(read().mcpServers.cloudflare, { type: 'http', url: 'https://other.example.com/mcp', oauth: { clientId: 'abc' } });
  for (let i = 0; i < 6; i++) cf.save({ url: `https://p${i}.example.com/mcp` });
  const s = cf.disconnect();
  assert.equal(s.configured, false);
  const after = read();
  assert.equal(after.mcpServers.cloudflare, undefined);
  assert.deepEqual(after.mcpServers.figma, original.mcpServers.figma);
  assert.equal(after.numStartups, 12);
  assert.ok(fs.readdirSync(path.join(process.env.CLAUDE_HUB_DIR, 'backups')).length <= 5);
});

test('invalid ~/.claude.json: nothing written', () => {
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => cf.save({ url: 'https://portal.example.com/mcp' }), /JSON valide/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
  fs.writeFileSync(file, JSON.stringify(original));
});

test('parseMcpGet reads the status line of `claude mcp get`', () => {
  assert.equal(cf.parseMcpGet('cloudflare:\n  Status: ✔ Connected\n  Type: http'), 'connected');
  assert.equal(cf.parseMcpGet('  Status: ⚠ Needs authentication'), 'auth');
  assert.equal(cf.parseMcpGet('  Status: ✗ Failed to connect'), 'failed');
  assert.equal(cf.parseMcpGet('No MCP server found'), null);
});

test('probe: 401 + WWW-Authenticate = reachable with OAuth to do; 404, redirect, refused = clear errors', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/mcp') { res.writeHead(401, { 'www-authenticate': 'Bearer realm="OAuth", resource_metadata="x"' }); return res.end('{}'); }
    if (req.url === '/open') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (req.url === '/login') { res.writeHead(302, { location: 'https://team.cloudflareaccess.com/' }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.deepEqual((({ ok, auth, oauth }) => ({ ok, auth, oauth }))(await cf.probe(`${base}/mcp`)), { ok: true, auth: true, oauth: true });
    assert.equal((await cf.probe(`${base}/open`)).auth, false);
    assert.match((await cf.probe(`${base}/nope`)).message, /404/);
    assert.match((await cf.probe(`${base}/login`)).message, /Redirection/);
  } finally { srv.close(); }
  assert.equal((await cf.probe('http://127.0.0.1:1/mcp')).ok, false);
  assert.match((await cf.probe('https://does-not-exist.invalid/mcp')).message, /introuvable/);
});

test('test(): invalid URL is an error; claude mcp get runs one at a time, callers share the run', async () => {
  assert.equal((await cf.test({ url: 'http://x.example.com' })).state, 'error');
  const log = path.join(tmp, 'mcp-get.log');
  const fake = path.join(tmp, 'fake-claude.sh');
  fs.writeFileSync(fake, `#!/bin/sh\necho "$$ start" >> '${log}'\nsleep 0.3\necho "$$ end" >> '${log}'\necho "  Status: ⚠ Needs authentication"\n`, { mode: 0o755 });
  cf.init({ claude: fake });
  const all = await Promise.all(Array.from({ length: 8 }, () => cf.claudeStatus()));
  assert.ok(all.every((r) => r.state === 'auth'));
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(lines.length <= 4, `${lines.length / 2} runs for 8 callers`);
  for (let i = 0; i < lines.length; i += 2) assert.ok(lines[i].endsWith('start') && lines[i + 1].endsWith('end'), 'never two at once');
});
