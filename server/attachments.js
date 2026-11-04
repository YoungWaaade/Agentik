// Pièces jointes du chat : enregistrement sur disque (en flux, sans tout charger en mémoire) et validation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, safeName, tooBigMessage } from '../src/attachments.js';

export class TooBig extends Error {
  constructor(name, size) { super(tooBigMessage(name, size)); this.status = 413; }
}

// Écrit le flux `input` dans <root>/<id>/<nom>. Refuse (413) au-delà de `max` octets, en annonce
// (Content-Length) ou en cours de route, et ne laisse alors aucun fichier partiel.
export async function saveUpload(input, { root, name, length, max = MAX_ATTACHMENT_BYTES }) {
  const clean = safeName(name);
  if (Number(length) > max) { input.resume?.(); throw new TooBig(clean, Number(length)); }
  const dir = path.join(root, crypto.randomBytes(5).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, clean);
  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > max) cb(new TooBig(clean, size));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(input, counter, fs.createWriteStream(file));
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return { path: file, name: clean, size };
}

// Pièces jointes d'un message : seulement des fichiers enregistrés par /api/attachments.
export function attachmentList(list, root) {
  const base = path.resolve(root) + path.sep;
  return (Array.isArray(list) ? list : []).slice(0, MAX_ATTACHMENTS).map((a) => {
    const file = path.resolve(String(a?.path || ''));
    if (!file.startsWith(base) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('pièce jointe introuvable');
    const out = { path: file, name: path.basename(file), size: fs.statSync(file).size };
    if (typeof a.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(a.type)) out.type = a.type;
    return out;
  });
}

// POST /api/attachments?name=… (corps = le fichier brut).
export const uploadHandler = (root) => async (req, res) => {
  try {
    res.json(await saveUpload(req, { root, name: String(req.query.name || 'fichier'), length: req.get('Content-Length') }));
  } catch (e) {
    if (!res.headersSent) res.status(e.status || 400).set('Connection', 'close').json({ error: e.status ? e.message : `envoi interrompu : ${e.message}` });
  }
};
