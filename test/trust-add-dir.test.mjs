import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDirAsked, isFolderTrustAsked } from '../server/trust.js';

// Claude Code 2.1.326 asks for each --add-dir folder at every launch; Agentik answers for its own folders.
const own = ['/Users/me/.claude-hub/memory', '/Users/me/.claude-hub/prompts'];
// As read from a stuck session (cursor moves instead of spaces, ANSI already stripped).
const screen = (dir) => `────────────\nAddinganewdirectory:\n${dir}\nThissessionhasn'tworkedherebefore.Isthisadirectoryyoucreatedoroneyoutrust?\nClaudeCode'llbeabletoread,edit,andexecutefileshere.\nSecurity guide\n❯No,exit\nYes,addit\nEntertoconfirm·Esctocancel`;

test('own folders are recognised, spaced or not', () => {
  assert.deepEqual(addDirAsked(screen('/Users/me/.claude-hub/memory'), own), { dir: own[0], own: true });
  assert.deepEqual(addDirAsked(screen('/Users/me/.claude-hub/prompts'), own), { dir: own[1], own: true });
  const spaced = 'Adding a new directory:\n /Users/me/.claude-hub/memory\n This session hasn\'t worked here before.\n ❯ No, exit\n   Yes, add it';
  assert.equal(addDirAsked(spaced, own).own, true);
});

test('the last question on screen wins (memory answered, prompts asked next)', () => {
  assert.equal(addDirAsked(screen(own[0]) + '\n' + screen(own[1]), own).dir, own[1]);
});

test('another folder, or a look-alike path, is not ours', () => {
  assert.deepEqual(addDirAsked(screen('/Users/me/secret'), own), { dir: '/Users/me/secret', own: false });
  assert.equal(addDirAsked(screen('/Users/me/.claude-hub/memory2'), own).own, false);
  assert.equal(addDirAsked(screen('/Users/me/.claude-hub/memory/sub'), own).own, false);
});

test('not asked, or not drawn up to the choices yet', () => {
  assert.equal(addDirAsked('╭ Claude Code ╮\n> ', own), null);
  assert.equal(addDirAsked('Adding a new directory:\n/Users/me/.claude-hub/memory\nThis session', own), null);
});

test('folder trust question still detected', () => {
  assert.ok(isFolderTrustAsked('❯ 1. Yes, I trust this folder'));
  assert.ok(!isFolderTrustAsked(screen(own[0])));
});

test('squashScreen: escape sequences and whitespace out', async () => {
  const { squashScreen } = await import('../server/trust.js');
  assert.equal(squashScreen('\x1b[2K\x1b[1G❯ \x1b[36mYes, add it\x1b[39m\r\n'), '❯Yes,addit');
});
