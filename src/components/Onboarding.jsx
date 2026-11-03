// First-run onboarding: five short steps to set up the team lead agent, then straight into its chat.
// Also reachable from the settings (« Refaire l'onboarding »), prefilled with the current lead.
import { useEffect, useRef, useState } from 'react';
import { LuArrowLeft, LuArrowRight, LuX, LuCheck } from 'react-icons/lu';
import BotAvatar, { BOT_SHAPES, avatarSpec, randomAvatar } from './BotAvatar.jsx';
import { BotBuilder } from './AgentsPage.jsx';
import { api } from '../api.js';

const STEPS = ['Bienvenue', 'Genre', 'Nom', 'Avatar', 'Toi'];
const NAMES = { f: ['Nova', 'Iris', 'Luna', 'Maya', 'Alba'], m: ['Atlas', 'Hugo', 'Milo', 'Oscar', 'Léo'] };
const WORDS = {
  f: { il: 'elle', the: 'ta cheffe' },
  m: { il: 'il', the: 'ton chef' },
};

export default function Onboarding({ me, redo, onDone, onCancel }) {
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState('f');
  const [name, setName] = useState(NAMES.f[0]);
  const [nameTouched, setNameTouched] = useState(false);
  const [avatar, setAvatar] = useState(() => avatarSpec(randomAvatar()));
  const [firstName, setFirstName] = useState(() => String(me?.name || '').split(/\s+/)[0] || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const w = WORDS[gender];

  // Re-running it starts from the current lead, so finishing updates that agent.
  useEffect(() => {
    if (!redo) return;
    api.get('/api/onboarding').then((s) => {
      if (s.firstName) setFirstName(s.firstName);
      if (!s.lead) return;
      setName(s.lead.label);
      setNameTouched(true);
      if (s.lead.gender === 'm' || s.lead.gender === 'f') setGender(s.lead.gender);
      if (BOT_SHAPES[String(s.lead.avatar).split(',')[0]]) setAvatar(s.lead.avatar);
    }).catch(() => {});
  }, [redo]);
  useEffect(() => { input.current?.focus(); }, [step]);

  const pickGender = (g) => {
    setGender(g);
    if (!nameTouched) setName(NAMES[g][0]);
  };
  const canNext = step !== 2 || name.trim();
  const last = step === STEPS.length - 1;
  const next = async () => {
    if (!canNext || busy) return;
    if (!last) return setStep(step + 1);
    setBusy(true);
    setError(null);
    try {
      onDone(await api.post('/api/onboarding', { gender, name: name.trim(), avatar, firstName: firstName.trim() }));
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'BUTTON') { e.preventDefault(); next(); } };

  return (
    <div className="onboarding" onKeyDown={onKey}>
      {onCancel && <button className="sb-iconbtn onb-close" title="Fermer" onClick={onCancel}><LuX size={16} /></button>}
      <div className="onb-card">
        <ol className="onb-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
              <span className="onb-dot">{i < step ? <LuCheck size={11} /> : i + 1}</span>{s}
            </li>
          ))}
        </ol>

        <div className="onb-body" key={step}>
          {step === 0 && (
            <>
              <div className="onb-hero">
                {Object.keys(BOT_SHAPES).map((s) => <BotAvatar key={s} spec={s} size={40} />)}
              </div>
              <h1>{redo ? "On reconfigure ton agent chef d'équipe" : 'Bienvenue dans Agentic'}</h1>
              <p>Agentic réunit tes sessions Claude Code et une équipe d'agents. Commençons par {w.the} d'équipe : {w.il} reçoit toutes tes demandes, les confie à l'agent le plus adapté ou lance une session, puis te fait la synthèse.</p>
              <p className="muted small">Cinq étapes, une minute. Tout reste modifiable ensuite dans Agents.</p>
            </>
          )}

          {step === 1 && (
            <>
              <h1>Une cheffe ou un chef d'équipe ?</h1>
              <p>Ça règle les accords de ses messages : prête ou prêt, organisée ou organisé…</p>
              <div className="onb-choices">
                {[['f', "Une cheffe d'équipe", '« Je suis prête, quelle est la mission ? »'], ['m', "Un chef d'équipe", '« Je suis prêt, quelle est la mission ? »']].map(([g, label, quote]) => (
                  <button key={g} type="button" className={`onb-choice ${gender === g ? 'on' : ''}`} onClick={() => pickGender(g)}>
                    <strong>{label}</strong>
                    <span className="muted">{quote}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1>Comment s'appelle {w.the} ?</h1>
              <p>C'est le nom affiché dans la barre latérale et dans le chat.</p>
              <input ref={input} className="onb-input" value={name} maxLength={40} placeholder={NAMES[gender][0]}
                onChange={(e) => { setName(e.target.value); setNameTouched(true); }} />
              <div className="onb-suggest">
                {NAMES[gender].map((n) => (
                  <button key={n} type="button" className={`chip ${name === n ? 'on' : ''}`} onClick={() => { setName(n); setNameTouched(true); }}>{n}</button>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1>À quoi ressemble {name.trim()} ?</h1>
              <p>Choisis une forme et une couleur, ou laisse le hasard faire.</p>
              <BotBuilder spec={avatar} seed={name} onChange={setAvatar} />
            </>
          )}

          {step === 4 && (
            <>
              <div className="onb-hero"><BotAvatar spec={avatar} size={64} /></div>
              <h1>Et toi, comment t'appelles-tu ?</h1>
              <p>{name.trim()} t'appellera par ton prénom.</p>
              <input ref={input} className="onb-input" value={firstName} maxLength={60} placeholder="Ton prénom" onChange={(e) => setFirstName(e.target.value)} />
              {error && <div className="error-bar">{error}</div>}
            </>
          )}
        </div>

        <div className="onb-foot">
          <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)} disabled={step === 0 || busy}><LuArrowLeft size={14} /> Retour</button>
          <span className="flex-1" />
          <button type="button" className="btn-primary" onClick={next} disabled={!canNext || busy}>
            {last ? <>{busy ? 'Création…' : redo ? `Enregistrer ${name.trim()}` : `Rencontrer ${name.trim()}`} <LuCheck size={14} /></> : <>{step === 0 ? 'Commencer' : 'Suivant'} <LuArrowRight size={14} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
