// Pièces jointes du chat : règles communes au navigateur et au serveur (module pur, sans dépendance).

export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024; // 200 Mo par fichier
export const MAX_ATTACHMENTS = 8; // par message

const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'svg', 'tif', 'tiff', 'ico'],
  video: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi', 'ogv', '3gp'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'caf', 'aiff'],
  pdf: ['pdf'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst'],
  sheet: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'],
  slides: ['ppt', 'pptx', 'odp', 'key'],
  doc: ['doc', 'docx', 'odt', 'rtf', 'pages', 'epub'],
  text: ['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'log', 'ini', 'toml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql', 'c', 'cpp', 'h', 'java', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'vtt', 'srt'],
};
const BY_EXT = new Map(Object.entries(EXT).flatMap(([k, list]) => list.map((e) => [e, k])));

export const extOf = (name) => { const m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };

// image | video | audio | pdf | archive | sheet | slides | doc | text | file
export function kindOf(name, type = '') {
  const k = BY_EXT.get(extOf(name));
  if (k) return k;
  const t = String(type || '');
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('text/')) return 'text';
  return 'file';
}

// Formats que le navigateur sait afficher/lire en ligne (le reste = carte fichier).
const INLINE_IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'heic', 'heif']);
const INLINE_VIDEO = new Set(['mp4', 'mov', 'webm', 'm4v', 'ogv']);
const INLINE_AUDIO = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'caf']);
export function previewOf(name) {
  const e = extOf(name);
  if (INLINE_IMAGE.has(e)) return 'image';
  if (INLINE_VIDEO.has(e)) return 'video';
  if (INLINE_AUDIO.has(e)) return 'audio';
  return 'file';
}

const LABEL = { image: 'Photo', video: 'Vidéo', audio: 'Audio', pdf: 'PDF', archive: 'Archive', sheet: 'Tableur', slides: 'Présentation', doc: 'Document', text: 'Texte', file: 'Fichier' };
export const kindLabel = (kind) => LABEL[kind] || 'Fichier';

// « PDF », « ZIP », « DOCX »… ou le libellé du type à défaut d'extension.
export const typeLabel = (name, type) => (extOf(name) ? extOf(name).toUpperCase() : kindLabel(kindOf(name, type)));

export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${(v < 10 ? Math.round(v * 10) / 10 : Math.round(v)).toString().replace('.', ',')} ${units[i]}`;
}

export function tooBigMessage(name, size) {
  const max = formatSize(MAX_ATTACHMENT_BYTES), got = formatSize(size);
  return `« ${name || 'Le fichier'} » est trop lourd${got && got !== max ? ` (${got})` : ''} : ${max} maximum par fichier.`;
}

// Nom sûr pour le disque, le markdown et le shell (garde les accents ; espaces, parenthèses, séparateurs → _).
export function safeName(name, fallback = 'fichier') {
  const base = String(name || '').split(/[\\/]/).pop().normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*%#()[\]{}'`$&;!]/g, '_').trim().replace(/\s+/g, '_').replace(/^\.+/, '');
  if (!base) return fallback;
  if (base.length <= 120) return base;
  const e = extOf(base);
  return base.slice(0, 120 - (e ? e.length + 1 : 0)) + (e ? `.${e}` : '');
}

// Aperçu une ligne d'un message qui n'a que des pièces jointes (« Photo », « 2 fichiers »…).
export function attachmentsSummary(files) {
  const list = files || [];
  if (!list.length) return '';
  if (list.length === 1) { const k = kindOf(list[0].name, list[0].type); return k === 'file' ? list[0].name : kindLabel(k); }
  const kinds = new Set(list.map((f) => kindOf(f.name, f.type)));
  if (kinds.size === 1 && kinds.has('image')) return `${list.length} photos`;
  return `${list.length} fichiers`;
}

// Lisible tel quel par l'outil Read de Claude Code : images, PDF, texte (csv/tsv compris).
const readable = (f) => {
  const k = kindOf(f.name, f.type);
  return k === 'image' || k === 'pdf' || k === 'text' || ['csv', 'tsv'].includes(extOf(f.name));
};

// Texte ajouté au message transmis à l'agent : les chemins à lire avec Read.
export function agentNote(files) {
  if (!files?.length) return '';
  const lines = files.map((f) => `- ${f.path} (${typeLabel(f.name, f.type)}${f.size ? `, ${formatSize(f.size)}` : ''})`);
  const binary = files.some((f) => !readable(f));
  return `\n\n[Pièces jointes, ouvre-les avec l'outil Read (images, PDF et fichiers texte se lisent directement) :\n${lines.join('\n')}`
    + (binary ? `\nLes vidéos, audios, archives et documents bureautiques ne se lisent pas avec Read : si tu as besoin de leur contenu, lance une session qui pourra les convertir ou les extraire.` : '')
    + ']';
}

// Texte par défaut d'un message envoyé sans texte.
export function defaultText(files) {
  if (!files?.length) return '';
  const kinds = new Set(files.map((f) => kindOf(f.name, f.type)));
  if (files.length === 1) return kinds.has('image') ? 'Regarde cette image.' : kinds.has('video') ? 'Regarde cette vidéo.' : 'Regarde ce fichier.';
  return kinds.size === 1 && kinds.has('image') ? 'Regarde ces images.' : 'Regarde ces fichiers.';
}
