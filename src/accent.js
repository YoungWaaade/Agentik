// Accent colour of the interface (Réglages → Apparence). Saved on the server (~/.claude-hub/appearance.json) so the
// Mac and the phone share it; cached in localStorage with its computed tokens so index.html can apply it before the
// first paint. null = Agentik's default orange: no inline token at all, styles.css stays in charge.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { activeTheme, onThemeChange } from './theme.js';
import { accentVars, normalizeAccent } from './accentColors.js';

const KEY = 'agentik-accent';
const TOKENS = Object.keys(accentVars('#000000', 'dark'));
const subs = new Set();

function cached() {
  try { return normalizeAccent(JSON.parse(localStorage.getItem(KEY))?.accent); } catch { return null; }
}
let current = cached();

function apply() {
  const root = document.documentElement.style;
  const vars = accentVars(current, activeTheme());
  for (const k of TOKENS) vars ? root.setProperty(k, vars[k]) : root.removeProperty(k);
  subs.forEach((f) => f(current));
}

function remember(accent) {
  current = normalizeAccent(accent);
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify({ accent: current, vars: { dark: accentVars(current, 'dark'), light: accentVars(current, 'light') } }));
    else localStorage.removeItem(KEY);
  } catch {}
  apply();
}

// What the server says (page load, or another device changed it).
export function syncAccent(accent) {
  if (normalizeAccent(accent) !== current) remember(accent);
}
export async function setAccent(accent) {
  remember(accent);
  const r = await api.put('/api/appearance', { accent: current });
  syncAccent(r.accent);
}

export const accentNow = () => current;
export function onAccentChange(f) { subs.add(f); return () => subs.delete(f); }
export const useAccent = () => useSyncExternalStore(onAccentChange, accentNow);

onThemeChange(apply);
apply();
