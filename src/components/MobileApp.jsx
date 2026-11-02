import { useEffect, useRef, useState } from 'react';
import { HiChevronRight } from 'react-icons/hi2';
import { LuChevronLeft, LuPlus, LuArrowUp, LuZap, LuGitBranch, LuTerminal, LuBot } from 'react-icons/lu';
import { api, ago, STATUS } from '../api.js';
import Terminal, { sendInput, restartTerminal } from './Terminal.jsx';
import { StatusIndicator, ProjectThumbnail, AsciiSpinner, DiffStats } from './ui.jsx';
import { AgentListScreen, AgentScreen } from './MobileAgents.jsx';
import { onNewMessage, useChatBadges, loadConvs } from '../chatStore.js';
import { systemLabel, lastKey } from './AgentChat.jsx';
import { PushScreen, PushBell, PushCallout } from './PushPanel.jsx';

// Keys Claude Code needs that the iOS keyboard doesn't have.
const KEYS = [
  ['Esc', '\x1b'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['⏎', '\r'], ['⇧Tab', '\x1b[Z'], ['Tab', '\t'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['^C', '\x03'],
];

// iOS lays the keyboard over the page: size the app to what is actually visible.
function useVisualViewport() {
  const [vv, setVv] = useState({ height: 0, top: 0 });
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    // Only follow the visual viewport while the keyboard covers the page: in the home-screen app its height can be
    // smaller than the screen (home indicator area) and would leave an empty band under the tab bar.
    const on = () => {
      const kb = innerHeight - v.height > 120;
      setVv((o) => { const n = kb ? { height: v.height, top: v.offsetTop } : { height: 0, top: 0 }; return o.height === n.height && o.top === n.top ? o : n; });
    };
    on();
    v.addEventListener('resize', on);
    v.addEventListener('scroll', on);
    return () => { v.removeEventListener('resize', on); v.removeEventListener('scroll', on); };
  }, []);
  return vv;
}

export default function MobileApp({ data, projectsById, route, go, connected, load }) {
  const vv = useVisualViewport();
  // A relayed session (context full) opens the one that took over.
  let current = route.kind === 'ws' ? data.workspaces.find((w) => w.id === route.id) : null;
  for (let i = 0; current?.successor && i < 50; i++) current = data.workspaces.find((w) => w.id === current.successor) || null;
  const agents = data.agents || [];
  const agent = route.kind === 'agent' ? agents.find((a) => a.slug === route.id) : null;
  const banner = useAgentBanner(agents, route);
  let screen;
  if (current) screen = <WorkspaceScreen key={current.id} ws={current} project={projectsById[current.project_id]} go={go} />;
  else if (route.kind === 'notifs') screen = <PushScreen go={go} />;
  else if (route.kind === 'new') screen = <NewScreen projects={data.projects} go={go} load={load} />;
  else if (agent) screen = <AgentScreen key={agent.slug} agent={agent} go={go} />;
  else if (route.kind === 'agents' || route.kind === 'agent') screen = <AgentListScreen agents={agents} go={go} connected={connected} tabs={<Tabs tab="agents" go={go} agents={agents} />} />;
  else screen = <ListScreen data={data} projectsById={projectsById} go={go} connected={connected} tabs={<Tabs tab="sessions" go={go} agents={agents} />} />;
  return (
    <div className="m-app" style={vv.height ? { height: vv.height, bottom: 'auto', transform: `translateY(${vv.top}px)` } : undefined}>
      {screen}
      {banner.item && (
        <button className="m-banner" onClick={banner.open}>
          <strong>{banner.item.title}</strong>
          <span>{banner.item.text}</span>
        </button>
      )}
    </div>
  );
}

// Bottom tabs of the two home screens: terminal sessions, and agents to chat with.
function Tabs({ tab, go, agents }) {
  const badges = useChatBadges();
  const unread = agents.reduce((n, a) => n + badges.unread(a.slug), 0);
  return (
    <nav className="m-tabs">
      <button className={`m-tab ${tab === 'agents' ? 'on' : ''}`} onClick={() => go({ kind: 'agents' })}>
        <span className="m-tab-icon"><LuBot size={20} />{unread > 0 && <span className="m-badge m-tab-badge">{unread}</span>}</span><span>Agents</span>
      </button>
      <button className={`m-tab ${tab === 'sessions' ? 'on' : ''}`} onClick={() => go({ kind: 'board' })}><LuTerminal size={20} /><span>Sessions</span></button>
    </nav>
  );
}

// An agent answered, or a [YoungHub] notice (session finished…) landed, in a conversation not on screen:
// show a banner at the top for a few seconds; tapping it opens that conversation.
function useAgentBanner(agents, route) {
  const [item, setItem] = useState(null);
  const ref = useRef({ agents, route });
  ref.current = { agents, route };
  useEffect(() => {
    let timer;
    const off = onNewMessage(({ agent, conversation, message, viewed }) => {
      if (viewed || !['assistant', 'system'].includes(message.role)) return;
      const a = ref.current.agents.find((x) => x.slug === agent);
      if (!a) return;
      const text = message.role === 'system' ? systemLabel(message.text) : (message.text || '').replace(/\s+/g, ' ').slice(0, 140);
      if (!text) return;
      setItem({ agent, conversation, title: message.role === 'system' ? `${a.label} · YoungHub` : a.label, text });
      clearTimeout(timer);
      timer = setTimeout(() => setItem(null), 6000);
    });
    return () => { off(); clearTimeout(timer); };
  }, []);
  const open = async () => {
    setItem(null);
    // Make sure the conversation is open (it could be one closed on the Mac), else the screen would pick another.
    try {
      const list = await api.get(`/api/agents/${item.agent}/conversations`);
      if (!list.find((c) => c.conversation === item.conversation)?.open) await api.patch(`/api/agents/${item.agent}/conversations/${item.conversation}`, { open: true });
      await loadConvs(item.agent);
    } catch {}
    localStorage.setItem(lastKey(item.agent), String(item.conversation));
    const r = ref.current.route;
    if (r.kind === 'agent' && r.id === item.agent) dispatchEvent(new CustomEvent('m-open-conv', { detail: item })); // same agent, other conversation
    else location.hash = `#/agent/${item.agent}`;
  };
  return { item, open };
}

function ListScreen({ data, projectsById, go, connected, tabs }) {
  const live = data.workspaces.filter((w) => !w.archived);
  const free = live.filter((w) => !w.project_id).sort((a, b) => b.updated_at - a.updated_at);
  // Same open/closed state as the desktop sidebar.
  const [closed, setClosed] = useState(() => { try { return JSON.parse(localStorage.getItem('sb-closed-projects')) || {}; } catch { return {}; } });
  const [freeClosed, setFreeClosed] = useState(false);
  const toggle = (id) => setClosed((c) => {
    const n = { ...c, [id]: !c[id] };
    try { localStorage.setItem('sb-closed-projects', JSON.stringify(n)); } catch {}
    return n;
  });
  return (
    <>
      <header className="m-head">
        <h1>YoungHub</h1>
        <span className={`m-conn ${connected ? 'on' : ''}`} title={connected ? 'Connecté au Mac' : 'Mac injoignable'} />
        <PushBell go={go} />
        <button className="m-iconbtn" onClick={() => go({ kind: 'new' })} aria-label="Nouvel espace"><LuPlus size={20} /></button>
      </header>
      <div className="m-scroll">
        <PushCallout go={go} />
        {!connected && <p className="m-note">Connexion au Mac… Vérifie qu'il est allumé et sur le même réseau (ou Tailscale).</p>}
        {free.length > 0 && (
          <section>
            <button className="m-acc" onClick={() => setFreeClosed(!freeClosed)}>
              <HiChevronRight className={`m-acc-chev ${freeClosed ? '' : 'open'}`} size={16} />
              <span className="m-acc-name">Sessions</span><span className="m-acc-count">{free.length}</span>
            </button>
            {!freeClosed && free.map((w) => <Row key={w.id} ws={w} project={null} onClick={() => go({ kind: 'ws', id: w.id })} />)}
          </section>
        )}
        {data.projects.map((p) => {
          const list = live.filter((w) => w.project_id === p.id).sort((a, b) => b.updated_at - a.updated_at);
          const open = !closed[p.id];
          return (
            <section key={p.id}>
              <button className="m-acc" onClick={() => toggle(p.id)}>
                <HiChevronRight className={`m-acc-chev ${open ? 'open' : ''}`} size={16} />
                <ProjectThumbnail project={p} size={20} />
                <span className="m-acc-name">{p.name}</span><span className="m-acc-count">{list.length}</span>
              </button>
              {open && list.map((w) => <Row key={w.id} ws={w} project={projectsById[w.project_id]} onClick={() => go({ kind: 'ws', id: w.id })} />)}
            </section>
          );
        })}
        {!live.length && <p className="m-note">Aucun espace de travail. Touche + pour en lancer un.</p>}
      </div>
      {tabs}
    </>
  );
}

function Row({ ws, project, onClick }) {
  return (
    <button className="m-row" onClick={onClick}>
      <span className="m-row-icon">{ws.status === 'working' ? <AsciiSpinner /> : project ? <ProjectThumbnail project={project} size={20} /> : <span className="thumb" style={{ width: 20, height: 20 }}>·</span>}</span>
      <span className="m-row-body">
        <span className="m-row-top">
          <span className="m-row-name">{ws.name}</span>
          <StatusIndicator status={ws.status} />
          <span className="m-row-ago">{ago(ws.status_since || ws.updated_at)}</span>
        </span>
        <span className="m-row-sub">
          {project?.name || 'Session libre'}{ws.branch ? ` · ${ws.branch}` : ''} <DiffStats stats={ws.stats} />
        </span>
        {ws.last_message && ['waiting', 'review', 'error'].includes(ws.status) && <span className="m-row-msg">{ws.last_message}</span>}
      </span>
    </button>
  );
}

function WorkspaceScreen({ ws, project, go }) {
  const key = `${ws.id}:agent`;
  const [text, setText] = useState('');
  const input = useRef(null);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    // Newlines become Claude Code's own "new line" (what ⇧↵ sends), then submit.
    sendInput(key, t.replace(/\n/g, '\x1b\r'));
    setTimeout(() => sendInput(key, '\r'), 60);
    setText('');
  };
  useEffect(() => {
    const el = input.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  return (
    <>
      <header className="m-head">
        <button className="m-iconbtn" onClick={() => go({ kind: 'board' })} aria-label="Retour"><LuChevronLeft size={22} /></button>
        <div className="m-head-title">
          <span className="m-head-name">{ws.name}</span>
          <span className="m-head-sub">{STATUS[ws.status]?.label}{project ? ` · ${project.name}` : ''}{ws.branch ? <> · <LuGitBranch size={10} /> {ws.branch}</> : null}</span>
        </div>
        <button className="m-iconbtn" onClick={() => confirm(ws.running ? 'Relancer Claude ?' : 'Lancer Claude ?') && restartTerminal(key)} aria-label="Relancer Claude"><LuZap size={18} /></button>
      </header>
      <div className="m-term"><Terminal termKey={key} active={false} keyboard={false} /></div>
      <div className="m-keys">
        {KEYS.map(([label, seq]) => (
          <button key={label} className="m-key" onPointerDown={(e) => e.preventDefault()} onClick={() => sendInput(key, seq)}>{label}</button>
        ))}
      </div>
      <div className="m-composer">
        <textarea ref={input} rows={1} value={text} placeholder="Répondre à Claude…" onChange={(e) => setText(e.target.value)} />
        <button className="m-send" disabled={!text.trim()} onPointerDown={(e) => e.preventDefault()} onClick={send} aria-label="Envoyer"><LuArrowUp size={18} /></button>
      </div>
    </>
  );
}

function NewScreen({ projects, go, load }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || null);
  const [worktree, setWorktree] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await api.post('/api/workspaces', { projectId, prompt: prompt.trim(), worktree: !!projectId && worktree });
      await load();
      go({ kind: 'ws', id: w.id });
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <>
      <header className="m-head">
        <button className="m-iconbtn" onClick={() => go({ kind: 'board' })} aria-label="Retour"><LuChevronLeft size={22} /></button>
        <h1>Nouvel espace</h1>
      </header>
      <div className="m-scroll m-form">
        <textarea className="m-prompt" autoFocus value={prompt} placeholder="Décris la tâche…" onChange={(e) => setPrompt(e.target.value)} />
        <h2 className="m-section">Projet</h2>
        <div className="m-chips">
          {projects.map((p) => (
            <button key={p.id} className={`m-chip ${projectId === p.id ? 'on' : ''}`} onClick={() => setProjectId(p.id)}><ProjectThumbnail project={p} /> {p.name}</button>
          ))}
          <button className={`m-chip ${projectId === null ? 'on' : ''}`} onClick={() => setProjectId(null)}>Session libre</button>
        </div>
        {projectId && (
          <>
            <h2 className="m-section">Où</h2>
            <div className="m-chips">
              <button className={`m-chip ${worktree ? 'on' : ''}`} onClick={() => setWorktree(true)}>Worktree (branche isolée)</button>
              <button className={`m-chip ${!worktree ? 'on' : ''}`} onClick={() => setWorktree(false)}>Local</button>
            </div>
          </>
        )}
        {error && <div className="error-bar">{error}</div>}
        <button className="m-primary" disabled={busy} onClick={create}>{busy ? 'Création…' : 'Lancer Claude'}</button>
      </div>
    </>
  );
}
