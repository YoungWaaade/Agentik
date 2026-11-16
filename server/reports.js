// Who hears back from a session (Stop, waiting, error), and which prompts Agentik typed into it itself.
// Pure helpers, kept out of index.js so they can be tested.

// Claude Code gets a typed prompt flattened (line breaks, odd spaces, zero-width chars): compare without them.
export const promptKey = (t) => String(t ?? '').replace(/[\s​-‍⁠﻿]/g, '');

// The agent conversation that launched the session, and the one that sent it the last message through
// `send` (even if it did not launch it). Once each.
export function reportTargets(ws, isAgent = () => true) {
  const out = [];
  const add = (agent, conv) => {
    conv = conv ?? null;
    if (agent && isAgent(agent) && !out.some((o) => o.agent === agent && o.conv === conv)) out.push({ agent, conv });
  };
  add(ws.owner_agent, ws.owner_conv);
  add(ws.sender_agent, ws.sender_conv);
  return out;
}

// Prompts typed into a session's PTY by Agentik (send, relay request), until their UserPromptSubmit comes back.
// The hook then knows the prompt was not typed by the user, and whether /send already logged it.
export function promptTracker({ ttl = 10 * 60 * 1000, now = Date.now } = {}) {
  const pending = new Map();
  return {
    typed(id, text, info = {}) {
      const key = promptKey(text).slice(0, 100);
      if (!key) return;
      pending.set(id, [...(pending.get(id) || []).filter((p) => now() - p.at < ttl), { key, at: now(), ...info }]);
    },
    // Claude Code may submit several queued messages as one prompt: every one it contains is consumed.
    submitted(id, prompt) {
      const k = promptKey(prompt);
      const list = pending.get(id) || [];
      const hit = list.filter((p) => k.includes(p.key));
      if (hit.length) pending.set(id, list.filter((p) => !hit.includes(p)));
      return hit;
    },
  };
}

// A prompt nobody in Agentik typed: the user wrote it in the session. Not the initial prompt (passed at
// launch, also the relay handoff) nor Agentik's own notices.
export function typedByUser(prompt, initialPrompt) {
  const k = promptKey(prompt);
  if (!k || /^(\[Supersept\]|<)/.test(k)) return false;
  const first = promptKey(initialPrompt).slice(0, 100);
  return !(first && (k.includes(first) || first.startsWith(k.slice(0, 100))));
}
