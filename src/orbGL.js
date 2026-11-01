// WebGL glass orbs (palettes in src/orb.js). One fragment shader raymarches a sphere cut into 7 swollen
// glass lobes: each lobe is the sphere's Voronoi cell around a moving direction, inflated and rounded
// (smooth max), with a thin slit to its neighbours and a hollow core holding a warm pulsing light.
// Transparent glass: the ray crosses up to 4 glass surfaces, each adding a thin fresnel rim, sharp
// reflections/speculars and palette-bound iridescence, then letting most light through (coloured
// absorption). What lies behind — dark background, pulsing core, 6 sparks circulating between the lobes
// (positions from orbState) and curling luminous wisps — is seen refracted, with per-channel dispersion.
//
// Performance: a single WebGL context for the whole page (a detached canvas). Each frame, every visible
// orb is drawn in turn in that context and copied into the orb's own 2D canvas. ≤30 fps, paused when
// the page is hidden and for orbs off screen (IntersectionObserver), one still frame under
// prefers-reduced-motion. Without WebGL the still image under the canvas stays visible.
import { PALETTES } from './orb.js';

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec3 uDirs[7];
uniform float uInfl[7];
uniform vec4 uSparks[6];
uniform float uGap;
uniform float uTime;
uniform float uPulse;
uniform vec3 uBg, uBody, uEdge, uAccent, uLight;
float gIdx;

float smin(float a, float b, float k) { float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

float map(vec3 p) {
  float best = -9.; vec3 bd = vec3(0., 0., 1.); float bi = 0.; float inf = 0.;
  for (int i = 0; i < 7; i++) { float d = dot(p, uDirs[i]); if (d > best) { best = d; bd = uDirs[i]; bi = float(i); inf = uInfl[i]; } }
  float pd = 9.;
  for (int j = 0; j < 7; j++) { vec3 dd = bd - uDirs[j]; float l = length(dd); if (l > .001) pd = min(pd, dot(p, dd / l)); }
  float d = length(p - bd * inf) - (1. - inf);   // the lobe bulges along its direction
  d = smax(d, uGap - pd, .1);                     // slit to the neighbours, rounded edges
  d = smax(d, .42 - length(p), .12);              // hollow core
  gIdx = bi;
  return d;
}
vec3 nor(vec3 p) {
  vec2 e = vec2(.0025, -.0025);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
// Transmittance of the glass layers in front of depth t (hs = depths of the crossings, ts = their factors).
vec4 hs; vec4 ts;
float transAt(float t) {
  return (t > hs.x ? ts.x : 1.) * (t > hs.y ? ts.y : 1.) * (t > hs.z ? ts.z : 1.) * (t > hs.w ? ts.w : 1.);
}
// Light living inside the orb, seen along a ray: pulsing core + sparks travelling between the lobes.
float glowPts(vec3 ro, vec3 rd, out float sparks) {
  float tc = -dot(ro, rd); float hc = length(ro + rd * tc);
  float pr = uPulse;
  float core = (exp(-hc * hc * 260. / (pr * pr)) * 3.6 + exp(-hc * hc * 18. / pr) * .4 * pr) * transAt(tc);
  sparks = 0.;
  for (int i = 0; i < 6; i++) {
    vec3 c = uSparks[i].xyz; float ts2 = dot(c - ro, rd); float d = length(ro + rd * ts2 - c);
    sparks += uSparks[i].w * (exp(-d * d * 650.) * 1.5 + exp(-d * d * 70.) * .15) * transAt(ts2);
  }
  return core;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2. - uRes) / uRes.y;
  vec3 ro = vec3(0., 0., 3.2);
  vec3 rd = normalize(vec3(uv * .34, -1.));
  float tc = -dot(ro, rd); float hc = length(ro + rd * tc);
  hs = vec4(99.); ts = vec4(1.);
  vec3 acc = vec3(0.); vec3 T = vec3(1.); vec3 bend = vec3(0.);
  vec3 tintAbs = mix(vec3(1.), (uBody + .03) / max(max(uBody.r, uBody.g), uBody.b + .03), .25);   // coloured absorption per crossing
  float b = dot(ro, rd); float h = b * b - dot(ro, ro) + 1.04 * 1.04;
  float t0 = 0., t1 = 0.;
  if (h > 0.) {
    float t = -b - sqrt(h); float tmax = -b + sqrt(h); t0 = t; t1 = tmax;
    float sgn = 1.; int k = 0;
    for (int i = 0; i < 80; i++) {
      vec3 p = ro + rd * t;
      float d = map(p) * sgn;
      if (d < .0015) {
        float idx = gIdx;
        vec3 n = nor(p); vec3 nf = dot(n, rd) < 0. ? n : -n;
        float ndv = clamp(-dot(nf, rd), 0., 1.);
        float om = 1. - ndv;
        float F = .02 + .98 * om * om * om * om * om;
        float film = ndv * 2.1 + dot(n, vec3(.35, .6, .2)) * .6 + idx * .37 + uTime * .05;
        vec3 ph = .5 + .5 * cos(6.2832 * (film + vec3(0., .33, .67)));
        vec3 irid = mix(uEdge, uAccent, ph.x) * (.6 + .6 * ph.y) + .15 * ph.z;   // iridescence within the palette
        float patchy = smoothstep(.3, 1., .5 + .5 * sin(dot(p, vec3(3.1, -2.3, 1.7)) + idx * 1.9 + uTime * .35));
        vec3 glass = mix(uBody, uAccent, patchy * .8);
        float front = k == 0 ? 1. : sgn > 0. ? .42 : .2;                                  // exit faces glow less
        vec3 rim = mix(uEdge, irid * uEdge * 2.2, .4) * pow(om, 8.) * 1.5;   // thin bright fresnel edge
        vec3 r = reflect(rd, nf);
        float env = smoothstep(.86, .95, r.y) + .7 * smoothstep(.95, .985, dot(r, normalize(vec3(-.8, .2, .3))))
                  + .5 * smoothstep(.95, .985, dot(r, normalize(vec3(.75, -.45, .3))));
        vec3 refl = mix(vec3(1.), uEdge, .2) * env * (F * 2.2 + .02);
        float s1 = pow(max(dot(nf, normalize(normalize(vec3(-.45, .75, .55)) - rd)), 0.), 900.) * 2.2;
        float s2 = pow(max(dot(nf, normalize(normalize(vec3(.6, -.5, .6)) - rd)), 0.), 400.) * .8;
        vec3 film3 = irid * (.008 + .35 * F) + glass * .012;
        acc += T * front * (rim + refl + vec3(s1 + s2) + film3);
        float a = .06 + .5 * F;                                              // mostly see-through
        vec3 f = (1. - a) * tintAbs;
        T *= f;
        float fs = (1. - a) * dot(tintAbs, vec3(.333));
        if (k == 0) { hs.x = t; ts.x = fs; } else if (k == 1) { hs.y = t; ts.y = fs; } else if (k == 2) { hs.z = t; ts.z = fs; } else { hs.w = t; ts.w = fs; }
        vec3 rr = refract(rd, nf, sgn > 0. ? .76 : 1.3);
        if (dot(rr, rr) > .5) bend += (rr - rd) * .3;                         // refraction offset of what lies behind (none on total reflection)
        sgn = -sgn; t += .035; k++;
        if (k >= 4) break;
        continue;
      }
      t += max(d * .9, .003);
      if (t > tmax) break;
    }
  }
  // What lies behind the glass, refracted, with dispersion: each channel bends a little differently.
  vec3 behind = vec3(0.); vec3 sp = vec3(0.);
  for (int c = 0; c < 3; c++) {
    float disp = 1. + (float(c) - 1.) * .16;
    vec3 dr = normalize(rd + bend * disp);
    float s; float g = glowPts(ro, dr, s);
    vec2 buv = uv + bend.xy * disp * .5;
    float bgc = (c == 0 ? uBg.r : c == 1 ? uBg.g : uBg.b) * (1.2 - .6 * dot(buv, buv));
    vec3 lc = mix(uLight, uEdge, .25);
    float lv = c == 0 ? lc.r : c == 1 ? lc.g : lc.b;
    vec3 sc = mix(uLight, uAccent, .45);
    float sv = c == 0 ? sc.r : c == 1 ? sc.g : sc.b;
    float tch = c == 0 ? T.r : c == 1 ? T.g : T.b;
    float v = bgc * tch + g * lv + s * sv;
    if (c == 0) behind.r = v; else if (c == 1) behind.g = v; else behind.b = v;
  }
  // Swirling luminous wisps inside the volume (sampled along the chord through the orb).
  vec3 wisp = vec3(0.);
  if (h > 0.) {
    vec3 dr = normalize(rd + bend);
    float dt = (t1 - t0) / 10.;
    for (int i = 0; i < 10; i++) {
      float tt = t0 + dt * (float(i) + .5);
      vec3 p = ro + dr * tt;
      float r2 = dot(p, p);
      vec3 q = p * 2.6;
      q += .7 * sin(q.yzx * 1.6 + uTime * vec3(.55, .43, .61));
      q += .35 * sin(q.zxy * 2.7 - uTime * vec3(.37, .52, .41));
      float f = abs(sin(q.x) + sin(q.y) * .8);                          // thin curling filaments
      float mask = smoothstep(.45, .95, .5 + .5 * sin(q.z * .9 + q.x * .4 + uTime * .5));
      float rib = exp(-f * 30.) * mask * smoothstep(.8, .12, r2);
      wisp += mix(uEdge, uAccent, .5 + .5 * sin(q.x + uTime * .3)) * rib * transAt(tt);
    }
    wisp *= dt * 2.2;
  }
  vec3 col = acc + behind + wisp;
  col += uEdge * .05 * smoothstep(1.12, 1., hc) * smoothstep(.9, 1., hc);
  float L = dot(col, vec3(.2126, .7152, .0722)) + 1e-4;
  col *= (1. - exp(-L * 1.3)) / L;                 // tone curve on luminance: keeps the hue
  col = min(col, 1.);
  gl_FragColor = vec4(pow(col, vec3(1. / 2.2)), 1.);
}`;
const VERT = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }';

const lin = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2);
// 7 directions spread over the sphere (Fibonacci), each one wobbling, the whole set turning slowly.
const BASE = Array.from({ length: 7 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 7, r = Math.sqrt(1 - y * y), a = i * 2.39996 + 0.6;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
});
export function orbState(time) {
  const T = time, dirs = new Float32Array(21), infl = new Float32Array(7);
  const ay = T * 0.16, ax = 0.45 * Math.sin(T * 0.11) + 0.25;
  const [cy, sy, cx, sx] = [Math.cos(ay), Math.sin(ay), Math.cos(ax), Math.sin(ax)];
  BASE.forEach(([x, y, z], i) => {
    x += 0.24 * Math.sin(T * 0.47 + i * 1.3); y += 0.24 * Math.sin(T * 0.39 + i * 2.1); z += 0.24 * Math.sin(T * 0.43 + i * 0.7);
    const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    dirs.set([x, y, z], i * 3);
    infl[i] = 0.17 + 0.1 * Math.sin(T * 0.8 + i * 1.7);
  });
  // Sparks of light circulating between the lobes (in and out of the hollow core), each one breathing.
  const sparks = new Float32Array(24);
  for (let i = 0; i < 6; i++) {
    const a = T * (0.42 + 0.09 * i) + i * 1.05, r = 0.3 + 0.32 * (0.5 + 0.5 * Math.sin(T * 0.33 + i * 2.1));
    const e = 0.75 * Math.sin(T * 0.29 + i * 1.7);
    let x = Math.cos(a) * Math.cos(e) * r, y = Math.sin(e) * r, z = Math.sin(a) * Math.cos(e) * r;
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    sparks.set([x, y, z, 0.55 + 0.45 * Math.sin(T * 1.3 + i * 2.4) ** 2], i * 4);
  }
  return { dirs, infl, sparks, pulse: 1 + 0.22 * Math.sin(T * 1.6) + 0.08 * Math.sin(T * 3.7), gap: 0.045 + 0.02 * Math.sin(T * 0.5) };
}

// Renderer on a given canvas (also used by scripts/agent-orbs.mjs for the still images).
export function createOrbRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['uRes', 'uDirs', 'uInfl', 'uGap', 'uTime', 'uSparks', 'uPulse', 'uBg', 'uBody', 'uEdge', 'uAccent', 'uLight'].map((k) => [k, gl.getUniformLocation(prog, k)]));
  const colors = {};
  return {
    gl,
    draw(w, h, palette, time) {
      if (canvas.width < w || canvas.height < h) { canvas.width = Math.max(canvas.width, w); canvas.height = Math.max(canvas.height, h); }
      const c = colors[palette] || (colors[palette] = Object.fromEntries(['bg', 'body', 'edge', 'accent', 'light'].map((k) => [k, lin(PALETTES[palette][k])])));
      const s = orbState(time);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.uRes, w, h); gl.uniform3fv(u.uDirs, s.dirs); gl.uniform1fv(u.uInfl, s.infl);
      gl.uniform1f(u.uGap, s.gap); gl.uniform1f(u.uTime, time); gl.uniform4fv(u.uSparks, s.sparks); gl.uniform1f(u.uPulse, s.pulse);
      gl.uniform3fv(u.uBg, c.bg); gl.uniform3fv(u.uBody, c.body); gl.uniform3fv(u.uEdge, c.edge); gl.uniform3fv(u.uAccent, c.accent); gl.uniform3fv(u.uLight, c.light);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// ---- shared scheduler (browser) -------------------------------------------------------------------
const FRAME_MS = 1000 / 30;
const MAX_PX = 420;
const orbs = new Set();
let R, failed = false, raf = 0, last = 0, io, reduce;

function renderer() {
  if (R || failed) return R;
  try {
    const c = document.createElement('canvas');
    c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); R = null; failed = true; for (const o of orbs) o.canvas.classList.remove('on'); });
    R = createOrbRenderer(c);
  } catch (e) { console.warn('orbes WebGL :', e); R = null; }
  if (!R) failed = true;
  return R;
}

function frame(now) {
  raf = orbs.size ? requestAnimationFrame(frame) : 0;
  if (now - last < FRAME_MS - 2 || document.hidden || !R) return;
  const dt = Math.min(now - last, 100) / 1000;
  last = now;
  const still = reduce.matches;
  for (const o of orbs) {
    if (!o.visible) continue;
    if (!still) { o.t += dt * o.rate; o.dirty = true; }
    if (!o.dirty) continue;
    const { width: w, height: h } = o.canvas;
    R.draw(w, h, o.palette, o.t);
    o.ctx.drawImage(R.gl.canvas, 0, R.gl.canvas.height - h, w, h, 0, 0, w, h);
    o.dirty = false;
    o.canvas.classList.add('on');
  }
}

// Animate an orb in `canvas` (CSS size `size` px). Returns { setBusy, dispose } or null without WebGL.
export function attachOrb(canvas, { palette, size, phase = 0, busy = false }) {
  if (!renderer()) return null;
  reduce ||= matchMedia('(prefers-reduced-motion: reduce)');
  io ||= new IntersectionObserver((entries) => { for (const e of entries) { const o = e.target.__orb; if (o) { o.visible = e.isIntersecting; o.dirty = true; } } });
  const px = Math.min(MAX_PX, Math.round(size * Math.min(window.devicePixelRatio || 1, 2)));
  canvas.width = canvas.height = px;
  const o = { canvas, ctx: canvas.getContext('2d'), palette, t: phase, rate: busy ? 2.4 : 1, visible: true, dirty: true };
  canvas.__orb = o;
  orbs.add(o);
  io.observe(canvas);
  if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  return {
    setBusy(b) { o.rate = b ? 2.4 : 1; },
    dispose() { orbs.delete(o); io.unobserve(canvas); delete canvas.__orb; },
  };
}
