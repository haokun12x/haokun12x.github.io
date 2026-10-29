import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sim } from './sim.js';
import { World } from './world.js';
import { UI } from './ui.js';
import { Lab } from './lab.js';

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
stage.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141518);
scene.fog = new THREE.Fog(0x141518, 110, 230);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x2a2622, 0.55));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.1);
sun.position.set(28, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -72, right: 72, top: 50, bottom: -50, near: 10, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
sun.target.position.set(-2, 0, 0);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.48;
controls.minDistance = 2.5;
controls.maxDistance = 190;
controls.screenSpacePanning = false;

const HOME = { target: new THREE.Vector3(-2, 0, -1), pos: new THREE.Vector3(14, 64, 74) };
camera.position.copy(HOME.pos);
controls.target.copy(HOME.target);

let sim = new Sim();
sim.warmup(3 * 3600);
const world = new World(scene, sim);

const app = {
  sim, world, renderer, speed: 20, follow: null, sel: null,
  setSpeed(s) { app.speed = s; ui.syncSpeed(); },
  setLayer(k, on) {
    world.setLayer(k, on);
    if (k === 'labels') labels.domElement.style.display = on ? '' : 'none';
    if (k === 'shadows') { renderer.shadowMap.enabled = on; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
    const i = document.querySelector(`[data-layer="${k}"]`);
    if (i) i.checked = on;
  },
  select(sel, fly = false) {
    app.sel = sel;
    world.setSelected(sel);
    ui.select(sel);
    if (fly && sel) app.focus(sel);
  },
  focus(sel) {
    if (sel.type === 'station') {
      const st = sel.ref, L = st.line.def;
      const isJ = L.id === 'J';
      fly(new THREE.Vector3(st.x, isJ ? 0.9 : 1.2, L.z - 0.4), new THREE.Vector3(st.x + (isJ ? 2.6 : 5), isJ ? 3.4 : 6.5, L.z + (isJ ? 5.2 : 10.5)));
    } else if (sel.type === 'unit' || sel.type === 'amr') {
      const p = sel.type === 'unit' ? world.unitPosition(sel.ref, new THREE.Vector3()) : new THREE.Vector3(sel.ref.x, 0.5, sel.ref.z);
      if (!p) return;
      const off = sel.type === 'unit' && sel.ref.line.id === 'J' ? new THREE.Vector3(1.4, 1.6, 2.6) : new THREE.Vector3(3.5, 3.5, 6.5);
      fly(p, p.clone().add(off));
    } else if (sel.type === 'line') app.view(sel.ref.id);
  },
  view(v) {
    if (v === 'overview') { fly(HOME.target.clone(), HOME.pos.clone()); return; }
    const l = sim.lineById[v];
    if (!l) return;
    const d = l.def;
    const cx = (d.spawnX + d.endX) / 2 + (d.id === 'J' ? -2 : 0);
    if (d.id === 'J') fly(new THREE.Vector3(cx - 4, 0.8, d.z), new THREE.Vector3(cx - 4, 11, d.z + 17));
    else fly(new THREE.Vector3(cx, 1, d.z), new THREE.Vector3(cx - 4, 24, d.z + 40));
  },
  setFollow(u) { app.follow = u; if (u) app.select({ type: 'unit', ref: u }); },
  openLab(kind) {
    const s = app.sel;
    const fromSel = s?.type === 'unit' || s?.type === 'station' ? s.ref.line.def.product : s?.type === 'line' ? s.ref.def.product : null;
    lab.open(kind || fromSel || 'humanoid');
  },
};

const ui = new UI(app);
const lab = new Lab(document.getElementById('lab'), { onClose: () => { clock.getDelta(); } });
world.onTagClick = (sel) => app.select(sel, true);
world.onUnitExit = (u) => { if (app.follow === u) app.follow = null; };

/* ---------------- camera flights ---------------- */
let flight = null;
function fly(target, pos, dur = 1.1) {
  flight = { t: 0, dur, t0: controls.target.clone(), p0: camera.position.clone(), t1: target, p1: pos };
}
controls.addEventListener('start', () => { flight = null; });

/* ---------------- picking ---------------- */
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoverDirty = false, lastMove = null, down = null;
function pickAt(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(world.pickables, false);
  let best = null;
  for (const h of hits) {
    const p = h.object.userData.pick;
    if (!p) continue;
    if (p.type !== 'station') return p;
    if (!best) best = p;
  }
  return best;
}
renderer.domElement.addEventListener('pointermove', (e) => { lastMove = e; hoverDirty = true; });
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }
  down = null;
  const p = pickAt(e);
  app.select(p, false);
});
renderer.domElement.addEventListener('dblclick', (e) => { const p = pickAt(e); if (p) app.select(p, true); });

window.addEventListener('keydown', (e) => {
  if (lab.isOpen || e.target.closest?.('input, textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (app.speed) { app.lastSpeed = app.speed; app.setSpeed(0); } else app.setSpeed(app.lastSpeed || 20);
  }
  if (e.key === 'Escape') { app.setFollow(null); app.select(null); }
  if (e.key === '0') app.view('overview');
  const k = { 1: 'J', 2: 'H', 3: 'Q', 4: 'W' }[e.key];
  if (k) app.view(k);
  if (e.key === 'l' || e.key === 'L') app.openLab();
});

/* ---------------- resize ---------------- */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

/* ---------------- loop ---------------- */
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, lowFps = 0;
const _a = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  if (lab.isOpen) { clock.getDelta(); return; }
  const dt = Math.min(0.1, clock.getDelta());
  const dts = dt * app.speed;
  if (dts > 0) {
    const n = Math.ceil(dts / 0.5);
    for (let i = 0; i < n; i++) sim.step(dts / n);
  }
  world.update(dt, dts);
  if (flight) {
    flight.t += dt;
    const k = Math.min(1, flight.t / flight.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    if (k >= 1) flight = null;
  } else if (app.follow) {
    const p = world.unitPosition(app.follow, _a);
    if (p) { const d = p.clone().sub(controls.target); controls.target.add(d); camera.position.add(d); }
  }
  controls.update();
  if (hoverDirty && lastMove) {
    hoverDirty = false;
    const h = pickAt(lastMove);
    world.setHover(h);
    renderer.domElement.style.cursor = h ? 'pointer' : '';
  }
  document.body.classList.toggle('far', camera.position.distanceTo(controls.target) > 55);
  renderer.render(scene, camera);
  labels.render(scene, camera);
  ui.tick(dt);
  // Adaptive quality: drop shadows and pixel ratio if the frame rate stays low.
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) {
    const fps = fpsN / fpsAcc;
    fpsAcc = 0; fpsN = 0;
    if (fps < 28) lowFps++; else lowFps = 0;
    if (lowFps >= 2) {
      lowFps = 0;
      if (pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.5); renderer.setPixelRatio(pixelRatio); resize(); }
      else if (renderer.shadowMap.enabled) app.setLayer('shadows', false);
    }
    document.getElementById('fps').textContent = Math.round(fps) + ' fps';
  }
}
frame();
document.body.classList.add('ready');
window.__factory = app;
