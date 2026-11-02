// Agent avatars: one of seven flat shapes (src/assets/bots, colours and outlines kept as drawn)
// with two little black eyes that blink, glance around, follow the mouse and squint while the
// agent works. Every avatar goes through this component.
import { useEffect, useRef } from 'react';
import lunes from '../assets/bots/lunes.svg?raw';
import etoile from '../assets/bots/etoile.svg?raw';
import pile from '../assets/bots/pile.svg?raw';
import trio from '../assets/bots/trio.svg?raw';
import sceau from '../assets/bots/sceau.svg?raw';
import fleur from '../assets/bots/fleur.svg?raw';
import soleil from '../assets/bots/soleil.svg?raw';

const V = 280; // every shape is centred in a 280×280 box
const parse = (raw) => {
  const num = (k) => Number(raw.match(new RegExp(`\\b${k}="([\\d.]+)"`))[1]);
  return { d: raw.match(/\sd="([^"]+)"/)[1], fill: raw.match(/<path[^>]*fill="([^"]+)"/)[1], ox: (V - num('width')) / 2, oy: (V - num('height')) / 2 };
};
// Eyes per shape, in the 280 box: centre (x, y), half-gap between the eyes, radii, and how far
// they may travel sideways (so they never leave the shape).
const EYES = { x: 140, y: 140, gap: 40, rx: 15, ry: 27, reach: 22 };
export const BOT_SHAPES = {
  fleur: { label: 'Fleur', ...parse(fleur), eyes: { ...EYES } },
  sceau: { label: 'Sceau', ...parse(sceau), eyes: { ...EYES } },
  trio: { label: 'Trio', ...parse(trio), eyes: { ...EYES, gap: 44 } },
  lunes: { label: 'Lunes', ...parse(lunes), eyes: { ...EYES, y: 196, gap: 38, rx: 14, ry: 24 } },
  pile: { label: 'Pile', ...parse(pile), eyes: { ...EYES, gap: 44, ry: 25 } },
  etoile: { label: 'Étoile', ...parse(etoile), eyes: { ...EYES, gap: 36 } },
  soleil: { label: 'Soleil', ...parse(soleil), eyes: { ...EYES, gap: 24, rx: 12, ry: 22, reach: 10 } },
};
const KEYS = Object.keys(BOT_SHAPES);
// Stable look for the team; any other agent gets a shape derived from its name.
const BY_AGENT = { nami: 'fleur', adi: 'sceau', franky: 'trio', katrina: 'lunes', robin: 'pile', git: 'etoile', claude: 'soleil' };
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
// `spec` is the agent's saved avatar: a shape name, or an older pixel-bot spec (ignored).
export function shapeOf(spec, seed = '') {
  if (BOT_SHAPES[spec]) return spec;
  const key = String(seed || spec || 'bot').toLowerCase();
  return BY_AGENT[key] || KEYS[hash(key) % KEYS.length];
}
export const randomShape = () => KEYS[Math.floor(Math.random() * KEYS.length)];

// One scheduler for all avatars: a single pointer listener + one rAF for mouse follow, and a
// single timer for blinks and glances. It writes transforms straight to the DOM (no React render).
const bots = new Set();
const bySvg = new WeakMap();
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const rnd = (a, b) => a + Math.random() * (b - a);
let mouse = null; // { x, y, at }
let raf = 0;
let timer = 0;
let io = null;
const FOLLOW_MS = 2500;

function look(b, x, y) {
  if (b.lx === x && b.ly === y) return;
  b.lx = x; b.ly = y;
  b.look.style.transform = x || y ? `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` : '';
}
function blink(b, now) {
  b.svg.classList.add('blink');
  setTimeout(() => b.svg.classList.remove('blink'), 120);
  // Now and then a quick double blink.
  if (Math.random() < 0.15) setTimeout(() => { b.svg.classList.add('blink'); setTimeout(() => b.svg.classList.remove('blink'), 110); }, 240);
  b.nextBlink = now + (b.running ? rnd(1500, 3500) : rnd(2500, 7000));
}
const following = (now) => mouse && now - mouse.at < FOLLOW_MS;

function follow() {
  raf = 0;
  if (!mouse || reduce.matches) return;
  for (const b of bots) {
    if (!b.visible || b.running) continue;
    const r = b.svg.getBoundingClientRect();
    if (!r.width) continue;
    const dx = mouse.x - (r.left + r.width / 2), dy = mouse.y - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 320);
    look(b, (dx / d) * k * b.reach, (dy / d) * k * b.reach * 0.6);
  }
}
function onMove(e) {
  mouse = { x: e.clientX, y: e.clientY, at: performance.now() };
  if (!raf) raf = requestAnimationFrame(follow);
}
function onLeave() { mouse = null; }

function tick() {
  if (document.hidden || reduce.matches) return;
  const now = performance.now(), track = following(now);
  for (const b of bots) {
    if (!b.visible) continue;
    if (now >= b.nextBlink) blink(b, now);
    if (track && !b.running) { b.glanceEnd = 0; continue; }
    if (b.glanceEnd && now >= b.glanceEnd) {
      // Back to the centre; a working agent keeps scanning from side to side.
      b.glanceEnd = 0;
      look(b, 0, 0);
      b.nextGlance = now + (b.running ? rnd(150, 600) : rnd(2500, 8000));
    } else if (!b.glanceEnd && now >= b.nextGlance) {
      const side = b.running ? -Math.sign(b.lastSide || 1) : Math.random() < 0.5 ? -1 : 1;
      b.lastSide = side;
      look(b, side * b.reach * (b.running ? 1 : rnd(0.7, 1)), b.running ? b.reach * 0.25 : 0);
      b.glanceEnd = now + (b.running ? rnd(400, 900) : rnd(600, 1600));
    } else if (!track && !b.glanceEnd && (b.lx || b.ly)) look(b, 0, 0); // the mouse stopped: recentre
  }
}

function register(b) {
  bots.add(b);
  bySvg.set(b.svg, b);
  if (bots.size === 1) {
    addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    timer = setInterval(tick, 100);
    io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      for (const e of entries) { const x = bySvg.get(e.target); if (x) x.visible = e.isIntersecting; }
    }) : null;
  }
  if (io) io.observe(b.svg); else b.visible = true;
}
function unregister(b) {
  bots.delete(b);
  io?.unobserve(b.svg);
  if (!bots.size) {
    removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    clearInterval(timer); cancelAnimationFrame(raf); raf = 0;
    io?.disconnect(); io = null;
  }
}

export default function BotAvatar({ spec, seed, size = 16, running = false, className = '', title }) {
  const shape = BOT_SHAPES[shapeOf(spec, seed)];
  const e = shape.eyes;
  // Small avatars get bigger eyes so the face still reads at 12–24 px.
  const k = size <= 16 ? 1.35 : size <= 24 ? 1.2 : 1;
  const svg = useRef(null), lookRef = useRef(null), bot = useRef(null);
  useEffect(() => {
    const now = performance.now();
    const b = { svg: svg.current, look: lookRef.current, reach: e.reach, lx: 0, ly: 0, visible: false, running,
      nextBlink: now + rnd(400, 6000), nextGlance: now + rnd(800, 7000), glanceEnd: 0 };
    bot.current = b;
    register(b);
    return () => unregister(b);
  }, [e.reach]);
  useEffect(() => {
    const b = bot.current;
    if (!b) return;
    b.running = running;
    b.glanceEnd = 0;
    b.nextGlance = performance.now() + rnd(100, 600);
  }, [running]);
  return (
    <svg ref={svg} className={`bot-avatar ${running ? 'running' : ''} ${className}`} width={size} height={size} viewBox={`0 0 ${V} ${V}`} aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={shape.d} fill={shape.fill} transform={`translate(${shape.ox} ${shape.oy})`} />
      <g transform={`translate(${e.x} ${e.y}) scale(${k})`}>
        <g ref={lookRef} className="bot-look">
          <ellipse className="bot-eye" cx={-e.gap} cy="0" rx={e.rx} ry={e.ry} />
          <ellipse className="bot-eye" cx={e.gap} cy="0" rx={e.rx} ry={e.ry} />
        </g>
      </g>
    </svg>
  );
}
