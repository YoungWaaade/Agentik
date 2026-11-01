// Phone view of the agents (Nami, Franky…): pick one, then chat with it like on the Mac.
// Reuses the desktop chat pieces (chatStore + Message from AgentChat) with a touch-sized layout.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LuChevronLeft, LuArrowUp, LuSquare, LuImagePlus, LuX, LuLoaderCircle, LuMessageSquare, LuPlus, LuCheck } from 'react-icons/lu';
import { api, ago, uploadFile, attachmentUrl, imageFiles } from '../api.js';
import { useChat, useConvs, loadConvs, setViewing, useChatBadges } from '../chatStore.js';
import BotAvatar from './BotAvatar.jsx';
import { splitAgents } from '../agentTeam.js';
import { Message, convTitle, lastKey } from './AgentChat.jsx';

const SUGGESTIONS = ['Qu\'est-ce que tu peux faire pour moi ?', 'Fais le point sur mes sessions en cours'];

export function AgentListScreen({ agents, go, connected, tabs }) {
  const badges = useChatBadges();
  // Busy state comes with the conversation list: fetch it for every agent.
  useEffect(() => { agents.forEach((a) => loadConvs(a.slug).catch(() => {})); }, [agents.map((a) => a.slug).join()]);
  const { lead, others } = splitAgents(agents);
  const open = (a) => go({ kind: 'agent', id: a.slug });
  return (
    <>
      <header className="m-head">
        <h1>Agents</h1>
        <span className={`m-conn ${connected ? 'on' : ''}`} title={connected ? 'Connecté au Mac' : 'Mac injoignable'} />
      </header>
      <div className="m-scroll">
        {!connected && <p className="m-note">Connexion au Mac… Vérifie qu'il est allumé et sur le même réseau (ou Tailscale).</p>}
        {agents.length > 0 && (
          <div className="m-team">
            {lead && (
              <button className="m-lead" onClick={() => open(lead)} title={lead.description}>
                <Bot agent={lead} size={56} badges={badges} />
                <span className="m-lead-text">
                  <span className="m-lead-name">{lead.label}</span>
                  <span className="m-lead-role">Cheffe d’équipe</span>
                </span>
              </button>
            )}
            {others.length > 0 && (
              <div className="m-grid">
                {others.map((a) => (
                  <button key={a.slug} className="m-grid-tile" onClick={() => open(a)} title={a.description}>
                    <Bot agent={a} size={52} badges={badges} />
                    <span className="m-grid-name">{a.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!agents.length && <p className="m-note">Aucun agent. Crée-en un depuis Supersept sur ton Mac (onglet Agents).</p>}
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
      <BotAvatar spec={agent.avatar} seed={agent.slug} size={size} />
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
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
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

  // Opens on the last message; stays at the bottom while new ones arrive, unless scrolled up.
  const toBottom = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; };
  useLayoutEffect(() => { stick.current = true; toBottom(); }, [active, chat?.loaded]);
  useLayoutEffect(() => { if (stick.current) toBottom(); }, [chat?.messages.length, chat?.busy]);
  useEffect(() => {
    const el = scroller.current;
    const col = el?.firstElementChild;
    if (!col) return;
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; };
    const ro = new ResizeObserver(() => { if (stick.current) toBottom(); });
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(col);
    ro.observe(el); // the keyboard opening shrinks the list
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);
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
  const upload = async (files) => {
    const imgs = imageFiles(files).slice(0, 8 - images.length);
    if (!imgs.length) return;
    setUploading(true);
    setError(null);
    try { for (const f of imgs) { const a = await uploadFile(f); setImages((l) => [...l, a]); } } catch (e) { setError(e.message); }
    setUploading(false);
  };
  const send = async (t = text) => {
    const v = t.trim();
    if (!v && !images.length) return;
    const imgs = images;
    setText('');
    setImages([]);
    setError(null);
    stick.current = true;
    try {
      const r = await api.post(`/api/agents/${agent.slug}/chat`, { text: v, conversation: active, images: imgs });
      if (r.conversation !== active) { await loadConvs(agent.slug); setActive(r.conversation); }
    } catch (e) { setError(e.message); setText(v); setImages(imgs); }
  };

  const messages = chat?.messages || [];
  const current = list.find((c) => c.conversation === active);
  const others = list.filter((c) => !c.open);
  const status = chat?.busy ? 'travaille…' : badges.busy(agent.slug) ? 'travaille dans une autre conversation…' : 'disponible';
  const otherUnread = open.reduce((n, c) => n + (c.conversation === active ? 0 : badges.unreadConv(agent.slug, c.conversation)), 0);
  const canSend = (text.trim() || images.length) && !uploading;

  return (
    <>
      <header className="m-head">
        <button className="m-iconbtn" onClick={() => go({ kind: 'agents' })} aria-label="Retour aux agents"><LuChevronLeft size={22} /></button>
        <BotAvatar spec={agent.avatar} seed={agent.slug} size={28} />
        <div className="m-head-title">
          <span className="m-head-name">{agent.label}</span>
          <span className={`m-head-sub ${chat?.busy ? 'm-busy' : ''}`}>{status}</span>
        </div>
        <button className="m-conv-btn" onClick={() => setSheet(true)} aria-label="Conversations">
          <LuMessageSquare size={16} />
          <span className="m-conv-btn-label">{current ? convTitle(current) : 'Nouvelle'}</span>
          {otherUnread > 0 && <span className="m-badge">{otherUnread}</span>}
        </button>
      </header>

      <div className="m-chat-list" ref={scroller}>
        <div className="chat-column">
          {!messages.length && chat?.loaded !== false && (
            <div className="chat-empty">
              <BotAvatar spec={agent.avatar} seed={agent.slug} size={72} className="chat-empty-bot" />
              <h2>Salut, moi c'est {agent.label}</h2>
              {agent.description && <p>{agent.description}</p>}
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {messages.map((m) => <Message key={m.id} m={m} agent={agent} go={go} />)}
          {chat?.busy && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="msg agent"><BotAvatar spec={agent.avatar} seed={agent.slug} size={24} className="msg-bot" /><div className="msg-typing"><span /><span /><span /></div></div>
          )}
        </div>
      </div>

      {error && <div className="error-bar m-chat-error" onClick={() => setError(null)}>{error}</div>}
      {(images.length > 0 || uploading) && (
        <div className="chat-thumbs m-thumbs">
          {images.map((a) => (
            <span key={a.path} className="chat-thumb">
              <img src={attachmentUrl(a.path)} alt={a.name} />
              <button type="button" className="m-thumb-x" aria-label="Retirer" onClick={() => setImages((l) => l.filter((x) => x !== a))}><LuX size={12} /></button>
            </span>
          ))}
          {uploading && <span className="chat-thumb loading"><LuLoaderCircle size={14} className="spin" /></span>}
        </div>
      )}
      <div className="m-composer">
        <button className="m-attach" onPointerDown={(e) => e.preventDefault()} onClick={() => fileInput.current.click()} aria-label="Ajouter une image"><LuImagePlus size={20} /></button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <textarea ref={input} rows={1} value={text} placeholder={`Écris à ${agent.label}…`} onChange={(e) => setText(e.target.value)} />
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
