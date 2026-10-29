// Station equipment: articulated robots with analytic IK, gantries, test rigs and line furniture.
import * as THREE from 'three';
import { M, box, cyl, sph, torus, capsule, at, rot, group, clamp, lerp, smooth, textTexture } from './kit.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/* ------------------------------------------------------------------ */
/* 6-axis arm with position IK (yaw + planar 2-link + wrist pitch)      */
/* ------------------------------------------------------------------ */
export class Arm {
  constructor({ scale = 1, tool = 'gripper', ped = 0.55, cobot = false } = {}) {
    const s = scale;
    this.s = s;
    this.tool = tool;
    this.root = new THREE.Group();
    const body = cobot ? M.cobot : M.armBody;
    const jm = cobot ? M.aluDark : M.armJoint;
    if (ped > 0) {
      this.root.add(at(box(0.36 * s, ped, 0.36 * s, M.frameDark, 0.02), 0, ped / 2, 0));
      this.root.add(at(box(0.5 * s, 0.02, 0.5 * s, M.steel), 0, 0.01, 0));
    }
    this.root.add(at(cyl(0.19 * s, 0.22 * s, 0.12 * s, jm), 0, ped + 0.06 * s, 0));
    this.L1 = 0.72 * s; this.L2 = 0.66 * s;
    this.so = 0.1 * s; this.sh = 0.27 * s;
    this.h0 = ped + 0.12 * s;
    const j1 = at(group(), 0, this.h0, 0);
    this.root.add(j1);
    j1.add(at(cyl(0.16 * s, 0.18 * s, 0.18 * s, body), 0, 0.09 * s, 0));
    j1.add(at(box(0.22 * s, 0.2 * s, 0.3 * s, body, 0.05 * s), this.so * 0.6, this.sh, 0));
    const j2 = at(group(), this.so, this.sh, 0);
    j1.add(j2);
    j2.add(cyl(0.12 * s, 0.12 * s, 0.3 * s, jm, 'z'));
    j2.add(at(box(this.L1, 0.17 * s, 0.16 * s, body, 0.05 * s), this.L1 / 2, 0, 0));
    if (!cobot) j2.add(at(cyl(0.07 * s, 0.07 * s, 0.1 * s, M.gold, 'z'), 0, 0, 0.16 * s));
    const j3 = at(group(), this.L1, 0, 0);
    j2.add(j3);
    j3.add(cyl(0.1 * s, 0.1 * s, 0.24 * s, jm, 'z'));
    j3.add(at(box(this.L2, 0.12 * s, 0.13 * s, body, 0.04 * s), this.L2 / 2, 0, 0));
    j3.add(at(cyl(0.075 * s, 0.075 * s, 0.16 * s, body, 'x'), -0.02 * s, 0.0, 0));
    const j5 = at(group(), this.L2, 0, 0);
    j3.add(j5);
    j5.add(cyl(0.062 * s, 0.062 * s, 0.15 * s, jm, 'z'));
    const j6 = at(group(), 0.075 * s, 0, 0);
    j5.add(j6);
    j6.add(at(cyl(0.05 * s, 0.05 * s, 0.03 * s, M.steel, 'x'), 0.015 * s, 0, 0));
    const tg = at(group(), 0.03 * s, 0, 0);
    j6.add(tg);
    let lt = 0.18 * s;
    this.fingers = [];
    if (tool === 'gripper') {
      tg.add(at(box(0.07 * s, 0.1 * s, 0.14 * s, M.graphite, 0.01), 0.035 * s, 0, 0));
      for (const k of [1, -1]) {
        const f = at(box(0.11 * s, 0.03 * s, 0.025 * s, M.aluDark), 0.12 * s, 0, 0.045 * s * k);
        tg.add(f);
        this.fingers.push({ m: f, k });
      }
      lt = 0.17 * s;
    } else if (tool === 'spindle') {
      tg.add(at(cyl(0.05 * s, 0.05 * s, 0.16 * s, M.graphite, 'x'), 0.08 * s, 0, 0));
      tg.add(at(cyl(0.035 * s, 0.035 * s, 0.03 * s, M.gold, 'x'), 0.17 * s, 0, 0));
      this.bit = at(cyl(0.012 * s, 0.006 * s, 0.08 * s, M.steel, 'x', 6), 0.22 * s, 0, 0);
      tg.add(this.bit);
      lt = 0.26 * s;
    } else if (tool === 'nozzle') {
      tg.add(at(cyl(0.04 * s, 0.04 * s, 0.12 * s, M.graphite, 'x'), 0.06 * s, 0, 0));
      tg.add(at(cyl(0.03 * s, 0.03 * s, 0.08 * s, M.alu, 'x'), 0.0, 0.06 * s, 0));
      tg.add(at(cyl(0.004 * s, 0.018 * s, 0.08 * s, M.steel, 'x', 8), 0.16 * s, 0, 0));
      lt = 0.2 * s;
    }
    this.lt = 0.105 * s + lt;
    this.carry = at(box(0.12 * s, 0.1 * s, 0.12 * s, M.gold, 0.01), 0.075 * s + lt - 0.02 * s, 0, 0);
    this.carry.visible = false;
    j6.add(this.carry);
    Object.assign(this, { j1, j2, j3, j5, j6, tg });
    this.q = [0, 0.7, -1.7, -0.6];
    this.qt = this.q.slice();
    this.grip = 0;
    this.spin = 0;
    this.homeYaw = 0;
    this.apply();
  }

  // Target the tool tip at world point p with tool pitch phi (rad, -PI/2 = pointing down).
  solve(p, phi = -Math.PI / 2) {
    const l = this.root.worldToLocal(_v.copy(p));
    const th = Math.atan2(-l.z, l.x);
    const r = Math.hypot(l.x, l.z);
    const wr = r - this.lt * Math.cos(phi) - this.so;
    const wy = l.y - this.lt * Math.sin(phi) - (this.h0 + this.sh);
    const { L1, L2 } = this;
    const D = clamp(Math.hypot(wr, wy), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    const b = -Math.acos(clamp((D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const a = Math.atan2(wy, wr) - Math.atan2(L2 * Math.sin(b), L1 + L2 * Math.cos(b));
    this.qt[0] = th; this.qt[1] = a; this.qt[2] = b; this.qt[3] = phi - a - b;
  }

  home() { this.qt[0] = this.homeYaw; this.qt[1] = 0.75; this.qt[2] = -1.85; this.qt[3] = -0.5; }

  update(dt, k = 14) {
    for (let i = 0; i < 4; i++) {
      let d = this.qt[i] - this.q[i];
      if (i === 0) d = Math.atan2(Math.sin(d), Math.cos(d));
      this.q[i] += d * (1 - Math.exp(-k * dt));
    }
    if (this.bit) this.bit.rotation.x += this.spin * dt;
    this.apply();
  }

  apply() {
    this.j1.rotation.y = this.q[0];
    this.j2.rotation.z = this.q[1];
    this.j3.rotation.z = this.q[2];
    this.j5.rotation.z = this.q[3];
    for (const f of this.fingers) f.m.position.z = (0.045 - 0.022 * this.grip) * this.s * f.k;
  }

  tip(out) { return this.tg.localToWorld(out.set(this.lt - 0.105 * this.s, 0, 0)); }
}

// Pick-and-place program mapped onto station progress p ∈ [0,1].
// targets: world points for each cycle; returns the number of completed placements.
export const CYCLE = { p0: 0.04, p1: 0.92, place: 0.64 };
export function cycleInfo(p, n) {
  if (n <= 0 || p < CYCLE.p0) return { k: -1, u: 0, done: 0 };
  if (p >= CYCLE.p1) return { k: n, u: 0, done: n };
  const L = (CYCLE.p1 - CYCLE.p0) / n;
  const x = (p - CYCLE.p0) / L;
  const k = Math.min(n - 1, Math.floor(x));
  const u = x - k;
  return { k, u, done: k + (u >= CYCLE.place ? 1 : 0) };
}

const arc = (a, b, s, h, out) => {
  const e = smooth(clamp(s, 0, 1));
  out.lerpVectors(a, b, e);
  out.y += Math.sin(Math.PI * e) * h;
  return out;
};

export function armProgram(arm, p, pick, targets, dt, opts = {}) {
  const n = targets.length;
  const s = arm.s;
  arm.spin = 0;
  if (p < 0 || n === 0) { arm.home(); arm.grip = damp(arm.grip, 0, 8, dt); arm.carry.visible = false; arm.update(dt, 5); return; }
  const { k, u } = cycleInfo(p, n);
  if (k < 0 || k >= n) { arm.home(); arm.carry.visible = false; arm.grip = damp(arm.grip, 0, 8, dt); arm.update(dt, 8); return; }
  const T = targets[k];
  const above = _w.copy(T); above.y += 0.28 * s;
  const pk = new THREE.Vector3().copy(pick);
  const pkUp = pk.clone(); pkUp.y += 0.25 * s;
  const P = new THREE.Vector3();
  let carry = false;
  if (u < 0.22) P.copy(pkUp);
  else if (u < 0.3) { P.lerpVectors(pkUp, pk, Math.sin(Math.PI * (u - 0.22) / 0.08)); arm.grip = u > 0.26 ? 1 : 0; carry = u > 0.26; }
  else if (u < 0.55) { arc(pkUp, above, (u - 0.3) / 0.25, 0.25 * s, P); carry = true; arm.grip = 1; }
  else if (u < CYCLE.place) { P.lerpVectors(above, T, smooth((u - 0.55) / (CYCLE.place - 0.55))); carry = true; }
  else if (u < 0.86) { P.copy(T); arm.grip = 0; if (opts.spin !== false) arm.spin = arm.tool === 'spindle' ? 60 : 0; }
  else { P.lerpVectors(T, above, smooth((u - 0.86) / 0.14)); arm.grip = 0; }
  arm.solve(P, opts.phi ?? -Math.PI / 2);
  arm.carry.visible = carry && arm.tool !== 'spindle' && arm.tool !== 'nozzle';
  arm.update(dt, u < 0.22 ? 7 : 16);
}

/* ------------------------------------------------------------------ */
/* Cartesian gantry                                                     */
/* ------------------------------------------------------------------ */
export class Gantry {
  constructor(w = 3.6, d = 5.6, h = 3.4) {
    this.root = new THREE.Group();
    this.w = w; this.d = d; this.h = h;
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) this.root.add(at(box(0.16, h, 0.16, M.yellow, 0.02), x, h / 2, z));
    for (const x of [-w / 2, w / 2]) this.root.add(at(box(0.2, 0.2, d + 0.2, M.frameDark, 0.02), x, h + 0.1, 0));
    this.bridge = at(group(), 0, h + 0.1, 0);
    this.root.add(this.bridge);
    this.bridge.add(box(w + 0.2, 0.22, 0.24, M.profile, 0.02));
    this.bridge.add(at(box(0.3, 0.12, 0.2, M.graphite, 0.02), w / 2 - 0.1, 0.17, 0));
    this.carriage = group();
    this.bridge.add(this.carriage);
    this.carriage.add(at(box(0.36, 0.34, 0.36, M.graphite, 0.03), 0, 0, 0.0));
    this.mast = at(box(0.12, 1, 0.12, M.alu), 0, -0.5, 0);
    this.carriage.add(this.mast);
    this.headG = group();
    this.carriage.add(this.headG);
    this.headG.add(at(box(0.5, 0.06, 0.4, M.graphite, 0.01), 0, 0, 0));
    for (const x of [-0.18, 0.18]) for (const z of [-0.14, 0.14]) this.headG.add(at(cyl(0.035, 0.03, 0.05, M.rubber, 'y', 10), x, -0.05, z));
    this.carry = at(box(0.42, 0.18, 0.3, M.graphite, 0.015), 0, -0.17, 0);
    this.carry.add(at(box(0.425, 0.03, 0.12, M.gold), 0, 0.02, 0));
    this.carry.visible = false;
    this.headG.add(this.carry);
    this.tool = new THREE.Vector3(0, 1.6, 0);
    this.set(this.tool);
  }

  set(local) {
    this.bridge.position.z = clamp(local.z, -this.d / 2 + 0.3, this.d / 2 - 0.3);
    this.carriage.position.x = clamp(local.x, -this.w / 2 + 0.3, this.w / 2 - 0.3);
    const drop = clamp(this.h + 0.1 - local.y, 0.4, this.h);
    this.mast.scale.y = drop;
    this.mast.position.y = -drop / 2;
    this.headG.position.y = -drop;
  }

  program(p, pickW, targets, dt) {
    const n = targets.length;
    const L = this.root.worldToLocal.bind(this.root);
    const home = new THREE.Vector3(0, this.h - 0.6, -this.d / 2 + 0.8);
    let goal = home.clone(), carry = false;
    if (p >= 0 && n > 0) {
      const { k, u } = cycleInfo(p, n);
      if (k >= 0 && k < n) {
        const pick = L(pickW.clone()); pick.y += 0.22;
        const tgt = L(targets[k].clone()); tgt.y += 0.12;
        const hi = this.h - 0.7;
        const pickUp = pick.clone(); pickUp.y = hi;
        const tgtUp = tgt.clone(); tgtUp.y = hi;
        if (u < 0.18) goal.copy(pickUp);
        else if (u < 0.3) { goal.lerpVectors(pickUp, pick, Math.sin(Math.PI * (u - 0.18) / 0.12)); carry = u > 0.24; }
        else if (u < 0.5) { goal.lerpVectors(pickUp, tgtUp, smooth((u - 0.3) / 0.2)); carry = true; }
        else if (u < CYCLE.place) { goal.lerpVectors(tgtUp, tgt, smooth((u - 0.5) / (CYCLE.place - 0.5))); carry = true; }
        else if (u < 0.8) goal.copy(tgt);
        else goal.lerpVectors(tgt, tgtUp, smooth((u - 0.8) / 0.2));
      }
    }
    this.tool.x = damp(this.tool.x, goal.x, 6, dt);
    this.tool.y = damp(this.tool.y, goal.y, 6, dt);
    this.tool.z = damp(this.tool.z, goal.z, 6, dt);
    this.carry.visible = carry;
    this.set(this.tool);
  }
}

/* ------------------------------------------------------------------ */
/* Human operator                                                       */
/* ------------------------------------------------------------------ */
export class Operator {
  constructor() {
    this.root = new THREE.Group();
    const b = this.body = group();
    this.root.add(b);
    this.legs = [];
    for (const s of [1, -1]) {
      const hip = at(group(), 0.09 * s, 0.86, 0);
      hip.add(at(capsule(0.06, 0.66, M.pants), 0, -0.4, 0));
      hip.add(at(box(0.11, 0.07, 0.24, M.dark, 0.02), 0, -0.82, 0.05));
      b.add(hip);
      this.legs.push(hip);
    }
    this.torso = at(group(), 0, 0.9, 0);
    b.add(this.torso);
    this.torso.add(at(box(0.36, 0.52, 0.22, M.vest, 0.07), 0, 0.27, 0));
    this.torso.add(at(box(0.362, 0.04, 0.222, M.shell), 0, 0.2, 0));
    this.torso.add(at(box(0.362, 0.04, 0.222, M.shell), 0, 0.36, 0));
    this.torso.add(at(sph(0.1, M.skin, 16), 0, 0.66, 0));
    this.torso.add(at(sph(0.112, M.helmet, 16), 0, 0.71, -0.005));
    this.torso.add(at(box(0.16, 0.03, 0.04, M.glass), 0, 0.68, 0.09));
    this.arms = [];
    for (const s of [1, -1]) {
      const sh = at(group(), 0.22 * s, 0.48, 0);
      sh.add(at(capsule(0.045, 0.26, M.vest), 0, -0.16, 0));
      const el = at(group(), 0, -0.32, 0);
      el.add(at(capsule(0.04, 0.22, M.pants), 0, -0.13, 0));
      el.add(at(sph(0.045, M.dark, 10), 0, -0.28, 0));
      sh.add(el);
      this.torso.add(sh);
      this.arms.push({ sh, el, s });
    }
    this.t = Math.random() * 10;
    this.spots = null;
  }

  update(dt, active, faceTo) {
    this.t += dt;
    const t = this.t;
    let bend = 0, reach = 0, walk = 0;
    if (active) {
      const c = (t * 0.18) % 1;
      if (this.spots) {
        const goTo = c < 0.5 ? this.spots[0] : this.spots[1];
        const d = _v.copy(goTo).sub(this.root.position);
        const dist = d.length();
        if (dist > 0.03) { this.root.position.addScaledVector(d.normalize(), Math.min(dist, dt * 0.9)); walk = 1; }
      }
      bend = 0.25 + 0.15 * Math.sin(t * 1.3);
      reach = 0.9 + 0.35 * Math.sin(t * 2.2);
    }
    if (faceTo) {
      const yaw = Math.atan2(faceTo.x - this.root.position.x, faceTo.z - this.root.position.z);
      this.root.rotation.y = damp(this.root.rotation.y, yaw, 4, dt);
    }
    this.torso.rotation.x = damp(this.torso.rotation.x, bend, 3, dt);
    for (const a of this.arms) {
      const ph = a.s > 0 ? 0 : Math.PI;
      a.sh.rotation.x = damp(a.sh.rotation.x, -reach + 0.2 * Math.sin(t * 3 + ph) * (active ? 1 : 0), 5, dt);
      a.el.rotation.x = damp(a.el.rotation.x, active ? -0.7 + 0.3 * Math.sin(t * 2.5 + ph) : -0.1, 5, dt);
    }
    this.legs.forEach((l, i) => { l.rotation.x = walk ? 0.35 * Math.sin(t * 7 + i * Math.PI) : damp(l.rotation.x, 0, 6, dt); });
  }
}

/* ------------------------------------------------------------------ */
/* Static / simple animated rigs                                        */
/* ------------------------------------------------------------------ */
export class Andon {
  constructor() {
    this.root = group();
    this.root.add(at(cyl(0.025, 0.025, 2.2, M.steel), 0, 1.1, 0));
    this.root.add(at(cyl(0.09, 0.09, 0.04, M.dark), 0, 2.22, 0));
    const mk = (m, y) => { const c = at(cyl(0.075, 0.075, 0.13, m.clone(), 'y', 16, false), 0, y, 0); this.root.add(c); return c; };
    this.lights = { red: mk(M.emRed, 2.31), amber: mk(M.emAmber, 2.45), green: mk(M.emGreen, 2.59), blue: mk(M.emBlue, 2.73) };
    this.root.add(at(cyl(0.06, 0.08, 0.05, M.dark), 0, 2.82, 0));
    this.state = '';
    this.t = 0;
  }
  update(state, dt) {
    this.t += dt;
    const on = { red: 0, amber: 0, green: 0, blue: 0 };
    if (state === 'work') on.green = 1.8;
    else if (state === 'idle') on.amber = 1.5;
    else if (state === 'blocked') on.blue = 1.6;
    else if (state === 'mat') { on.amber = 1.5; on.blue = (Math.sin(this.t * 6) > 0) * 1.6; }
    else if (state === 'down') on.red = (Math.sin(this.t * 8) > -0.2) * 2.4;
    for (const k in on) this.lights[k].material.emissiveIntensity = on[k];
  }
}

export function hmi() {
  const g = group();
  g.add(at(box(0.08, 1.2, 0.08, M.frameDark), 0, 0.6, 0));
  const head = rot(at(group(), 0, 1.35, 0), -0.35, 0, 0);
  head.add(box(0.5, 0.36, 0.06, M.dark, 0.02));
  const scr = at(box(0.44, 0.3, 0.01, M.screen), 0, 0, 0.032);
  head.add(scr);
  g.add(head);
  g.add(at(box(0.3, 0.04, 0.16, M.dark), 0, 1.06, 0.06));
  return g;
}

export function fencePanel(w, h = 1.9) {
  const g = group();
  for (const x of [-w / 2, w / 2]) g.add(at(box(0.05, h, 0.05, M.yellow), x, h / 2, 0));
  g.add(at(box(w, 0.04, 0.04, M.frameDark), 0, h, 0));
  g.add(at(box(w, 0.04, 0.04, M.frameDark), 0, 0.15, 0));
  g.add(at(mkPlane(w, h - 0.2, M.fence), 0, h / 2 + 0.05, 0));
  return g;
}

function mkPlane(w, h, mat) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.castShadow = false; return m; }

// Line-side flow rack. setLevel(0..1) shows the stock level as bins.
export class Rack {
  constructor({ w = 2.2, kind = 'act' } = {}) {
    this.root = group();
    const h = 1.7, d = 0.8;
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) this.root.add(at(box(0.05, h, 0.05, M.profile), x, h / 2, z));
    this.bins = [];
    const binM = kind === 'act' ? M.blue : M.graphite;
    for (let lv = 0; lv < 3; lv++) {
      const y = 0.45 + lv * 0.45;
      const shelf = rot(at(box(w, 0.03, d, M.frameDark), 0, y, 0), 0.12, 0, 0);
      this.root.add(shelf);
      const n = Math.floor(w / 0.42);
      for (let i = 0; i < n; i++) for (let r = 0; r < 2; r++) {
        const b = at(box(0.36, kind === 'act' ? 0.16 : 0.2, 0.3, binM, 0.02), -w / 2 + 0.26 + i * 0.42, 0.1, r ? 0.18 : -0.18);
        shelf.add(b);
        this.bins.push(b);
      }
    }
    this.level = -1;
  }
  setLevel(f) {
    const n = Math.round(clamp(f, 0, 1) * this.bins.length);
    if (n === this.level) return;
    this.level = n;
    this.bins.forEach((b, i) => { b.visible = i < n; });
  }
}

export class Press {
  constructor() {
    this.root = group();
    for (const z of [-0.55, 0.55]) this.root.add(at(box(0.14, 2.3, 0.14, M.graphite, 0.02), 0, 1.15, z));
    this.root.add(at(box(0.5, 0.3, 1.4, M.yellow, 0.03), 0, 2.35, 0));
    this.root.add(at(cyl(0.12, 0.12, 0.5, M.dark), 0, 2.7, 0));
    this.root.add(at(cyl(0.13, 0.13, 0.06, M.gold), 0, 2.98, 0));
    this.ram = group();
    this.root.add(this.ram);
    this.ram.add(at(cyl(0.06, 0.06, 0.8, M.steel), 0, 0.4, 0));
    this.ram.add(at(box(0.7, 0.08, 0.46, M.aluDark, 0.01), 0, 0, 0));
    for (const [x, z] of [[-0.21, -0.09], [-0.07, -0.09], [0.07, -0.09], [0.21, -0.09], [-0.21, 0.09], [-0.07, 0.09], [0.07, 0.09], [0.21, 0.09]]) this.ram.add(at(cyl(0.03, 0.03, 0.06, M.steel, 'y', 12), x, -0.07, z));
    this.top = 1.9; this.bottom = 1.1;
    this.y = this.top;
  }
  update(p, dt) {
    let g = this.top;
    if (p >= 0) {
      if (p < 0.12) g = this.top;
      else if (p < 0.3) g = lerp(this.top, this.bottom + 0.06, smooth((p - 0.12) / 0.18));
      else if (p < 0.7) g = lerp(this.bottom + 0.06, this.bottom, (p - 0.3) / 0.4);
      else if (p < 0.85) g = lerp(this.bottom, this.top, smooth((p - 0.7) / 0.15));
    }
    this.y = damp(this.y, g, 12, dt);
    this.ram.position.y = this.y;
  }
}

export class VisionArch {
  constructor(span = 3.4, h = 2.9) {
    this.root = group();
    for (const z of [-span / 2, span / 2]) this.root.add(at(box(0.12, h, 0.12, M.profile), 0, h / 2, z));
    this.root.add(at(box(0.16, 0.14, span + 0.2, M.frameDark, 0.02), 0, h, 0));
    this.leds = [];
    for (const z of [-0.6, 0.6]) {
      const cam = rot(at(group(), 0, h - 0.18, z), 0, 0, 0);
      cam.add(box(0.12, 0.12, 0.2, M.dark, 0.015));
      cam.add(at(cyl(0.035, 0.04, 0.08, M.glass, 'y', 14), 0, -0.09, 0));
      this.root.add(cam);
    }
    for (const z of [-1.1, 1.1]) {
      const l = at(box(0.5, 0.04, 0.12, M.ledCyan.clone(), 0.01, false), 0, h - 0.1, z);
      this.root.add(l);
      this.leds.push(l);
    }
  }
  update(p) {
    const f = p >= 0 && ((p > 0.2 && p < 0.26) || (p > 0.5 && p < 0.56) || (p > 0.8 && p < 0.86));
    for (const l of this.leds) l.material.emissiveIntensity = f ? 4 : 0.4;
  }
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1e21'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#2c3035';
  for (let x = 0; x < 256; x += 16) g.fillRect(x, 0, 6, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

export class Treadmill {
  constructor() {
    this.root = group();
    this.root.add(at(box(2.4, 0.24, 1.2, M.graphite, 0.03), 0, 0.12, 0));
    this.tex = stripeTexture();
    this.belt = at(new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.8), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9 })), 0, 0.245, 0);
    this.belt.rotation.x = -Math.PI / 2;
    this.belt.receiveShadow = true;
    this.root.add(this.belt);
    for (const z of [-0.6, 0.6]) {
      this.root.add(at(box(0.05, 1.0, 0.05, M.steel), 1.05, 0.74, z));
      this.root.add(at(box(0.05, 0.05, 0.7, M.steel), 1.05, 1.24, z * 0.5));
    }
    for (const x of [-1.3, 1.3]) this.root.add(at(box(0.14, 3.2, 0.14, M.yellow, 0.02), x, 1.6, -0.75));
    this.root.add(at(box(2.8, 0.18, 0.18, M.frameDark, 0.02), 0, 3.2, -0.75));
    this.root.add(at(box(0.3, 0.2, 1.0, M.frameDark, 0.02), 0, 3.2, -0.3));
    this.rope = at(cyl(0.012, 0.012, 1, M.hiVis), 0, 2.5, 0.05);
    this.root.add(this.rope);
    this.hook = at(box(0.12, 0.1, 0.12, M.dark), 0, 3.05, 0.05);
    this.root.add(this.hook);
    this.surface = 0.245;
  }
  update(dt, running, ropeBottomY) {
    if (running) this.tex.offset.x -= dt * 1.2;
    const top = 3.05, bot = ropeBottomY ?? 2.0;
    const L = Math.max(0.05, top - bot);
    this.rope.scale.y = L;
    this.rope.position.y = bot + L / 2;
  }
}

export class TerrainTrack {
  constructor() {
    this.root = group();
    this.root.add(at(box(5.6, 0.1, 1.5, M.graphite, 0.02), 0, 0.05, 0));
    this.root.add(at(box(1.0, 0.16, 1.4, M.aluDark, 0.01), 1.2, 0.18, 0));
    this.root.add(at(box(0.7, 0.16, 1.4, M.aluDark, 0.01), 1.55, 0.34, 0));
    const ramp = rot(at(box(1.4, 0.06, 1.4, M.steel, 0.01), -1.6, 0.27, 0), 0, 0, -0.26);
    this.root.add(ramp);
    for (let i = 0; i < 9; i++) this.root.add(at(box(0.16, 0.05, 0.16, M.rubber, 0.02), -0.4 + (i % 3) * 0.25, 0.125, -0.4 + Math.floor(i / 3) * 0.4));
    for (const z of [-0.78, 0.78]) this.root.add(at(fencePanel(5.6, 0.7), 0, 0, z));
    this.surface = 0.1;
  }
  heightAt(x) {
    if (x > 0.7 && x < 1.2) return 0.26;
    if (x >= 1.2 && x < 1.9) return 0.42;
    if (x < -0.92 && x > -2.3) return 0.1 + (-0.92 - x) * Math.tan(0.26);
    return 0.1;
  }
}

export class NavLoop {
  constructor(w = 7, d = 3.2) {
    this.root = group();
    this.w = w; this.d = d;
    const tape = new THREE.MeshBasicMaterial({ color: 0xe9b627 });
    const mk = (W, D, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(W, D), tape); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); this.root.add(m); };
    mk(w, 0.06, 0, -d / 2); mk(w, 0.06, 0, d / 2); mk(0.06, d, -w / 2, 0); mk(0.06, d, w / 2, 0);
    for (const [x, z] of [[-1.2, 0.0], [1.4, 0.2]]) {
      this.root.add(at(cyl(0.02, 0.16, 0.42, M.hiVis, 'y', 12), x, 0.21, z));
      this.root.add(at(cyl(0.18, 0.18, 0.02, M.dark, 'y', 12), x, 0.01, z));
    }
    const dock = at(group(), w / 2 - 0.1, 0, 0);
    dock.add(at(box(0.25, 0.5, 0.6, M.graphite, 0.03), 0.1, 0.25, 0));
    dock.add(at(box(0.04, 0.12, 0.3, M.gold), -0.03, 0.2, 0));
    this.root.add(dock);
  }
  // Point and heading on the loop for u ∈ [0,1).
  at(u, out) {
    const w = this.w - 1.2, d = this.d - 1.0;
    const per = 2 * (w + d);
    let s = ((u % 1) + 1) % 1 * per, hd;
    if (s < w) { out.set(-w / 2 + s, 0, -d / 2); hd = Math.PI / 2; }
    else if ((s -= w) < d) { out.set(w / 2, 0, -d / 2 + s); hd = 0; }
    else if ((s -= d) < w) { out.set(w / 2 - s, 0, d / 2); hd = -Math.PI / 2; }
    else { s -= w; out.set(-w / 2, 0, d / 2 - s); hd = Math.PI; }
    return hd;
  }
}

export class LeakChamber {
  constructor() {
    this.root = group();
    for (const x of [-0.7, 0.7]) for (const z of [-0.6, 0.6]) this.root.add(at(box(0.08, 2.6, 0.08, M.profile), x, 1.3, z));
    this.root.add(at(box(1.5, 0.12, 1.3, M.frameDark, 0.02), 0, 2.6, 0));
    this.root.add(at(cyl(0.05, 0.05, 0.6, M.steel), 0, 2.9, 0));
    this.hood = group();
    this.root.add(this.hood);
    this.hood.add(at(box(1.2, 0.05, 1.0, M.frameDark, 0.01), 0, 0.7, 0));
    for (const [w, d, x, z, ry] of [[1.2, 0.7, 0, 0.5, 0], [1.2, 0.7, 0, -0.5, 0], [1.0, 0.7, 0.6, 0, Math.PI / 2], [1.0, 0.7, -0.6, 0, Math.PI / 2]]) {
      const p = mkPlane(w, d, M.glassPanel);
      p.position.set(x, 0.35, z);
      p.rotation.y = ry;
      this.hood.add(p);
    }
    const gauge = at(group(), 0.62, 1.7, 0.62);
    gauge.add(cyl(0.12, 0.12, 0.04, M.dark, 'z'));
    gauge.add(at(cyl(0.1, 0.1, 0.01, M.shell, 'z'), 0, 0, 0.022));
    this.needle = at(box(0.008, 0.08, 0.004, M.red), 0, 0.03, 0.03);
    const pivot = at(group(), 0, 0, 0.03);
    pivot.add(at(this.needle, 0, 0.035, 0));
    gauge.add(pivot);
    this.pivot = pivot;
    this.root.add(gauge);
    this.top = 1.95; this.low = 0.82;
    this.y = this.top;
  }
  update(p, dt) {
    let g = this.top, press = 0;
    if (p >= 0) {
      if (p < 0.08) g = this.top;
      else if (p < 0.2) g = lerp(this.top, this.low, smooth((p - 0.08) / 0.12));
      else if (p < 0.82) { g = this.low; press = p < 0.3 ? (p - 0.2) / 0.1 : 1 - 0.02 * (p - 0.3) / 0.52; }
      else if (p < 0.95) g = lerp(this.low, this.top, smooth((p - 0.82) / 0.13));
    }
    this.y = damp(this.y, g, 10, dt);
    this.hood.position.y = this.y - 0.7;
    this.pivot.rotation.z = damp(this.pivot.rotation.z, 2.2 - press * 3.6, 6, dt);
  }
}

export class Dyno {
  constructor() {
    this.root = group();
    for (const x of [-0.5, 0.5]) this.root.add(at(box(0.1, 2.1, 0.1, M.graphite), x, 1.05, -0.55));
    this.root.add(at(box(1.2, 0.14, 0.16, M.frameDark, 0.02), 0, 2.1, -0.55));
    this.beam = group();
    this.root.add(this.beam);
    this.beam.add(at(box(0.8, 0.08, 0.5, M.aluDark, 0.01), 0, 0, -0.1));
    this.spindles = [];
    for (const [x, z] of [[-0.21, -0.09], [-0.07, -0.09], [0.07, -0.09], [0.21, -0.09], [-0.21, 0.09], [-0.07, 0.09], [0.07, 0.09], [0.21, 0.09]]) {
      const s = at(group(), x, -0.05, z);
      s.add(at(cyl(0.025, 0.025, 0.14, M.dark, 'y', 12), 0, 0.12, 0));
      s.add(at(torus(0.026, 0.005, M.gold, 'y', 16), 0, 0.04, 0));
      const sh = at(cyl(0.016, 0.016, 0.06, M.steel, 'y', 8), 0, -0.02, 0);
      s.add(sh);
      this.beam.add(s);
      this.spindles.push(sh);
    }
    const cab = at(group(), 0.9, 0, -0.6);
    cab.add(at(box(0.5, 1.6, 0.5, M.graphite, 0.02), 0, 0.8, 0));
    cab.add(at(box(0.4, 0.3, 0.02, M.screen), 0, 1.25, 0.26));
    this.root.add(cab);
    this.top = 1.75; this.low = 1.12; this.y = this.top;
  }
  update(p, dt) {
    let g = this.top, spin = 0;
    if (p >= 0) {
      if (p < 0.1) g = this.top;
      else if (p < 0.2) g = lerp(this.top, this.low, smooth((p - 0.1) / 0.1));
      else if (p < 0.85) { g = this.low; spin = Math.sin((p - 0.2) * 40) * 20; }
      else g = lerp(this.low, this.top, smooth((p - 0.85) / 0.15));
    }
    this.y = damp(this.y, g, 12, dt);
    this.beam.position.y = this.y;
    for (const s of this.spindles) s.rotation.y += spin * dt;
    this.spin = spin;
  }
}

export class LaserMarker {
  constructor() {
    this.root = group();
    this.root.add(at(box(0.12, 1.9, 0.12, M.graphite), 0, 0.95, -0.6));
    this.root.add(at(box(0.14, 0.14, 0.7, M.frameDark), 0, 1.9, -0.3));
    this.head = at(group(), 0, 1.75, 0);
    this.root.add(this.head);
    this.head.add(box(0.22, 0.26, 0.22, M.dark, 0.02));
    this.head.add(at(cyl(0.05, 0.05, 0.06, M.glass), 0, -0.15, 0));
    this.beam = at(cyl(0.004, 0.004, 1, M.laser, 'y', 6, false), 0, 0, 0);
    this.head.add(this.beam);
    const cam = at(group(), 0.35, 1.7, 0.0);
    cam.add(box(0.1, 0.14, 0.1, M.dark));
    this.root.add(cam);
  }
  update(p, dt, targetLocalX = 0, surfaceY = 1.05) {
    const act = p > 0.1 && p < 0.85;
    this.head.position.x = damp(this.head.position.x, act ? targetLocalX : 0, 10, dt);
    const L = this.head.position.y - 0.18 - surfaceY;
    this.beam.visible = act && Math.random() > 0.15;
    this.beam.scale.y = L;
    this.beam.position.y = -0.18 - L / 2;
  }
}

export class CalibBoard {
  constructor() {
    this.root = group();
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#111';
    for (let i = 0; i < 8; i++) for (let k = 0; k < 8; k++) if ((i + k) % 2) g.fillRect(i * 32, k * 32, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    this.board = at(group(), 0, 1.4, 0);
    this.board.add(board);
    this.board.add(at(box(1.06, 1.06, 0.03, M.frameDark), 0, 0, -0.02));
    this.root.add(this.board);
    this.root.add(at(box(0.08, 1.4, 0.08, M.steel), 0, 0.7, -0.05));
    this.root.add(at(box(0.6, 0.04, 0.5, M.dark), 0, 0.02, -0.05));
    this.t = 0;
  }
  update(dt, active) {
    this.t += dt;
    const a = active ? 1 : 0;
    this.board.rotation.y = damp(this.board.rotation.y, a * 0.35 * Math.sin(this.t * 0.9), 4, dt);
    this.board.rotation.x = damp(this.board.rotation.x, a * 0.2 * Math.sin(this.t * 0.7), 4, dt);
  }
}

/* ------------------------------------------------------------------ */
/* Carriers and AMR                                                     */
/* ------------------------------------------------------------------ */
export function carrierMesh(kind) {
  const g = group();
  if (kind === 'agv') {
    g.add(at(box(1.3, 0.24, 1.0, M.graphite, 0.05), 0, 0.14, 0));
    g.add(at(box(1.32, 0.03, 1.02, M.yellow), 0, 0.2, 0));
    g.add(at(box(1.2, 0.02, 0.9, M.aluDark), 0, 0.27, 0));
    g.add(at(box(0.6, 0.012, 0.004, M.ledCyan), 0, 0.14, 0.502));
    g.add(at(box(0.14, 1.12, 0.14, M.frameDark, 0.02), 0, 0.82, -0.42));
    g.add(at(box(0.12, 0.1, 0.36, M.yellow, 0.02), 0, 1.33, -0.25));
    g.add(at(box(0.36, 0.12, 0.08, M.dark, 0.02), 0, 1.33, -0.1));
    g.add(at(cyl(0.05, 0.05, 0.05, M.dark), 0.5, 0.29, 0.35));
  } else if (kind === 'pallet') {
    g.add(at(box(0.92, 0.06, 0.72, M.pallet, 0.01), 0, 0.03, 0));
    for (const [x, z] of [[-0.38, -0.28], [0.38, -0.28], [-0.38, 0.28], [0.38, 0.28]]) g.add(at(box(0.08, 0.06, 0.08, M.yellow), x, 0.09, z));
    g.add(at(box(0.06, 0.012, 0.04, M.gold), 0.42, 0.066, 0.0));
  } else if (kind === 'slat') {
    g.add(at(box(1.1, 0.05, 1.1, M.aluDark, 0.01), 0, 0.025, 0));
    for (const x of [-0.4, 0.4]) g.add(at(box(0.06, 0.03, 1.0, M.yellow), x, 0.06, 0));
  }
  return g;
}

export class AMRMesh {
  constructor() {
    this.root = group();
    this.root.add(at(box(1.0, 0.26, 0.68, M.graphite, 0.06), 0, 0.17, 0));
    this.root.add(at(box(0.96, 0.03, 0.64, M.aluDark, 0.01), 0, 0.315, 0));
    this.led = at(box(1.02, 0.025, 0.7, new THREE.MeshStandardMaterial({ color: 0x0b1d24, emissive: 0x5fd1ff, emissiveIntensity: 1.2 }), 0.02, false), 0, 0.12, 0);
    this.root.add(this.led);
    this.root.add(at(cyl(0.05, 0.05, 0.06, M.dark), 0.42, 0.34, 0));
    this.root.add(at(box(0.06, 0.06, 0.2, M.yellow), 0.5, 0.2, 0));
    this.cargo = group();
    at(this.cargo, 0, 0.33, 0);
    this.root.add(this.cargo);
    this.trays = [];
    for (let i = 0; i < 2; i++) {
      const t = at(group(), 0, i * 0.17, 0);
      t.add(at(box(0.66, 0.04, 0.44, M.pallet), 0, 0.02, 0));
      for (let k = 0; k < 8; k++) t.add(at(cyl(0.048, 0.048, 0.09, M.aluDark, 'y', 12), -0.21 + (k >> 1) * 0.14, 0.085, (k & 1 ? 0.09 : -0.09)));
      this.cargo.add(t);
      this.trays.push(t);
    }
    this.bats = [];
    for (let i = 0; i < 4; i++) {
      const b = at(box(0.36, 0.18, 0.26, M.graphite, 0.01), (i % 2 ? 0.2 : -0.2), 0.09 + (i > 1 ? 0.19 : 0), 0);
      b.add(at(box(0.362, 0.03, 0.08, M.gold), 0, 0.03, 0));
      this.cargo.add(b);
      this.bats.push(b);
    }
    this.setLoad(null);
  }
  setLoad(load) {
    const nt = load && load.type === 'act' ? Math.ceil(load.items.length / 8) : 0;
    const nb = load && load.type === 'bat' ? load.items.length : 0;
    this.trays.forEach((t, i) => { t.visible = i < nt; });
    this.bats.forEach((b, i) => { b.visible = i < nb; });
  }
  setColor(hex) { this.led.material.emissive.setHex(hex); }
}

export { textTexture };
