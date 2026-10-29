// Shared materials, cached geometry and small mesh helpers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const std = (color, roughness = 0.5, metalness = 0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

export const M = {
  shell: std(0xecebe6, 0.36, 0.0),
  shell2: std(0xd2d0c9, 0.42, 0.0),
  graphite: std(0x2b2e33, 0.5, 0.45),
  dark: std(0x191b1f, 0.65, 0.25),
  alu: std(0xb4b9be, 0.3, 0.85),
  aluDark: std(0x6b7178, 0.38, 0.8),
  steel: std(0x8d939a, 0.25, 0.9),
  copper: std(0xc4783f, 0.32, 1.0),
  magN: std(0xb8473f, 0.45, 0.4),
  magS: std(0x3f6fb8, 0.45, 0.4),
  gold: std(0xd9b77a, 0.32, 0.75),
  rubber: std(0x121314, 0.92, 0.0),
  glass: std(0x0a0d12, 0.08, 0.9),
  pcb: std(0x1c5a3c, 0.6, 0.1),
  chip: std(0x111214, 0.4, 0.2),
  cable: std(0xe07b2a, 0.6, 0.0),
  cable2: std(0x2e8a6e, 0.6, 0.0),
  yellow: std(0xe9b627, 0.5, 0.1),
  red: std(0xd6453d, 0.45, 0.1),
  blue: std(0x3c7dd9, 0.45, 0.1),
  teal: std(0x3aa6a0, 0.45, 0.2),
  armBody: std(0xe6e4dd, 0.38, 0.05),
  armJoint: std(0x2f3237, 0.45, 0.5),
  cobot: std(0xcfd6dc, 0.32, 0.2),
  profile: std(0x9ea4aa, 0.35, 0.8),
  frameDark: std(0x353a40, 0.5, 0.6),
  fence: new THREE.MeshStandardMaterial({ color: 0xa8c2d8, roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  glassPanel: new THREE.MeshStandardMaterial({ color: 0xbfd6e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  belt: std(0x1e2023, 0.85, 0.0),
  pallet: std(0x4a5058, 0.5, 0.6),
  vest: std(0xf0c419, 0.7, 0.0),
  skin: std(0xc89f7f, 0.7, 0.0),
  pants: std(0x2c3440, 0.8, 0.0),
  helmet: std(0xf2f2f2, 0.4, 0.0),
  hiVis: std(0xff7a1a, 0.6, 0.0),
  emGreen: new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x35d07f, emissiveIntensity: 0.0, roughness: 0.4 }),
  emAmber: new THREE.MeshStandardMaterial({ color: 0x332611, emissive: 0xffb02e, emissiveIntensity: 0.0, roughness: 0.4 }),
  emRed: new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff3b30, emissiveIntensity: 0.0, roughness: 0.4 }),
  emBlue: new THREE.MeshStandardMaterial({ color: 0x112233, emissive: 0x4aa3ff, emissiveIntensity: 0.0, roughness: 0.4 }),
  ledCyan: new THREE.MeshStandardMaterial({ color: 0x0b1d24, emissive: 0x5fd1ff, emissiveIntensity: 1.6, roughness: 0.3 }),
  ledWarm: new THREE.MeshStandardMaterial({ color: 0x241b0b, emissive: 0xffc46b, emissiveIntensity: 1.4, roughness: 0.3 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x0b1f2a, emissive: 0x2a7fa8, emissiveIntensity: 0.7, roughness: 0.3 }),
  laser: new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.85 }),
  hit: new THREE.MeshBasicMaterial({ visible: false }),
};

const gcache = new Map();
export function geo(key, make) {
  let g = gcache.get(key);
  if (!g) { g = make(); gcache.set(key, g); }
  return g;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

export function mesh(g, mat, shadow = true) {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = shadow;
  m.receiveShadow = false;
  return m;
}

export function box(w, h, d, mat, radius = 0, shadow = true) {
  const key = `b${r3(w)}_${r3(h)}_${r3(d)}_${r3(radius)}`;
  const g = geo(key, () => radius > 0
    ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) / 2 - 1e-4))
    : new THREE.BoxGeometry(w, h, d));
  return mesh(g, mat, shadow);
}

// Cylinder along the given axis ('y' default, or 'x' / 'z').
export function cyl(rt, rb, h, mat, axis = 'y', seg = 24, shadow = true) {
  const key = `c${r3(rt)}_${r3(rb)}_${r3(h)}_${axis}_${seg}`;
  const g = geo(key, () => {
    const c = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (axis === 'x') c.rotateZ(Math.PI / 2);
    if (axis === 'z') c.rotateX(Math.PI / 2);
    return c;
  });
  return mesh(g, mat, shadow);
}

export function sph(r, mat, seg = 16, shadow = true) {
  return mesh(geo(`s${r3(r)}_${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75 | 0))), mat, shadow);
}

export function torus(R, r, mat, axis = 'y', seg = 32, shadow = true) {
  const key = `t${r3(R)}_${r3(r)}_${axis}_${seg}`;
  const g = geo(key, () => {
    const t = new THREE.TorusGeometry(R, r, 10, seg);
    if (axis === 'y') t.rotateX(Math.PI / 2);
    if (axis === 'x') t.rotateY(Math.PI / 2);
    return t;
  });
  return mesh(g, mat, shadow);
}

export function capsule(r, len, mat, axis = 'y', shadow = true) {
  const key = `k${r3(r)}_${r3(len)}_${axis}`;
  const g = geo(key, () => {
    const c = new THREE.CapsuleGeometry(r, len, 6, 14);
    if (axis === 'x') c.rotateZ(Math.PI / 2);
    if (axis === 'z') c.rotateX(Math.PI / 2);
    return c;
  });
  return mesh(g, mat, shadow);
}

export function tube(points, r, mat, shadow = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), r, 6, false);
  g.userData.own = true;
  return mesh(g, mat, shadow);
}

// Hollow ring (annulus with thickness) along y.
export function ring(R, r, h, mat, seg = 40, axis = 'y', shadow = true) {
  const key = `r${r3(R)}_${r3(r)}_${r3(h)}_${seg}_${axis}`;
  const g = geo(key, () => {
    const s = new THREE.Shape();
    s.absarc(0, 0, R, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, r, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const e = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg });
    e.translate(0, 0, -h / 2);
    if (axis === 'y') e.rotateX(Math.PI / 2);
    if (axis === 'x') e.rotateY(Math.PI / 2);
    return e;
  });
  return mesh(g, mat, shadow);
}

export function at(obj, x = 0, y = 0, z = 0) { obj.position.set(x, y, z); return obj; }
export function rot(obj, x = 0, y = 0, z = 0) { obj.rotation.set(x, y, z); return obj; }

export function group(name, ...children) {
  const g = new THREE.Group();
  if (name) g.name = name;
  for (const c of children) if (c) g.add(c);
  return g;
}

export function textTexture(text, { size = 64, color = '#d9b77a', font = '600', w = 1024, h = 128, align = 'left', family = 'Inter, "Noto Sans SC", sans-serif', bg = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.font = `${font} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillText(text, align === 'center' ? w / 2 : 8, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function floorText(text, width, opts = {}) {
  const tex = textTexture(text, opts);
  const h = width * ((opts.h || 128) / (opts.w || 1024));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: opts.opacity ?? 0.9 }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Seeded RNG so traces and serial numbers are stable per run.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(r) {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
