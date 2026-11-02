// Live state of agent chats, fed by the /ws/events socket (see App.jsx).
// An agent has several conversations, open side by side; each one has its messages and busy state.
import { useEffect, useState } from 'react';
import { api } from './api.js';

const chats = new Map(); // "agent:conversation" → { messages, busy, loaded }
const convs = new Map(); // agent → { list, loaded }
const unread = new Map(); // "agent:conversation" → count of agent messages not seen yet
const subs = new Set();
const msgSubs = new Set(); // called on each new message (mobile banners)
let viewing = null; // "agent:conversation" on screen

const k = (agent, conv) => `${agent}:${conv}`;
const emit = () => subs.forEach((f) => f());
const get = (agent, conv) => {
  if (!chats.has(k(agent, conv))) chats.set(k(agent, conv), { messages: [], busy: false, loaded: false });
  return chats.get(k(agent, conv));
};

export async function loadChat(agent, conv) {
  const before = chats.get(k(agent, conv));
  const ver = before?.ver || 0;
  const r = await api.get(`/api/agents/${agent}/chat?conversation=${conv}`);
  // Live events that arrived during the request win over the (older) snapshot.
  const c = get(agent, conv);
  const top = r.messages.reduce((n, m) => Math.max(n, m.id), 0);
  const newer = c.ver !== ver ? c.messages.filter((m) => m.id > top) : [];
  chats.set(k(agent, conv), { messages: [...r.messages, ...newer], busy: c.ver !== ver ? c.busy : r.busy, loaded: true, ver: c.ver || 0 });
  emit();
}

// After the live socket was cut (phone in the background, network lost): reload what is on screen and
// every chat already loaded, so no message or busy state is missed.
let resyncing = null;
export function resyncChats({ onlyViewing = false } = {}) {
  if (resyncing) return resyncing;
  const keys = onlyViewing ? (viewing ? [viewing] : []) : [...chats.keys()].filter((x) => chats.get(x).loaded || x === viewing);
  const agents = onlyViewing ? (viewing ? [viewing.split(':')[0]] : []) : [...convs.keys()];
  const jobs = [
    ...keys.map((x) => { const i = x.lastIndexOf(':'); return loadChat(x.slice(0, i), Number(x.slice(i + 1))); }),
    ...agents.map((a) => loadConvs(a)),
  ].map((p) => p.catch(() => {}));
  resyncing = Promise.all(jobs).finally(() => { resyncing = null; });
  return resyncing;
}
export async function loadConvs(agent) {
  const list = await api.get(`/api/agents/${agent}/conversations`);
  convs.set(agent, { list, loaded: true });
  for (const c of list) if (c.busy) get(agent, c.conversation).busy = true;
  emit();
}

export function onChatEvent(m) {
  if (m.type === 'chat-convs' || m.type === 'chat-reset') {
    if (convs.has(m.agent)) loadConvs(m.agent).catch(() => {});
    return;
  }
  const conv = m.conversation ?? m.message?.conversation ?? 0;
  const c = get(m.agent, conv);
  c.ver = (c.ver || 0) + 1;
  if (m.type === 'chat') {
    const i = c.messages.findIndex((x) => x.id === m.message.id);
    c.messages = i >= 0 ? c.messages.map((x, j) => (j === i ? m.message : x)) : [...c.messages, m.message];
    if (i < 0 && m.message.role === 'assistant' && viewing !== k(m.agent, conv)) unread.set(k(m.agent, conv), (unread.get(k(m.agent, conv)) || 0) + 1);
    if (i < 0) msgSubs.forEach((f) => f({ agent: m.agent, conversation: conv, message: m.message, viewed: viewing === k(m.agent, conv) }));
    // A message in a conversation we don't list yet (new mission, reopened): refresh the tabs.
    const list = convs.get(m.agent)?.list;
    if (list && !list.some((x) => x.conversation === conv && x.open)) loadConvs(m.agent).catch(() => {});
  } else if (m.type === 'chat-busy') c.busy = m.busy;
  emit();
}

export function setViewing(agent, conv = null) {
  viewing = agent && conv !== null ? k(agent, conv) : null;
  if (viewing) unread.delete(viewing);
  emit();
}

const useTick = () => {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
};

export function useChat(agent, conv) {
  useTick();
  useEffect(() => {
    // Always refetched when shown (cached chats may have missed events while the socket was down).
    if (agent && conv !== null && conv !== undefined) loadChat(agent, conv).catch(() => {});
  }, [agent, conv]);
  return agent && conv !== null && conv !== undefined ? get(agent, conv) : null;
}

export function useConvs(agent) {
  useTick();
  useEffect(() => { if (agent) loadConvs(agent).catch(() => {}); }, [agent]);
  return convs.get(agent) || { list: [], loaded: false };
}

const sum = (agent, f) => [...chats.keys()].filter((x) => x.startsWith(`${agent}:`)).reduce((n, x) => n + f(x), 0);
// For the sidebar and the tabs: busy + unread per agent, and per conversation.
export function useChatBadges() {
  useTick();
  return {
    busy: (a) => sum(a, (x) => (chats.get(x).busy ? 1 : 0)) > 0,
    unread: (a) => [...unread].filter(([x]) => x.startsWith(`${a}:`)).reduce((n, [, v]) => n + v, 0),
    busyConv: (a, c) => !!chats.get(k(a, c))?.busy,
    unreadConv: (a, c) => unread.get(k(a, c)) || 0,
  };
}

// The conversation on screen ("agent:conversation" or null), and a callback on any store change.
export const getViewing = () => viewing;
export function onStoreChange(f) {
  subs.add(f);
  return () => subs.delete(f);
}

// New chat messages as they arrive: { agent, conversation, message, viewed }. Returns the unsubscribe.
export function onNewMessage(f) {
  msgSubs.add(f);
  return () => msgSubs.delete(f);
}

// Non-hook readers (callers re-render through useChatBadges): conversations of an agent, one chat.
export const peekConvs = (agent) => convs.get(agent)?.list || [];
export const peekChat = (agent, conv) => chats.get(k(agent, conv)) || null;
