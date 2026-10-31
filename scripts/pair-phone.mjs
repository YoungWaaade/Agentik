// Turns phone access on (if needed) and prints the pairing link with a QR code in the terminal.
// Meant for a server without a screen: run it over SSH on the machine where Supersept runs.
//   npm run pair            → show the current link
//   npm run pair -- --rotate → new token: every paired device is logged out
import QRCode from 'qrcode';

const PORT = Number(process.env.PORT || 4317);
const BASE = `http://127.0.0.1:${PORT}`;
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

let st;
try {
  st = await (await fetch(`${BASE}/api/remote`)).json();
} catch {
  console.error(`Supersept ne répond pas sur ${BASE} : vérifie qu'il tourne (systemctl --user status supersept).`);
  process.exit(1);
}
if (st.error) { console.error(`Refusé : ${st.error}`); process.exit(1); }
if (!st.enabled) st = await (await post('/api/remote', { enabled: true })).json();
if (process.argv.includes('--rotate')) st = await (await post('/api/remote/rotate')).json();

const list = st.addresses.filter((a) => a.url);
if (!list.length) { console.error('Aucune adresse réseau trouvée (Tailscale est-il connecté ?)'); process.exit(1); }
for (const a of list) {
  console.log(`\n${a.label} — ${a.tailscale ? 'chiffré, marche partout' : 'réseau local uniquement'}`);
  console.log(a.url);
  console.log(await QRCode.toString(a.url, { type: 'terminal', small: true }));
}
console.log('Scanne le premier QR code avec l\'iPhone (Tailscale connecté), puis Partager → Sur l\'écran d\'accueil.');
console.log('Ce lien donne le contrôle de Supersept : ne le partage pas. « npm run pair -- --rotate » le révoque.');
