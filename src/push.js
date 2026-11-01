// Web Push on this device: service worker, subscription, and "what's on screen" reports so the server
// doesn't push what the user is already looking at. Server side: server/push.js.
import { api } from './api.js';
import { getViewing, onStoreChange } from './chatStore.js';

const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const swSupported = 'serviceWorker' in navigator && window.isSecureContext;
const pushSupported = () => swSupported && 'PushManager' in window && 'Notification' in window;

let endpoint = null; // this device's subscription, once known
const listeners = new Set();
const changed = () => listeners.forEach((f) => f());
export function onPushChange(f) { listeners.add(f); return () => listeners.delete(f); }
export const pushEndpoint = () => endpoint;

// Where this device stands, for the "Notifications" panels.
// state: 'unsupported' | 'install' (iOS: add to home screen first) | 'denied' | 'off' | 'on'
export function pushState() {
  if (!pushSupported()) return isIOS && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return endpoint ? 'on' : 'off';
}

const b64ToBytes = (s) => {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const sameKey = (sub, key) => {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // not exposed by this browser: assume it matches
  const a = new Uint8Array(k), b = b64ToBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

let publicKey = null;
let reg = null;
const ready = (async () => {
  if (!swSupported) return;
  try {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') openUrl(e.data.url); });
    if (!pushSupported()) return;
    const [sub, st] = await Promise.all([reg.pushManager.getSubscription(), api.get('/api/push')]);
    publicKey = st.publicKey;
    if (!sub) return;
    if (Notification.permission !== 'granted') return; // permission withdrawn in iOS settings
    if (!sameKey(sub, publicKey)) {
      // The server's VAPID keys changed: the old subscription is dead, make a new one (permission is still granted).
      await sub.unsubscribe().catch(() => {});
      await subscribeWith(reg);
    } else {
      // Make sure the server has it (new database, subscription renewed by the browser…).
      await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
      endpoint = sub.endpoint;
    }
  } catch (e) { console.warn('push', e); }
})().finally(() => { changed(); report(); });

async function subscribeWith(r) {
  const sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
  endpoint = sub.endpoint;
}

// Must run from a tap: iOS only shows the permission prompt for a user gesture, so ask first, before any await.
export async function enablePush() {
  if (!pushSupported()) throw new Error(pushState() === 'install' ? "Ajoute d'abord YoungHub à l'écran d'accueil." : 'Ce navigateur ne gère pas les notifications push.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { changed(); throw new Error(perm === 'denied' ? 'Notifications refusées. Réactive-les dans Réglages → Notifications → YoungHub.' : 'Permission non accordée.'); }
  await ready;
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  if (!publicKey) publicKey = (await api.get('/api/push')).publicKey;
  const old = await reg.pushManager.getSubscription();
  if (old && !sameKey(old, publicKey)) await old.unsubscribe().catch(() => {});
  await subscribeWith(reg);
  changed();
  report(true);
}

export async function disablePush() {
  await ready;
  const sub = await reg?.pushManager.getSubscription();
  const ep = sub?.endpoint || endpoint;
  await sub?.unsubscribe().catch(() => {});
  if (ep) await api.post('/api/push/unsubscribe', { endpoint: ep }).catch(() => {});
  endpoint = null;
  changed();
  report(true);
}

export const pushStatus = () => api.get(`/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ''}`);
export const setPushPrefs = (prefs) => api.put('/api/push/prefs', { endpoint, prefs });
export const testPush = () => api.post('/api/push/test', { endpoint });

// ---------- opening a notification ----------
// URLs look like /#/ws/<id> or /#/agent/<slug>/<conversation>.
export function openUrl(url) {
  const hash = new URL(url, location.origin).hash || '#/';
  const [, kind, id, conv] = hash.split('/');
  if (kind === 'agent' && id && conv !== undefined && conv !== '') {
    try { localStorage.setItem(`supersept.conv.${id}`, conv); } catch {}
    const [, curKind, curId] = location.hash.split('/');
    // Same agent already on screen: switch its conversation in place.
    if (curKind === 'agent' && curId === id) dispatchEvent(new CustomEvent('m-open-conv', { detail: { agent: id, conversation: Number(conv) } }));
    else location.hash = `#/agent/${id}`;
    return;
  }
  location.hash = hash;
}
// Cold start from a notification (/#/agent/nami/3): pick the conversation before the screen mounts.
export function takeLaunchRoute() {
  const [, kind, id, conv] = location.hash.split('/');
  if (kind === 'agent' && id && conv) {
    try { localStorage.setItem(`supersept.conv.${id}`, conv); } catch {}
    history.replaceState(null, '', `#/agent/${id}`);
  }
}

// ---------- presence ----------
// Over /ws/events: { endpoint, visible, view: { ws } | { chat: "agent:conv" } }, on change and every 30 s.
let sock = null, last = '';
function view() {
  const chat = getViewing();
  if (chat) return { chat };
  const [, kind, id] = location.hash.split('/');
  return kind === 'ws' && id ? { ws: id } : null;
}
function report(force = false) {
  if (!sock || sock.readyState !== 1) return;
  const m = JSON.stringify({ type: 'presence', endpoint, visible: document.visibilityState === 'visible', view: view() });
  if (!force && m === last) return;
  last = m;
  sock.send(m);
}
export function attachPresence(s) {
  sock = s;
  last = '';
  report();
}
onStoreChange(() => report());
addEventListener('hashchange', () => report());
document.addEventListener('visibilitychange', () => report());
addEventListener('pagehide', () => { if (sock?.readyState === 1) sock.send(JSON.stringify({ type: 'presence', endpoint, visible: false, view: null })); });
setInterval(() => { if (document.visibilityState === 'visible') report(true); }, 30_000);
