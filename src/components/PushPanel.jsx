// "Notifications" on this device: Web Push (lock screen, app closed). Desktop settings section and phone screen.
import { useEffect, useState } from 'react';
import { LuBell, LuBellOff, LuChevronLeft, LuShare, LuSquarePlus } from 'react-icons/lu';
import { pushState, onPushChange, enablePush, disablePush, pushStatus, setPushPrefs, testPush, isIOS } from '../push.js';

export function usePush() {
  const [state, setState] = useState(pushState);
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  useEffect(() => onPushChange(() => setState(pushState())), []);
  useEffect(() => { if (state === 'on') pushStatus().then((s) => setPrefs(s.prefs)).catch(() => {}); }, [state]);
  const run = (f, ok) => async () => {
    setBusy(true);
    setMsg(null);
    try { await f(); if (ok) setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
    setState(pushState());
  };
  return {
    state, prefs, busy, msg,
    // Not wrapped in anything async before the call: the permission prompt needs the tap's user gesture.
    enable: run(async () => { await enablePush(); await testPush(); }, 'Notifications activées : une notif de test vient d\'être envoyée.'),
    disable: run(disablePush),
    test: run(testPush, 'Notif de test envoyée : regarde l\'écran verrouillé ou le haut de l\'écran.'),
    toggle: (k) => run(async () => setPrefs((await setPushPrefs({ [k]: !prefs?.[k] })).prefs))(),
  };
}

const PREFS = [
  ['sessions', 'Sessions', 'Une session a terminé, attend ta réponse ou a une erreur'],
  ['agents', 'Agents', 'Un agent (Nami…) t’a répondu dans une de tes conversations'],
];

// Desktop: Réglages → Notifications.
export function PushSettings() {
  const p = usePush();
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  return (
    <section>
      <h2>Notifications</h2>
      <div className="settings-row">
        <span>Prévenir dans ce navigateur quand une session a fini ou attend une réponse (onglet ouvert)</span>
        {perm === 'granted' ? <span className="tag green">activées</span> : (
          <button className="btn-ghost" onClick={() => Notification.requestPermission().then(setPerm)} disabled={perm === 'unsupported'}>Activer</button>
        )}
      </div>
      <div className="settings-row">
        <span>Notifications push sur cet appareil, même Supersept fermé (sur iPhone : depuis l'app ajoutée à l'écran d'accueil)</span>
        {p.state === 'on' ? (
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn-ghost" disabled={p.busy} onClick={p.test}>Tester</button>
            <button className="btn-ghost" disabled={p.busy} onClick={p.disable}>Désactiver</button>
          </span>
        ) : p.state === 'off' ? <button className="btn-ghost" disabled={p.busy} onClick={p.enable}>Activer</button>
          : <span className="tag">{p.state === 'denied' ? 'refusées par le navigateur' : 'non disponibles ici'}</span>}
      </div>
      {p.state === 'on' && p.prefs && PREFS.map(([k, label, hint]) => (
        <div key={k} className="settings-row">
          <span>{label} — <span style={{ color: 'var(--muted-foreground)' }}>{hint}</span></span>
          <button className="btn-ghost" disabled={p.busy} onClick={() => p.toggle(k)}>{p.prefs[k] ? 'Activé' : 'Désactivé'}</button>
        </div>
      ))}
      {p.msg && <div className="settings-row"><span style={p.msg.ok ? null : { color: 'var(--red-400)' }}>{p.msg.text}</span></div>}
    </section>
  );
}

// Phone: the bell in the header opens this screen (#/notifs).
export function PushScreen({ go }) {
  const p = usePush();
  return (
    <>
      <header className="m-head">
        <button className="m-iconbtn" onClick={() => (history.length > 1 ? history.back() : go({ kind: 'agents' }))} aria-label="Retour"><LuChevronLeft size={22} /></button>
        <h1>Notifications</h1>
      </header>
      <div className="m-scroll m-form">
        {p.state === 'install' && (
          <div className="m-push-card">
            <strong>Ajoute d'abord Supersept à l'écran d'accueil</strong>
            <p>Sur iPhone, les notifications ne marchent que depuis l'app installée :</p>
            <ol>
              <li>Dans Safari, touche <LuShare size={15} /> <b>Partager</b></li>
              <li>Choisis <LuSquarePlus size={15} /> <b>Sur l'écran d'accueil</b>, puis <b>Ajouter</b></li>
              <li>Ouvre Supersept depuis sa nouvelle icône et reviens ici</li>
            </ol>
          </div>
        )}
        {p.state === 'unsupported' && (
          <div className="m-push-card">
            <strong>Notifications push non disponibles</strong>
            <p>{isIOS ? 'Il faut iOS 16.4 ou plus récent (Réglages → Général → Mise à jour logicielle).' : 'Ce navigateur ne gère pas les notifications push (ou la page n\'est pas en HTTPS).'}</p>
          </div>
        )}
        {p.state === 'denied' && (
          <div className="m-push-card">
            <strong>Notifications refusées</strong>
            <p>Réactive-les dans Réglages → Notifications → Supersept, puis reviens ici.</p>
          </div>
        )}
        {p.state === 'off' && (
          <>
            <p className="m-push-lead">Sois prévenu sur l'écran verrouillé quand une session a terminé ou attend ta réponse, et quand Nami ou un autre agent te répond, même Supersept fermé.</p>
            <button className="m-primary" disabled={p.busy} onClick={p.enable}><LuBell size={18} /> {p.busy ? 'Activation…' : 'Activer les notifications'}</button>
          </>
        )}
        {p.state === 'on' && (
          <>
            <p className="m-push-lead"><span className="tag green">activées</span> sur cet iPhone. Pas de notif pour la conversation ou la session que tu as déjà à l'écran.</p>
            <h2 className="m-section">Me prévenir pour</h2>
            {p.prefs && PREFS.map(([k, label, hint]) => (
              <button key={k} className="m-push-pref" disabled={p.busy} onClick={() => p.toggle(k)}>
                <span><strong>{label}</strong><span>{hint}</span></span>
                <span className={`m-switch ${p.prefs[k] ? 'on' : ''}`} />
              </button>
            ))}
            <button className="m-primary" disabled={p.busy} onClick={p.test}>Envoyer une notif de test</button>
            <button className="m-secondary" disabled={p.busy} onClick={p.disable}><LuBellOff size={16} /> Désactiver sur cet appareil</button>
          </>
        )}
        {p.msg && <p className={p.msg.ok ? 'm-push-ok' : 'error-bar'}>{p.msg.text}</p>}
      </div>
    </>
  );
}

// Header bell of the phone home screens, with a dot while notifications are off.
export function PushBell({ go }) {
  const { state } = usePush();
  return (
    <button className="m-iconbtn m-bell" onClick={() => go({ kind: 'notifs' })} aria-label="Notifications">
      {state === 'on' ? <LuBell size={19} /> : <LuBellOff size={19} />}
      {state !== 'on' && <span className="m-bell-dot" />}
    </button>
  );
}

// Once, at the top of the phone home screens, until enabled or dismissed.
export function PushCallout({ go }) {
  const { state } = usePush();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('push-callout-hidden') === '1'; } catch { return false; } });
  if (hidden || state === 'on' || state === 'unsupported') return null;
  const hide = (e) => { e.stopPropagation(); setHidden(true); try { localStorage.setItem('push-callout-hidden', '1'); } catch {} };
  return (
    <div className="m-push-callout" role="button" onClick={() => go({ kind: 'notifs' })}>
      <LuBell size={18} />
      <span><strong>Active les notifications</strong>{state === 'install' ? 'Ajoute d\'abord Supersept à l\'écran d\'accueil' : 'Sessions terminées et réponses des agents, sur l\'écran verrouillé'}</span>
      <button onClick={hide} aria-label="Masquer">✕</button>
    </div>
  );
}
