// The factory scene: building, lines, stations, carriers, products and AMRs, all driven by the sim.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYOUT, STATE } from './data.js';
import { M, box, cyl, at, rot, group, floorText, clamp, lerp, smooth } from './kit.js';
import { buildProduct } from './products.js';
import {
  Arm, Gantry, Operator, Andon, hmi, fencePanel, Rack, Press, VisionArch, Treadmill, TerrainTrack, NavLoop,
  LeakChamber, Dyno, LaserMarker, CalibBoard, carrierMesh, AMRMesh, armProgram, cycleInfo,
} from './equipment.js';

const _v = new THREE.Vector3();
const AMR_COLORS = { idle: 0x4fbf7f, charge: 0x4fbf7f, toPick: 0x5fd1ff, pick: 0xd9b77a, wait: 0xe5534b, toDrop: 0x5fd1ff, drop: 0xd9b77a, toCharge: 0x8a8984 };

// Merge every mesh under `root` into one mesh per material (static scenery only).
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = o.material.uuid;
    if (!byMat.has(key)) byMat.set(key, { mat: o.material, list: [], shadow: false });
    const e = byMat.get(key);
    e.list.push(g);
    e.shadow ||= o.castShadow;
  });
  const out = new THREE.Group();
  for (const { mat, list, shadow } of byMat.values()) {
    const m = new THREE.Mesh(mergeGeometries(list, false), mat);
    m.castShadow = shadow && !mat.transparent;
    m.receiveShadow = true;
    out.add(m);
    list.forEach((g) => g.dispose());
  }
  return out;
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2e32'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.02})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  g.strokeStyle = 'rgba(255,255,255,0.045)'; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke(); g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function hatchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(233,182,39,0.55)'; g.lineWidth = 10;
  for (let i = -64; i < 128; i += 32) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function tag(html, cls = 'tag') {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  const o = new CSS2DObject(el);
  o.center.set(0.5, 1);
  return o;
}

export class World {
  constructor(scene, sim) {
    this.scene = scene;
    this.pickables = [];
    this.stationViz = new Map();
    this.unitViz = new Map();
    this.amrViz = new Map();
    this.leaving = [];
    this.labels = [];
    this.layers = { labels: true, paths: false, heat: false, fences: true };
    this.time = 0;
    this.statics = new THREE.Group();
    this.fences = new THREE.Group();
    this.dyn = new THREE.Group();
    scene.add(this.dyn);
    this.buildFloor();
    this.buildBuilding();
    this.buildLogistics();
    this.sim = sim;
    for (const line of sim.lines) this.buildLine(line);
    const baked = bake(this.statics);
    baked.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(baked);
    const bf = bake(this.fences);
    this.fenceGroup = bf;
    scene.add(bf);
    this.buildSelection();
    this.bind(sim);
  }

  /* ---------------- static environment ---------------- */
  buildFloor() {
    const F = LAYOUT.floor;
    const tex = floorTexture();
    tex.repeat.set(F.w / 8, F.d / 8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(F.w, F.d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(F.cx, 0, F.cz);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;

    const yellow = new THREE.MeshBasicMaterial({ color: 0xc99a1f });
    const white = new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.55 });
    const strip = (x0, x1, z0, z1, mat, y = 0.006) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      this.statics.add(m);
      return m;
    };
    this.strip = strip;
    const [cxL, cxR] = LAYOUT.crossX;
    for (const z of Object.values(LAYOUT.aisles)) {
      for (const s of [-1, 1]) strip(cxL - 2, cxR + 2, z + s * 2.0 - 0.05, z + s * 2.0 + 0.05, yellow);
      for (let x = cxL + 1; x < cxR - 1; x += 3) strip(x, x + 1.4, z - 0.04, z + 0.04, white);
    }
    for (const x of LAYOUT.crossX) for (const s of [-1, 1]) strip(x + s * 2.0 - 0.05, x + s * 2.0 + 0.05, -32, 30, yellow);
    // Pedestrian walkway along the front.
    const walk = new THREE.MeshBasicMaterial({ color: 0x2f6b4f, transparent: true, opacity: 0.55 });
    strip(-60, 58, 30.2, 32.2, walk);
    for (let x = -58; x < 56; x += 1.2) strip(x, x + 0.5, 31.0, 31.4, white, 0.008);
    const t = floorText('人行通道 · VISITOR WALKWAY', 14, { size: 64, color: '#8fc9a8' });
    t.position.set(-40, 0.01, 31.2);
    this.statics.add(t);
    // AMR charging bay
    for (let i = 0; i < 8; i++) {
      const z = LAYOUT.chargers.z0 + i * LAYOUT.chargers.dz;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), new THREE.MeshBasicMaterial({ color: 0x1f3a48, transparent: true, opacity: 0.7 }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(LAYOUT.chargers.dockX, 0.007, z);
      this.statics.add(pad);
      const ch = at(group(), LAYOUT.chargers.x, 0, z);
      ch.add(at(box(0.3, 0.7, 0.6, M.graphite, 0.03), -0.3, 0.35, 0));
      ch.add(at(box(0.02, 0.1, 0.3, M.gold), -0.14, 0.18, 0));
      ch.add(at(box(0.02, 0.06, 0.4, M.ledCyan), -0.14, 0.6, 0));
      this.statics.add(ch);
    }
    const ct = floorText('AMR 充电区', 4, { size: 72, color: '#5fd1ff' });
    ct.position.set(-57, 0.01, LAYOUT.chargers.z0 - 2);
    this.statics.add(ct);
  }

  buildBuilding() {
    const F = LAYOUT.floor;
    const x0 = F.cx - F.w / 2, x1 = F.cx + F.w / 2, z0 = F.cz - F.d / 2, z1 = F.cz + F.d / 2;
    this.statics.add(at(box(F.w, 3.2, 0.3, M.frameDark), F.cx, 1.6, z0));
    this.statics.add(at(box(F.w, 0.6, 0.32, M.yellow), F.cx, 0.3, z0 + 0.01));
    for (const x of [x0, x1]) this.statics.add(at(box(0.3, 3.2, F.d, M.frameDark), x, 1.6, F.cz));
    for (let x = x0; x <= x1 + 0.1; x += 12) {
      for (const z of [z0 + 0.4, z1 - 0.2]) {
        this.statics.add(at(box(0.45, 9, 0.45, M.graphite), x, 4.5, z));
        this.statics.add(at(box(0.5, 1.2, 0.5, M.yellow), x, 0.6, z));
      }
    }
    const sign = floorText('EMBODIED ASSEMBLY · FLOOR 01', 30, { size: 72, color: '#d9b77a', opacity: 0.55 });
    sign.rotation.set(0, 0, 0);
    sign.position.set(-28, 2.4, z0 + 0.17);
    this.statics.add(sign);
    // Finished goods and rework areas at the right.
    const fgx = LAYOUT.fg.x;
    const hm = new THREE.MeshBasicMaterial({ map: hatchTexture(), transparent: true, depthWrite: false });
    hm.map.repeat.set(6, 20);
    const hatch = new THREE.Mesh(new THREE.PlaneGeometry(8, 34), hm);
    hatch.rotation.x = -Math.PI / 2;
    hatch.position.set(fgx + 2, 0.006, 6);
    this.statics.add(hatch);
    const t1 = floorText('成品库 FG', 6, { size: 80, color: '#d9b77a' });
    t1.rotation.z = Math.PI / 2;
    t1.position.set(fgx - 2.6, 0.01, 6);
    this.statics.add(t1);
    this.crates = [];
    for (let i = 0; i < 36; i++) {
      const c = at(box(1.1, 0.9, 0.9, new THREE.MeshStandardMaterial({ color: 0x9c7a4b, roughness: 0.85 }), 0.02), fgx + 0.2 + (i % 3) * 1.25, 0.45 + Math.floor(i / 18) * 0.92, -8 + (Math.floor(i / 3) % 6) * 5.2);
      c.visible = false;
      this.dyn.add(c);
      this.crates.push(c);
    }
    this.rework = [];
    const rw = floorText('返修区 REWORK', 6, { size: 72, color: '#e5534b' });
    rw.position.set(fgx + 2, 0.01, -14.5);
    this.statics.add(rw);
    this.statics.add(at(box(3.2, 0.85, 1.2, M.graphite, 0.03), fgx + 2, 0.425, -12));
    for (let i = 0; i < 6; i++) {
      const c = at(box(0.5, 0.35, 0.5, M.red, 0.04), fgx + 0.9 + i * 0.45, 1.03, -12);
      c.visible = false;
      this.dyn.add(c);
      this.rework.push(c);
    }
  }

  buildLogistics() {
    // J outbound buffer rack
    const J = LAYOUT.jOut;
    const r = at(group(), J.x, 0, J.z);
    for (const x of [-1.6, 1.6]) for (const z of [-0.45, 0.45]) r.add(at(box(0.06, 1.8, 0.06, M.profile), x, 0.9, z));
    for (const y of [0.4, 0.95, 1.5]) r.add(at(box(3.3, 0.04, 0.95, M.frameDark), 0, y, 0));
    this.statics.add(r);
    this.outTrays = [];
    for (let i = 0; i < 12; i++) {
      const t = at(group(), J.x - 1.1 + (i % 4) * 0.73, 0.42 + Math.floor(i / 4) * 0.55, J.z);
      t.add(at(box(0.66, 0.035, 0.44, M.pallet), 0, 0.02, 0));
      for (let k = 0; k < 8; k++) t.add(at(cyl(0.048, 0.048, 0.09, M.aluDark, 'y', 12), -0.21 + (k >> 1) * 0.14, 0.08, k & 1 ? 0.09 : -0.09));
      t.visible = false;
      this.dyn.add(t);
      this.outTrays.push(t);
    }
    this.outLabel = tag('<b>J-OUT</b><span>关节出库缓存</span><em class="v">0</em>', 'tag tag-store');
    this.outLabel.position.set(J.x, 2.6, J.z);
    this.dyn.add(this.outLabel);
    this.labels.push(this.outLabel);

    // Battery & electronics store
    const S = LAYOUT.store;
    for (let x = S.x0 + 1; x < S.x1; x += 3.4) {
      const rk = at(group(), x, 0, (S.z0 + S.z1) / 2 - 1);
      for (const dx of [-1.4, 1.4]) for (const dz of [-0.6, 0.6]) rk.add(at(box(0.08, 4.2, 0.08, M.blue), dx, 2.1, dz));
      for (const y of [0.15, 1.2, 2.25, 3.3]) {
        rk.add(at(box(2.9, 0.06, 1.3, M.yellow), 0, y, 0));
        for (let k = 0; k < 3; k++) if (Math.random() > 0.2) rk.add(at(box(0.8, 0.7, 1.0, k % 2 ? M.graphite : new THREE.MeshStandardMaterial({ color: 0x8c6d45, roughness: 0.85 }), 0.02), -0.95 + k * 0.95, y + 0.38, 0));
      }
      this.statics.add(rk);
    }
    const st = floorText('电池 & 电子料仓 · SUPERMARKET', 16, { size: 64, color: '#d9b77a' });
    st.position.set((S.x0 + S.x1) / 2, 0.01, S.z1 + 1.2);
    this.statics.add(st);
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), new THREE.MeshBasicMaterial({ color: 0x5a4a1f }));
    sp.rotation.x = -Math.PI / 2; sp.position.set(S.pick.x, 0.007, S.pick.dockZ);
    this.statics.add(sp);
    const jp = sp.clone(); jp.position.set(J.x, 0.007, J.dockZ);
    this.statics.add(jp);
  }

  /* ---------------- lines & stations ---------------- */
  buildLine(line) {
    const d = line.def;
    const L = d.endX - d.spawnX;
    const cx = (d.endX + d.spawnX) / 2;
    const zoneMat = new THREE.MeshBasicMaterial({ color: 0x3a3f45, transparent: true, opacity: 0.35, depthWrite: false });
    const halfD = d.id === 'J' ? 2.4 : 4.6;
    this.strip(d.spawnX - 1.2, d.endX + 1.2, d.z - halfD, d.z + halfD, zoneMat, 0.003);
    const title = floorText(`${d.id} · ${d.name}  ${d.en.toUpperCase()}`, d.id === 'J' ? 13 : 20, { size: 60, color: '#d9b77a', opacity: 0.75 });
    title.position.set(d.spawnX + (d.id === 'J' ? 6.5 : 10), 0.01, d.z + halfD - 0.6);
    this.statics.add(title);

    // Transport
    if (d.carrier === 'tray') {
      this.statics.add(at(box(L + 1, 0.12, 0.62, M.frameDark), cx, d.baseY - 0.08, d.z));
      this.statics.add(at(box(L + 1, 0.02, 0.5, M.belt), cx, d.baseY - 0.01, d.z));
      for (const s of [-1, 1]) this.statics.add(at(box(L + 1, 0.05, 0.04, M.profile), cx, d.baseY + 0.01, d.z + s * 0.3));
      for (let x = d.spawnX; x <= d.endX + 0.5; x += 2.2) for (const s of [-1, 1]) this.statics.add(at(box(0.05, d.baseY - 0.1, 0.05, M.profile), x, (d.baseY - 0.1) / 2, d.z + s * 0.25));
    } else if (d.carrier === 'pallet') {
      for (const s of [-1, 1]) {
        this.statics.add(at(box(L + 1, 0.1, 0.12, M.profile), cx, d.baseY - 0.06, d.z + s * 0.3));
        this.statics.add(at(box(L + 1, 0.015, 0.09, M.belt), cx, d.baseY - 0.005, d.z + s * 0.3));
      }
      for (let x = d.spawnX; x <= d.endX + 0.5; x += 2.4) {
        for (const s of [-1, 1]) this.statics.add(at(box(0.06, d.baseY - 0.1, 0.06, M.profile), x, (d.baseY - 0.1) / 2, d.z + s * 0.3));
        this.statics.add(at(box(0.05, 0.05, 0.6, M.profile), x, 0.25, d.z));
      }
    } else if (d.carrier === 'agv') {
      const tape = new THREE.MeshBasicMaterial({ color: 0x255a46 });
      this.strip(d.spawnX - 1, d.endX + 1, d.z - 0.04, d.z + 0.04, tape, 0.006);
      const qr = new THREE.MeshBasicMaterial({ color: 0x15171a });
      for (let x = d.spawnX; x <= d.endX; x += 1.2) this.strip(x - 0.06, x + 0.06, d.z - 0.06, d.z + 0.06, qr, 0.007);
    } else if (d.carrier === 'slat') {
      const sx1 = line.stations[1].x + 2.0;
      this.statics.add(at(box(sx1 - d.spawnX + 1, 0.04, 1.3, M.frameDark), (sx1 + d.spawnX) / 2, 0.02, d.z));
      for (let x = d.spawnX - 0.4; x < sx1; x += 0.3) this.statics.add(at(box(0.22, 0.012, 1.2, M.aluDark), x, 0.045, d.z));
      const tape = new THREE.MeshBasicMaterial({ color: 0x255a46 });
      this.strip(sx1, d.endX + 1, d.z - 0.04, d.z + 0.04, tape, 0.006);
    }
    // Infeed / outfeed arrows
    const arrow = floorText('▶ IN', 3, { size: 90, color: '#8a8984' });
    arrow.position.set(d.spawnX - 0.8, 0.012, d.z + (d.id === 'J' ? 0.9 : 1.6));
    this.statics.add(arrow);

    for (const st of line.stations) this.buildStation(st);
    const lt = tag(`<b>${d.id}</b><span>${d.name}</span>`, 'tag tag-line');
    lt.position.set(d.spawnX - 1.5, d.id === 'J' ? 2.2 : 3.4, d.z);
    lt.element.dataset.line = d.id;
    this.dyn.add(lt);
    this.labels.push(lt);
  }

  buildStation(st) {
    const line = st.line.def;
    const x = st.x, z = line.z;
    const isJ = line.id === 'J';
    const w = line.pitch - (isJ ? 0.5 : 0.8);
    const dep = isJ ? 3.6 : 7.4;
    const zc = isJ ? z : z - 0.4;
    const sv = { st, placers: [], ops: [], rigs: {}, arms: [], tagEl: null };
    // Pad + status border
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, dep), new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.9, transparent: true, opacity: 0.85 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.009, zc);
    pad.receiveShadow = true;
    this.dyn.add(pad);
    sv.pad = pad;
    const bm = new THREE.MeshBasicMaterial({ color: 0x4fbf7f, transparent: true, opacity: 0.9 });
    sv.borderMat = bm;
    const bw = 0.07;
    for (const [bx, bz, ww, dd] of [[x, zc - dep / 2, w, bw], [x, zc + dep / 2, w, bw], [x - w / 2, zc, bw, dep], [x + w / 2, zc, bw, dep]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, dd), bm);
      m.rotation.x = -Math.PI / 2;
      m.position.set(bx, 0.012, bz);
      this.dyn.add(m);
    }
    // Andon + HMI
    const andon = new Andon();
    at(andon.root, x + w / 2 - 0.35, 0, z + (isJ ? 1.45 : 3.1));
    if (isJ) andon.root.scale.setScalar(0.7);
    this.dyn.add(andon.root);
    sv.andon = andon;
    const h = hmi();
    at(h, x - w / 2 + 0.5, 0, z + (isJ ? 1.3 : 2.9));
    if (isJ) h.scale.setScalar(0.85);
    this.statics.add(h);

    const rackZ = z + (line.rackZ || -3.6);
    const armZ = z + (line.armZ || -1.5);
    // Back fences with an opening at the rack.
    if (!isJ) {
      const fz = rackZ + 0.55;
      const segW = (w - 3.8) / 2;
      for (const s of [-1, 1]) {
        const f = fencePanel(segW, 1.9);
        f.position.set(x + s * (1.9 + segW / 2), 0, fz);
        this.fences.add(f);
      }
    }

    const defs = st.def.equip;
    const hasPlacer = defs.some((e) => ['arm', 'gantry', 'cobot'].includes(e.t));
    if (st.def.consumes || hasPlacer) {
      if (isJ) {
        const f = at(group(), x + 0.55, 0, armZ - 0.35);
        f.add(at(cyl(0.22, 0.16, 0.25, M.alu), 0, 0.85, 0));
        f.add(at(box(0.4, 0.72, 0.4, M.frameDark), 0, 0.36, 0));
        this.statics.add(f);
      } else {
        const kind = st.def.consumes?.bat || defs.some((e) => e.t === 'gantry') ? 'bat' : 'act';
        const rack = new Rack({ w: 3.2, kind });
        rack.root.position.set(x, 0, rackZ - 0.1);
        if (st.def.consumes) { this.dyn.add(rack.root); sv.rack = rack; sv.rackKind = Object.keys(st.def.consumes)[0]; }
        else this.statics.add(rack.root);
        // AMR dock marker
        if (st.def.consumes) {
          const dm = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), new THREE.MeshBasicMaterial({ color: 0x1f3a48 }));
          dm.rotation.x = -Math.PI / 2; dm.position.set(x, 0.008, rackZ - 1.2);
          this.statics.add(dm);
        }
      }
    }

    for (const e of defs) {
      if (e.t === 'arm') {
        const arm = new Arm({ scale: e.scale || 1, tool: e.tool, ped: isJ ? 0.62 : 0.55 });
        arm.root.position.set(x + (e.dx || 0), 0, armZ);
        arm.homeYaw = -Math.PI / 2;
        arm.q[0] = arm.qt[0] = arm.homeYaw;
        arm.home(); arm.q = arm.qt.slice(); arm.apply();
        this.dyn.add(arm.root);
        const pick = isJ ? new THREE.Vector3(x + 0.55, 1.12, armZ - 0.35) : new THREE.Vector3(x + (e.dx || 0) * 0.7, 1.32, rackZ + 0.35);
        sv.placers.push({ kind: 'arm', arm, pick });
        sv.arms.push(arm);
      } else if (e.t === 'cobot') {
        const arm = new Arm({ scale: 0.72, tool: 'gripper', ped: 0.7, cobot: true });
        const zz = z + (e.side || 1) * 1.35;
        arm.root.position.set(x + (e.dx || 0), 0, zz);
        arm.homeYaw = (e.side || 1) > 0 ? Math.PI / 2 : -Math.PI / 2;
        arm.home(); arm.q = arm.qt.slice(); arm.apply();
        this.dyn.add(arm.root);
        const tz = z + (e.side || 1) * 2.15;
        const tbl = at(group(), x + (e.dx || 0) + 0.2, 0, tz);
        tbl.add(at(box(0.9, 0.05, 0.55, M.aluDark), 0, 0.82, 0));
        for (const [a, b] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) tbl.add(at(box(0.04, 0.8, 0.04, M.profile), a, 0.4, b));
        tbl.add(at(box(0.3, 0.12, 0.25, M.blue, 0.02), 0.15, 0.91, 0));
        this.statics.add(tbl);
        sv.placers.push({ kind: 'arm', arm, pick: new THREE.Vector3(x + (e.dx || 0) + 0.35, 0.98, tz) });
        sv.arms.push(arm);
      } else if (e.t === 'gantry') {
        const g = new Gantry(3.6, 5.8, 3.4);
        g.root.position.set(x, 0, z + (line.rackZ || -3.6) / 2 - 0.1);
        this.dyn.add(g.root);
        sv.placers.push({ kind: 'gantry', g, pick: new THREE.Vector3(x, 1.5, rackZ - 0.1) });
      } else if (e.t === 'operator') {
        const op = new Operator();
        const side = e.side || 1;
        const oz = z + side * 1.3;
        op.root.position.set(x + (e.dx || 0), 0, oz);
        op.spots = [new THREE.Vector3(x + (e.dx || 0) - 0.4, 0, oz), new THREE.Vector3(x + (e.dx || 0) + 0.4, 0, oz + side * 0.2)];
        op.root.rotation.y = side > 0 ? Math.PI : 0;
        this.dyn.add(op.root);
        sv.ops.push(op);
      } else if (e.t === 'vision') {
        const va = new VisionArch(isJ ? 1.6 : 3.4, isJ ? 2.0 : 2.9);
        va.root.position.set(x + (line.id === 'Q' ? 2.3 : 2.9), 0, z);
        this.dyn.add(va.root);
        sv.rigs.vision = va;
      } else if (e.t === 'press') {
        const p = new Press();
        p.root.position.set(x, 0, z);
        p.bottom = line.baseY + 0.16;
        this.dyn.add(p.root);
        sv.rigs.press = p;
      } else if (e.t === 'laser') {
        const l = new LaserMarker();
        l.root.position.set(x, 0, z);
        this.dyn.add(l.root);
        sv.rigs.laser = l;
      } else if (e.t === 'dyno') {
        const dy = new Dyno();
        dy.root.position.set(x, 0, z);
        dy.low = line.baseY + 0.2;
        this.dyn.add(dy.root);
        sv.rigs.dyno = dy;
      } else if (e.t === 'treadmill') {
        const tm = new Treadmill();
        tm.root.position.set(x, 0, z + 3.3);
        this.dyn.add(tm.root);
        sv.rigs.treadmill = tm;
        sv.demoOff = new THREE.Vector3(0, tm.surface, 3.3);
      } else if (e.t === 'terrain') {
        const tt = new TerrainTrack();
        tt.root.position.set(x, 0, z + 3.3);
        this.dyn.add(tt.root);
        sv.rigs.terrain = tt;
      } else if (e.t === 'navloop') {
        const nl = new NavLoop();
        nl.root.position.set(x, 0, z + 4.4);
        this.dyn.add(nl.root);
        sv.rigs.nav = nl;
      } else if (e.t === 'leak') {
        const lc = new LeakChamber();
        lc.root.position.set(x, 0, z);
        lc.low = line.baseY + 0.07;
        lc.top = line.baseY + 1.1;
        this.dyn.add(lc.root);
        sv.rigs.leak = lc;
      } else if (e.t === 'calib') {
        const cb = new CalibBoard();
        cb.root.position.set(x + 0.2, 0, z + 2.4);
        cb.root.rotation.y = Math.PI;
        this.dyn.add(cb.root);
        sv.rigs.calib = cb;
        const tri = at(group(), x - 1.2, 0, z + 2.2);
        tri.add(at(cyl(0.02, 0.02, 1.6, M.dark), 0, 0.8, 0));
        tri.add(at(box(0.18, 0.1, 0.12, M.dark), 0, 1.65, 0));
        this.statics.add(tri);
      }
    }

    // Hit volume
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w, isJ ? 2.4 : 3.2, dep), M.hit);
    hit.position.set(x, isJ ? 1.2 : 1.6, zc);
    hit.userData.pick = { type: 'station', ref: st };
    this.dyn.add(hit);
    this.pickables.push(hit);
    sv.hit = hit;
    sv.w = w; sv.dep = dep; sv.zc = zc;
    const t = tag(`<i class="dot"></i><b>${st.id}</b><span>${st.def.name}</span>`, 'tag tag-st');
    t.position.set(x, isJ ? 2.6 : 3.7, z - 0.4);
    t.element.addEventListener('click', (ev) => { ev.stopPropagation(); this.onTagClick?.({ type: 'station', ref: st }); });
    this.dyn.add(t);
    this.labels.push(t);
    sv.tag = t;
    sv.dot = t.element.querySelector('.dot');
    this.stationViz.set(st.id, sv);
  }

  buildSelection() {
    const mk = (color, opacity) => new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    this.selBox = mk(0xd9b77a, 1);
    this.hovBox = mk(0xf2f0ea, 0.45);
    this.selBox.visible = this.hovBox.visible = false;
    this.scene.add(this.selBox, this.hovBox);
    this.pathGroup = new THREE.Group();
    this.scene.add(this.pathGroup);
  }

  /* ---------------- dynamic objects ---------------- */
  bind(sim) {
    this.sim = sim;
    for (const l of sim.lines) for (const u of l.units) this.addUnit(u);
    for (const a of sim.amrs) this.addAmr(a);
    sim.on('spawn', (u) => this.addUnit(u));
    sim.on('exit', (u) => this.exitUnit(u));
    sim.on('amrAdd', (a) => this.addAmr(a));
    sim.on('amrRemove', (a) => this.removeAmr(a));
  }

  addUnit(u) {
    const d = u.line.def;
    const root = new THREE.Group();
    let carrier = null;
    if (d.carrier !== 'tray') { carrier = carrierMesh(d.carrier); root.add(carrier); }
    const prod = buildProduct(d.product);
    // Only large parts cast shadows; keeps the shadow pass cheap with dozens of units on the floor.
    prod.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.castShadow = o.geometry.boundingSphere.radius > 0.14;
    });
    const holder = new THREE.Group();
    holder.add(prod.root);
    holder.position.y = d.baseY;
    if (d.product === 'quadruped' || d.product === 'wheeled') prod.root.rotation.y = Math.PI / 2;
    root.add(holder);
    const size = { humanoid: [0.9, 1.9, 0.9], quadruped: [0.95, 0.75, 0.8], wheeled: [1.0, 1.55, 1.0], actuator: [0.7, 0.2, 0.5] }[d.product];
    const hit = new THREE.Mesh(new THREE.BoxGeometry(...size), M.hit);
    hit.position.y = d.baseY + size[1] / 2 - (d.product === 'actuator' ? 0 : 0.0);
    hit.userData.pick = { type: 'unit', ref: u };
    root.add(hit);
    this.pickables.push(hit);
    const nok = tag(`<b>NOK</b>`, 'tag tag-nok');
    nok.position.y = d.baseY + size[1] + 0.3;
    nok.visible = false;
    root.add(nok);
    root.position.set(u.pos, 0, d.z);
    this.dyn.add(root);
    const viz = { u, root, carrier, prod, holder, hit, size, nok, mode: '', t: Math.random() * 10, roll: 0 };
    prod.setStage(0, 0);
    this.unitViz.set(u.id, viz);
    this.syncUnit(viz, 0, 0);
  }

  exitUnit(u) {
    const viz = this.unitViz.get(u.id);
    if (!viz) return;
    this.unitViz.delete(u.id);
    this.pickables.splice(this.pickables.indexOf(viz.hit), 1);
    if (u.line.id === 'J') { this.disposeViz(viz); return; }
    viz.leave = 0;
    this.leaving.push(viz);
    if (this.onUnitExit) this.onUnitExit(u);
  }

  disposeViz(viz) {
    this.dyn.remove(viz.root);
    viz.root.traverse((o) => {
      if (o.geometry?.userData?.own) o.geometry.dispose();
      if (o.isCSS2DObject) o.element.remove();
    });
    viz.hit.geometry.dispose();
  }

  addAmr(a) {
    const m = new AMRMesh();
    m.root.position.set(a.x, 0, a.z);
    m.root.rotation.y = a.hd;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.8), M.hit);
    hit.position.y = 0.4;
    hit.userData.pick = { type: 'amr', ref: a };
    m.root.add(hit);
    this.pickables.push(hit);
    const t = tag(`<b>${a.name}</b>`, 'tag tag-amr');
    t.position.y = 1.3;
    m.root.add(t);
    this.labels.push(t);
    this.dyn.add(m.root);
    this.amrViz.set(a.id, { a, m, hit, hd: a.hd, load: undefined, tag: t, path: null });
  }

  removeAmr(a) {
    const v = this.amrViz.get(a.id);
    if (!v) return;
    this.dyn.remove(v.m.root);
    v.tag.element.remove();
    this.pickables.splice(this.pickables.indexOf(v.hit), 1);
    if (v.line) this.pathGroup.remove(v.line);
    this.amrViz.delete(a.id);
  }

  /* ---------------- per-frame ---------------- */
  update(dt, dts) {
    this.time += dt;
    const sim = this.sim;
    for (const sv of this.stationViz.values()) this.updateStation(sv, dt, dts);
    for (const viz of this.unitViz.values()) this.syncUnit(viz, dt, dts);
    for (const viz of this.leaving) {
      viz.leave += dts;
      const d = viz.u.line.def;
      const x = d.endX + viz.leave * 1.2;
      const goal = LAYOUT.fg.x - 1.5;
      viz.root.position.x = Math.min(x, goal);
      if (viz.u.nok) viz.root.position.z = lerp(d.z, -12, clamp((x - d.endX) / (goal - d.endX), 0, 1));
      else viz.root.position.z = lerp(d.z, d.z * 0.6 + 4, clamp((x - d.endX) / (goal - d.endX), 0, 1));
      if (x >= goal) {
        const s = clamp(1 - (x - goal) / 1.5, 0, 1);
        viz.root.scale.setScalar(Math.max(0.001, s));
        if (s <= 0) viz.gone = true;
      }
      viz.prod.tick(dt);
      if (d.product === 'wheeled') { viz.roll += dts * 1.2 / 0.07; viz.prod.pose('rest', 0, { roll: viz.roll }); }
    }
    for (const viz of this.leaving.filter((v) => v.gone)) this.disposeViz(viz);
    this.leaving = this.leaving.filter((v) => !v.gone);

    for (const v of this.amrViz.values()) {
      const a = v.a;
      v.m.root.position.set(a.x, 0, a.z);
      if (a.hdT != null) {
        let dd = a.hdT - v.hd;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        v.hd += dd * (1 - Math.exp(-dt * 8));
      }
      v.m.root.rotation.y = v.hd;
      if (v.load !== a.load) { v.load = a.load; v.m.setLoad(a.load); }
      v.m.setColor(AMR_COLORS[a.state] ?? 0x5fd1ff);
      if (this.layers.paths) this.updatePath(v);
      else if (v.line) v.line.visible = false;
    }

    // Logistics visuals
    const n = Math.min(12, sim.jOut.length);
    this.outTrays.forEach((t, i) => { t.visible = i < n; });
    const ov = this.outLabel.element.querySelector('.v');
    if (ov) ov.textContent = `${sim.jOut.length} 盘 · ${sim.jOut.reduce((s, x) => s + x.items.length, 0)} 件`;
    const good = sim.lines.filter((l) => l.id !== 'J').reduce((s, l) => s + l.good, 0);
    const shown = good % 37;
    this.crates.forEach((c, i) => { c.visible = i < shown; });
    const bad = sim.lines.reduce((s, l) => s + (l.id !== 'J' ? l.out - l.good : 0), 0);
    this.rework.forEach((c, i) => { c.visible = i < Math.min(6, bad); });

    this.updateMarkers();
  }

  updatePath(v) {
    const a = v.a;
    if (v.pathRef !== a.path) {
      v.pathRef = a.path;
      if (v.line) { this.pathGroup.remove(v.line); v.line.geometry.dispose(); v.line.material.dispose(); v.line = null; }
      if (a.path.length > 1) {
        const cp = new THREE.CurvePath();
        for (let i = 0; i < a.path.length - 1; i++) cp.add(new THREE.LineCurve3(new THREE.Vector3(a.path[i].x, 0.06, a.path[i].z), new THREE.Vector3(a.path[i + 1].x, 0.06, a.path[i + 1].z)));
        const g = new THREE.TubeGeometry(cp, a.path.length * 8, 0.07, 4, false);
        v.line = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: a.state === 'toDrop' ? 0xd9b77a : a.state === 'toCharge' ? 0x8a8984 : 0x5fd1ff, transparent: true, opacity: 0.8 }));
        this.pathGroup.add(v.line);
      }
    }
    if (v.line) v.line.visible = true;
  }

  updateStation(sv, dt, dts) {
    const st = sv.st;
    const state = st.state;
    sv.andon.update(state, dt);
    if (sv.lastState !== state) {
      sv.lastState = state;
      sv.dot.style.background = STATE[state].color;
      sv.tag.element.dataset.state = state;
    }
    if (this.layers.heat) {
      const a = st.acc, tot = a.work + a.idle + a.blocked + a.down + a.mat || 1;
      const u = (a.work + a.down) / tot;
      sv.borderMat.color.setHSL(0.33 - 0.33 * u, 0.7, 0.5);
      sv.pad.material.color.setHSL(0.33 - 0.33 * u, 0.45, 0.18 + 0.12 * u);
    } else {
      sv.borderMat.color.set(STATE[state].color);
      sv.pad.material.color.setHex(0x33383e);
    }
    if (sv.rack) sv.rack.setLevel(st.stock[sv.rackKind].length / st.cap[sv.rackKind]);

    const u = st.unit;
    const viz = u ? this.unitViz.get(u.id) : null;
    let p = st.progress;
    const working = viz && st.started && !st.finished;
    if (!working) p = -1;
    // Group targets for placers (round-robin assignment).
    const groups = working ? viz.prod.groupsAt(st.idx) : [];
    const P = sv.placers.length;
    sv.placers.forEach((pl, j) => {
      const targets = [];
      for (let gi = j; gi < groups.length; gi += P) targets.push(viz.prod.groupWorldCenter(st.idx, gi, new THREE.Vector3()));
      if (pl.kind === 'arm') {
        const paused = state === 'down';
        if (paused) { pl.arm.update(dt, 2); return; }
        armProgram(pl.arm, targets.length ? p : -1, pl.pick, targets, dt);
      } else if (pl.kind === 'gantry') pl.g.program(state === 'down' ? -1 : p, pl.pick, targets, dt);
    });
    for (const op of sv.ops) op.update(dt, state === 'work', viz ? viz.root.position : null);
    const R = sv.rigs;
    if (R.vision) R.vision.update(p);
    if (R.press) R.press.update(p, dt);
    if (R.leak) R.leak.update(p, dt);
    if (R.dyno) R.dyno.update(p, dt);
    if (R.laser) {
      const k = Math.floor(clamp((p - 0.1) / 0.75, 0, 0.999) * 8);
      R.laser.update(p, dt, -0.21 + (k >> 1) * 0.14, st.line.def.baseY + 0.12);
    }
    if (R.calib) R.calib.update(dt, p > 0);
    if (R.treadmill) {
      let ropeY = 2.4;
      if (viz) { viz.prod.root.updateMatrixWorld(); ropeY = viz.prod.root.localToWorld(_v.set(0, 1.55, 0)).y; }
      R.treadmill.update(dt, p > 0.15 && p < 0.85, ropeY);
    }
    // Which groups are installed so far.
    if (viz) {
      let mask = 0;
      if (working) {
        if (P > 0) {
          sv.placers.forEach((pl, j) => {
            const mine = [];
            for (let gi = j; gi < groups.length; gi += P) mine.push(gi);
            const done = cycleInfo(p, mine.length).done;
            for (let i = 0; i < done; i++) mask |= 1 << mine[i];
          });
        } else {
          for (let gi = 0; gi < groups.length; gi++) if (p >= (gi + 1) / (groups.length + 1)) mask |= 1 << gi;
        }
      } else if (st.finished) mask = -1;
      viz.stageOverride = { stage: st.idx, mask };
    }
  }

  syncUnit(viz, dt, dts) {
    const u = viz.u, d = u.line.def;
    viz.t += dt;
    viz.root.position.set(u.pos, 0, d.z);
    let stage = u.stage, mask = 0;
    if (u.st && viz.stageOverride && viz.stageOverride.stage === u.st.idx && !u.st.finished) ({ stage, mask } = viz.stageOverride);
    viz.prod.setStage(stage, mask);
    viz.stageOverride = null;
    viz.prod.tick(dt);
    viz.nok.visible = u.nok;
    // W line: self-driving after power-on (W20 done).
    if (d.product === 'wheeled') {
      const selfDrive = u.stage >= 2;
      if (viz.carrier) viz.carrier.visible = !selfDrive;
      viz.holder.position.y = selfDrive ? 0 : d.baseY;
      if (u.moving && selfDrive) viz.roll += (u.vel || 0) * dts / 0.07;
    }
    // EOL demos
    const st = u.st;
    const p = st && st.started && !st.finished ? st.progress : -1;
    const demo = st?.def.demo;
    let mode = d.product === 'humanoid' ? 'hang' : d.product === 'quadruped' ? 'stand' : 'rest';
    viz.holder.position.x = 0; viz.holder.position.z = 0; viz.holder.rotation.y = 0;
    if (d.product !== 'wheeled') viz.holder.position.y = d.baseY;
    if (demo && p >= 0) {
      const sv = this.stationViz.get(st.id);
      if (demo === 'walk') {
        const off = sv.demoOff;
        const k = p < 0.12 ? smooth(p / 0.12) : p > 0.88 ? 1 - smooth((p - 0.88) / 0.12) : 1;
        viz.holder.position.set(0, lerp(d.baseY, off.y, k) + Math.sin(Math.PI * k) * 0.25, lerp(0, off.z, k));
        viz.holder.rotation.y = Math.PI / 2 * k;
        if (p > 0.12 && p < 0.88) mode = 'walk';
        else if (k > 0.02) mode = 'stand';
      } else if (demo === 'trot') {
        const tr = sv.rigs.terrain;
        const k = p < 0.1 ? smooth(p / 0.1) : p > 0.9 ? 1 - smooth((p - 0.9) / 0.1) : 1;
        let tx = -2.2, hd = 0;
        if (p >= 0.1 && p <= 0.9) {
          const s = (p - 0.1) / 0.8 * 2;
          const tri = s % 1;
          const fwd = Math.floor(s) % 2 === 0;
          tx = fwd ? -2.2 + 4.4 * tri : 2.2 - 4.4 * tri;
          hd = fwd ? 0 : Math.PI;
          mode = 'trot';
        }
        viz.holder.position.set(lerp(0, tx, k), lerp(d.baseY, tr.heightAt(tx), k) + Math.sin(Math.PI * k) * 0.3, lerp(0, 3.3, k));
        viz.holder.rotation.y = hd;
      } else if (demo === 'drive') {
        const nl = sv.rigs.nav;
        const k = p < 0.08 ? smooth(p / 0.08) : p > 0.92 ? 1 - smooth((p - 0.92) / 0.08) : 1;
        const lp = new THREE.Vector3();
        let hd = 0;
        if (p >= 0.08 && p <= 0.92) { hd = nl.at((p - 0.08) / 0.84 * 2, lp); mode = 'drive'; }
        else nl.at(0, lp);
        viz.holder.position.set(lerp(0, lp.x, k), 0, lerp(0, lp.z + 4.4, k));
        viz.holder.rotation.y = (hd - Math.PI / 2) * k;
      } else if (demo === 'calib' && p > 0.05 && p < 0.95) mode = 'calib';
    }
    const animated = mode !== 'hang' && mode !== 'rest' || (d.product === 'wheeled');
    if (animated || viz.mode !== mode) {
      viz.prod.pose(mode, viz.t, { roll: viz.roll });
      viz.mode = mode;
      if (d.product === 'humanoid') viz.prod.root.position.y = viz.prod.bob || 0;
    }
  }

  setSelected(sel) { this.sel = sel; }
  setHover(h) { this.hov = h; }

  boxFor(s, out) {
    if (!s) return false;
    if (s.type === 'station') {
      const sv = this.stationViz.get(s.ref.id);
      if (!sv) return false;
      out.pos.copy(sv.hit.position); out.size.set(sv.w, sv.hit.geometry.parameters.height, sv.dep);
      return true;
    }
    if (s.type === 'unit') {
      const v = this.unitViz.get(s.ref.id);
      if (!v) return false;
      v.hit.getWorldPosition(out.pos);
      out.size.set(...v.size).multiplyScalar(1.08);
      return true;
    }
    if (s.type === 'amr') {
      const v = this.amrViz.get(s.ref.id);
      if (!v) return false;
      v.hit.getWorldPosition(out.pos); out.size.set(1.2, 0.9, 1.2);
      return true;
    }
    return false;
  }

  updateMarkers() {
    const o = { pos: new THREE.Vector3(), size: new THREE.Vector3() };
    for (const [b, s] of [[this.selBox, this.sel], [this.hovBox, this.hov && this.hov !== this.sel && this.hov.ref !== this.sel?.ref ? this.hov : null]]) {
      if (s && this.boxFor(s, o)) { b.visible = true; b.position.copy(o.pos); b.scale.copy(o.size); }
      else b.visible = false;
    }
  }

  unitPosition(u, out) {
    const v = this.unitViz.get(u.id);
    if (!v) return null;
    return v.hit.getWorldPosition(out);
  }

  setLayer(k, on) {
    this.layers[k] = on;
    if (k === 'fences') this.fenceGroup.visible = on;
    if (k === 'paths' && !on) for (const v of this.amrViz.values()) if (v.line) v.line.visible = false;
  }
}
