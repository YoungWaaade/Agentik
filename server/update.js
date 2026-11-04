// Built-in update: compare this checkout with main on GitHub, then pull, install, build and restart.
// Never leaves the app broken: the build goes to a side folder swapped in only once it worked,
// and a failed install or build puts the previous commit back.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const BRANCH = 'main';
export const DEFAULT_REPO = 'YoungWaaade/Agentik';
export const SERVICE = 'sh.supersept.local';
// Changes on every start: the page reloads once it sees a new one.
export const BOOT_ID = crypto.randomBytes(6).toString('hex');
const DIST_NEXT = '.dist-update';

export class UpdateError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; }
}

// owner/repo of a GitHub remote URL (https, ssh or scp form), null otherwise.
export function parseGithub(url) {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// A git network failure, told apart from the rest by its message.
export function gitFailure(stderr, repo) {
  const s = String(stderr || '');
  if (/repository .* not found|not found/i.test(s)) return new UpdateError('repo', `Dépôt GitHub introuvable (${repo}). Vérifie le remote « origin » de ta copie.`, s);
  if (/could not resolve|unable to access|timed out|connection|network|operation timed out|failed to connect|ssl/i.test(s) || !s) {
    return new UpdateError('network', 'GitHub est injoignable : vérifie ta connexion internet, puis réessaie.', s);
  }
  return new UpdateError('fetch', 'Impossible de récupérer les nouveautés depuis GitHub.', s);
}

// Files whose change means the dependencies must be installed again.
export const needsInstall = (files) => files.some((f) => f === 'package.json' || f === 'package-lock.json');

// Tracked files modified locally (untracked ones never block a fast-forward by themselves).
export const dirtyFiles = (porcelain) => porcelain.split('\n').filter((l) => l && !l.startsWith('??')).map((l) => l.slice(3).replace(/^.* -> /, ''));

const tail = (s, n = 12) => String(s || '').trim().split('\n').slice(-n).join('\n');

function run(cmd, args, { cwd = ROOT, timeout = 60_000, env } = {}) {
  return new Promise((ok) => execFile(cmd, args, { cwd, timeout, maxBuffer: 20 * 1024 * 1024, env: env || process.env }, (e, out, err) => ok({ ok: !e, out: String(out || ''), err: String(err || e?.message || '') })));
}

export function makeUpdater({ root = ROOT, restartCmd = process.env.SUPERSEPT_RESTART_CMD, log = console.log } = {}) {
  // No credential prompt can hang the server, and npm is found next to the node running us.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` };
  const git = (...args) => run('git', args, { cwd: root, env, timeout: 60_000 });
  const npm = (...args) => run('npm', args, { cwd: root, env, timeout: 15 * 60_000 });
  let job = null; // { step, error, done, from, to }

  async function isRepo() {
    const r = await git('rev-parse', '--show-toplevel');
    return r.ok && fs.realpathSync(r.out.trim()) === fs.realpathSync(root);
  }

  async function version() {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch {}
    const base = { version: pkg.version || null, git: false, bootId: BOOT_ID };
    if (!(await isRepo())) return base;
    const [head, branch, origin] = await Promise.all([
      git('log', '-1', '--format=%h%x09%H%x09%cI%x09%s'),
      git('rev-parse', '--abbrev-ref', 'HEAD'),
      git('remote', 'get-url', 'origin'),
    ]);
    const [commit, sha, date, title] = head.out.trim().split('\t');
    return { ...base, git: true, commit, sha, date, title, branch: branch.out.trim(), repo: parseGithub(origin.out) || (origin.ok ? null : DEFAULT_REPO), origin: origin.out.trim() || null };
  }

  // Fetch main into origin/main. GitHub remotes are read over anonymous https (the repo is public),
  // which also follows the redirect left by a rename (supersept → Agentik) and never asks for an ssh key.
  async function fetchMain(v) {
    const repo = v.repo || DEFAULT_REPO;
    const url = v.repo || !v.origin ? `https://github.com/${repo}.git` : 'origin';
    const r = await git('fetch', '--quiet', '--no-tags', url, `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`);
    if (!r.ok) throw gitFailure(r.err, url === 'origin' ? v.origin : repo);
  }

  async function check() {
    const v = await version();
    if (!v.git) throw new UpdateError('notgit', "Ce dossier n'est pas un dépôt git : la mise à jour intégrée ne marche que pour une installation faite avec git clone. Réinstalle Agentik avec git clone pour en profiter.");
    await fetchMain(v);
    const [behind, ahead, latest] = await Promise.all([
      git('log', '--format=%h%x09%cI%x09%s', `HEAD..origin/${BRANCH}`),
      git('rev-list', '--count', `origin/${BRANCH}..HEAD`),
      git('log', '-1', '--format=%h%x09%cI', `origin/${BRANCH}`),
    ]);
    const commits = behind.out.split('\n').filter(Boolean).map((l) => { const [sha, date, title] = l.split('\t'); return { sha, date, title }; });
    const [latestSha, latestDate] = latest.out.trim().split('\t');
    return { ...v, behind: commits.length, ahead: Number(ahead.out.trim()) || 0, commits: commits.slice(0, 50), latest: { sha: latestSha, date: latestDate }, checkedAt: Date.now() };
  }

  // Refuse before touching anything: not git, other branch, local edits, local commits.
  async function preflight() {
    const st = await check();
    if (st.branch !== BRANCH) throw new UpdateError('branch', `Ta copie est sur la branche « ${st.branch} » : la mise à jour suit ${BRANCH}. Repasse sur ${BRANCH} (git checkout ${BRANCH}) puis réessaie.`);
    const dirty = dirtyFiles((await git('status', '--porcelain')).out);
    if (dirty.length) throw new UpdateError('dirty', `Des fichiers ont été modifiés localement (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? '…' : ''}). Annule-les ou commite-les, puis réessaie : la mise à jour ne les écrasera pas.`, dirty.join('\n'));
    if (st.ahead) throw new UpdateError('diverged', `Ta copie contient ${st.ahead} commit${st.ahead > 1 ? 's' : ''} absent${st.ahead > 1 ? 's' : ''} de GitHub : mets à jour à la main (git pull).`);
    return st;
  }

  // Build into a side folder, then swap it with dist: the running app keeps its files until the build worked.
  async function build() {
    const next = path.join(root, DIST_NEXT);
    const r = await npm('run', 'build', '--', '--outDir', next, '--emptyOutDir');
    if (!r.ok) { fs.rmSync(next, { recursive: true, force: true }); return r; }
    const dist = path.join(root, 'dist');
    const old = `${dist}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(dist)) fs.renameSync(dist, old);
    fs.renameSync(next, dist);
    fs.rmSync(old, { recursive: true, force: true });
    return r;
  }

  async function rollback(from, reinstall) {
    log(`  mise à jour : retour à ${from.slice(0, 7)}`);
    await git('reset', '--hard', from);
    if (reinstall) await npm('install', '--no-audit', '--no-fund');
  }

  async function apply(st) {
    const from = (await git('rev-parse', 'HEAD')).out.trim();
    const to = (await git('rev-parse', `origin/${BRANCH}`)).out.trim();
    job.from = from; job.to = to;
    const files = (await git('diff', '--name-only', from, to)).out.split('\n').filter(Boolean);
    job.step = 'pull';
    const pull = await git('merge', '--ff-only', `origin/${BRANCH}`);
    if (!pull.ok) {
      const blocked = /untracked working tree files would be overwritten|would be overwritten/i.test(pull.err);
      throw new UpdateError('pull', blocked
        ? 'La mise à jour écraserait des fichiers locaux non suivis par git. Déplace-les puis réessaie.'
        : 'git pull a échoué : rien n\'a été modifié.', tail(pull.err));
    }
    const install = needsInstall(files);
    if (install) {
      job.step = 'install';
      const r = await npm('install', '--no-audit', '--no-fund');
      if (!r.ok) {
        job.step = 'rollback';
        await rollback(from, true);
        throw new UpdateError('install', "npm install a échoué. Agentik est revenu à la version précédente : rien n'a changé.", tail(r.err || r.out));
      }
    }
    job.step = 'build';
    const b = await build();
    if (!b.ok) {
      job.step = 'rollback';
      await rollback(from, install);
      throw new UpdateError('build', "La compilation (npm run build) a échoué. Agentik est revenu à la version précédente : rien n'a changé.", tail(b.err || b.out));
    }
    return { from, to, count: st.behind };
  }

  // Start the update in the background; its progress is read with status().
  async function start() {
    if (job && !job.done) throw new UpdateError('busy', 'Une mise à jour est déjà en cours.');
    job = { step: 'check', startedAt: Date.now() };
    let st;
    try {
      st = await preflight();
    } catch (e) {
      job = { done: true, error: describe(e) };
      throw e;
    }
    if (!st.behind) { job = { done: true, upToDate: true }; return status(); }
    apply(st).then(async (r) => {
      const restart = await restartMode();
      Object.assign(job, r, { step: restart === 'manual' ? 'manual' : 'restart', restart, done: true });
      log(`  mise à jour : ${r.from.slice(0, 7)} → ${r.to.slice(0, 7)}${restart === 'manual' ? ' (à relancer à la main)' : ', redémarrage'}`);
      // Let the page read this state first, then restart.
      if (restart !== 'manual') setTimeout(() => restartNow(restart), 1500);
    }, (e) => {
      log(`  mise à jour échouée : ${e.message}`);
      Object.assign(job, { done: true, error: describe(e) });
    });
    return status();
  }

  const status = () => ({ ...(job || { idle: true }), bootId: BOOT_ID });

  // How to restart: a configured command, launchd when this very process is the service, else the user.
  async function restartMode() {
    if (restartCmd) return 'command';
    if (process.platform !== 'darwin' || typeof process.getuid !== 'function') return 'manual';
    const r = await run('launchctl', ['print', `gui/${process.getuid()}/${SERVICE}`], { timeout: 5000 });
    const pid = /\bpid = (\d+)/.exec(r.out)?.[1];
    return r.ok && Number(pid) === process.pid ? 'launchd' : 'manual';
  }

  // A detached shell outlives this process, which launchd (or the command) kills and starts again.
  function restartNow(mode) {
    const cmd = mode === 'command' ? restartCmd : `sleep 1; launchctl kickstart -k gui/${process.getuid()}/${SERVICE}`;
    spawn('/bin/sh', ['-c', cmd], { detached: true, stdio: 'ignore', cwd: root, env: { ...process.env, AGENTIK_PID: String(process.pid) } }).unref();
  }

  return { version, check, start, status };
}

export function describe(e) {
  return e instanceof UpdateError ? { code: e.code, message: e.message, detail: e.detail || null } : { code: 'unknown', message: e.message || String(e), detail: null };
}
