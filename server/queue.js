// Runs fn(key) for queued keys, at most `limit` at a time, each key at most once in line.
// Spawning git blocks the event loop for tens of milliseconds on a managed Mac: with dozens
// of sessions, refreshing them all at once froze every request for seconds.
export function keyedQueue(fn, limit = 2) {
  const waiting = new Set();
  const running = new Set();
  const again = new Set();
  const pump = () => {
    for (const key of waiting) {
      if (running.size >= limit) return;
      if (running.has(key)) continue;
      waiting.delete(key);
      running.add(key);
      Promise.resolve().then(() => fn(key)).catch(() => {}).finally(() => {
        running.delete(key);
        // Asked again while it ran: its result may already be stale.
        if (again.delete(key)) waiting.add(key);
        pump();
      });
    }
  };
  return {
    push(key) {
      if (running.has(key)) again.add(key);
      else waiting.add(key);
      pump();
    },
    get size() { return waiting.size + running.size; },
  };
}
