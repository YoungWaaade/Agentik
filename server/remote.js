// Access from a phone on the network: off by default, gated by a secret token stored in a cookie.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { HUB_DIR } from './db.js';

const FILE = path.join(HUB_DIR, 'remote.json');
const COOKIE = 'supersept_token';
let conf = { enabled: false, token: null };
try { conf = { ...conf, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}

const save = () => fs.writeFileSync(FILE, JSON.stringify(conf), { mode: 0o600 });
const newToken = () => crypto.randomBytes(24).toString('base64url');

export const enabled = () => conf.enabled && !!conf.token;
// SUPERSEPT_HOST forces the bind address (e.g. 127.0.0.1 on a server reached through Tailscale Serve or Caddy).
export const listenHost = () => process.env.SUPERSEPT_HOST || (enabled() ? '0.0.0.0' : '127.0.0.1');
export const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

// Behind a reverse proxy on the same machine (SUPERSEPT_BEHIND_PROXY=1), every visitor shows up as 127.0.0.1:
// a request only counts as local when it carries no forwarding header and targets a loopback host name
// (hooks, the supersept CLI, an SSH tunnel). Anything else is a remote device and needs the pairing token.
export const behindProxy = /^(1|true|yes)$/i.test(process.env.SUPERSEPT_BEHIND_PROXY || '');
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', 'supersept.localhost']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'tailscale-user-login'];
export function isLocal(req) {
  if (!isLoopback(req.socket.remoteAddress)) return false;
  if (!behindProxy) return true;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return LOCAL_NAMES.has(host);
}
export const isHttps = (req) => !!req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
// Public address of this hub (e.g. https://supersept.tail1234.ts.net), shown first with its QR code.
const PUBLIC_URL = (process.env.SUPERSEPT_PUBLIC_URL || '').replace(/\/+$/, '');

export function setEnabled(on) {
  if (on && !conf.token) conf.token = newToken();
  conf.enabled = !!on;
  save();
}

export function rotate() {
  conf.token = newToken();
  save();
}

export function tokenOk(t) {
  if (!conf.token || typeof t !== 'string') return false;
  const a = Buffer.from(t), b = Buffer.from(conf.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function authed(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  return !!m && tokenOk(decodeURIComponent(m[1]));
}

export const cookie = (secure = false) => `${COOKIE}=${conf.token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
export const pairPath = () => `/pair?token=${conf.token}`;

// Tailscale hands out 100.64.0.0/10 addresses; those work from anywhere, the others only on the same Wi‑Fi.
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [x, y] = a.address.split('.').map(Number);
      const tailscale = x === 100 && y >= 64 && y < 128;
      out.push({ label: tailscale ? 'Tailscale' : `Réseau local (${name})`, address: a.address, tailscale });
    }
  }
  return out.sort((a, b) => b.tailscale - a.tailscale);
}

export async function status(port) {
  // Bound to loopback (behind Tailscale Serve / Caddy): the http://<ip>:<port> links can't work, only the public URL can.
  const loopbackOnly = isLoopback(listenHost()) || listenHost() === 'localhost';
  const all = [...(PUBLIC_URL ? [{ label: 'Adresse du serveur', address: PUBLIC_URL, tailscale: true, public: true }] : []), ...(loopbackOnly ? [] : addresses())];
  if (!enabled()) return { enabled: false, addresses: all };
  const list = await Promise.all(all.map(async (a) => {
    const url = a.public ? `${PUBLIC_URL}${pairPath()}` : `http://${a.address}:${port}${pairPath()}`;
    return { ...a, url, qr: await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#151110', light: '#ffffff' } }) };
  }));
  return { enabled: true, addresses: list };
}

export const PAIR_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Supersept</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#151110;color:#eae8e6;font:15px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box}
div{max-width:340px;text-align:center}h1{font-size:18px}p{color:#a8a5a3}</style></head><body><div><h1>Appareil non relié</h1>
<p>Sur ton Mac, ouvre Supersept → Réglages → Accès depuis le téléphone (sur un serveur : <code>npm run pair</code>), puis scanne le QR code avec l'appareil photo de ton iPhone.</p></div></body></html>`;
