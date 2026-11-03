// Light / dark theme. The choice ('light', 'dark' or 'system') lives in localStorage; index.html
// applies it before the first paint, this module keeps it in sync afterwards (and follows the OS
// live in 'system' mode). Colours themselves are CSS tokens in styles.css.
import { useSyncExternalStore } from 'react';

const KEY = 'agentik-theme';
export const THEME_PREFS = [['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système']];
// Status bar / browser chrome colour: the background (dark) or the header grey (light).
const CHROME = { dark: '#151110', light: '#f2f2f7' };
const media = matchMedia('(prefers-color-scheme: light)');
const subs = new Set();

export function themePref() {
  try {
    const v = localStorage.getItem(KEY);
    return THEME_PREFS.some(([k]) => k === v) ? v : 'dark';
  } catch { return 'dark'; }
}
const resolve = (pref) => (pref === 'system' ? (media.matches ? 'light' : 'dark') : pref);
let current = resolve(themePref());

function apply() {
  current = resolve(themePref());
  document.documentElement.dataset.theme = current;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[current]);
  // iOS reads this one at launch: dark text on the light theme, white text over the dark one.
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', current === 'light' ? 'default' : 'black-translucent');
  subs.forEach((f) => f(current));
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch {}
  apply();
}

// The theme actually shown ('light' or 'dark').
export const activeTheme = () => current;
export function onThemeChange(f) { subs.add(f); return () => subs.delete(f); }
export const useTheme = () => useSyncExternalStore(onThemeChange, activeTheme);
export const useThemePref = () => useSyncExternalStore(onThemeChange, themePref);

media.addEventListener('change', () => themePref() === 'system' && apply());
// Another tab or the installed app changed it.
addEventListener('storage', (e) => e.key === KEY && apply());
apply();
