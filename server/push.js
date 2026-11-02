// Web Push: lock-screen notifications on the phone (iOS 16.4+ once YoungHub is on the home screen),
// even with the app closed. The browser subscribes with our VAPID public key; we send through its push service.
//
// VAPID keys come from the server config (SUPERSEPT_VAPID_PUBLIC_KEY / SUPERSEPT_VAPID_PRIVATE_KEY in
// ~/.config/supersept/env, see scripts/vapid-keys.mjs). Without them, a pair is generated once and kept in
// ~/.claude-hub/vapid.json (0600), so it works out of the box; never in the repository.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { fileURLToPath } from 'node:url';
import { db, HUB_DIR } from './db.js';
import { getAgent, isSlug } from './agents.js';

db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  ua TEXT,
  prefs TEXT,
  created_at INTEGER NOT NULL,
  last_ok INTEGER,
  failures INTEGER NOT NULL DEFAULT 0
)`);

const KEY_FILE = path.join(HUB_DIR, 'vapid.json');
function loadKeys() {
  const pub = process.env.SUPERSEPT_VAPID_PUBLIC_KEY, priv = process.env.SUPERSEPT_VAPID_PRIVATE_KEY;
  if (pub && priv) return { publicKey: pub.trim(), privateKey: priv.trim(), source: 'env' };
  try {
    const k = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    if (k.publicKey && k.privateKey) return { ...k, source: KEY_FILE };
  } catch {}
  const k = webpush.generateVAPIDKeys();
  fs.writeFileSync(KEY_FILE, JSON.stringify(k), { mode: 0o600 });
  return { ...k, source: KEY_FILE };
}
const keys = loadKeys();
// Apple rejects the JWT without a valid subject: a mailto: or an https URL (the hub's public address).
const SUBJECT = process.env.SUPERSEPT_VAPID_SUBJECT || (process.env.SUPERSEPT_PUBLIC_URL?.startsWith('https://') ? process.env.SUPERSEPT_PUBLIC_URL : 'mailto:supersept@example.com');
webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
console.log(`Web Push : clés VAPID depuis ${keys.source === 'env' ? '~/.config/supersept/env' : keys.source}`);

export const publicKey = () => keys.publicKey;

const DEFAULT_PREFS = { sessions: true, agents: true };
const prefsOf = (row) => { try { return { ...DEFAULT_PREFS, ...JSON.parse(row.prefs || '{}') }; } catch { return { ...DEFAULT_PREFS }; } };

export function subscribe(sub, { ua = null, prefs = null } = {}) {
  const { endpoint, keys: k } = sub || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !k?.p256dh || !k?.auth) throw new Error('abonnement push invalide');
  const old = db.prepare('SELECT prefs FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
  const p = JSON.stringify({ ...(old ? prefsOf(old) : DEFAULT_PREFS), ...pickPrefs(prefs) });
  db.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, ua, prefs, created_at, failures) VALUES (?, ?, ?, ?, ?, ?, 0)
              ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, prefs = excluded.prefs, failures = 0`)
    .run(endpoint, k.p256dh, k.auth, ua, p, Date.now());
  return status(endpoint);
}

const pickPrefs = (p) => Object.fromEntries(Object.entries(p || {}).filter(([k, v]) => k in DEFAULT_PREFS && typeof v === 'boolean'));

export function setPrefs(endpoint, prefs) {
  const row = db.prepare('SELECT prefs FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
  if (!row) throw new Error('appareil non abonné');
  db.prepare('UPDATE push_subscriptions SET prefs = ? WHERE endpoint = ?').run(JSON.stringify({ ...prefsOf(row), ...pickPrefs(prefs) }), endpoint);
  return status(endpoint);
}

export function unsubscribe(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint || ''));
}

export function status(endpoint) {
  const row = endpoint ? db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(endpoint) : null;
  return { publicKey: keys.publicKey, subscribed: !!row, prefs: row ? prefsOf(row) : { ...DEFAULT_PREFS }, devices: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n };
}

// Which devices have the app in the foreground on a given screen, as reported over /ws/events.
// presence: () => [{ endpoint, visible, view: { ws } | { chat: "agent:conv" }, at }]
let presence = () => [];
export function setPresenceSource(f) { presence = f; }
const STALE = 75_000; // a visible page re-reports every 30 s; iOS can freeze a page without telling us
function lookingAt(endpoint, target) {
  if (!target) return false;
  return presence().some((p) => p.endpoint === endpoint && p.visible && Date.now() - p.at < STALE
    && ((target.ws && p.view?.ws === target.ws) || (target.chat && p.view?.chat === target.chat)));
}

// Plain text for a lock screen: no markdown, one line, short.
export function summary(text, max = 180) {
  const s = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|~]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// kind: 'sessions' | 'agents' (the device's preferences) | 'test' (always sent), target: the screen that makes it redundant.
// payload: { title, body, url, tag }. Resolves to { sent, skipped, failed }.
export async function notify(kind, payload, { target = null, only = null } = {}) {
  const rows = only
    ? db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').all(only)
    : db.prepare('SELECT * FROM push_subscriptions').all();
  const out = { sent: 0, skipped: 0, failed: 0, errors: [] };
  const body = JSON.stringify({ ...payload, body: payload.body ? summary(payload.body, 240) : '' });
  await Promise.all(rows.map(async (row) => {
    if (!only && kind !== 'test' && (!prefsOf(row)[kind] || lookingAt(row.endpoint, target))) { out.skipped++; return; }
    try {
      // Urgency high: iOS otherwise may hold the notification until the phone wakes up.
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, { TTL: 6 * 3600, urgency: 'high', topic: topicOf(payload.tag) });
      db.prepare('UPDATE push_subscriptions SET last_ok = ?, failures = 0 WHERE endpoint = ?').run(Date.now(), row.endpoint);
      out.sent++;
    } catch (e) {
      out.failed++;
      out.errors.push(`${e.statusCode || ''} ${e.body || e.message || e.code || e.errors?.[0]?.code || 'injoignable'}`.trim());
      // 404/410: the subscription is gone (app removed, permission revoked). Other errors: retry next time, up to a point.
      if (e.statusCode === 404 || e.statusCode === 410 || row.failures >= 20) unsubscribe(row.endpoint);
      else db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?').run(row.endpoint);
      console.log(`Web Push : échec (${e.statusCode || e.message})`);
    }
  }));
  return out;
}

// The Topic header replaces a pending, undelivered notification with the same topic (max 32 chars).
// Apple reads it as base64url and answers 400 BadWebPushTopic (push lost) for a '-' and for a length of
// 4n+1 ("chatnami6"): a 32-char hex digest of the tag is always valid.
const topicOf = (tag) => (tag ? crypto.createHash('sha256').update(String(tag)).digest('hex').slice(0, 32) : undefined);

// ---- agent avatars as notification icons ----------------------------------------------------------
// Resolved on every push from the agent's config, never from a fixed list: the avatar field of
// ~/.claude/agents/<slug>.md can point at an image (/agents/x.webp, agents/x.png); a "v2:…" spec is a
// portrait drawn in the browser (no file to show, so the app icon); anything else (empty, legacy spec,
// "studio", "photo") means "the agent's picture in public/agents/ if there is one", smallest version first.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIRS = [path.join(ROOT, 'public'), path.join(ROOT, 'dist')];
const IMG = /\.(webp|png|jpe?g)$/i;
const SUFFIXES = ['-push', '-sm', '-face', '-small', '', '-bust'];
function existing(rel) {
  for (const dir of IMAGE_DIRS) {
    const f = path.resolve(dir, rel);
    if (f.startsWith(dir + path.sep) && IMG.test(f)) try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}
export function avatarFile(slug) {
  if (!isSlug(slug)) return null;
  const spec = getAgent(slug)?.avatar;
  if (typeof spec === 'string' && spec.startsWith('v2:')) return null;
  if (typeof spec === 'string' && IMG.test(spec) && !/^[a-z]+:/i.test(spec)) return existing(spec.replace(/^\/+/, ''));
  for (const suf of SUFFIXES) for (const ext of ['webp', 'png', 'jpg', 'jpeg']) {
    const f = existing(`agents/${slug}${suf}.${ext}`);
    if (f) return f;
  }
  return null;
}
// Absolute URL for the payload (the service worker also resolves it against its own origin), with the
// file's mtime so a replaced picture is fetched again instead of a cached one. null → app icon.
export function avatarIcon(slug) {
  const f = avatarFile(slug);
  if (!f) return null;
  const rel = `/api/push/avatar/${slug}?v=${Math.round(fs.statSync(f).mtimeMs)}`;
  const base = process.env.SUPERSEPT_PUBLIC_URL?.replace(/\/+$/, '');
  return base ? base + rel : rel;
}
