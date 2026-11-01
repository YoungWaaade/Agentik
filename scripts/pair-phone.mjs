// Turns phone access on (if needed) and gives the pairing link, as a QR code in the terminal or as an image.
// Meant for a server without a screen: run it over SSH on the machine where YoungHub runs.
//   npm run pair                         link + QR code (big, black on white)
//   npm run pair -- --compact            smaller QR code (half blocks: needs a terminal without line spacing)
//   npm run pair -- --png ~/pair.png     QR code saved as a PNG image
//   node scripts/pair-phone.mjs --png -  PNG on stdout, e.g. from the Mac:
//       ssh emre@serveur 'cd ~/supersept && node scripts/pair-phone.mjs --png -' > pair.png && open pair.png
//   npm run pair -- --all                every address, not only the best one
//   npm run pair -- --rotate             new token: every paired device is logged out
import fs from 'node:fs';
import QRCode from 'qrcode';

const PORT = Number(process.env.PORT || 4317);
const BASE = `http://127.0.0.1:${PORT}`;
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? null : (argv[i + 1] ?? ''); };
const png = opt('--png');
const toStdout = png === '-';
// Text goes to stderr when stdout carries the image.
const log = (...a) => (toStdout ? console.error(...a) : console.log(...a));
const fail = (m) => { console.error(m); process.exit(1); };
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

let st;
try {
  st = await (await fetch(`${BASE}/api/remote`)).json();
} catch {
  fail(`YoungHub ne répond pas sur ${BASE} : vérifie qu'il tourne (systemctl status supersept).`);
}
if (st.error) fail(`Refusé : ${st.error}`);
if (!st.enabled) st = await (await post('/api/remote', { enabled: true })).json();
if (argv.includes('--rotate')) st = await (await post('/api/remote/rotate')).json();

// Best first: the HTTPS address (Tailscale Serve), then Tailscale IPs, then the local network.
const rank = (a) => (a.public ? 0 : a.tailscale ? 1 : 2);
const list = st.addresses.filter((a) => a.url).sort((a, b) => rank(a) - rank(b));
if (!list.length) fail('Aucune adresse : connecte Tailscale (sudo tailscale up) ou renseigne SUPERSEPT_PUBLIC_URL dans ~/.config/supersept/env.');
const best = list[0];

if (png !== null) {
  if (png === '' ) fail('Donne un fichier : --png ~/pair.png (ou --png - pour la sortie standard)');
  const buf = await QRCode.toBuffer(best.url, { type: 'png', errorCorrectionLevel: 'M', margin: 4, scale: 12, color: { dark: '#000000', light: '#ffffff' } });
  if (toStdout) process.stdout.write(buf);
  else { fs.writeFileSync(png, buf, { mode: 0o600 }); log(`QR code enregistré : ${png}`); }
  log(best.url);
  process.exit(0);
}

// Terminal rendering with explicit colours (bright white / black backgrounds), whatever the terminal theme,
// plus the 4-module quiet zone cameras need. Default: two spaces per module, no glyph, so line spacing can't
// cut the code into stripes. --compact: half blocks, a quarter of the size.
function terminalQR(text, compact) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const n = modules.size, q = 4;
  const dark = (x, y) => x >= 0 && y >= 0 && x < n && y < n && modules.get(y, x);
  const W = '\x1b[107m', B = '\x1b[40m', R = '\x1b[0m';
  const rows = [];
  if (!compact) {
    for (let y = -q; y < n + q; y++) {
      let line = '';
      for (let x = -q; x < n + q; x++) line += (dark(x, y) ? B : W) + '  ';
      rows.push(line + R);
    }
  } else {
    // Upper half block: foreground = top module, background = bottom module.
    for (let y = -q; y < n + q; y += 2) {
      let line = '';
      for (let x = -q; x < n + q; x++) {
        line += `\x1b[${dark(x, y) ? 30 : 97};${dark(x, y + 1) ? 40 : 107}m▀`;
      }
      rows.push(line + R);
    }
  }
  return rows.join('\n');
}

for (const a of argv.includes('--all') ? list : [best]) {
  log(`\n${a.label} — ${a.public ? 'HTTPS, chiffré, marche partout avec Tailscale' : a.tailscale ? 'chiffré par Tailscale, sans HTTPS' : 'réseau local uniquement'}`);
  log(a.url + '\n');
  log(terminalQR(a.url, argv.includes('--compact')));
}
log('\nScanne-le avec l\'appareil photo de l\'iPhone (Tailscale allumé), ouvre dans Safari, puis Partager → Sur l\'écran d\'accueil.');
log('QR code illisible ? --compact, ou --png ~/pair.png. Ce lien donne le contrôle de YoungHub : ne le partage pas (--rotate le révoque).');
