// Questions Claude Code asks in the terminal before a session can start.
// Claude Code 2.1.326: every --add-dir folder never trusted before asks, at each launch (the answer
// holds for that session only): "Adding a new directory: <dir> … This session hasn't worked here before.
// … ❯ No, exit / Yes, add it". "No, exit" comes first and is selected: a message pasted there followed by
// Enter quits Claude. Agentik passes its own folders (memory, prompts): those are accepted at once.

// The terminal redraws with cursor moves instead of spaces: compare without any whitespace.
const squash = (t) => String(t || '').replace(/\s+/g, '');
const MARK = 'Addinganewdirectory:';
// What follows the folder on screen: the rest of the question (no space left to tell where the path ends).
const AFTER = '(?:Thissession|Claude|Its|Security|No,exit|Yes,addit|─|$)';
const END = new RegExp(AFTER);

// The folder named by the last "Adding a new directory" question on screen, or null.
// own: one of `ownDirs` (Agentik's folders); dir: the folder as shown.
export function addDirAsked(screen, ownDirs = []) {
  const flat = squash(screen);
  const at = flat.lastIndexOf(MARK);
  if (at < 0) return null;
  const rest = flat.slice(at + MARK.length);
  // Not drawn up to the choices yet: wait for the rest of the question.
  if (!/Yes,addit/.test(rest)) return null;
  const own = ownDirs.find((d) => squash(d) && rest.startsWith(squash(d)) && new RegExp(`^${AFTER}`).test(rest.slice(squash(d).length)));
  if (own) return { dir: own, own: true };
  const m = rest.match(END);
  const dir = rest.slice(0, m ? m.index : 200);
  return dir ? { dir, own: false } : null;
}

// Terminal output as comparable text: escape sequences out, no whitespace.
export const squashScreen = (raw) => squash(String(raw || '').replace(/\x1b\[[0-9;?<>]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, ''));

export const isFolderTrustAsked = (screen) => /trust\s*this\s*folder/i.test(screen);
