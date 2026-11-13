// « Pris en charge depuis 01:11  0:29 » : shown under the last message while an agent or a session handles
// a message. The start comes from the server (ms since epoch), so a reload or a reconnection doesn't reset
// the chrono; the elapsed time is measured on the server's clock (see serverNow), whatever the device's.
import { useEffect, useState } from 'react';
import { serverNow } from '../clock.js';

export const clockTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export function chrono(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export default function TakenPill({ since, className = '' }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const took = chrono(serverNow() - since);
  return (
    <div className={`taken-pill ${className}`} role="status" aria-label={`Pris en charge depuis ${clockTime(since)}, ${took}`}>
      <svg className="taken-spin" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="taken-track" cx="12" cy="12" r="9.5" />
        <circle className="taken-arc" cx="12" cy="12" r="9.5" pathLength="360" strokeDasharray="115 245" />
        <circle className="taken-dot" cx="12" cy="12" r="3.6" />
      </svg>
      <span className="taken-text"><b>Pris</b> en charge depuis {clockTime(since)}</span>
      <span className="taken-time">{took}</span>
    </div>
  );
}
