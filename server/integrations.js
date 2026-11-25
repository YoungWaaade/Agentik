// The company's Cloudflare MCP Portal, declared to Claude Code as the user-scope server "cloudflare"
// (mcpServers in ~/.claude.json), so every session and agent gets its tools (mcp__cloudflare__*).
// OAuth first: a bare http entry, Claude Code runs the login and keeps the tokens in the macOS keychain.
// An optional API token stays in ~/.claude-hub/secrets (chmod 600), read by a headersHelper script:
// it is never written to ~/.claude.json, the repo, the logs, nor sent back to the client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { HUB_DIR } from './db.js';
import { keyedQueue } from './queue.js';

export const NAME = 'cloudflare';
const SECRETS = path.join(HUB_DIR, 'secrets');
const TOKEN_FILE = path.join(SECRETS, 'cloudflare-mcp.token');
export const HELPER = path.join(HUB_DIR, 'bin', 'cloudflare-mcp-headers.sh');
const BACKUPS = path.join(HUB_DIR, 'backups');
const KEEP_BACKUPS = 5;

// Read at call time: tests (and HOME=/tmp copies) point it elsewhere.
const configFile = () => path.join(os.homedir(), '.claude.json');

// A symlinked ~/.claude.json (dotfiles repo) is written through, never replaced by a plain file.
function realConfig() {
  const f = configFile();
  try { return fs.realpathSync(f); } catch { return f; }
}

function readConfig() {
  let raw;
  try { raw = fs.readFileSync(realConfig(), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`lecture de ~/.claude.json impossible : ${e.code || e.message}`);
  }
  try { return JSON.parse(raw); } catch { throw new Error("~/.claude.json n'est pas un JSON valide : rien n'a été modifié"); }
}

// Copy before every change (chmod 600: the file holds account data), the last few kept.
function backup(file) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(BACKUPS, { recursive: true, mode: 0o700 });
  const to = path.join(BACKUPS, `claude.json.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
  fs.copyFileSync(file, to);
  fs.chmodSync(to, 0o600);
  const old = fs.readdirSync(BACKUPS).filter((n) => n.startsWith('claude.json.')).sort();
  for (const n of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUPS, n), { force: true });
  return to;
}

// Read, change only mcpServers.cloudflare, write a temp file next to it and rename it over (atomic):
// every other key (Claude Code's own state, other MCP servers) is kept as it was just read.
function updateServer(fn) {
  const file = realConfig();
  const cfg = readConfig();
  const servers = { ...(cfg.mcpServers || {}) };
  const next = fn(servers[NAME]);
  if (next) servers[NAME] = next;
  else delete servers[NAME];
  cfg.mcpServers = servers;
  backup(file);
  let mode = 0o600;
  try { mode = fs.statSync(file).mode & 0o777; } catch {}
  const tmp = `${file}.agentik-${process.pid}-${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w', mode);
    fs.writeSync(fd, JSON.stringify(cfg, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`écriture de ~/.claude.json impossible : ${e.code || e.message}`);
  }
  return next;
}

// https only, a real host, no user:password@ in it.
export function checkUrl(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error("indique l'URL du portail MCP");
  if (s.length > 500) throw new Error('URL trop longue');
  let u;
  try { u = new URL(s); } catch { throw new Error("URL invalide : elle doit ressembler à https://portail.exemple.com/mcp"); }
  if (u.protocol !== 'https:') throw new Error("l'URL doit commencer par https://");
  if (!u.hostname || !u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error("URL invalide : nom de domaine manquant");
  if (u.username || u.password) throw new Error("pas d'identifiant dans l'URL : utilise le champ jeton si besoin");
  return u.toString();
}

const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{8,4096}$/;
function checkToken(t) {
  const s = String(t || '').trim().replace(/^Bearer\s+/i, '');
  if (!TOKEN_RE.test(s)) throw new Error('jeton invalide : une seule ligne, sans espace (lettres, chiffres, . _ - ~ + / =)');
  return s;
}

const hasToken = () => fs.existsSync(TOKEN_FILE);
const ours = (entry) => entry?.headersHelper === HELPER;

function writeToken(token) {
  fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  fs.chmodSync(SECRETS, 0o700);
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE, 0o600);
  fs.mkdirSync(path.dirname(HELPER), { recursive: true });
  // Prints the header Claude Code adds to each request; the token never leaves this Mac's files.
  fs.writeFileSync(HELPER, `#!/bin/sh\n# Agentik : en-tête du portail MCP Cloudflare (jeton dans ${TOKEN_FILE}, chmod 600).\nt=$(cat '${TOKEN_FILE.replace(/'/g, `'\\''`)}' 2>/dev/null) || exit 1\nprintf '{"Authorization":"Bearer %s"}' "$t"\n`, { mode: 0o700 });
  fs.chmodSync(HELPER, 0o700);
}

function removeToken() {
  fs.rmSync(TOKEN_FILE, { force: true });
  fs.rmSync(HELPER, { force: true });
}

// What the UI may know: never the token itself.
export function status() {
  let entry = null;
  let error = null;
  try { entry = readConfig().mcpServers?.[NAME] || null; } catch (e) { error = e.message; }
  return {
    configured: !!entry,
    url: entry?.url || '',
    type: entry?.type || '',
    hasToken: ours(entry) && hasToken(),
    error,
  };
}

// Adds or updates the entry. token: a new one; clearToken: back to OAuth. Other fields someone added
// by hand (headers, oauth settings) are kept.
export function save({ url, token, clearToken } = {}) {
  url = checkUrl(url);
  const tok = token ? checkToken(token) : null;
  if (tok) writeToken(tok);
  updateServer((entry) => {
    const next = { ...(entry || {}), type: 'http', url };
    if (tok) next.headersHelper = HELPER;
    else if (clearToken && ours(next)) delete next.headersHelper;
    return next;
  });
  if (clearToken && !tok) removeToken();
  return status();
}

export function disconnect() {
  if (status().configured) updateServer(() => null);
  removeToken();
  return status();
}

// --- Connection test -------------------------------------------------------------------------------

// One MCP initialize request: 2xx = open, 401 + WWW-Authenticate = there, login to do (OAuth).
export async function probe(url, { token, timeoutMs = 8000 } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agentik', version: '1' } } }),
    });
  } catch (e) {
    const code = e.cause?.code || e.code || e.name;
    if (code === 'TimeoutError' || code === 'AbortError') return { ok: false, message: `Pas de réponse en ${timeoutMs / 1000} s : vérifie l'URL et ta connexion (WARP, VPN).` };
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { ok: false, message: "Adresse introuvable : vérifie le nom de domaine de l'URL (et que WARP est connecté)." };
    if (code === 'ECONNREFUSED') return { ok: false, message: 'Connexion refusée par le serveur.' };
    if (/CERT|SSL|TLS/i.test(String(code))) return { ok: false, message: 'Certificat HTTPS refusé.' };
    return { ok: false, message: `Portail injoignable (${code || 'erreur réseau'}).` };
  }
  res.body?.cancel?.().catch(() => {});
  const auth = res.headers.get('www-authenticate') || '';
  if (res.status >= 200 && res.status < 300) return { ok: true, http: res.status, auth: false, message: 'Joignable.' };
  if (res.status === 401) {
    if (token) return { ok: false, http: 401, message: 'Jeton refusé par le portail (401) : vérifie-le ou repasse à la connexion par compte (OAuth).' };
    return auth
      ? { ok: true, http: 401, auth: true, oauth: /resource_metadata|realm="?oauth/i.test(auth), message: 'Joignable : connexion à faire (OAuth).' }
      : { ok: false, http: 401, message: 'Le portail demande une authentification sans dire laquelle (401) : vérifie que c\'est bien l\'URL MCP.' };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, http: res.status, message: "Redirection vers une autre page (souvent la connexion Cloudflare Access) : ce n'est pas l'URL MCP. Demande à l'admin l'URL du portail MCP, elle finit souvent par /mcp." };
  if (res.status === 403) return { ok: false, http: 403, message: "Accès refusé (403) : ton compte n'a peut-être pas accès à ce portail." };
  if (res.status === 404) return { ok: false, http: 404, message: "Pas de serveur MCP à cette adresse (404) : vérifie le chemin, souvent /mcp." };
  if (res.status === 405) return { ok: false, http: 405, message: "Cette adresse n'accepte pas les requêtes MCP (405) : vérifie le chemin, souvent /mcp." };
  return { ok: false, http: res.status, message: `Réponse inattendue du portail (HTTP ${res.status}).` };
}

// `claude mcp get cloudflare` tells whether Claude Code itself is logged in. One process at a time,
// callers asking meanwhile share the next run (no burst of spawns on this managed Mac).
export function parseMcpGet(out) {
  const line = String(out || '').split('\n').find((l) => /^\s*Status:/i.test(l)) || '';
  if (!line) return null;
  if (/needs? auth/i.test(line)) return 'auth';
  if (/fail|error|✗/i.test(line)) return 'failed';
  if (/connected|✔|✓/i.test(line)) return 'connected';
  return null;
}

let claudeBin = 'claude';
let childEnv = () => process.env;
export function init({ claude, env } = {}) {
  if (claude) claudeBin = claude;
  if (env) childEnv = env;
}

const waiters = new Map();
const runGet = (name) => new Promise((resolve) => {
  execFile(claudeBin, ['mcp', 'get', name], { cwd: os.homedir(), env: childEnv(), timeout: 30000, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
    resolve({ state: parseMcpGet(`${stdout}\n${stderr}`), err: err && !stdout ? err : null });
  });
});
const getQueue = keyedQueue(async (name) => {
  const mine = waiters.get(name) || [];
  waiters.delete(name);
  const r = await runGet(name).catch(() => ({ state: null }));
  for (const w of mine) w(r);
}, 1);
export function claudeStatus(name = NAME) {
  return new Promise((resolve) => {
    if (!waiters.has(name)) waiters.set(name, []);
    waiters.get(name).push(resolve);
    getQueue.push(name);
  });
}

const HOW_TO_LOGIN = 'suis les étapes ci-dessous, puis clique sur Tester.';

// state: connected | auth | reachable | error. url given: tests that address (before saving it).
export async function test({ url } = {}) {
  const st = status();
  let target;
  try { target = checkUrl(url || st.url); } catch (e) { return { state: 'error', message: e.message[0].toUpperCase() + e.message.slice(1) + '.' }; }
  const saved = st.configured && st.url === target;
  let token = null;
  if (saved && st.hasToken) { try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch {} }
  const p = await probe(target, { token });
  if (!p.ok) return { state: 'error', http: p.http, message: p.message };
  if (!saved) {
    return p.auth
      ? { state: 'reachable', http: p.http, message: 'Portail joignable. Enregistre-le, puis connecte-toi (OAuth) depuis une session.' }
      : { state: 'reachable', http: p.http, message: 'Portail joignable. Enregistre-le pour que les sessions et les agents l\'utilisent.' };
  }
  if (token) {
    return { state: 'connected', http: p.http, message: 'Connecté avec le jeton.' };
  }
  const c = await claudeStatus();
  if (c.state === 'connected') return { state: 'connected', http: p.http, message: 'Connecté : Claude Code est authentifié sur le portail.' };
  if (c.state === 'auth') return { state: 'auth', http: p.http, message: `Il reste à te connecter : ${HOW_TO_LOGIN}` };
  if (c.state === 'failed') return { state: 'error', http: p.http, message: 'Le portail répond, mais Claude Code n\'arrive pas à s\'y connecter. Essaie /mcp dans une session pour voir le détail.' };
  // Claude Code could not tell: say what the HTTP answer means.
  return p.auth
    ? { state: 'auth', http: p.http, message: `Portail joignable, mais impossible de savoir si tu es connecté. Si les outils cloudflare n'apparaissent pas, ${HOW_TO_LOGIN}` }
    : { state: 'connected', http: p.http, message: 'Portail joignable sans authentification.' };
}
