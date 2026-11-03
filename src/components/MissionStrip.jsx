// Live strip above the composer: who this conversation has put to work (agents given a mission, sessions
// it launched) and how it's going. Fed by /api/agents/:slug/conversations/:n/missions (see chatStore).
import { useEffect, useState } from 'react';
import { LuCheck, LuX, LuTerminal, LuChevronUp } from 'react-icons/lu';
import { api, ago } from '../api.js';
import { useMissions } from '../chatStore.js';
import BotAvatar from './BotAvatar.jsx';

const SHOW_DONE = 10000; // a finished mission stays this long, then leaves
const FADE = 600;
const MAX = 3; // beyond this many, the rest folds into a "+N" chip
const STATE = {
  running: 'en cours',
  waiting: 'en attente',
  done: 'terminé',
  error: 'erreur',
};
const dismissed = new Set(); // errors the user closed

export default function MissionStrip({ agent, conversation, go }) {
  const { missions, skew } = useMissions(agent, conversation);
  const [expanded, setExpanded] = useState(false);
  const [, tick] = useState(0);
  const now = Date.now() - skew;
  const shown = missions.filter((m) => !(m.state === 'done' && now - m.since >= SHOW_DONE) && !(m.state === 'error' && dismissed.has(`${m.key}:${m.since}`)));
  // Re-render while finished missions count down.
  const counting = shown.some((m) => m.state === 'done');
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => tick((n) => n + 1), 300);
    return () => clearInterval(t);
  }, [counting]);
  useEffect(() => { if (shown.length <= MAX + 1) setExpanded(false); }, [shown.length <= MAX + 1]);
  if (!shown.length) return null;

  const fold = !expanded && shown.length > MAX + 1;
  const list = fold ? shown.slice(0, MAX) : shown;
  const rest = shown.slice(MAX);
  const active = shown.filter((m) => m.state === 'running' || m.state === 'waiting').length;
  const open = async (m) => {
    if (m.kind === 'session') return go({ kind: 'ws', id: m.workspace });
    localStorage.setItem(`supersept.conv.${m.agent}`, String(m.conversation));
    await api.patch(`/api/agents/${m.agent}/conversations/${m.conversation}`, { open: true }).catch(() => {});
    go({ kind: 'agent', id: m.agent });
  };
  return (
    <div className={`missions ${expanded ? 'expanded' : ''}`} role="status" aria-label={`${active} mission${active > 1 ? 's' : ''} en cours`}>
      {list.map((m) => {
        const leaving = m.state === 'done' && now - m.since > SHOW_DONE - FADE;
        const title = `${m.label}${m.kind === 'session' ? ' (session)' : ''} · ${STATE[m.state]} ${m.state === 'running' || m.state === 'waiting' ? 'depuis' : 'il y a'} ${ago(m.since)}${m.state === 'waiting' ? (m.kind === 'session' ? '\nAttend une réponse' : '\nAttend ses propres missions') : ''}${m.mission ? `\n${m.mission}` : ''}\nClic pour ouvrir`;
        return (
          <div key={m.key} className={`mission ${m.state} ${leaving ? 'leaving' : ''}`} title={title} role="button" tabIndex={0}
            onClick={() => open(m)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(m); } }}>
            {m.agent ? <BotAvatar spec={m.avatar} seed={m.agent} size={16} running={m.state === 'running'} className="mission-bot" />
              : <span className="mission-icon"><LuTerminal size={11} /></span>}
            <span className="mission-name">{m.label}</span>
            {m.mission && <span className="mission-text">{m.mission}</span>}
            <span className="mission-state" aria-label={STATE[m.state]}>
              {m.state === 'running' ? <span className="mission-dots"><span /><span /><span /></span>
                : m.state === 'waiting' ? <><span className="mission-dot" />en attente</>
                : m.state === 'done' ? <LuCheck size={12} />
                : 'erreur'}
            </span>
            {m.state === 'error' && (
              <button className="mission-dismiss" title="Masquer" onClick={(e) => { e.stopPropagation(); dismissed.add(`${m.key}:${m.since}`); tick((n) => n + 1); }}><LuX size={10} /></button>
            )}
          </div>
        );
      })}
      {fold && (
        <button className="mission mission-more" title={rest.map((m) => `${m.label} · ${STATE[m.state]}`).join('\n')} onClick={() => setExpanded(true)}>
          +{rest.length} {rest.some((m) => m.state === 'running') && <span className="mission-dots"><span /><span /><span /></span>}
        </button>
      )}
      {expanded && <button className="mission mission-more" title="Réduire" onClick={() => setExpanded(false)}><LuChevronUp size={12} /></button>}
    </div>
  );
}
