// The /ws/events socket, kept alive on phones.
// iOS freezes the web app in the background and its socket often dies without a close event: the page
// still sees it "open" and silently misses every message. So:
// - heartbeat: while on screen, a ping after 10 s of silence; no answer within 5 s → the socket is dropped and reopened;
// - wake (back to the foreground, pageshow, network back, focus): immediate check + resync;
// - every reconnection resyncs (state + loaded chats) to catch what was missed;
// - while the socket is down, a light polling of the state and the chat on screen.

const HEARTBEAT = 10_000, TIMEOUT = 5_000, POLL = 5_000;
let probeNow = () => {};

// Called after an action whose result comes back over the socket (a message sent): check it is alive.
export const checkLive = () => probeNow(3_000);

export function startLive({ url, onOpen, onMessage, onStatus, resync, poll }) {
  let sock = null, timer = null, retry = 0, lastSeen = 0, dead = false, opened = false, lastWake = 0;
  const visible = () => document.visibilityState === 'visible';
  const isOpen = () => sock?.readyState === WebSocket.OPEN;

  const drop = () => {
    const s = sock;
    sock = null;
    if (!s) return;
    s.onopen = s.onclose = s.onmessage = s.onerror = null;
    try { s.close(); } catch {}
    onStatus(false);
  };
  const connect = () => {
    if (dead) return;
    clearTimeout(timer);
    drop();
    const s = (sock = new WebSocket(url));
    s.onopen = () => {
      lastSeen = Date.now();
      retry = 0;
      onStatus(true);
      onOpen(s);
      if (opened) resync(); // what happened while we were away
      opened = true;
    };
    s.onclose = () => {
      if (sock !== s) return;
      sock = null;
      onStatus(false);
      if (!dead) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10_000));
    };
    s.onmessage = (e) => {
      lastSeen = Date.now();
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type !== 'pong') onMessage(m);
    };
  };
  // Ask the server for a pong; silence → the socket is dead, open a new one.
  const probe = (timeout = TIMEOUT) => {
    if (dead) return;
    if (!isOpen()) {
      // Connecting already: let it finish (unless it hangs), else reconnect now.
      if (sock?.readyState === WebSocket.CONNECTING) { const s = sock; setTimeout(() => { if (sock === s && !isOpen()) connect(); }, TIMEOUT); return; }
      return connect();
    }
    const s = sock, sent = Date.now();
    try { s.send('{"type":"ping"}'); } catch { return connect(); }
    setTimeout(() => { if (sock === s && lastSeen < sent) connect(); }, timeout);
  };
  probeNow = probe;

  const wake = () => {
    if (dead || !visible() || Date.now() - lastWake < 1000) return;
    lastWake = Date.now();
    resync(); // the socket may look alive and still have missed events
    probe();
  };
  const onVisibility = () => wake();
  const onOnline = () => { lastWake = 0; wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('pageshow', wake);
  addEventListener('online', onOnline);
  addEventListener('focus', wake);

  const beat = setInterval(() => { if (visible() && Date.now() - lastSeen >= HEARTBEAT) probe(); }, 5_000);
  const fallback = setInterval(() => { if (visible() && !isOpen()) poll(); }, POLL);

  connect();
  return () => {
    dead = true;
    clearTimeout(timer);
    clearInterval(beat);
    clearInterval(fallback);
    document.removeEventListener('visibilitychange', onVisibility);
    removeEventListener('pageshow', wake);
    removeEventListener('online', onOnline);
    removeEventListener('focus', wake);
    probeNow = () => {};
    drop();
  };
}
