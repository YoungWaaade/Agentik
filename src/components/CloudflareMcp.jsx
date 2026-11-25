// Connects the company's Cloudflare MCP Portal (Claude Code server "cloudflare", user scope).
// Used by the onboarding (optional step) and Settings > Intégrations. The API token, if any, is
// write-only here: the server only says whether one is saved.
import { useEffect, useState } from 'react';
import { LuLoaderCircle, LuPlugZap, LuUnplug, LuCheck } from 'react-icons/lu';
import { api } from '../api.js';

const STATES = {
  connected: ['green', 'Connecté'],
  auth: ['amber', 'Authentification requise'],
  reachable: ['green', 'Joignable'],
  error: ['red', 'Erreur'],
};

// saveRef (onboarding): set to an async function that saves a typed URL, true when it is fine to go on.
export default function CloudflareMcp({ saveRef, autoTest = true, inOnboarding = false }) {
  const [cfg, setCfg] = useState(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(null); // 'save' | 'test' | 'off'
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runTest = async (u) => {
    setBusy('test');
    setError(null);
    try { setResult(await api.post('/api/integrations/cloudflare/test', u ? { url: u } : {})); }
    catch (e) { setResult({ state: 'error', message: e.message }); }
    finally { setBusy(null); }
  };

  useEffect(() => {
    api.get('/api/integrations/cloudflare').then((s) => {
      setCfg(s);
      setUrl(s.url || '');
      if (s.configured && autoTest) runTest();
    }).catch((e) => setError(e.message));
  }, []);

  const dirty = !!cfg && (url.trim() !== (cfg.url || '') || !!token.trim());
  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const s = await api.put('/api/integrations/cloudflare', { url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) });
      setCfg(s);
      setUrl(s.url);
      setToken('');
      setShowToken(false);
      setBusy(null);
      await runTest();
      return true;
    } catch (e) { setError(e.message); setBusy(null); return false; }
  };
  const clearToken = async () => {
    setBusy('save');
    try { setCfg(await api.put('/api/integrations/cloudflare', { url: cfg.url, clearToken: true })); setResult(null); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };
  const disconnect = async () => {
    if (!confirm('Déconnecter le portail MCP Cloudflare ? Les sessions et les agents n\'auront plus ses outils.')) return;
    setBusy('off');
    try { const s = await api.del('/api/integrations/cloudflare'); setCfg(s); setUrl(''); setResult(null); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  if (saveRef) saveRef.current = async () => (dirty && url.trim() ? save() : true);

  if (!cfg) return error ? <div className="error-bar">{error}</div> : null;
  const [tone, label] = result ? STATES[result.state] || STATES.error : cfg.configured ? ['', 'Enregistré'] : ['', 'Non connecté'];
  return (
    <div className="cf-mcp">
      <div className="cf-mcp-head">
        <span className={`tag ${tone}`} data-state={result?.state || (cfg.configured ? 'saved' : 'off')}>{busy === 'test' ? 'Test…' : label}</span>
        {cfg.configured && <code className="fade-r" title={cfg.url}>{cfg.url}</code>}
        {cfg.hasToken && <span className="tag">jeton d'API</span>}
      </div>
      <label className="cf-mcp-label" htmlFor="cf-mcp-url">URL du portail MCP</label>
      <input id="cf-mcp-url" className="cf-mcp-input" type="url" inputMode="url" spellCheck={false} autoComplete="off" value={url}
        placeholder="https://mcp-portal.ton-entreprise.com/mcp" onChange={(e) => { setUrl(e.target.value); setResult(null); }} />
      <span className="muted small">Donnée par l'admin Cloudflare de ton entreprise. Elle doit commencer par https://.</span>

      {showToken ? (
        <>
          <label className="cf-mcp-label" htmlFor="cf-mcp-token">Jeton d'API (optionnel)</label>
          <input id="cf-mcp-token" className="cf-mcp-input" type="password" autoComplete="off" value={token}
            placeholder={cfg.hasToken ? 'Laisser vide pour garder le jeton enregistré' : 'Seulement si l\'admin t\'en a donné un'} onChange={(e) => setToken(e.target.value)} />
          <span className="muted small">Gardé sur ce Mac seulement (~/.claude-hub/secrets, lisible par toi seul), jamais affiché ni partagé. Sans jeton, la connexion se fait par ton compte (OAuth), c'est le plus simple.</span>
        </>
      ) : (
        <span className="cf-mcp-links">
          <button type="button" className="link-btn" onClick={() => setShowToken(true)}>{cfg.hasToken ? 'Changer le jeton d\'API' : 'J\'ai un jeton d\'API'}</button>
          {cfg.hasToken && <button type="button" className="link-btn" onClick={clearToken} disabled={!!busy}>Revenir à la connexion par compte (OAuth)</button>}
        </span>
      )}

      <div className="cf-mcp-actions">
        <button type="button" className="btn-ghost" onClick={() => runTest(url.trim() || undefined)} disabled={!!busy || !url.trim()}>
          {busy === 'test' ? <LuLoaderCircle size={13} className="spin" /> : <LuPlugZap size={13} />} Tester
        </button>
        <button type="button" className="btn-ghost" onClick={save} disabled={!!busy || !dirty || !url.trim()}>
          {busy === 'save' ? <LuLoaderCircle size={13} className="spin" /> : <LuCheck size={13} />} {cfg.configured ? 'Enregistrer' : 'Connecter'}
        </button>
        <span className="flex-1" />
        {cfg.configured && (
          <button type="button" className="btn-ghost danger" onClick={disconnect} disabled={!!busy}>
            <LuUnplug size={13} /> Déconnecter
          </button>
        )}
      </div>
      {result && <div className={`cf-mcp-result ${STATES[result.state]?.[0] || 'red'}`} role="status">{result.message}</div>}
      {cfg.configured && !cfg.hasToken && result?.state !== 'connected' && (
        <div className="cf-mcp-howto">
          <strong>Pour finir la connexion</strong>
          <ol>
            <li>Ouvre une session Claude Code (Nouvel espace de travail, ou un terminal).</li>
            <li>Tape <kbd>/mcp</kbd> puis Entrée.</li>
            <li>Choisis <strong>cloudflare</strong>, puis <strong>Authenticate</strong>.</li>
            <li>Connecte-toi dans le navigateur qui s'ouvre, puis reviens ici.</li>
            <li>Clique sur <strong>Tester</strong> : tu dois voir « Connecté ».</li>
          </ol>
          <span className="muted small">À faire une seule fois : ensuite, toutes tes sessions et tes agents ont accès aux outils.{inOnboarding && ' Tu peux aussi terminer l\'onboarding d\'abord et revenir tester depuis Réglages > Intégrations.'}</span>
        </div>
      )}
      {error && <div className="error-bar" onClick={() => setError(null)}>{error}</div>}
    </div>
  );
}
