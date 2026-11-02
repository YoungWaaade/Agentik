import { useEffect, useState } from 'react';
import { LuFile, LuX } from 'react-icons/lu';
import { attachmentUrl } from '../api.js';

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
export const isImageName = (name) => IMAGE.test(String(name || ''));

// A fixed-size thumbnail then the file name; a file icon when it is not an image or does not load.
// SVGs go through <img> only, never inline, so they cannot run anything.
export function AttachmentChip({ file, onOpen, onRemove }) {
  const [broken, setBroken] = useState(false);
  const preview = isImageName(file.name) && !broken;
  return (
    <span className={`att-chip ${preview ? '' : 'no-preview'}`}>
      <button type="button" className="att-open" title={file.name} onClick={() => onOpen(file)} disabled={!preview}>
        <span className="att-thumb">
          {preview ? <img src={attachmentUrl(file.path)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} /> : <LuFile size={16} />}
        </span>
        <span className="att-name">{file.name}</span>
      </button>
      {onRemove && <button type="button" className="att-remove" title="Retirer" onClick={onRemove}><LuX size={10} /></button>}
    </span>
  );
}

// Full-size view; Escape or a click outside the image closes it.
export function Lightbox({ file, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="att-lightbox" onMouseDown={(e) => e.target.tagName !== 'IMG' && onClose()}>
      <figure>
        <img src={attachmentUrl(file.path)} alt={file.name} />
        <figcaption>{file.name}</figcaption>
      </figure>
      <button type="button" className="att-lightbox-close" title="Fermer (Échap)" onClick={onClose}><LuX size={16} /></button>
    </div>
  );
}
