// Agent portrait studio (run via render.mjs): stylised art-toy busts rendered with Three.js (physical materials,
// liquid-chrome hair, studio lighting), exported as images. window.renderAgent(slug, framing).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const SIZE = 1024;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ---------- characters ----------
export const AGENTS = {
  nami: { bg: ['#4f7c9c', '#2c4a63'], accent: '#ff7a2f', skin: '#f6dccb', hair: 'bob', hairMat: 'copper', eyes: 'open', marks: 'lines', acc: ['earring'], body: '#1b2230', mouth: 'smile' },
  anastasia: { bg: ['#7a4466', '#3e2236'], accent: '#ff4fa3', skin: '#efe6e0', hair: 'afro', hairMat: 'blackChrome', eyes: 'shades', marks: 'none', acc: ['headphones'], body: '#1c1820', mouth: 'smile', lips: true },
  katerina: { bg: ['#7c8a4c', '#424c26'], accent: '#c9ff3a', skin: '#c98a5c', hair: 'curls', hairMat: 'latex', eyes: 'open', marks: 'dot', acc: ['goggles', 'earring'], body: '#262418', mouth: 'smile' },
  hammer: { bg: ['#3a7f8c', '#1d434c'], accent: '#3ee8ff', skin: '#e2a879', hair: 'pompadour', hairMat: 'blueChrome', eyes: 'visor', marks: 'bars', acc: [], body: '#14232a', mouth: 'flat' },
  robin: { bg: ['#5e5480', '#2f2945'], accent: '#a77bff', skin: '#efd2c0', hair: 'long', hairMat: 'latex', eyes: 'closed', marks: 'bars', acc: ['earring'], body: '#1b1726', mouth: 'flat' },
  claude: { bg: ['#8f978a', '#555d52'], accent: '#ff6a3d', skin: 'chrome', hair: 'none', hairMat: 'chrome', eyes: 'open', marks: 'spark', acc: [], body: '#22231f', mouth: 'none' },
};

// Head shape: unit sphere → toy head (wide cranium, small soft chin).
function deform(v) {
  const p = v.clone();
  p.x *= 0.93; p.z *= 0.97; p.y *= 1.06;
  if (p.y < 0) {
    const t = Math.min(1, -p.y / 1.06);
    const k = 1 - 0.36 * Math.pow(t, 1.7);
    p.x *= k; p.z *= 1 - 0.18 * Math.pow(t, 1.5);
    p.z += 0.07 * Math.pow(t, 2) * Math.max(0, v.z);
  }
  if (p.z < 0) p.z *= 0.95;
  return p;
}
const sph = (theta, phi) => new THREE.Vector3(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));
// Point on the head surface: theta from the top (0) down, phi around (0 = facing the camera).
const onHead = (theta, phi, lift = 0) => { const p = deform(sph(theta, phi)); return p.add(p.clone().normalize().multiplyScalar(lift)); };

function faceTexture(c) {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = c.skin === 'chrome' ? '#ffffff' : c.skin; g.fillRect(0, 0, W, H);
  if (c.skin === 'chrome') return new THREE.CanvasTexture(cv);
  // SphereGeometry: u = phi/2π with phi measured so the +z front sits at u = .25 → x = 512.
  const X = (phi) => 512 - (phi / (2 * Math.PI)) * W; // phi > 0 = character's left (screen right)
  const Y = (theta) => (theta / Math.PI) * H;
  const px = 326; // px per radian
  // soft blush
  const blush = (x, y) => { const gr = g.createRadialGradient(x, y, 0, x, y, 70); gr.addColorStop(0, 'rgba(255,120,120,.28)'); gr.addColorStop(1, 'rgba(255,120,120,0)'); g.fillStyle = gr; g.fillRect(x - 80, y - 80, 160, 160); };
  blush(X(0.55), Y(1.92)); blush(X(-0.55), Y(1.92));
  const ink = '#14131a';
  const eyeT = 1.70, eyeP = 0.42;
  if (c.eyes === 'closed') {
    g.strokeStyle = ink; g.lineWidth = 9; g.lineCap = 'round';
    for (const s of [1, -1]) {
      const x = X(s * eyeP), y = Y(eyeT);
      g.beginPath(); g.moveTo(x - 46, y - 4); g.quadraticCurveTo(x, y + 26, x + 46, y - 4); g.stroke();
      g.lineWidth = 6; g.beginPath(); g.moveTo(x + s * -46, y - 4); g.lineTo(x + s * -62, y - 14); g.stroke(); g.lineWidth = 9;
      // brows
      g.strokeStyle = '#2a2230'; g.lineWidth = 7;
      g.beginPath(); g.moveTo(x - 44, y - 62 - s * 6); g.quadraticCurveTo(x, y - 74, x + 44, y - 62 + s * 6); g.stroke();
      g.strokeStyle = ink; g.lineWidth = 9;
    }
  }
  if (c.eyes === 'open') {
    g.strokeStyle = ink; g.lineWidth = 7; g.lineCap = 'round';
    for (const s of [1, -1]) {
      const x = X(s * eyeP), y = Y(eyeT);
      g.beginPath(); g.moveTo(x - 58, y - 30); g.quadraticCurveTo(x, y - 82, x + 58, y - 30); g.stroke();
      g.beginPath(); g.moveTo(x + s * -58, y - 30); g.lineTo(x + s * -78, y - 46); g.stroke();
      g.lineWidth = 6; g.beginPath(); g.moveTo(x - 40, y - 118 + s * 4); g.quadraticCurveTo(x, y - 128, x + 40, y - 116 - s * 4); g.stroke(); g.lineWidth = 7;
    }
  }
  // graphic marks in the accent colour
  g.fillStyle = c.accent; g.strokeStyle = c.accent;
  if (c.marks === 'bars') {
    g.fillRect(X(0) - 13, Y(1.08), 26, 120);
    g.save(); g.translate(X(0.62), Y(1.95)); g.rotate(0.12); g.fillRect(-46, -26, 92, 22); g.fillRect(-40, 12, 80, 22); g.restore();
  }
  if (c.marks === 'lines') {
    g.lineWidth = 9; g.lineCap = 'round';
    for (const s of [1, -1]) for (const d of [0, 26]) { const x = X(s * 0.6), y = Y(1.98) + d; g.beginPath(); g.moveTo(x - 30, y - 10 * s * -1); g.lineTo(x + 30, y + 10 * s * -1); g.stroke(); }
  }
  if (c.marks === 'dot') { g.save(); g.translate(X(0), Y(1.18)); g.rotate(Math.PI / 4); g.fillRect(-18, -18, 36, 36); g.restore(); }
  // mouth
  g.strokeStyle = '#5a2c2a'; g.lineWidth = 8; g.lineCap = 'round';
  const my = Y(2.33);
  if (c.lips) { g.fillStyle = c.accent; g.beginPath(); g.ellipse(X(0), my + 2, 30, 13, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(X(0) - 8, my - 3, 9, 3, 0, 0, Math.PI * 2); g.fill(); }
  if (c.mouth === 'smile') { g.beginPath(); g.moveTo(X(0) - 30, my - 4); g.quadraticCurveTo(X(0), my + 16, X(0) + 30, my - 4); g.stroke(); }
  if (c.mouth === 'flat') { g.beginPath(); g.moveTo(X(0) - 22, my + 2); g.quadraticCurveTo(X(0), my + 6, X(0) + 22, my); g.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Bold printed graphic on the jumper (art-toy style), in the agent's accent.
function shirtTexture(c) {
  const W = 1024, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.fillStyle = c.body; g.fillRect(0, 0, W, H);
  const X = (phi) => ((phi / (2 * Math.PI)) * W + W) % W;
  g.fillStyle = c.accent; g.strokeStyle = '#f4efe9'; g.lineWidth = 10;
  // a big rounded swoosh on the character's right chest, wrapping onto the arm
  const x0 = X(0.42), y0 = 175;
  g.save(); g.translate(x0, y0); g.scale(0.8, 0.75); g.translate(-x0, -y0); g.lineWidth = 16;
  g.beginPath();
  g.moveTo(x0 - 120, y0 + 40);
  g.bezierCurveTo(x0 - 120, y0 - 90, x0 + 60, y0 - 110, x0 + 110, y0 - 30);
  g.bezierCurveTo(x0 + 150, y0 + 30, x0 + 90, y0 + 110, x0 + 20, y0 + 80);
  g.bezierCurveTo(x0 - 30, y0 + 60, x0 + 10, y0 + 10, x0 + 40, y0 + 20);
  g.bezierCurveTo(x0 + 10, y0 - 40, x0 - 70, y0 - 20, x0 - 60, y0 + 50);
  g.closePath(); g.fill(); g.stroke(); g.restore();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; return t;
}

function materials(c) {
  const chrome = (color = '#f2f2f6', rough = 0.035) => new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: 0.02 });
  const hair = {
    chrome: chrome(),
    copper: chrome('#ffb987', 0.05),
    blueChrome: chrome('#b9ecff', 0.04),
    blackChrome: chrome('#3a3a44', 0.06),
    latex: new THREE.MeshPhysicalMaterial({ color: '#0d0c12', metalness: 0.1, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, sheen: 0.4, sheenColor: new THREE.Color(c.accent) }),
  }[c.hairMat];
  const skin = c.skin === 'chrome'
    ? Object.assign(chrome('#eef0f5', 0.03), { map: null })
    : new THREE.MeshPhysicalMaterial({ map: faceTexture(c), roughness: 0.48, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffd6c8'), envMapIntensity: 0.55 });
  const ink = new THREE.MeshPhysicalMaterial({ color: '#07070a', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.0, envMapIntensity: 1.4 });
  const fabric = new THREE.MeshPhysicalMaterial({ color: c.body, roughness: 0.82, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(c.body).lerp(new THREE.Color('#ffffff'), 0.25), envMapIntensity: 0.4 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(c.accent).multiplyScalar(1.6), toneMapped: false });
  const accentMat = new THREE.MeshPhysicalMaterial({ color: c.accent, roughness: 0.35, clearcoat: 0.6, envMapIntensity: 0.6 });
  return { hair, skin, ink, fabric, glow, accentMat, chrome };
}

// Hair as a shell grown from the scalp: each strand follows the head profile then falls straight;
// cut(phi) gives where it stops (in head units of y), front(phi) whether it is the fringe.
function hairShell({ offset = 0.1, cut, fringe = 0.32, fringeHalf = 0.95, segs = 160, rows = 90, flare = 0 }) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const phi = (i / segs) * Math.PI * 2 - Math.PI; // -π..π, 0 = front
    const inFront = Math.abs(phi) < fringeHalf;
    const endY = inFront ? fringe + 0.05 * Math.sin(phi * 2.2) : cut(phi);
    for (let j = 0; j <= rows; j++) {
      const s = j / rows;
      // walk the profile: arc from the crown to the equator, then straight drop to endY.
      const arcLen = Math.PI / 2, dropLen = Math.max(0, -endY);
      let p;
      const lengthToFringe = endY >= 0 ? Math.acos(Math.min(1, endY / 1.06)) : arcLen + dropLen;
      const d = s * lengthToFringe;
      if (d <= arcLen) {
        p = deform(sph(d, phi));
        p.add(p.clone().normalize().multiplyScalar(offset));
      } else {
        const e = deform(sph(Math.PI / 2, phi)); e.add(e.clone().normalize().multiplyScalar(offset));
        const k = d - arcLen;
        const t = k / Math.max(dropLen, 1e-3);
        const widen = 1 + flare * t - 0.08 * Math.pow(t, 3);
        p = new THREE.Vector3(e.x * widen, -k, e.z * widen);
      }
      pos.push(p.x, p.y, p.z); uv.push(i / segs, s);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rows; j++) {
    const a = i * (rows + 1) + j, b = a + rows + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function blobCluster(group, mat, n, center, radii, rMin, rMax, seed, filter) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a));
    if (filter && !filter(dir)) { i--; continue; }
    const r = rMin + rnd() * (rMax - rMin);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mat);
    m.position.set(center.x + dir.x * radii.x, center.y + dir.y * radii.y, center.z + dir.z * radii.z);
    m.castShadow = true; group.add(m);
  }
}

function buildCharacter(c) {
  const M = materials(c);
  const root = new THREE.Group();
  const head = new THREE.Group();
  root.add(head);

  // head
  const hg = new THREE.SphereGeometry(1, 192, 128);
  const p = hg.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const d = deform(v); p.setXYZ(i, d.x, d.y, d.z); }
  hg.computeVertexNormals();
  const headMesh = new THREE.Mesh(hg, M.skin); headMesh.castShadow = headMesh.receiveShadow = true; head.add(headMesh);

  // ears
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), M.skin === M.hair ? M.skin : (c.skin === 'chrome' ? M.skin : new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c.skin).lerp(new THREE.Color('#ff7a6a'), 0.25), roughness: 0.5, sheen: 0.6, sheenColor: new THREE.Color('#ffb0a0'), envMapIntensity: 0.5 })));
    e.scale.set(0.12, 0.22, 0.17); e.position.copy(onHead(1.7, s * 1.5, -0.04)); e.rotation.y = s * 0.3;
    e.castShadow = true; head.add(e);
  }
  // nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), headMesh.material);
  if (c.nose === 'long') { nose.scale.set(0.09, 0.09, 0.42); nose.position.copy(onHead(1.95, 0, 0.2)); nose.rotation.x = 0.25; }
  else { nose.scale.set(0.075, 0.06, 0.06); nose.position.copy(onHead(2.0, 0, -0.005)); }
  if (c.skin !== 'chrome') nose.material = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c.skin).lerp(new THREE.Color('#ff6f6f'), 0.3), roughness: 0.4, sheen: 0.5, clearcoat: 0.3 });
  nose.castShadow = true; head.add(nose);

  // eyes
  if (c.eyes === 'open') {
    for (const s of [1, -1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), M.ink);
      const at = onHead(1.72, s * 0.42, -0.035);
      e.position.copy(at); e.scale.set(0.17, 0.205, 0.09);
      e.lookAt(at.clone().multiplyScalar(2)); head.add(e);
      if (c.skin === 'chrome') { const iris = new THREE.Mesh(new THREE.CircleGeometry(0.055, 32), M.glow); iris.position.copy(onHead(1.72, s * 0.42, 0.048)); iris.lookAt(iris.position.clone().multiplyScalar(2)); head.add(iris); }
    }
  }
  if (c.eyes === 'shades') {
    for (const s of [1, -1]) {
      const l = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.34, 0.08, 6, 0.09), M.ink);
      l.position.copy(onHead(1.72, s * 0.4, 0.07)); l.lookAt(l.position.clone().multiplyScalar(2)); l.rotateZ(s * -0.06); head.add(l);
      const rim = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.035, 0.02, 2, 0.01), M.glow);
      rim.position.copy(onHead(1.64, s * 0.4, 0.12)); rim.lookAt(rim.position.clone().multiplyScalar(2)); head.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 12), M.ink);
    bridge.position.copy(onHead(1.68, 0, 0.05)); bridge.rotation.z = Math.PI / 2; head.add(bridge);
  }
  if (c.eyes === 'visor') {
    const vg = new THREE.CylinderGeometry(1.06, 1.04, 0.32, 96, 1, true, -1.25, 2.5);
    const vis = new THREE.Mesh(vg, new THREE.MeshPhysicalMaterial({ color: '#0a1418', roughness: 0.03, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.8, side: THREE.DoubleSide }));
    vis.position.set(0, 0.13, 0.02); vis.scale.set(0.95, 1, 1.02); head.add(vis);
    const line = new THREE.Mesh(new THREE.CylinderGeometry(1.075, 1.075, 0.04, 96, 1, true, -1.0, 2.0), M.glow);
    line.position.set(0, 0.13, 0.02); line.scale.set(0.95, 1, 1.02); head.add(line);
  }
  if (c.marks === 'spark') {
    const sp = new THREE.Group();
    for (let i = 0; i < 8; i++) { const r = new THREE.Mesh(new RoundedBoxGeometry(0.035, i % 2 ? 0.2 : 0.3, 0.03, 2, 0.015), M.glow); r.rotation.z = (i * Math.PI) / 4; r.position.set(Math.sin(-r.rotation.z) * (i % 2 ? 0.1 : 0.15), Math.cos(r.rotation.z) * (i % 2 ? 0.1 : 0.15), 0); sp.add(r); }
    sp.position.copy(onHead(1.12, 0, 0.01)); sp.lookAt(sp.position.clone().multiplyScalar(2)); head.add(sp);
  }

  // hair
  const H = new THREE.Group(); head.add(H);
  const shell = (opts) => { const m = new THREE.Mesh(hairShell(opts), M.hair); m.material.side = THREE.DoubleSide; m.castShadow = true; H.add(m); return m; };
  if (c.hair === 'bob') {
    // sharp chrome bob (inspiration 1): sides drop to the jaw, a slanted fringe.
    shell({ offset: 0.1, fringe: 0.38, fringeHalf: 0.78, cut: (phi) => -0.78 + 0.18 * Math.cos(phi) * 0 - 0.06 * Math.abs(Math.sin(phi)), flare: 0.05 });
  }
  if (c.hair === 'long') {
    shell({ offset: 0.09, fringe: 0.36, fringeHalf: 0.72, cut: (phi) => -1.45 - 0.25 * Math.max(0, -Math.cos(phi)), flare: 0.06 });
  }
  if (c.hair === 'pompadour') {
    shell({ offset: 0.05, fringe: 0.62, fringeHalf: 0.9, cut: () => 0.1 });
    const q = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), M.hair);
    q.scale.set(0.82, 0.46, 1.0); q.position.set(0, 1.08, 0.38); q.rotation.x = -0.45; q.castShadow = true; H.add(q);
    const q2 = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), M.hair);
    q2.scale.set(0.6, 0.34, 0.62); q2.position.set(0.02, 1.0, 1.05); q2.rotation.x = -0.9; q2.castShadow = true; H.add(q2);
  }
  if (c.hair === 'afro') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), M.hair); core.scale.set(1.3, 1.0, 1.1); core.position.set(0, 0.6, -0.15); H.add(core);
    blobCluster(H, M.hair, 150, new THREE.Vector3(0, 0.6, -0.15), new THREE.Vector3(1.3, 1.0, 1.1), 0.2, 0.32, 7, (d) => !(d.z > 0.5 && d.y < 0.3));
  }
  if (c.hair === 'curls') {
    blobCluster(H, M.hair, 90, new THREE.Vector3(0, 0.45, -0.05), new THREE.Vector3(1.02, 0.82, 1.0), 0.16, 0.26, 11, (d) => d.y > -0.1 && !(d.z > 0.6 && d.y < 0.45));
  }

  // accessories
  if (c.acc.includes('headphones')) {
    for (const s of [1, -1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 48), M.chrome('#d8d8e0', 0.08));
      cup.rotation.z = Math.PI / 2; cup.position.set(s * 1.0, -0.05, -0.02); cup.castShadow = true; head.add(cup);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 16, 64), M.glow);
      ring.rotation.y = Math.PI / 2; ring.position.set(s * 1.11, -0.05, -0.02); head.add(ring);
    }
  }
  if (c.acc.includes('goggles')) {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.055, 16, 128), M.ink);
    strap.position.set(0, 0.55, 0.0); strap.rotation.x = Math.PI / 2 - 0.3; strap.scale.set(1.0, 1.04, 1); head.add(strap);
    for (const s of [1, -1]) {
      const at = onHead(0.82, s * 0.38, 0.1);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.16, 48), M.chrome('#e8e8ee', 0.05));
      rim.position.copy(at); rim.lookAt(at.clone().multiplyScalar(2)); rim.rotateX(Math.PI / 2); head.add(rim);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.19, 48), new THREE.MeshPhysicalMaterial({ color: c.accent, emissive: c.accent, emissiveIntensity: 0.5, roughness: 0.02, clearcoat: 1, envMapIntensity: 2 }));
      lens.position.copy(onHead(0.82, s * 0.38, 0.19)); lens.lookAt(lens.position.clone().multiplyScalar(2)); head.add(lens);
    }
  }
  if (c.acc.includes('earring')) {
    const at = onHead(1.95, -1.48, 0.05);
    const tag = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.3, 0.04, 2, 0.015), M.ink);
    tag.position.set(at.x - 0.02, at.y - 0.28, at.z); head.add(tag);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.01), M.glow);
    bar.position.set(at.x - 0.02, at.y - 0.28, at.z + 0.025); head.add(bar);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 24), M.chrome());
    hook.position.set(at.x - 0.02, at.y - 0.1, at.z); head.add(hook);
  }

  // neck, collar, shoulders
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 1.0, 48), c.skin === 'chrome' ? M.skin : new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c.skin).multiplyScalar(0.82), roughness: 0.5, sheen: 0.5 }));
  neck.position.set(0, -0.95, -0.05); neck.scale.set(1.12, 0.8, 1.12); neck.receiveShadow = true; root.add(neck);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.46, 0.55, 64), M.fabric);
  collar.position.set(0, -1.18, -0.05); collar.scale.set(1.1, 0.95, 1.08);
  const roll = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.05, 24, 64), M.fabric); roll.rotation.x = Math.PI / 2; roll.position.set(0, -0.98, -0.05); roll.scale.set(1.12, 1.08, 1); root.add(roll); collar.receiveShadow = collar.castShadow = true; root.add(collar);
  // shoulders: lathe profile (neck base → sloping trapezius → rounded shoulder → arm), flattened front-to-back
  const prof = [[0.42, 0], [0.62, -0.06], [0.95, -0.2], [1.35, -0.38], [1.7, -0.6], [1.92, -0.88], [2.04, -1.2], [2.1, -1.7], [2.12, -2.6]].map(([r, y]) => new THREE.Vector2(r, y));
  const torsoG = new THREE.LatheGeometry(new THREE.SplineCurve(prof).getPoints(64), 160);
  const torso = new THREE.Mesh(torsoG, Object.assign(M.fabric.clone(), { map: shirtTexture(c), color: new THREE.Color('#ffffff') }));
  torso.scale.set(1.08, 1, 0.55); torso.position.set(0, -1.42, -0.1); torso.receiveShadow = torso.castShadow = true; root.add(torso);
  // accent emblem on the chest + a thin cord, art-toy style
  const cordCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.3, -1.3, 0.38), new THREE.Vector3(0.38, -1.75, 0.78), new THREE.Vector3(0.45, -2.5, 0.98), new THREE.Vector3(0.5, -3.4, 1.0)]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(cordCurve, 64, 0.018, 8), M.accentMat));

  head.rotation.set(0.14, -0.28, 0.03);
  root.rotation.y = -0.12;
  return root;
}

// ---------- studio ----------
function studioEnv(accent) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: '#3c403b', side: THREE.BackSide }));
  env.add(room);
  const panel = (w, h, color, intensity, pos, look) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48).scale(w, h, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...(look || [0, 0, 0])); env.add(m);
  };
  panel(12, 8, '#ffffff', 3.2, [-8, 9, 8]);         // big key softbox
  panel(3, 16, '#ffd0e4', 2.4, [10, 2, 3]);          // rosy strip (inspiration 1)
  panel(16, 1.2, '#ffffff', 4, [0, 12, -2]);         // top strip
  panel(6, 10, accent, 1.6, [6, 3, -10]);            // accent kicker behind
  panel(30, 30, '#7c8577', 0.9, [0, -12, 0], [0, 0, 0]);
  panel(40, 6, '#14161a', 1, [0, -1, -14]);           // dark horizon band → crisp chrome contrast
  panel(5, 5, '#ffffff', 5, [3, 6, 10]);             // small front-top highlight
  panel(14, 1.6, '#ffffff', 3.5, [-6, 1.5, 9]);       // horizontal white band front-left
  panel(7, 9, '#ffc6dc', 2.2, [9, -1, 8]);           // big rosy card front-right
  panel(8, 12, '#050506', 1, [-11, -2, 6]);          // black flag for deep chrome darks
  panel(2, 14, '#ffffff', 3, [4, 2, 12]);            // vertical front strip // grey-green floor bounce
  panel(2, 10, '#ffffff', 2.4, [-12, 0, -4]);        // left rim strip
  const pm = new THREE.PMREMGenerator(renderer);
  return pm.fromScene(env, 0.02).texture;
}

function bgTexture([a, b]) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(256, 200, 20, 256, 260, 420);
  gr.addColorStop(0, a); gr.addColorStop(1, b);
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function grain(src, amount = 16) {
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const g = cv.getContext('2d'); g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, cv.width, cv.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return cv;
}

window.renderAgent = (slug, framing = 'bust', out = 512) => {
  const c = AGENTS[slug];
  const scene = new THREE.Scene();
  scene.background = bgTexture(c.bg);
  scene.environment = studioEnv(c.accent);
  scene.add(buildCharacter(c));
  // key, fill, coloured rim
  const key = new THREE.DirectionalLight('#fff4ea', 2.6); key.position.set(-4, 6, 6); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -5 });
  scene.add(key);
  scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a3530', 0.9));
  const rim = new THREE.DirectionalLight(c.accent, 4.5); rim.position.set(5, 2.5, -4); scene.add(rim);
  const rim2 = new THREE.DirectionalLight('#ffffff', 1.6); rim2.position.set(-5, 3, -3); scene.add(rim2);
  const cam = new THREE.PerspectiveCamera(framing === 'face' ? 21 : 22, 1, 0.1, 100);
  if (framing === 'face') { cam.position.set(0, 0.45, 9.5); cam.lookAt(0, 0.22, 0); }
  else { cam.position.set(0, 0.1, 11.5); cam.lookAt(0, -0.45, 0); }
  renderer.render(scene, cam);
  const cv = grain(renderer.domElement, 18);
  const o = document.createElement('canvas'); o.width = o.height = out;
  const g = o.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, out, out);
  return o.toDataURL('image/webp', 0.86);
};
window.studioReady = true;
