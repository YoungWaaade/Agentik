import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import http from 'node:http';
import express from 'express';
import {
  MAX_ATTACHMENT_BYTES, kindOf, previewOf, formatSize, safeName, typeLabel,
  attachmentsSummary, agentNote, defaultText, tooBigMessage,
} from '../src/attachments.js';
import { saveUpload, attachmentList, uploadHandler, TooBig } from '../server/attachments.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'att-test-'));

test('kindOf / previewOf reconnaissent les types courants', () => {
  assert.equal(kindOf('film.MOV'), 'video');
  assert.equal(kindOf('clip.webm'), 'video');
  assert.equal(kindOf('note.m4a'), 'audio');
  assert.equal(kindOf('facture.pdf'), 'pdf');
  assert.equal(kindOf('projet.zip'), 'archive');
  assert.equal(kindOf('lettre.docx'), 'doc');
  assert.equal(kindOf('budget.xlsx'), 'sheet');
  assert.equal(kindOf('data.csv'), 'sheet');
  assert.equal(kindOf('lisez-moi.txt'), 'text');
  assert.equal(kindOf('blob', 'image/png'), 'image');
  assert.equal(kindOf('inconnu.bin'), 'file');
  assert.equal(previewOf('a.mp4'), 'video');
  assert.equal(previewOf('a.mkv'), 'file'); // pas lisible par les navigateurs
  assert.equal(previewOf('a.mp3'), 'audio');
  assert.equal(previewOf('a.pdf'), 'file');
  assert.equal(previewOf('a.jpg'), 'image');
});

test('formatSize en français', () => {
  assert.equal(formatSize(512), '512 o');
  assert.equal(formatSize(1536), '1,5 Ko');
  assert.equal(formatSize(200 * 1024 * 1024), '200 Mo');
  assert.equal(formatSize(3.25 * 1024 ** 3), '3,3 Go');
  assert.equal(formatSize(undefined), '');
});

test('safeName : sûr pour le disque, le markdown et le shell', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('C:\\Users\\moi\\Relevé (mars).pdf'), 'Relevé__mars_.pdf');
  assert.equal(safeName('mon fichier.zip'), 'mon_fichier.zip');
  assert.equal(safeName('...'), 'fichier');
  const long = safeName(`${'a'.repeat(300)}.docx`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.docx'));
});

test('libellés, résumé et texte par défaut', () => {
  assert.equal(typeLabel('x.pdf'), 'PDF');
  assert.equal(attachmentsSummary([{ name: 'a.jpg' }]), 'Photo');
  assert.equal(attachmentsSummary([{ name: 'a.jpg' }, { name: 'b.png' }]), '2 photos');
  assert.equal(attachmentsSummary([{ name: 'a.pdf' }]), 'PDF');
  assert.equal(attachmentsSummary([{ name: 'a.bin' }]), 'a.bin');
  assert.equal(attachmentsSummary([{ name: 'a.pdf' }, { name: 'b.zip' }]), '2 fichiers');
  assert.equal(defaultText([{ name: 'a.png' }]), 'Regarde cette image.');
  assert.equal(defaultText([{ name: 'a.mov' }]), 'Regarde cette vidéo.');
  assert.equal(defaultText([{ name: 'a.zip' }]), 'Regarde ce fichier.');
  assert.equal(defaultText([]), '');
  assert.match(tooBigMessage('gros.mp4', 300 * 1024 * 1024), /« gros\.mp4 » est trop lourd \(300 Mo\) : 200 Mo maximum par fichier\./);
});

test("agentNote donne les chemins et prévient pour les formats illisibles par Read", () => {
  const pdf = agentNote([{ path: '/h/attachments/ab/f.pdf', name: 'f.pdf', size: 2048 }]);
  assert.match(pdf, /\/h\/attachments\/ab\/f\.pdf \(PDF, 2 Ko\)/);
  assert.doesNotMatch(pdf, /lance une session/);
  const zip = agentNote([{ path: '/h/attachments/cd/p.zip', name: 'p.zip', size: 10 }]);
  assert.match(zip, /p\.zip \(ZIP, 10 o\)/);
  assert.match(zip, /lance une session/);
  assert.equal(agentNote([]), '');
});

test('saveUpload enregistre en flux et refuse au-delà de la limite sans rien laisser', async () => {
  const root = tmp();
  const ok = await saveUpload(Readable.from([Buffer.from('bonjour '), Buffer.from('monde')]), { root, name: 'salut (1).txt' });
  assert.equal(ok.name, 'salut__1_.txt');
  assert.equal(ok.size, 13);
  assert.equal(fs.readFileSync(ok.path, 'utf8'), 'bonjour monde');

  await assert.rejects(saveUpload(Readable.from([Buffer.alloc(60), Buffer.alloc(60)]), { root, name: 'gros.bin', max: 100 }), TooBig);
  await assert.rejects(saveUpload(Readable.from([]), { root, name: 'annonce.bin', length: 101, max: 100 }), (e) => e.status === 413);
  assert.deepEqual(fs.readdirSync(root), [path.basename(path.dirname(ok.path))]); // pas de reste
});

test("attachmentList n'accepte que des fichiers du dossier des pièces jointes", async () => {
  const root = tmp();
  const a = await saveUpload(Readable.from([Buffer.from('%PDF-1.4')]), { root, name: 'doc.pdf' });
  const [f] = attachmentList([{ path: a.path, type: 'application/pdf' }], root);
  assert.deepEqual(f, { path: a.path, name: 'doc.pdf', size: 8, type: 'application/pdf' });
  assert.throws(() => attachmentList([{ path: '/etc/passwd' }], root), /introuvable/);
  assert.throws(() => attachmentList([{ path: path.join(root, '..', 'x') }], root), /introuvable/);
  assert.equal(attachmentList([{ path: a.path, type: 'bad type<script>' }], root)[0].type, undefined);
  assert.deepEqual(attachmentList(undefined, root), []);
});

test('POST /api/attachments : 200 pour un zip, 413 avec message clair au-delà de la limite', async () => {
  const root = tmp();
  const app = express();
  app.post('/up', uploadHandler(root));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/up`;
  try {
    const zip = Buffer.from('PK\x03\x04 faux zip');
    let r = await fetch(`${url}?name=${encodeURIComponent('archive photos.zip')}`, { method: 'POST', body: zip });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.name, 'archive_photos.zip');
    assert.deepEqual(fs.readFileSync(j.path), zip);

    // Annoncé trop gros : refusé tout de suite (413), sans attendre le corps.
    const big = await new Promise((resolve, reject) => {
      const rq = http.request(`${url}?name=enorme.mp4`, { method: 'POST', headers: { 'Content-Length': String(MAX_ATTACHMENT_BYTES + 1) } }, (rs) => {
        let body = '';
        rs.on('data', (c) => { body += c; });
        rs.on('end', () => resolve({ status: rs.statusCode, body: JSON.parse(body) }));
      });
      rq.on('error', reject);
      rq.write(Buffer.alloc(1024));
    });
    assert.equal(big.status, 413);
    assert.match(big.body.error, /« enorme\.mp4 » est trop lourd : 200 Mo maximum par fichier/);
  } finally { server.close(); }
});
