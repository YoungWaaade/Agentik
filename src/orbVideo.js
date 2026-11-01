// Playback of the orb (src/orb.js) for every avatar at once: ONE muted looping <video> decodes the
// animation, and each visible orb copies its current frame onto its own small canvas, only when the video
// shows a new frame (requestVideoFrameCallback, else a rAF loop watching currentTime). The video plays only
// while at least one orb is on screen and the page is visible.
//
// Modes (shared by every orb, see useOrbMode):
//  'video' — canvases fed by the shared video (the still image shows under them until the first frame);
//  'image' — the video can't play (autoplay refused, e.g. iOS Low Power Mode, or no supported format):
//            each orb shows the animated WebP/GIF, decoded once by the browser for all of them;
//  'still' — prefers-reduced-motion: the still image only.
import { useSyncExternalStore } from 'react';
import { ORB_SOURCES } from './orb.js';

const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let failed = false;
let video = null;
let io = null;
const orbs = new Map(); // canvas → { ctx, visible, drawn }
const listeners = new Set();

const mode = () => (reduced?.matches ? 'still' : failed ? 'image' : 'video');
const emit = () => listeners.forEach((f) => f());
reduced?.addEventListener?.('change', () => { emit(); update(); });
export function useOrbMode() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, mode, () => 'still');
}

function fail() {
  if (failed) return;
  failed = true;
  video?.pause();
  emit();
}

function ensureVideo() {
  if (video) return video;
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true; v.autoplay = false;
  v.preload = 'auto';
  for (const a of ['muted', 'playsinline', 'webkit-playsinline', 'loop', 'disablepictureinpicture', 'disableremoteplayback']) v.setAttribute(a, '');
  v.setAttribute('aria-hidden', 'true');
  // In the page and inside the viewport (WebKit pauses muted videos it considers off screen), but
  // invisible and out of the way.
  Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
  for (const [src, type] of ORB_SOURCES) {
    const s = document.createElement('source');
    s.src = src; s.type = type;
    v.appendChild(s);
  }
  v.lastElementChild.addEventListener('error', fail); // the last source failed too: nothing playable
  v.addEventListener('error', fail);
  // Paused by the browser (not by us) while orbs are on screen: try again, once per pause.
  v.addEventListener('pause', () => { if (wanted()) setTimeout(update, 300); });
  document.body.appendChild(v);
  video = v;
  return v;
}

const wanted = () => mode() === 'video' && !document.hidden && [...orbs.values()].some((o) => o.visible);

let loop = 0;
function draw() {
  if (!video || video.readyState < 2) return;
  for (const [canvas, o] of orbs) {
    if (!o.visible) continue;
    o.ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (!o.drawn) { o.drawn = true; canvas.classList.add('on'); }
  }
}
function schedule() {
  if (loop || !video) return;
  if (video.requestVideoFrameCallback) {
    const tick = () => { loop = 0; draw(); if (wanted()) loop = video.requestVideoFrameCallback(tick); };
    loop = video.requestVideoFrameCallback(tick);
  } else {
    let last = -1;
    const tick = () => {
      loop = 0;
      if (video.currentTime !== last) { last = video.currentTime; draw(); }
      if (wanted()) loop = requestAnimationFrame(tick);
    };
    loop = requestAnimationFrame(tick);
  }
}

function update() {
  if (!wanted()) { if (video && !video.paused) video.pause(); return; }
  const v = ensureVideo();
  draw(); // newly visible canvases get the current frame right away
  if (v.paused) {
    const p = v.play();
    p?.then(() => schedule(), (err) => { if (err?.name === 'NotAllowedError' || err?.name === 'NotSupportedError') fail(); });
  }
  schedule();
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pageshow', update);
}

// Feeds `canvas` (CSS size `size` px) while it is on screen; returns the detach function.
export function attachOrb(canvas, size) {
  const px = Math.min(494, Math.round(size * Math.min(3, window.devicePixelRatio || 1)));
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  ctx.imageSmoothingQuality = 'high';
  orbs.set(canvas, { ctx, visible: !('IntersectionObserver' in window), drawn: false });
  if ('IntersectionObserver' in window) {
    io ||= new IntersectionObserver((entries) => {
      for (const e of entries) { const o = orbs.get(e.target); if (o) o.visible = e.isIntersecting; }
      update();
    }, { rootMargin: '64px' });
    io.observe(canvas);
  }
  update();
  return () => { io?.unobserve(canvas); orbs.delete(canvas); update(); };
}
