// Pièces jointes du chat (bureau + mobile) : envoi, vignettes du composer, aperçus dans les messages.
import { useRef, useState } from 'react';
import { LuX, LuFile, LuFileText, LuFileArchive, LuFileSpreadsheet, LuFileAudio, LuFileVideo, LuFileImage, LuPresentation, LuDownload, LuLoaderCircle } from 'react-icons/lu';
import { uploadFile, attachmentUrl } from '../api.js';
import { MAX_ATTACHMENTS, kindOf, previewOf, typeLabel, formatSize } from '../attachments.js';

const ICON = { image: LuFileImage, video: LuFileVideo, audio: LuFileAudio, pdf: LuFileText, archive: LuFileArchive, sheet: LuFileSpreadsheet, slides: LuPresentation, doc: LuFileText, text: LuFileText, file: LuFile };
export function FileIcon({ name, type, size = 20 }) {
  const kind = kindOf(name, type);
  const Icon = ICON[kind] || LuFile;
  return <span className={`file-icon k-${kind}`}><Icon size={size} /></span>;
}

// Fichiers prêts à partir + envois en cours ({ id, name, progress }).
export function useAttachments({ onError, onDone } = {}) {
  const [files, setFiles] = useState([]);
  const [pending, setPending] = useState([]);
  const seq = useRef(0);
  const upload = async (list) => {
    const all = [...(list || [])];
    if (!all.length) return false;
    const room = MAX_ATTACHMENTS - files.length - pending.length;
    const take = all.slice(0, Math.max(0, room));
    if (take.length < all.length) onError?.(`${MAX_ATTACHMENTS} pièces jointes maximum par message.`);
    if (!take.length) return true;
    const jobs = take.map((f) => ({ f, id: ++seq.current, name: f.name || 'image', progress: 0 }));
    setPending((p) => [...p, ...jobs.map(({ id, name }) => ({ id, name, progress: 0 }))]);
    const errors = [];
    for (const j of jobs) {
      try {
        const a = await uploadFile(j.f, (progress) => setPending((p) => p.map((x) => (x.id === j.id ? { ...x, progress } : x))));
        setFiles((l) => [...l, a]);
      } catch (e) { errors.push(e.message); }
      setPending((p) => p.filter((x) => x.id !== j.id));
    }
    if (errors.length) onError?.(errors.join(' '));
    onDone?.();
    return true;
  };
  const remove = (a) => setFiles((l) => l.filter((x) => x !== a));
  return { files, setFiles, pending, uploading: pending.length > 0, upload, remove };
}

// Vignettes au-dessus du champ de saisie.
export function ComposerFiles({ files, pending, onRemove, mobile }) {
  if (!files.length && !pending.length) return null;
  return (
    <div className={`chat-thumbs ${mobile ? 'm-thumbs' : ''}`}>
      {files.map((a) => {
        const p = previewOf(a.name);
        const src = attachmentUrl(a.path);
        const x = <button type="button" className={mobile ? 'm-thumb-x' : undefined} title="Retirer" aria-label={`Retirer ${a.name}`} onClick={() => onRemove(a)}><LuX size={mobile ? 12 : 10} /></button>;
        if (p === 'image') return <span key={a.path} className="chat-thumb"><img src={src} alt={a.name} />{x}</span>;
        if (p === 'video') return <span key={a.path} className="chat-thumb"><video src={`${src}#t=0.1`} muted playsInline preload="metadata" /><span className="thumb-badge"><LuFileVideo size={11} /></span>{x}</span>;
        return (
          <span key={a.path} className="chat-thumb file" title={a.name}>
            <FileIcon name={a.name} type={a.type} size={18} />
            <span className="chip-text"><span className="chip-name">{a.name}</span><span className="chip-meta">{typeLabel(a.name, a.type)} · {formatSize(a.size)}</span></span>
            {x}
          </span>
        );
      })}
      {pending.map((j) => (
        <span key={`p${j.id}`} className="chat-thumb loading" title={j.name}>
          <LuLoaderCircle size={14} className="spin" />
          {j.progress > 0 && <span className="thumb-progress">{Math.round(j.progress * 100)} %</span>}
        </span>
      ))}
    </div>
  );
}

// Carte d'un fichier non affichable (PDF, zip, docx…) : ouvrir au tap, bouton Télécharger.
export function FileCard({ src, name, size, type }) {
  return (
    <span className="file-card">
      <a className="file-card-open" href={src} target="_blank" rel="noreferrer" title={`Ouvrir ${name}`}>
        <FileIcon name={name} type={type} size={22} />
        <span className="chip-text"><span className="chip-name">{name}</span><span className="chip-meta">{typeLabel(name, type)}{size ? ` · ${formatSize(size)}` : ''}</span></span>
      </a>
      <a className="file-card-dl" href={`${src}?download=1`} download={name} title="Télécharger" aria-label={`Télécharger ${name}`}><LuDownload size={16} /></a>
    </span>
  );
}

// Pièces jointes d'un message envoyé par l'utilisateur (meta.files, ou meta.images des anciens messages).
export function MessageFiles({ files }) {
  if (!files?.length) return null;
  const by = { image: [], video: [], audio: [], file: [] };
  for (const f of files) by[previewOf(f.name)].push(f);
  return (
    <div className="msg-files">
      {by.image.length > 0 && (
        <div className="msg-images">
          {by.image.map((i) => <a key={i.path} href={attachmentUrl(i.path)} target="_blank" rel="noreferrer"><img src={attachmentUrl(i.path)} alt={i.name} /></a>)}
        </div>
      )}
      {by.video.map((v) => <video key={v.path} className="msg-file-video" src={attachmentUrl(v.path)} controls playsInline preload="metadata" />)}
      {by.audio.map((a) => (
        <span key={a.path} className="msg-file-audio"><span className="chip-name">{a.name}</span><audio src={attachmentUrl(a.path)} controls preload="metadata" /></span>
      ))}
      {by.file.map((f) => <FileCard key={f.path} src={attachmentUrl(f.path)} name={f.name} size={f.size} type={f.type} />)}
    </div>
  );
}
