import { MAX_ATTACHMENT_BYTES, tooBigMessage } from './attachments.js';

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', // live data: never a stale copy from the browser cache (iOS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b || {}),
  put: (u, b) => req('PUT', u, b),
  patch: (u, b) => req('PATCH', u, b),
  del: (u) => req('DELETE', u),
};

export const wsUrl = (p) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${p}`;

export function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}j`;
}

export const STATUS = {
  working: { label: 'En cours', color: 'var(--amber-500)' },
  waiting: { label: 'Attend ton input', color: 'var(--yellow-500)' },
  review: { label: 'À revoir', color: 'var(--green-500)' },
  error: { label: 'Erreur', color: 'var(--red-500)' },
  idle: { label: 'Inactif', color: 'var(--muted-foreground)' },
  done: { label: 'Terminé', color: 'var(--dim)' },
};

// Upload a file to ~/.claude-hub/attachments; returns { path, name, size, type }.
// onProgress(0…1) follows the upload (XHR: fetch has no upload progress).
export function uploadFile(f, onProgress) {
  if (f.size > MAX_ATTACHMENT_BYTES) return Promise.reject(new Error(tooBigMessage(f.name, f.size)));
  const name = f.name || `image-${Date.now()}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/attachments?name=${encodeURIComponent(name)}`);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    if (onProgress) x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let data = {};
      try { data = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) resolve({ ...data, ...(f.type ? { type: f.type } : {}) });
      else reject(new Error(data.error || (x.status === 413 ? tooBigMessage(name, f.size) : `l'envoi de « ${name} » a échoué`)));
    };
    x.onerror = () => reject(new Error(`l'envoi de « ${name} » a échoué (connexion coupée ?)`));
    x.send(f);
  });
}
// …/attachments/<id>/<name> → the URL serving it.
export const attachmentUrl = (p) => {
  const [id, name] = String(p).split('/').slice(-2);
  return `/api/attachments/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
};
