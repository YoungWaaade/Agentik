// "Tâches" tab: the agents' scheduled tasks (table `schedules`, see server/schedules.js). Lists every task,
// pauses / resumes / runs / edits / deletes them, and creates new ones by hand. Refreshes on the server's
// { type: 'schedules' } event (relayed by App as a window event) and every 30 s.
import { useCallback, useEffect, useState } from 'react';
import { LuPlus, LuPause, LuPlay, LuZap, LuPencil, LuTrash2, LuRepeat, LuCalendarClock, LuChevronLeft } from 'react-icons/lu';
import { api } from '../api.js';
import BotAvatar from './BotAvatar.jsx';
import { PageHeader } from './Pages.jsx';
import { Modal } from './ui.jsx';
import { isPhone } from './Terminal.jsx';

export const SCHEDULES_EVENT = 'agentik:schedules';

export function useSchedules() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => api.get('/api/schedules/all').then((l) => { setList(l); setError(null); }).catch((e) => setError(e.message)), []);
  const [, setTick] = useState(0);
  useEffect(() => {
    load();
    addEventListener(SCHEDULES_EVENT, load);
    // Fallback refresh, and keeps the "dans 5 min" wording current.
    const i = setInterval(() => { load(); setTick((n) => n + 1); }, 30_000);
    return () => { removeEventListener(SCHEDULES_EVENT, load); clearInterval(i); };
  }, [load]);
  return { list, error, load };
}

// ---- Dates ----
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${d.getHours()}:${pad(d.getMinutes())}`;
export function absDate(ms, now = Date.now()) {
  const d = new Date(ms);
  const day = (x) => new Date(x).toDateString();
  if (day(ms) === day(now)) return `aujourd'hui ${hhmm(d)}`;
  if (day(ms) === day(now + 86400_000)) return `demain ${hhmm(d)}`;
  if (day(ms) === day(now - 86400_000)) return `hier ${hhmm(d)}`;
  const date = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
  return `${date} ${hhmm(d)}`;
}
export function relDate(ms, now = Date.now()) {
  const s = Math.round((ms - now) / 1000);
  const a = Math.abs(s);
  const txt = a < 60 ? 'moins d’une minute' : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.floor(a / 3600)} h${Math.round((a % 3600) / 60) ? ` ${pad(Math.round((a % 3600) / 60))}` : ''}` : `${Math.round(a / 86400)} j`;
  return s >= 0 ? `dans ${txt}` : `il y a ${txt}`;
}
const endDay = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const isoDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export function taskState(t, now = Date.now()) {
  if (t.active) return { key: 'active', label: 'Active', cls: 'green' };
  if ((t.until && t.until < now) || /^terminée/.test(t.dernier_statut || '')) return { key: 'done', label: 'Terminée', cls: '' };
  return { key: 'paused', label: 'En pause', cls: 'amber' };
}
const statusCls = (s = '') => (/^lancée/.test(s) ? 'green' : /^(erreur|agent introuvable)/.test(s) ? 'red' : /^reportée/.test(s) ? 'amber' : '');

// ---- Frequency of the form <-> API ----
const UNITS = [['m', 'minutes', 1], ['h', 'heures', 60], ['d', 'jours', 1440]];
export function freqFromTask(t) {
  if (t?.cron) return { mode: 'cron', n: '2', unit: 'h', cron: t.cron };
  const min = t?.every_min || 120;
  const [unit, , k] = [...UNITS].reverse().find(([, , k2]) => min % k2 === 0);
  return { mode: 'every', n: String(min / k), unit, cron: '' };
}
export const freqToApi = (f) => (f.mode === 'cron' ? { cron: f.cron.trim() } : { every: `${Number(f.n) || 0}${f.unit}` });

// ---- Pieces ----
function TaskCard({ task: t, agent, onEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const now = Date.now();
  const st = taskState(t, now);
  const long = t.prompt.length > 180 || t.prompt.split('\n').length > 3;
  const act = (name, fn) => async () => {
    setBusy(name); setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const toggle = act('toggle', () => api.patch(`/api/schedules/${t.id}`, { active: !t.active }));
  const run = act('run', () => api.post(`/api/schedules/${t.id}/run`));
  const remove = act('delete', async () => {
    if (!confirm(`Supprimer la tâche ${t.id} de ${agent?.label || t.agent} ?\n« ${t.prompt.slice(0, 140)}${t.prompt.length > 140 ? '…' : ''} »`)) return;
    await api.del(`/api/schedules/${t.id}`);
  });
  return (
    <article className={`task ${st.key}`}>
      <div className="task-top">
        <BotAvatar spec={agent?.avatar} seed={t.agent} size={24} running={t.busy} />
        <span className="task-agent">{agent?.label || t.agent}</span>
        <span className={`tag ${st.cls}`}>{st.label}</span>
        {t.busy && <span className="tag">en train de travailler</span>}
        <span className="flex-1" />
        <span className="task-id mono" title="Identifiant (agentik delete-task ID)">{t.id}</span>
      </div>
      <div className="task-freq"><LuRepeat size={13} /> <span>{t.quand}</span>{t.cron && !t.quand.startsWith('cron') && <code className="task-cron">{t.cron}</code>}</div>
      <p className={`task-prompt ${open ? 'open' : ''}`} onClick={() => long && setOpen(!open)} title={long && !open ? 'Afficher tout' : undefined}>{t.prompt}</p>
      {long && <button className="task-more" onClick={() => setOpen(!open)}>{open ? 'Réduire' : 'Afficher tout'}</button>}
      <dl className="task-meta">
        <div><dt>Prochaine</dt><dd>{t.next_run ? <><span>{absDate(t.next_run, now)}</span> <span className="muted">· {relDate(t.next_run, now)}</span></> : <span className="muted">—</span>}</dd></div>
        <div><dt>Dernière</dt><dd>{t.last_run ? <><span>{absDate(t.last_run, now)}</span>{t.dernier_statut && <span className={`tag ${statusCls(t.dernier_statut)}`} title={t.dernier_statut}>{t.dernier_statut}</span>}</> : <span className="muted">jamais</span>}</dd></div>
        <div><dt>Exécutions</dt><dd>{t.executions}{t.reportees > 0 && <span className="muted"> · {t.reportees} reportée{t.reportees > 1 ? 's' : ''}</span>}</dd></div>
        <div><dt>Fin</dt><dd>{t.until ? endDay(t.until) : <span className="muted">aucune</span>}</dd></div>
      </dl>
      {t.dernier_resultat && (
        <div className="task-result"><span className="task-result-label">Dernier résultat</span><p title={t.dernier_resultat}>{t.dernier_resultat}</p></div>
      )}
      {error && <div className="error-bar" onClick={() => setError(null)}>{error}</div>}
      <div className="task-actions">
        {st.key !== 'done' && (
          <button className="btn-ghost" disabled={!!busy} onClick={toggle}>{t.active ? <><LuPause size={13} /> Pause</> : <><LuPlay size={13} /> Reprendre</>}</button>
        )}
        <button className="btn-ghost" disabled={!!busy || t.busy} onClick={run} title={t.busy ? "L'agent travaille déjà" : "Envoie le message de réveil maintenant (les échéances ne bougent pas)"}><LuZap size={13} /> {busy === 'run' ? 'Envoi…' : 'Lancer maintenant'}</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => onEdit(t)}><LuPencil size={13} /> Modifier</button>
        <span className="flex-1" />
        <button className="btn-ghost danger" disabled={!!busy} onClick={remove}><LuTrash2 size={13} /> Supprimer</button>
      </div>
    </article>
  );
}

export function TaskForm({ agents, task, onDone, onCancel }) {
  const lead = agents.find((a) => a.manager && a.manager !== 'false');
  const [agent, setAgent] = useState(task?.agent || lead?.slug || agents[0]?.slug || '');
  const [prompt, setPrompt] = useState(task?.prompt || '');
  const [freq, setFreq] = useState(() => freqFromTask(task));
  const [until, setUntil] = useState(task?.until ? isoDay(task.until) : '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const setF = (k, v) => setFreq((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setError(null); setSaving(true);
    try {
      if (task) await api.patch(`/api/schedules/${task.id}`, { prompt, ...freqToApi(freq), until: until || '' });
      else await api.post('/api/schedules', { agent, prompt, ...freqToApi(freq), ...(until ? { until } : {}) });
      onDone();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  return (
    <form className="form task-form" onSubmit={submit}>
      <label>Agent
        <select value={agent} disabled={!!task} onChange={(e) => setAgent(e.target.value)}>
          {agents.map((a) => <option key={a.slug} value={a.slug}>{a.label}</option>)}
        </select>
      </label>
      <label>Message de réveil <span className="muted">— ce que l'agent doit faire à chaque fois</span>
        <textarea rows={5} autoFocus={!task && !isPhone /* phone: no keyboard popping up on open */} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="ex. Regarde mes nouveaux mails importants et résume-les-moi" />
      </label>
      <div className="task-form-freq">
        <span className="task-form-label">Fréquence</span>
        <div className="wsp-segmented task-seg">
          <button type="button" className={freq.mode === 'every' ? 'on' : ''} onClick={() => setF('mode', 'every')}>Intervalle</button>
          <button type="button" className={freq.mode === 'cron' ? 'on' : ''} onClick={() => setF('mode', 'cron')}>Cron</button>
        </div>
        {freq.mode === 'every' ? (
          <div className="task-form-row">
            <span>Toutes les</span>
            <input type="number" min="1" inputMode="numeric" value={freq.n} onChange={(e) => setF('n', e.target.value)} />
            <select value={freq.unit} onChange={(e) => setF('unit', e.target.value)}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
        ) : (
          <>
            <input className="mono" value={freq.cron} onChange={(e) => setF('cron', e.target.value)} placeholder="17 */2 * * *" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <span className="muted small">minute heure jour mois jour-de-semaine, heure de Paris — ex. « 0 9 * * 1-5 » = en semaine à 9 h</span>
          </>
        )}
      </div>
      <label>Date de fin <span className="muted">— optionnelle, la tâche s'arrête après ce jour-là</span>
        <span className="task-form-row">
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          {until && <button type="button" className="btn-ghost" onClick={() => setUntil('')}>Aucune</button>}
        </span>
      </label>
      {error && <div className="error-bar" onClick={() => setError(null)}>{error}</div>}
      <div className="form-foot">
        <button type="button" className="btn-ghost" onClick={onCancel}>Annuler</button>
        <button className="btn-primary" disabled={saving || !prompt.trim() || !agent}>{saving ? 'Enregistrement…' : task ? 'Enregistrer' : 'Créer la tâche'}</button>
      </div>
    </form>
  );
}

function TaskList({ list, agents, filter, onEdit, load, empty }) {
  const bySlug = Object.fromEntries(agents.map((a) => [a.slug, a]));
  const shown = (list || []).filter((t) => filter === 'all' || t.agent === filter);
  if (!list) return <p className="empty-note">Chargement…</p>;
  if (!shown.length) return empty;
  return <div className="tasks">{shown.map((t) => <TaskCard key={t.id} task={t} agent={bySlug[t.agent]} onEdit={onEdit} onChanged={load} />)}</div>;
}

function AgentChips({ list, agents, filter, setFilter }) {
  const used = agents.filter((a) => (list || []).some((t) => t.agent === a.slug));
  if (used.length < 2) return null;
  return (
    <div className="chips">
      <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Toutes</button>
      {used.map((a) => (
        <button key={a.slug} className={`chip ${filter === a.slug ? 'on' : ''}`} onClick={() => setFilter(a.slug)}><BotAvatar spec={a.avatar} seed={a.slug} size={14} /> {a.label}</button>
      ))}
    </div>
  );
}

const Empty = ({ onNew }) => (
  <div className="tasks-empty">
    <LuCalendarClock size={28} />
    <p>Aucune tâche planifiée. Les agents en créent eux-mêmes (« toutes les 2 h, vérifie… ») ; tu peux aussi en ajouter une ici.</p>
    <button className="btn-primary" onClick={onNew}><LuPlus size={14} /> Nouvelle tâche</button>
  </div>
);

// Desktop page.
export default function TasksPage({ agents }) {
  const { list, error, load } = useSchedules();
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // null | 'new' | task
  const active = (list || []).filter((t) => t.active).length;
  return (
    <div className="page">
      <PageHeader title="Tâches">
        {list && <span className="muted small">{active} active{active > 1 ? 's' : ''} · {list.length} au total</span>}
        <button className="btn-primary" onClick={() => setEditing('new')}><LuPlus size={14} /> Nouvelle tâche</button>
      </PageHeader>
      <AgentChips list={list} agents={agents} filter={filter} setFilter={setFilter} />
      <div className="page-scroll">
        {error && <div className="error-bar tasks-error">{error}</div>}
        <TaskList list={list} agents={agents} filter={filter} onEdit={setEditing} load={load} empty={<Empty onNew={() => setEditing('new')} />} />
      </div>
      {editing && (
        <Modal title={editing === 'new' ? 'Nouvelle tâche planifiée' : `Modifier la tâche ${editing.id}`} onClose={() => setEditing(null)} className="modal-wide">
          <TaskForm agents={agents} task={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

// Phone screen (calendar button of the sessions list): the form replaces the list instead of a modal.
export function TasksScreen({ agents, connected, go }) {
  const { list, error, load } = useSchedules();
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  if (editing) {
    return (
      <>
        <header className="m-head">
          <button className="m-iconbtn" onClick={() => setEditing(null)} aria-label="Retour aux tâches"><LuChevronLeft size={22} /></button>
          <h1>{editing === 'new' ? 'Nouvelle tâche' : `Tâche ${editing.id}`}</h1>
        </header>
        <div className="m-scroll">
          <TaskForm agents={agents} task={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
        </div>
      </>
    );
  }
  return (
    <>
      <header className="m-head">
        <button className="m-iconbtn" onClick={() => go({ kind: 'board' })} aria-label="Retour"><LuChevronLeft size={22} /></button>
        <h1>Tâches</h1>
        <span className={`m-conn ${connected ? 'on' : ''}`} title={connected ? 'Connecté' : 'Serveur injoignable'} />
        <button className="m-iconbtn" onClick={() => setEditing('new')} aria-label="Nouvelle tâche"><LuPlus size={20} /></button>
      </header>
      <div className="m-scroll m-tasks">
        <AgentChips list={list} agents={agents} filter={filter} setFilter={setFilter} />
        {error && <div className="error-bar tasks-error">{error}</div>}
        <TaskList list={list} agents={agents} filter={filter} onEdit={setEditing} load={load} empty={<Empty onNew={() => setEditing('new')} />} />
      </div>
    </>
  );
}
