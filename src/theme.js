// Thème : 'auto' (suit le système) | 'light' | 'dark'. Réglage mémorisé dans localStorage, appliqué avant le 1er rendu (index.html).
const KEY = 'supersept.theme';
const COLORS = { light: '#ffffff', dark: '#151110' };
const mq = matchMedia('(prefers-color-scheme: dark)');
const subs = new Set();

export function themePref() {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch {}
  return 'auto';
}
export function resolvedTheme(pref = themePref()) { return pref === 'auto' ? (mq.matches ? 'dark' : 'light') : pref; }

export function applyTheme() {
  const t = resolvedTheme();
  const root = document.documentElement;
  root.dataset.theme = t;
  root.style.colorScheme = t;
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
  m.content = COLORS[t];
  // Barre d'état iOS : "default" = texte sombre sur fond clair ; "black-translucent" = texte clair, la page passe dessous.
  const s = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (s) s.content = t === 'dark' ? 'black-translucent' : 'default';
  subs.forEach((f) => f(t));
}
export function setThemePref(p) {
  try { p === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, p); } catch {}
  applyTheme();
}
export function onTheme(f) { subs.add(f); return () => subs.delete(f); }
mq.addEventListener?.('change', () => themePref() === 'auto' && applyTheme());
