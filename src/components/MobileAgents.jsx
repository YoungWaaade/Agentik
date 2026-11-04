// Phone view of the agents (Nami, Franky…): pick one, then chat with it like on the Mac.
// Reuses the desktop chat pieces (chatStore + Message from AgentChat) with a touch-sized layout.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LuChevronLeft, LuArrowUp, LuSquare, LuPaperclip, LuX, LuLoaderCircle, LuMessageSquare, LuPlus, LuCheck, LuChevronRight } from 'react-icons/lu';
import { api, ago } from '../api.js';
import { attachmentsSummary } from '../attachments.js';
import { useAttachments, ComposerFiles } from './Attachments.jsx';
import { useChat, useConvs, loadConvs, loadChat, peekConvs, peekChat, setViewing, useChatBadges } from '../chatStore.js';
import { checkLive } from '../live.js';
import BotAvatar, { accentOf } from './BotAvatar.jsx';
import { splitAgents } from '../agentTeam.js';
import { Message, JumpDown, convTitle, lastKey } from './AgentChat.jsx';
import { PushBell, PushCallout } from './PushPanel.jsx';

const SUGGESTIONS = ['Qu\'est-ce que tu peux faire pour moi ?', 'Fais le point sur mes sessions en cours'];

// iOS Messages date: time today, "Hier", weekday this week, else short date.
function listDate(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff <= 0) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Hier';
  if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Plain one-line preview: no markdown, no image/attachment lines.
function plain(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .split('\n').filter((l) => !/^\s*\[?(pièces? jointes?|attachments?)\b/i.test(l) && !/attachments?[:/]/i.test(l))
    .join(' ')
    .replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#]+/g, '').replace(/^\s*([-•]|\d+\.)\s+/gm, '').replace(/\s+/g, ' ').trim();
}
function previewOf(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'activity') continue;
    if (m.role === 'system') return { text: systemLabel(m.text), at: m.at };
    const t = plain(m.text) || attachmentsSummary(m.meta?.files || m.meta?.images);
    if (t) return { text: (m.role === 'user' ? 'Toi : ' : '') + t, at: m.at };
  }
  return { text: '', at: 0 };
}

export function AgentListScreen({ agents, go, connected, tabs }) {
  const badges = useChatBadges();
  // Busy state comes with the conversation list: fetch it for every agent.
  const slugs = agents.map((a) => a.slug).join();
  useEffect(() => { agents.forEach((a) => loadConvs(a.slug).catch(() => {})); }, [slugs]);
  // Latest conversation of each agent → its messages feed the preview.
  const latest = (slug) => peekConvs(slug)[0];
  const need = agents.map((a) => latest(a.slug)).map((c, i) => (c ? `${agents[i].slug}:${c.conversation}` : '')).join();
  useEffect(() => {
    agents.forEach((a) => { const c = latest(a.slug); if (c && !peekChat(a.slug, c.conversation)?.loaded) loadChat(a.slug, c.conversation).catch(() => {}); });
  }, [need]);
  const { lead, others } = splitAgents(agents);
  const open = (a) => go({ kind: 'agent', id: a.slug });
  const info = (a) => {
    const c = latest(a.slug);
    const p = previewOf(c ? peekChat(a.slug, c.conversation)?.messages || [] : []);
    return { ...p, at: p.at || c?.last || 0 };
  };
  const rows = [...others].map((a) => ({ a, ...info(a) })).sort((x, y) => y.at - x.at);
  return (
    <>
      <header className="m-head">
        <h1>Agents</h1>
        <span className={`m-conn ${connected ? 'on' : ''}`} title={connected ? 'Connecté au Mac' : 'Mac injoignable'} />
        <PushBell go={go} />
      </header>
      <div className="m-scroll">
        <PushCallout go={go} />
        {!connected && <p className="m-note">Connexion au Mac… Vérifie qu'il est allumé et sur le même réseau (ou Tailscale).</p>}
        {lead && (
          <button className={`m-pin ${badges.busy(lead.slug) ? 'busy' : ''}`} onClick={() => open(lead)} title={lead.description} aria-label={`${lead.label}${badges.unread(lead.slug) > 0 ? `, ${badges.unread(lead.slug)} non lus` : ''}`}>
            <span className="m-pin-photo">
              <BotAvatar spec={lead.avatar} seed={lead.slug} size={96} busy={badges.busy(lead.slug)} />
              {badges.unread(lead.slug) > 0 && <span className="m-pin-unread">{badges.unread(lead.slug)}</span>}
            </span>
            <span className="m-pin-name">{lead.label}</span>
          </button>
        )}
        {rows.length > 0 && (
          <div className="m-msgs" style={lead ? { marginTop: 12 } : undefined}>
            {rows.map(({ a, text, at }) => {
              const busy = badges.busy(a.slug), unread = badges.unread(a.slug);
              return (
                <button key={a.slug} className={`m-msg ${unread > 0 ? 'unread' : ''}`} onClick={() => open(a)} title={a.description} aria-label={`${a.label}${unread > 0 ? `, ${unread} non lus` : ''}`}>
                  <span className="m-msg-dot">{unread > 0 && <i />}</span>
                  <span className="m-msg-av"><BotAvatar spec={a.avatar} seed={a.slug} size={54} busy={busy} /></span>
                  <span className="m-msg-body">
                    <span className="m-msg-top">
                      <span className="m-msg-name">{a.label}</span>
                      <span className="m-msg-date">{listDate(at)}</span>
                      <LuChevronRight size={14} className="m-msg-chev" />
                    </span>
                    {busy
                      ? <span className="m-msg-text typing"><i className="status-dot on" /> écrit<span className="m-dots"><span /><span /><span /></span></span>
                      : <span className="m-msg-text">{text || a.description || 'Aucun message'}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {!agents.length && <p className="m-note">Aucun agent. Crée-en un depuis YoungHub sur ton Mac (onglet Agents).</p>}
      </div>
      {tabs}
    </>
  );
}

// Pixel bot with the busy dots or unread count pinned to its corner.
function Bot({ agent, size, badges }) {
  const busy = badges.busy(agent.slug);
  const unread = badges.unread(agent.slug);
  return (
    <span className="m-bot">
      <BotAvatar spec={agent.avatar} seed={agent.slug} size={size} busy={busy} />
      {busy ? <span className="m-bot-badge busy" aria-label="travaille"><span /><span /><span /></span> : unread > 0 ? <span className="m-bot-badge">{unread}</span> : null}
    </span>
  );
}

export function AgentScreen({ agent, go }) {
  const { list, loaded } = useConvs(agent.slug);
  const badges = useChatBadges();
  const open = list.filter((c) => c.open).sort((a, b) => a.conversation - b.conversation);
  const [active, setActive] = useState(() => {
    const v = localStorage.getItem(lastKey(agent.slug));
    return v === null ? null : Number(v);
  });
  const chat = useChat(agent.slug, active);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const { files, setFiles, pending, uploading, upload, remove } = useAttachments({ onError: setError });
  const [sheet, setSheet] = useState(false);
  const scroller = useRef(null);
  const input = useRef(null);
  const fileInput = useRef(null);
  const stick = useRef(true);

  // Same rule as on the Mac: keep the selected conversation valid, else the last active open one.
  useEffect(() => {
    if (!loaded) return;
    if (active !== null && open.some((c) => c.conversation === active)) return;
    const next = list.find((c) => c.open);
    setActive(next ? next.conversation : null);
  }, [loaded, list, active]);
  useEffect(() => {
    if (active !== null) localStorage.setItem(lastKey(agent.slug), String(active));
    setViewing(agent.slug, active);
  }, [agent.slug, active]);
  useEffect(() => () => setViewing(null), []);
  // Tapping a banner about another conversation of this agent.
  useEffect(() => {
    const on = (e) => { if (e.detail.agent === agent.slug) { setSheet(false); setActive(e.detail.conversation); } };
    addEventListener('m-open-conv', on);
    return () => removeEventListener('m-open-conv', on);
  }, [agent.slug]);

  // Opens on the last message before the first paint (no visible scrolling); stays at the bottom while images/messages
  // arrive, until the user scrolls up (only a real upward scroll unsticks: content growing must not).
  const lastTop = useRef(0);
  const [away, setAway] = useState(false);
  const toBottom = (smooth) => {
    const el = scroller.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => { stick.current = true; setAway(false); toBottom(); lastTop.current = scroller.current?.scrollTop || 0; }, [active, chat?.loaded]);
  useLayoutEffect(() => { if (stick.current) toBottom(); }, [chat?.messages.length, chat?.busy]);
  useEffect(() => {
    const el = scroller.current;
    const col = el?.firstElementChild;
    if (!col) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (gap < 40) stick.current = true;
      else if (el.scrollTop < lastTop.current - 2) stick.current = false;
      lastTop.current = el.scrollTop;
      setAway(!stick.current && gap > 160);
    };
    const onLoad = () => { if (stick.current) toBottom(); }; // an image/video got its height
    const ro = new ResizeObserver(() => { if (stick.current) toBottom(); });
    el.addEventListener('scroll', onScroll, { passive: true });
    col.addEventListener('load', onLoad, true);
    col.addEventListener('loadedmetadata', onLoad, true);
    ro.observe(col);
    ro.observe(el); // the keyboard opening shrinks the list
    return () => { el.removeEventListener('scroll', onScroll); col.removeEventListener('load', onLoad, true); col.removeEventListener('loadedmetadata', onLoad, true); ro.disconnect(); };
  }, []);
  const jump = () => { stick.current = true; setAway(false); toBottom(true); };
  useEffect(() => {
    const el = input.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const select = async (c) => {
    setSheet(false);
    if (!c.open) { await api.patch(`/api/agents/${agent.slug}/conversations/${c.conversation}`, { open: true }); await loadConvs(agent.slug); }
    setActive(c.conversation);
  };
  const newConv = async () => {
    setSheet(false);
    const r = await api.post(`/api/agents/${agent.slug}/conversations`);
    await loadConvs(agent.slug);
    setActive(r.conversation);
  };
  const send = async (t = text) => {
    const v = t.trim();
    if (!v && !files.length) return;
    const sent = files;
    setText('');
    setFiles([]);
    setError(null);
    stick.current = true;
    try {
      const r = await api.post(`/api/agents/${agent.slug}/chat`, { text: v, conversation: active, files: sent });
      checkLive(); // the message and the reply come back over the socket: make sure it is not dead
      if (r.conversation !== active) { await loadConvs(agent.slug); setActive(r.conversation); }
    } catch (e) { setError(e.message); setText(v); setFiles(sent); }
  };

  const messages = chat?.messages || [];
  const current = list.find((c) => c.conversation === active);
  const others = list.filter((c) => !c.open);
  const status = chat?.busy ? 'travaille…' : badges.busy(agent.slug) ? 'travaille dans une autre conversation…' : 'disponible';
  const otherUnread = open.reduce((n, c) => n + (c.conversation === active ? 0 : badges.unreadConv(agent.slug, c.conversation)), 0);
  const canSend = (text.trim() || files.length) && !uploading;

  return (
    <>
      <header className="m-head">
        <button className="m-iconbtn" onClick={() => go({ kind: 'agents' })} aria-label="Retour aux agents"><LuChevronLeft size={22} /></button>
        <BotAvatar spec={agent.avatar} seed={agent.slug} size={36} busy={!!chat?.busy} />
        <div className="m-head-title">
          <span className="m-head-name">{agent.label}</span>
          <span className={`m-head-sub ${chat?.busy ? 'm-busy' : ''}`} style={{ '--acc': accentOf(agent.avatar, agent.slug) }}><i className={`status-dot ${chat?.busy || badges.busy(agent.slug) ? 'on' : ''}`} />{status}</span>
        </div>
        <button className="m-conv-btn" onClick={() => setSheet(true)} aria-label="Conversations">
          <LuMessageSquare size={16} />
          <span className="m-conv-btn-label">{current ? convTitle(current) : 'Nouvelle'}</span>
          {otherUnread > 0 && <span className="m-badge">{otherUnread}</span>}
        </button>
      </header>

      <div className="m-chat-list" ref={scroller}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); upload(e.dataTransfer.files); }}>
        <div className="chat-column">
          {!messages.length && chat?.loaded !== false && (
            <div className="chat-empty">
              <span className="chat-empty-stage" style={{ '--acc': accentOf(agent.avatar, agent.slug) }}><BotAvatar spec={agent.avatar} seed={agent.slug} size={156} className="chat-empty-bot" /></span>
              <h2>Salut, moi c'est {agent.label}</h2>
              {agent.description && <p>{agent.description}</p>}
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {messages.map((m) => <Message key={m.id} m={m} agent={agent} go={go} />)}
          {chat?.busy && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="msg agent"><BotAvatar spec={agent.avatar} seed={agent.slug} size={26} className="msg-bot" busy /><div className="msg-typing"><span /><span /><span /></div></div>
          )}
        </div>
        {away && <JumpDown onClick={jump} />}
      </div>

      {error && <div className="error-bar m-chat-error" onClick={() => setError(null)}>{error}</div>}
      <ComposerFiles files={files} pending={pending} onRemove={remove} mobile />
      <div className="m-composer">
        <button className="m-attach" onPointerDown={(e) => e.preventDefault()} onClick={() => fileInput.current.click()} aria-label="Joindre des fichiers"><LuPaperclip size={20} /></button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <textarea ref={input} rows={1} value={text} placeholder={`Écris à ${agent.label}…`} onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); upload(e.clipboardData.files); } }} />
        {chat?.busy && !canSend ? (
          <button className="m-send m-stop" onPointerDown={(e) => e.preventDefault()} onClick={() => api.post(`/api/agents/${agent.slug}/chat/stop`, { conversation: active })} aria-label="Arrêter"><LuSquare size={14} /></button>
        ) : (
          <button className="m-send" disabled={!canSend} onPointerDown={(e) => e.preventDefault()} onClick={() => send()} aria-label="Envoyer"><LuArrowUp size={18} /></button>
        )}
      </div>

      {sheet && (
        <div className="m-sheet-back" onClick={() => setSheet(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-head">
              <h2>Conversations avec {agent.label}</h2>
              <button className="m-iconbtn" onClick={() => setSheet(false)} aria-label="Fermer"><LuX size={20} /></button>
            </div>
            <div className="m-sheet-body">
              <button className="m-primary m-sheet-new" onClick={newConv}><LuPlus size={18} /> Nouvelle conversation</button>
              {open.length > 0 && <h3 className="m-section">Ouvertes</h3>}
              {open.map((c) => <ConvRow key={c.conversation} c={c} active={c.conversation === active} busy={badges.busyConv(agent.slug, c.conversation)} unread={badges.unreadConv(agent.slug, c.conversation)} onClick={() => select(c)} />)}
              {others.length > 0 && <h3 className="m-section">Historique</h3>}
              {others.map((c) => <ConvRow key={c.conversation} c={c} onClick={() => select(c)} />)}
              {loaded && !list.length && <p className="m-note">Aucune conversation pour l'instant.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ConvRow({ c, active, busy, unread, onClick }) {
  return (
    <button className={`m-row m-conv-row ${active ? 'on' : ''}`} onClick={onClick}>
      <span className="m-row-icon">{busy ? <LuLoaderCircle size={16} className="spin m-busy" /> : active ? <LuCheck size={16} /> : <LuMessageSquare size={16} />}</span>
      <span className="m-row-body">
        <span className="m-row-top">
          <span className="m-row-name">{convTitle(c)}</span>
          {unread > 0 && <span className="m-badge">{unread}</span>}
          <span className="m-row-ago">{ago(c.last)}</span>
        </span>
        <span className="m-row-sub">{new Date(c.started).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · {c.count} messages</span>
      </span>
    </button>
  );
}
