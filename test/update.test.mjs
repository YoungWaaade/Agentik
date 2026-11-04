import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseGithub, gitFailure, needsInstall, dirtyFiles, makeUpdater } from '../server/update.js';

test('owner/repo is read from every GitHub remote form', () => {
  assert.equal(parseGithub('https://github.com/YoungWaaade/Agentik.git'), 'YoungWaaade/Agentik');
  assert.equal(parseGithub('https://github.com/YoungWaaade/supersept'), 'YoungWaaade/supersept');
  assert.equal(parseGithub('git@github.com:YoungWaaade/Agentik.git'), 'YoungWaaade/Agentik');
  assert.equal(parseGithub('ssh://git@github.com/YoungWaaade/Agentik.git\n'), 'YoungWaaade/Agentik');
  assert.equal(parseGithub('https://gitlab.com/a/b.git'), null);
  assert.equal(parseGithub('/tmp/repo.git'), null);
});

test('git failures are told apart', () => {
  assert.equal(gitFailure("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com", 'a/b').code, 'network');
  assert.equal(gitFailure('remote: Repository not found.\nfatal: repository not found', 'a/b').code, 'repo');
  assert.equal(gitFailure('', 'a/b').code, 'network');
});

test('only package.json and the lock file trigger npm install', () => {
  assert.ok(needsInstall(['src/App.jsx', 'package-lock.json']));
  assert.ok(!needsInstall(['src/package.json.md', 'README.md']));
});

test('untracked files do not count as local edits', () => {
  assert.deepEqual(dirtyFiles(' M server/index.js\n?? notes.txt\nR  a.js -> b.js\n'), ['server/index.js', 'b.js']);
});

// A local "GitHub": a bare repo with a clone one commit behind it.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-update-'));
  const sh = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString();
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  sh(src, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(src, 'package.json'), '{"version":"1.2.3"}');
  sh(src, 'add', '.'); sh(src, 'commit', '-qm', 'first');
  sh(dir, 'clone', '-q', '--bare', src, 'origin.git');
  sh(dir, 'clone', '-q', path.join(dir, 'origin.git'), 'app');
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');
  sh(src, 'add', '.'); sh(src, 'commit', '-qm', 'Second commit');
  sh(src, 'push', '-q', path.join(dir, 'origin.git'), 'main');
  return { dir, app: path.join(dir, 'app'), sh };
}

test('check counts the commits behind main, with their titles', async () => {
  const { dir, app } = fixture();
  const st = await makeUpdater({ root: app, log() {} }).check();
  assert.equal(st.version, '1.2.3');
  assert.equal(st.behind, 1);
  assert.equal(st.ahead, 0);
  assert.equal(st.commits[0].title, 'Second commit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an update is refused with local edits, and when the remote is unreachable', async () => {
  const { dir, app, sh } = fixture();
  fs.writeFileSync(path.join(app, 'package.json'), '{"version":"9"}');
  await assert.rejects(makeUpdater({ root: app, log() {} }).start(), { code: 'dirty' });
  sh(app, 'checkout', '-q', '--', 'package.json');
  sh(app, 'remote', 'set-url', 'origin', path.join(dir, 'missing.git'));
  await assert.rejects(makeUpdater({ root: app, log() {} }).check(), (e) => ['repo', 'fetch', 'network'].includes(e.code));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a folder that is not a git checkout says so', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentik-nogit-'));
  const u = makeUpdater({ root: dir, log() {} });
  assert.equal((await u.version()).git, false);
  await assert.rejects(u.check(), { code: 'notgit' });
  fs.rmSync(dir, { recursive: true, force: true });
});
