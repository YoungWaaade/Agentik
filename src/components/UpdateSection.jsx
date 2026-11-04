import { useEffect, useRef, useState } from 'react';

// Errors keep their code and git/npm output, which api.js drops.
async function call(method, url) {
  const res = await fetch(url, { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || res.statusText), { code: data.code, detail: data.detail });
  return data;
}

const STEPS = {
  check: 'Vérification…',
  pull: 'Téléchargement des nouveautés…',
  install: 'Installation des dépendances (npm install)…',
  build: "Compilation de l'interface…",
  rollback: 'Échec, retour à la version précédente…',
  restart: "Redémarrage d'Agentik…",
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Version installed, check against main on GitHub, and a one-click update that reloads the page once restarted.
export function UpdateSection() {
  const [v, setV] = useState(null);
  const [st, setSt] = useState(null); // result of the last check
  const [phase, setPhase] = useState(null); // null | 'checking' | step of the running update | 'manual' | 'timeout'
  const [error, setError] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    call('GET', '/api/update/version').then(setV).catch((e) => setError({ message: e.message }));
    // The page was reloaded in the middle of an update: follow it again.
    call('GET', '/api/update/status').then((s) => { if (s.step && !s.done) follow(s.bootId); }).catch(() => {});
    return () => { alive.current = false; };
  }, []);

  const check = async () => {
    setPhase('checking'); setError(null);
    try { setSt(await call('GET', '/api/update/check')); } catch (e) { setError(e); }
    setPhase(null);
  };

  // Once the server restarted (new boot id), reload to load the new interface.
  const reloadWhenBack = async (bootId) => {
    const until = Date.now() + 3 * 60_000;
    while (alive.current && Date.now() < until) {
      await wait(1000);
      try {
        const h = await call('GET', '/api/health');
        if (h.bootId !== bootId) return location.reload();
      } catch {}
    }
    if (alive.current) setPhase('timeout');
  };

  const follow = async (bootId) => {
    setPhase('check');
    while (alive.current) {
      let s;
      try { s = await call('GET', '/api/update/status'); } catch { return reloadWhenBack(bootId); }
      if (s.bootId !== bootId) return location.reload();
      if (s.error) { setPhase(null); setError(s.error); return; }
      if (s.upToDate) { setPhase(null); return check(); }
      setPhase(s.step);
      if (s.done && s.restart === 'manual') { setPhase('manual'); return reloadWhenBack(bootId); }
      if (s.done) return reloadWhenBack(bootId);
      await wait(1000);
    }
  };

  const update = async () => {
    setError(null); setPhase('check');
    try {
      const s = await call('POST', '/api/update');
      if (s.upToDate) { setPhase(null); return check(); }
      follow(s.bootId);
    } catch (e) { setPhase(null); setError(e); }
  };

  const running = phase && phase !== 'checking' && phase !== 'manual' && phase !== 'timeout';
  return (
    <section>
      <h2>Mise à jour</h2>
      <div className="settings-row">
        <span>Version installée</span>
        <code>{v ? [v.version && `v${v.version}`, v.commit, day(v.date)].filter(Boolean).join(' · ') : '…'}</code>
      </div>
      {v && !v.git ? (
        <p className="update-note">Ce dossier n'est pas un dépôt git : réinstalle Agentik avec <code>git clone</code> pour profiter des mises à jour intégrées.</p>
      ) : (
        <div className="settings-row">
          <span>
            {!st ? `Comparer avec la dernière version sur GitHub${v?.repo ? ` (${v.repo})` : ''}`
              : st.behind ? `${st.behind} commit${st.behind > 1 ? 's' : ''} en retard sur GitHub`
                : 'Agentik est à jour'}
            {st && <span className="muted"> — vérifié à {new Date(st.checkedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
          </span>
          <span className="settings-row-actions">
            {st && !st.behind && !running && <span className="tag green">à jour</span>}
            {st?.behind > 0 && !running && phase !== 'manual' && <button className="btn-primary" onClick={update}>Mettre à jour</button>}
            {!running && phase !== 'manual' && <button className="btn-ghost" disabled={phase === 'checking'} onClick={check}>{phase === 'checking' ? 'Vérification…' : 'Vérifier les mises à jour'}</button>}
          </span>
        </div>
      )}
      {st?.behind > 0 && !running && (
        <ul className="update-commits">
          {st.commits.map((c) => <li key={c.sha}><code>{c.sha}</code><span>{c.title}</span><span className="muted">{day(c.date)}</span></li>)}
          {st.behind > st.commits.length && <li className="muted">… et {st.behind - st.commits.length} de plus</li>}
        </ul>
      )}
      {running && <p className="update-progress"><span className="update-spin" />Mise à jour en cours… {STEPS[phase] || ''}<span className="muted"> La page se rechargera toute seule.</span></p>}
      {phase === 'manual' && <p className="update-note">Mise à jour installée. Relance Agentik pour l'appliquer (<code>npm run serve</code>, ou ton lanceur habituel) : la page se rechargera dès qu'il répond.</p>}
      {phase === 'timeout' && <p className="update-error">Agentik ne répond pas depuis 3 minutes. Relance-le (<code>npm run service</code>) puis recharge la page.</p>}
      {error && (
        <div className="update-error">
          {error.message}
          {error.detail && <details><summary>Détails</summary><pre>{error.detail}</pre></details>}
        </div>
      )}
    </section>
  );
}
