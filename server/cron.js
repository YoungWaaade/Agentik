// Pure scheduling rules (no database): 5-field cron expressions read in the server's local time
// (Europe/Paris on the VPS), "every N minutes/hours" intervals, end dates. Shared by the scheduler and tests.

const ALIASES = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *' };
const FIELDS = [['minute', 0, 59], ['heure', 0, 23], ['jour du mois', 1, 31], ['mois', 1, 12], ['jour de semaine', 0, 7]];

function field(src, [name, lo, hi]) {
  const set = new Set();
  for (const part of src.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron invalide (${name} : « ${part} »)`);
    const step = m[4] ? Number(m[4]) : 1;
    let a = m[1] === '*' ? lo : Number(m[2]);
    let b = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a;
    if (step < 1 || a < lo || b > hi || a > b) throw new Error(`cron invalide (${name} : « ${part} », de ${lo} à ${hi})`);
    for (let v = a; v <= b; v += step) set.add(v);
  }
  return set;
}

export function parseCron(expr) {
  const src = String(expr || '').trim();
  const parts = (ALIASES[src] || src).split(/\s+/);
  if (parts.length !== 5) throw new Error('cron invalide : 5 champs attendus « minute heure jour mois jour-de-semaine » (ex. « 17 */2 * * * »)');
  const [min, hour, dom, mon, dow] = parts.map((p, i) => field(p, FIELDS[i]));
  if (dow.has(7)) dow.add(0);
  return { min, hour, dom, mon, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

const dayMatches = (c, d) => {
  if (!c.mon.has(d.getMonth() + 1)) return false;
  const byDom = c.dom.has(d.getDate());
  const byDow = c.dow.has(d.getDay());
  // Classic cron: when both day fields are restricted, either one is enough.
  if (!c.domAny && !c.dowAny) return byDom || byDow;
  return c.domAny ? byDow : byDom;
};

// First matching minute strictly after `from` (ms), or null within ~5 years.
export function nextCron(expr, from = Date.now()) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from + 5 * 366 * 86400_000;
  while (d.getTime() < limit) {
    if (!dayMatches(c, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!c.hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!c.min.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    return d.getTime();
  }
  return null;
}

// "90", "90m", "2h", "1d", "1h30" → minutes.
export function parseEvery(v) {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(?:(\d+)(?:d|j))?(?:(\d+)h)?(?:(\d+)(?:m|min)?)?$/.exec(s);
  const min = m ? (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) : 0;
  if (!s || !m || !min) throw new Error('intervalle invalide (--every) : ex. 30m, 2h, 1h30, 1d');
  return min;
}

// "AAAA-MM-JJ" → end of that day (local time); also accepts a full date-time.
export function parseUntil(v) {
  if (!v) return null;
  const s = String(v).trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const t = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 23, 59, 59, 999).getTime() : Date.parse(s);
  if (!Number.isFinite(t)) throw new Error('date de fin invalide (--until AAAA-MM-JJ)');
  return t;
}

// Next run of a task after `from`, or null when it's over (past its end date).
export function nextRun(task, from = Date.now()) {
  const t = task.cron ? nextCron(task.cron, from) : from + task.every_min * 60_000;
  return t === null || (task.until && t > task.until) ? null : t;
}

// Human wording of a frequency, for the Tasks page and the wake-up message.
const hm = (h, m) => `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} et ${a[a.length - 1]}` : a[0]);

export function describeEvery(min) {
  const n = Number(min);
  if (!n) return '';
  if (n % 1440 === 0) return n === 1440 ? 'tous les jours' : `tous les ${n / 1440} jours`;
  if (n === 60) return 'toutes les heures';
  if (n < 60) return `toutes les ${n} min`;
  return `toutes les ${Math.floor(n / 60)} h${n % 60 ? ` ${String(n % 60).padStart(2, '0')}` : ''}`;
}

export function describeCron(expr) {
  const src = String(expr || '').trim();
  const raw = `cron « ${src} »`;
  let c;
  try { c = parseCron(src); } catch { return raw; }
  const [mi, ho, dom, mon, dow] = (ALIASES[src] || src).split(/\s+/);
  if (mon !== '*') return raw;
  const one = (s) => /^\d+$/.test(s);
  const sorted = (set) => [...set].sort((a, b) => a - b);
  // Day part.
  let days;
  if (dom === '*' && dow === '*') days = '';
  else if (dom === '*') {
    const d = sorted(c.dow).filter((x, i, a) => !(x === 7 && a.includes(0)));
    days = d.join() === '1,2,3,4,5' ? 'en semaine' : d.join() === '0,6' ? 'le week-end' : `le ${list(d.map((x) => DAYS[x % 7]))}`;
  } else if (dow === '*' && one(dom)) days = `le ${dom === '1' ? '1er' : dom} du mois`;
  else return raw;
  // Time part.
  if (mi.startsWith('*/') && ho === '*' && !days) return describeEvery(Number(mi.slice(2)));
  if (mi === '*' && ho === '*' && !days) return 'toutes les minutes';
  if (!one(mi)) return raw;
  const m = Number(mi);
  if (ho === '*') return `toutes les heures à :${String(m).padStart(2, '0')}${days ? `, ${days}` : ''}`;
  const step = /^\*\/(\d+)$/.exec(ho);
  if (step) return `toutes les ${step[1]} h à :${String(m).padStart(2, '0')}${days ? `, ${days}` : ''}`;
  if (!/^\d+(,\d+)*$/.test(ho)) return raw;
  const at = `à ${list(ho.split(',').map(Number).sort((a, b) => a - b).map((h) => hm(h, m)))}`;
  return days ? `${days} ${at}` : `tous les jours ${at}`;
}

export const describeFrequency = (t) => (t.cron ? describeCron(t.cron) : describeEvery(t.every_min));
