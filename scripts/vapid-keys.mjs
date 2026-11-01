#!/usr/bin/env node
// Writes the Web Push (VAPID) keys into the server config, ~/.config/supersept/env (never in the repository).
// Idempotent: keeps existing keys (changing them invalidates every phone's subscription).
//   node scripts/vapid-keys.mjs            add the keys if missing
//   node scripts/vapid-keys.mjs --rotate   replace them (phones re-subscribe at their next launch)
// Then restart YoungHub (sudo systemctl restart supersept) when no session is running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import webpush from 'web-push';

const file = process.env.SUPERSEPT_ENV_FILE || path.join(os.homedir(), '.config', 'supersept', 'env');
const rotate = process.argv.includes('--rotate');
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const has = (k) => new RegExp(`^${k}=.+`, 'm').test(text);

if (has('SUPERSEPT_VAPID_PUBLIC_KEY') && has('SUPERSEPT_VAPID_PRIVATE_KEY') && !rotate) {
  console.log(`Clés VAPID déjà présentes dans ${file} (rien changé ; --rotate pour les remplacer).`);
  process.exit(0);
}
text = text.split('\n').filter((l) => !/^#?\s*SUPERSEPT_VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=/.test(l) && l !== '# Web Push (notifications iPhone) : clés VAPID, générées par scripts/vapid-keys.mjs').join('\n').replace(/\n*$/, '\n');
const k = webpush.generateVAPIDKeys();
const publicUrl = /^SUPERSEPT_PUBLIC_URL=(https:\/\/\S+)/m.exec(text)?.[1];
text += `# Web Push (notifications iPhone) : clés VAPID, générées par scripts/vapid-keys.mjs
SUPERSEPT_VAPID_PUBLIC_KEY=${k.publicKey}
SUPERSEPT_VAPID_PRIVATE_KEY=${k.privateKey}
${publicUrl ? '' : '#'}SUPERSEPT_VAPID_SUBJECT=${publicUrl || 'mailto:toi@example.com'}
`;
fs.writeFileSync(file, text, { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log(`Clés VAPID écrites dans ${file}. Redémarre YoungHub quand aucune session ne tourne : sudo systemctl restart supersept`);
