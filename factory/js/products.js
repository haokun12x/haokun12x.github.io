// Procedural product models with staged parts, kinematic joints and motion demos.
// Every product faces +z with +x on its left; the root origin sits on the ground.
import * as THREE from 'three';
import { M, box, cyl, sph, torus, capsule, tube, ring, at, rot, group, clamp } from './kit.js';

export const JOINT_COLORS = {
  planetary: '#d9b77a', harmonic: '#5fd1ff', linear: '#e06cc4', qdd: '#f0a24a',
  swerve: '#4fbf7f', drive: '#4fbf7f', lift: '#b07ce0', rotor: '#e5534b',
};
export const JOINT_LABEL = {
  planetary: '行星减速旋转关节', harmonic: '谐波减速关节', linear: '线性执行器驱动',
  qdd: '准直驱 QDD', swerve: '舵轮转向', drive: '轮毂驱动', lift: '直线升降', rotor: '电机转子（高速）',
};

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _b = new THREE.Box3();

export class Product {
  constructor(kind) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.name = kind;
    this.parts = [];
    this.J = {};
    this.joints = [];
    this.sensors = [];
    this.contacts = [];   // meshes whose lowest points can touch the ground
    this._stageKey = '';
    this._pops = [];
    this.mode = 'rest';
  }

  part(obj, key, stage, grp = 0, opts = {}) {
    obj.userData.part = key;
    this.parts.push({ obj, key, stage, grp, explode: opts.explode || null, weight: opts.weight ?? 1, cover: key.includes('cover') });
    return obj;
  }

  joint(name, obj, axis, type, key, opts = {}) {
    const j = { name, obj, axis, type, key, rest: axis === 'py' ? obj.position.y : obj.rotation[axis], hidden: !!opts.hidden, v: 0 };
    this.J[name] = j;
    this.joints.push(j);
    return obj;
  }

  set(name, v) {
    const j = this.J[name];
    if (!j) return;
    j.v = v;
    if (j.axis === 'py') j.obj.position.y = j.rest + v;
    else j.obj.rotation[j.axis] = j.rest + v;
  }

  resetJoints() { for (const j of this.joints) this.set(j.name, 0); }

  sensor(obj, type, opts = {}) { this.sensors.push({ obj, type, ...opts }); return obj; }

  finalize() {
    this.stages = new Map();
    for (const p of this.parts) {
      if (!this.stages.has(p.stage)) this.stages.set(p.stage, new Map());
      const s = this.stages.get(p.stage);
      if (!s.has(p.grp)) s.set(p.grp, []);
      s.get(p.grp).push(p);
    }
    // Sort groups by id and keep them as arrays.
    for (const [k, m] of this.stages) {
      this.stages.set(k, [...m.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]));
    }
    // Explode vectors and CoM weights are computed in the rest pose.
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const bb = new THREE.Box3().setFromObject(this.root);
    const c = bb.getCenter(new THREE.Vector3()).applyMatrix4(inv);
    const size = bb.getSize(new THREE.Vector3()).length();
    this.size = size;
    for (const p of this.parts) {
      _b.setFromObject(p.obj);
      const pc = _b.getCenter(new THREE.Vector3()).applyMatrix4(inv);
      const dims = _b.getSize(new THREE.Vector3());
      p.local = p.obj.worldToLocal(_b.getCenter(new THREE.Vector3()));
      p.mass = Math.max(1e-5, dims.x * dims.y * dims.z) * (p.cover ? 0.15 : 1) * p.weight;
      let dir;
      if (p.explode) dir = new THREE.Vector3(...p.explode);
      else {
        dir = pc.clone().sub(c);
        dir.y *= 0.7;
        if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
        dir.normalize().multiplyScalar(size * 0.16 * (p.cover ? 1.9 : 1));
      }
      p.obj.parent.getWorldQuaternion(_q);
      const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
      _q.premultiply(rootQ.invert());
      p.dirLocal = dir.applyQuaternion(_q.invert());
      p.base = p.obj.position.clone();
    }
  }

  // Show parts of earlier stages and the installed groups of the current stage.
  // mask: bit i set → group i of the current stage is already installed.
  setStage(stage, mask = 0) {
    const key = stage + ':' + mask;
    if (key === this._stageKey) return;
    this._stageKey = key;
    for (const p of this.parts) {
      let vis;
      if (p.stage < stage) vis = true;
      else if (p.stage > stage) vis = false;
      else {
        const groups = this.stages.get(stage);
        const gi = groups.findIndex((g) => g.includes(p));
        vis = ((mask >> gi) & 1) === 1;
      }
      if (vis && !p.obj.visible && stage !== Infinity) { p.pop = 0; this._pops.push(p); }
      p.obj.visible = vis;
    }
  }

  groupsAt(stage) { return this.stages.get(stage) || []; }

  groupWorldCenter(stage, gi, out) {
    const g = this.groupsAt(stage)[gi];
    out.set(0, 0, 0);
    if (!g) return out;
    for (const p of g) out.add(p.obj.localToWorld(_v.copy(p.local)));
    return out.multiplyScalar(1 / g.length);
  }

  tick(dt) {
    if (!this._pops.length) return;
    for (const p of this._pops) {
      p.pop = Math.min(1, p.pop + dt * 3.5);
      const e = 1 - Math.pow(1 - p.pop, 3);
      p.obj.scale.setScalar(0.55 + 0.45 * e);
    }
    this._pops = this._pops.filter((p) => p.pop < 1);
  }

  setExplode(t) {
    for (const p of this.parts) p.obj.position.copy(p.base).addScaledVector(p.dirLocal, t);
  }

  centerOfMass(out) {
    out.set(0, 0, 0);
    let m = 0;
    for (const p of this.parts) {
      if (!p.obj.visible) continue;
      out.addScaledVector(p.obj.localToWorld(_v.copy(p.local)), p.mass);
      m += p.mass;
    }
    return m > 0 ? out.multiplyScalar(1 / m) : out;
  }

  pose() {}
}

function partsOf(P, key, stage, grp, ...meshes) {
  for (const m of meshes) P.part(m, key, stage, grp);
  return meshes;
}

/* ------------------------------------------------------------------ */
/* Humanoid                                                            */
/* ------------------------------------------------------------------ */
export function buildHumanoid() {
  const P = new Product('humanoid');
  const R = P.root;
  const pelvis = at(group('pelvis'), 0, 1.0, 0);
  R.add(pelvis);
  pelvis.add(P.part(box(0.30, 0.11, 0.17, M.aluDark, 0.02), 'pelvis', 0, 0));
  for (const s of [1, -1]) pelvis.add(P.part(at(box(0.08, 0.06, 0.12, M.graphite, 0.01), 0.1 * s, -0.06, 0), 'pelvis', 0, 0));
  const imu = P.part(at(box(0.05, 0.02, 0.05, M.gold, 0.004), 0, 0.065, 0.03), 'compute', 5, 1);
  pelvis.add(imu);
  P.sensor(imu, 'imu', { label: 'IMU' });
  pelvis.add(P.part(at(box(0.32, 0.13, 0.21, M.shell, 0.04), 0, -0.01, 0), 'cover', 6, 0));

  const waist = at(group('waist'), 0, 0.07, 0);
  pelvis.add(waist);
  P.joint('waist', waist, 'y', 'planetary', 'waist');
  waist.add(P.part(cyl(0.075, 0.075, 0.05, M.alu), 'waist', 0, 0));
  waist.add(P.part(at(torus(0.075, 0.006, M.gold), 0, 0.02, 0), 'waist', 0, 0));

  // Torso frame
  const T = (m, x, y, z) => waist.add(P.part(at(m, x, y, z), 'torso', 0, 1));
  T(box(0.06, 0.34, 0.06, M.aluDark, 0.01), 0, 0.2, -0.07);
  T(box(0.34, 0.03, 0.17, M.aluDark, 0.008), 0, 0.08, 0);
  T(box(0.34, 0.03, 0.17, M.aluDark, 0.008), 0, 0.35, 0);
  for (const s of [1, -1]) T(box(0.025, 0.28, 0.15, M.aluDark, 0.006), 0.16 * s, 0.22, 0);
  T(box(0.46, 0.055, 0.08, M.graphite, 0.012), 0, 0.38, 0);

  waist.add(P.part(at(box(0.22, 0.17, 0.1, M.graphite, 0.012), 0, 0.17, 0.0), 'battery', 3, 0));
  waist.add(P.part(at(box(0.2, 0.012, 0.102, M.gold), 0, 0.2, 0.0), 'battery', 3, 0));
  waist.add(P.part(at(box(0.14, 0.05, 0.06, M.dark, 0.008), 0, 0.3, 0.02), 'pdu', 3, 0));
  waist.add(P.part(at(box(0.2, 0.12, 0.035, M.graphite, 0.006), 0, 0.24, -0.1), 'compute', 5, 0));
  waist.add(P.part(at(box(0.18, 0.1, 0.012, M.alu), 0, 0.24, -0.125), 'compute', 5, 0));

  // Harness (EtherCAT + power) along the spine to the shoulders and hips.
  for (const s of [1, -1]) {
    waist.add(P.part(tube([[0.03 * s, 0.0, -0.04], [0.05 * s, 0.16, -0.095], [0.07 * s, 0.33, -0.07], [0.19 * s, 0.4, -0.02]], 0.007, s > 0 ? M.cable : M.cable2), 'harness', 2, 0));
    pelvis.add(P.part(tube([[0.02 * s, 0.07, -0.05], [0.07 * s, 0.0, -0.08], [0.11 * s, -0.08, -0.05]], 0.007, M.cable), 'harness', 2, 0));
  }
  waist.add(P.part(at(box(0.36, 0.33, 0.06, M.shell, 0.028), 0, 0.21, 0.105), 'cover', 6, 1));
  waist.add(P.part(at(box(0.36, 0.33, 0.05, M.shell2, 0.022), 0, 0.21, -0.14), 'cover', 6, 1));
  waist.add(P.part(at(box(0.07, 0.006, 0.002, M.ledCyan), 0, 0.33, 0.137), 'cover', 6, 1));

  // Neck & head
  const neckYaw = at(group('neckYaw'), 0, 0.42, 0);
  waist.add(neckYaw);
  P.joint('neckYaw', neckYaw, 'y', 'harmonic', 'neck');
  neckYaw.add(P.part(cyl(0.035, 0.035, 0.05, M.alu), 'neck', 5, 0));
  const neckPitch = at(group('neckPitch'), 0, 0.04, 0);
  neckYaw.add(neckPitch);
  P.joint('neckPitch', neckPitch, 'x', 'harmonic', 'neck');
  neckPitch.add(P.part(cyl(0.03, 0.03, 0.07, M.graphite, 'x'), 'neck', 5, 0));
  const H = (m, x, y, z) => neckPitch.add(P.part(at(m, x, y, z), 'head', 5, 0));
  H(box(0.17, 0.18, 0.19, M.graphite, 0.05), 0, 0.1, 0);
  H(box(0.15, 0.07, 0.02, M.glass, 0.008), 0, 0.11, 0.095);
  for (const s of [1, -1]) H(cyl(0.011, 0.011, 0.012, M.dark, 'z', 12), 0.035 * s, 0.115, 0.106);
  H(cyl(0.045, 0.045, 0.035, M.dark), 0, 0.205, 0);
  H(at(torus(0.045, 0.004, M.ledCyan), 0, 0, 0), 0, 0.205, 0);
  const camAnchor = at(new THREE.Object3D(), 0, 0.115, 0.11);
  neckPitch.add(camAnchor);
  P.sensor(camAnchor, 'camera', { label: '双目 + 深度相机', fov: 70, range: 1.6 });
  const lidarAnchor = at(new THREE.Object3D(), 0, 0.205, 0);
  neckPitch.add(lidarAnchor);
  P.sensor(lidarAnchor, 'lidar', { label: '3D 激光雷达', range: 1.8 });
  neckPitch.add(P.part(at(box(0.19, 0.15, 0.15, M.shell, 0.06), 0, 0.13, -0.035), 'cover', 6, 0));

  // Legs
  const legs = [];
  for (const s of [1, -1]) {
    const sd = s > 0 ? 'L' : 'R';
    const g0 = s > 0 ? 0 : 1;
    const hipYaw = at(group(), 0.1 * s, -0.08, 0);
    pelvis.add(hipYaw);
    P.joint('hipYaw' + sd, hipYaw, 'y', 'planetary', 'hipAct');
    hipYaw.add(P.part(at(cyl(0.048, 0.048, 0.06, M.alu), 0, -0.01, 0), 'hipAct', 1, g0));
    const hipRoll = at(group(), 0, -0.075, 0);
    hipYaw.add(hipRoll);
    P.joint('hipRoll' + sd, hipRoll, 'z', 'planetary', 'hipAct');
    hipRoll.add(P.part(cyl(0.055, 0.055, 0.08, M.alu, 'z'), 'hipAct', 1, g0));
    hipRoll.add(P.part(at(torus(0.055, 0.005, M.gold, 'z'), 0, 0, 0.04), 'hipAct', 1, g0));
    const hipPitch = at(group(), 0, -0.01, 0);
    hipRoll.add(hipPitch);
    P.joint('hipPitch' + sd, hipPitch, 'x', 'planetary', 'hipAct');
    hipPitch.add(P.part(at(cyl(0.066, 0.066, 0.085, M.alu, 'x'), 0.01 * s, 0, 0), 'hipAct', 1, g0));
    hipPitch.add(P.part(at(torus(0.066, 0.006, M.gold, 'x'), 0.055 * s, 0, 0), 'hipAct', 1, g0));
    hipPitch.add(P.part(at(box(0.075, 0.34, 0.085, M.aluDark, 0.015), 0, -0.2, 0), 'thigh', 1, g0 + 2));
    hipPitch.add(P.part(at(capsule(0.024, 0.2, M.alu), 0, -0.19, -0.07), 'kneeLin', 1, g0 + 2));
    hipPitch.add(P.part(at(cyl(0.032, 0.032, 0.07, M.graphite), 0, -0.05, -0.07), 'kneeLin', 1, g0 + 2));
    hipPitch.add(P.part(tube([[0.045 * s, -0.04, 0.02], [0.05 * s, -0.2, 0.035], [0.045 * s, -0.37, 0.02]], 0.006, M.cable), 'harness', 2, 0));
    hipPitch.add(P.part(at(box(0.115, 0.3, 0.125, M.shell, 0.045), 0, -0.2, 0.005), 'cover', 6, 0));
    const knee = at(group(), 0, -0.38, 0);
    hipPitch.add(knee);
    P.joint('knee' + sd, knee, 'x', 'linear', 'kneeLin');
    knee.add(P.part(cyl(0.042, 0.042, 0.1, M.graphite, 'x'), 'shank', 1, g0 + 4));
    knee.add(P.part(at(box(0.065, 0.32, 0.075, M.aluDark, 0.015), 0, -0.19, 0), 'shank', 1, g0 + 4));
    for (const k of [1, -1]) {
      knee.add(P.part(at(capsule(0.016, 0.2, M.alu), 0.026 * k, -0.16, -0.06), 'ankleLin', 1, g0 + 4));
      knee.add(P.part(at(cyl(0.022, 0.022, 0.05, M.graphite), 0.026 * k, -0.04, -0.06), 'ankleLin', 1, g0 + 4));
    }
    knee.add(P.part(tube([[0.04 * s, -0.02, 0.02], [0.045 * s, -0.2, 0.03], [0.03 * s, -0.33, 0.01]], 0.005, M.cable2), 'harness', 2, 0));
    knee.add(P.part(at(box(0.1, 0.27, 0.115, M.shell, 0.04), 0, -0.18, 0.012), 'cover', 6, 0));
    const ankle = at(group(), 0, -0.36, 0);
    knee.add(ankle);
    P.joint('anklePitch' + sd, ankle, 'x', 'linear', 'ankleLin');
    const ankleRoll = group();
    ankle.add(ankleRoll);
    P.joint('ankleRoll' + sd, ankleRoll, 'z', 'linear', 'ankleLin');
    const ft = P.part(at(cyl(0.034, 0.034, 0.025, M.gold), 0, -0.02, 0), 'foot', 1, g0 + 4);
    ankleRoll.add(ft);
    P.sensor(ft, 'ft', { label: '六维力' });
    const foot = P.part(at(box(0.1, 0.04, 0.24, M.graphite, 0.015), 0, -0.05, 0.04), 'foot', 1, g0 + 4);
    ankleRoll.add(foot);
    ankleRoll.add(P.part(at(box(0.1, 0.012, 0.24, M.rubber, 0.004), 0, -0.074, 0.04), 'foot', 1, g0 + 4));
    P.contacts.push(foot);
    legs.push({ s, sd });
  }

  // Arms
  for (const s of [1, -1]) {
    const sd = s > 0 ? 'L' : 'R';
    const g0 = s > 0 ? 0 : 1;
    const sp = at(group(), 0.215 * s, 0.37, 0);
    waist.add(sp);
    P.joint('shPitch' + sd, sp, 'x', 'harmonic', 'shoulderAct');
    sp.add(P.part(at(cyl(0.05, 0.05, 0.07, M.alu, 'x'), 0.02 * s, 0, 0), 'shoulderAct', 4, g0));
    sp.add(P.part(at(torus(0.05, 0.005, M.ledCyan, 'x'), 0.056 * s, 0, 0), 'shoulderAct', 4, g0));
    const sr = at(group(), 0.065 * s, 0, 0);
    sp.add(sr);
    P.joint('shRoll' + sd, sr, 'z', 'harmonic', 'shoulderAct');
    sr.add(P.part(cyl(0.044, 0.044, 0.07, M.alu, 'z'), 'shoulderAct', 4, g0));
    const sy = at(group(), 0, -0.06, 0);
    sr.add(sy);
    P.joint('shYaw' + sd, sy, 'y', 'harmonic', 'shoulderAct');
    sy.add(P.part(at(cyl(0.04, 0.04, 0.05, M.alu), 0, -0.005, 0), 'shoulderAct', 4, g0));
    sy.add(P.part(at(box(0.065, 0.19, 0.065, M.aluDark, 0.014), 0, -0.13, 0), 'elbowAct', 4, g0));
    sy.add(P.part(at(box(0.088, 0.17, 0.088, M.shell, 0.035), 0, -0.13, 0), 'cover', 6, 1));
    const el = at(group(), 0, -0.25, 0);
    sy.add(el);
    P.joint('elbow' + sd, el, 'x', 'harmonic', 'elbowAct');
    el.add(P.part(cyl(0.038, 0.038, 0.08, M.alu, 'x'), 'elbowAct', 4, g0));
    el.add(P.part(at(box(0.058, 0.19, 0.058, M.aluDark, 0.012), 0, -0.12, 0), 'elbowAct', 4, g0));
    el.add(P.part(at(box(0.078, 0.15, 0.078, M.shell, 0.03), 0, -0.11, 0), 'cover', 6, 1));
    const wy = at(group(), 0, -0.23, 0);
    el.add(wy);
    P.joint('wrYaw' + sd, wy, 'y', 'harmonic', 'wristAct');
    wy.add(P.part(cyl(0.03, 0.03, 0.035, M.alu), 'wristAct', 4, g0));
    const wp = at(group(), 0, -0.03, 0);
    wy.add(wp);
    P.joint('wrPitch' + sd, wp, 'x', 'harmonic', 'wristAct');
    wp.add(P.part(cyl(0.024, 0.024, 0.06, M.graphite, 'x'), 'wristAct', 4, g0));
    const wr = group();
    wp.add(wr);
    P.joint('wrRoll' + sd, wr, 'z', 'harmonic', 'wristAct');
    const ftw = P.part(at(cyl(0.028, 0.028, 0.015, M.gold), 0, -0.02, 0), 'wristAct', 4, g0);
    wr.add(ftw);
    P.sensor(ftw, 'ft', { label: '腕部六维力' });
    wr.add(P.part(at(box(0.075, 0.085, 0.028, M.graphite, 0.01), 0, -0.07, 0), 'hand', 4, g0 + 2));
    const fingers = at(group(), 0, -0.11, 0);
    wr.add(fingers);
    P.joint('fingers' + sd, fingers, 'x', 'linear', 'hand', { hidden: true });
    for (let i = 0; i < 4; i++) fingers.add(P.part(at(capsule(0.008, 0.05, M.dark), -0.027 + i * 0.018, -0.03, 0), 'hand', 4, g0 + 2));
    const thumb = rot(at(capsule(0.009, 0.04, M.dark), 0.042 * s, -0.08, 0.015), 0, 0, 0.6 * s);
    wr.add(P.part(thumb, 'hand', 4, g0 + 2));
    P.sensor(fingers, 'tactile', { label: '指尖触觉' });
  }

  P.finalize();
  P.pose = (mode, t) => humanoidPose(P, mode, t);
  humanoidPose(P, 'hang', 0);
  return P;
}

function humanoidPose(P, mode, t) {
  P.resetJoints();
  const set = (n, v) => P.set(n, v);
  let bob = 0;
  if (mode === 'hang' || mode === 'rest') {
    for (const [sd, s] of [['L', 1], ['R', -1]]) { set('shRoll' + sd, 0.12 * s); set('elbow' + sd, -0.25); set('knee' + sd, 0.06); set('hipPitch' + sd, -0.03); set('anklePitch' + sd, -0.03); }
  } else if (mode === 'stand') {
    const w = Math.sin(t * 1.3);
    for (const [sd, s] of [['L', 1], ['R', -1]]) {
      set('hipPitch' + sd, -0.12); set('knee' + sd, 0.24); set('anklePitch' + sd, -0.12);
      set('hipRoll' + sd, 0.03 * w); set('ankleRoll' + sd, -0.03 * w);
      set('shRoll' + sd, 0.1 * s); set('elbow' + sd, -0.35 + 0.03 * Math.sin(t * 1.7));
    }
    set('neckYaw', 0.25 * Math.sin(t * 0.5));
    bob = -0.02 + 0.004 * Math.sin(t * 2.6);
  } else if (mode === 'walk') {
    const f = 0.95, ph = t * f * Math.PI * 2;
    for (const [sd, s, off] of [['L', 1, 0], ['R', -1, Math.PI]]) {
      const p = ph + off;
      const hip = -0.12 - 0.36 * Math.sin(p);
      const knee = 0.22 + 0.62 * Math.max(0, Math.cos(p - 0.3));
      set('hipPitch' + sd, hip);
      set('knee' + sd, knee);
      set('anklePitch' + sd, -(hip + knee) * 0.85);
      set('hipRoll' + sd, 0.035 * Math.sin(ph));
      set('ankleRoll' + sd, -0.035 * Math.sin(ph));
      set('shRoll' + sd, 0.1 * s);
      set('elbow' + sd, -0.45);
    }
    set('shPitchL', 0.32 * Math.sin(ph));
    set('shPitchR', -0.32 * Math.sin(ph));
    set('waist', 0.06 * Math.sin(ph));
    bob = -0.03 + 0.012 * Math.cos(2 * ph);
  } else if (mode === 'wave') {
    for (const [sd, s] of [['L', 1], ['R', -1]]) { set('hipPitch' + sd, -0.1); set('knee' + sd, 0.2); set('anklePitch' + sd, -0.1); }
    set('shPitchR', -0.4); set('shRollR', -1.9); set('elbowR', -0.9 - 0.35 * Math.sin(t * 5)); set('wrRollR', 0.3 * Math.sin(t * 5));
    set('shPitchL', -0.7 - 0.2 * Math.sin(t * 1.2)); set('shRollL', 0.15); set('elbowL', -1.1); set('fingersL', 0.7 + 0.5 * Math.sin(t * 2));
    set('neckYaw', -0.3); set('neckPitch', 0.15); set('waist', 0.15 * Math.sin(t * 0.8));
    bob = -0.018;
  } else if (mode === 'calib') {
    set('neckYaw', 0.5 * Math.sin(t)); set('neckPitch', 0.2 * Math.sin(t * 1.3));
  }
  P.bob = bob;
}

/* ------------------------------------------------------------------ */
/* Quadruped                                                           */
/* ------------------------------------------------------------------ */
export const GAITS = {
  stand: { off: [0, 0, 0, 0], duty: 1, f: 0 },
  trot: { off: [0, 0.5, 0.5, 0], duty: 0.5, f: 2.2 },
  pace: { off: [0, 0.5, 0, 0.5], duty: 0.5, f: 2.0 },
  bound: { off: [0, 0, 0.5, 0.5], duty: 0.4, f: 2.6 },
  walk: { off: [0, 0.5, 0.75, 0.25], duty: 0.75, f: 1.0 },
};
export const LEG_NAMES = ['FL', 'FR', 'RL', 'RR'];

export function buildQuadruped() {
  const P = new Product('quadruped');
  const body = at(group('body'), 0, 0.36, 0);
  P.root.add(body);
  P.body = body;
  body.add(P.part(box(0.24, 0.11, 0.56, M.aluDark, 0.03), 'qbody', 0, 0));
  for (const fz of [1, -1]) body.add(P.part(at(box(0.27, 0.09, 0.08, M.graphite, 0.02), 0, -0.005, 0.25 * fz), 'qbody', 0, 0));

  const legDefs = [['FL', 1, 1], ['FR', -1, 1], ['RL', 1, -1], ['RR', -1, -1]];
  legDefs.forEach(([n, s, fz], i) => {
    const hipAA = at(group(), 0.075 * s, 0, 0.25 * fz);
    body.add(hipAA);
    P.joint('aa' + n, hipAA, 'z', 'qdd', 'qhip');
    hipAA.add(P.part(cyl(0.048, 0.048, 0.07, M.alu, 'z'), 'qhip', 1, i));
    hipAA.add(P.part(at(torus(0.048, 0.005, M.gold, 'z'), 0, 0, 0.036 * fz), 'qhip', 1, i));
    const hipFE = at(group(), 0.07 * s, 0, 0);
    hipAA.add(hipFE);
    P.joint('fe' + n, hipFE, 'x', 'qdd', 'qhip');
    hipFE.add(P.part(cyl(0.054, 0.054, 0.055, M.alu, 'x'), 'qhip', 1, i));
    hipFE.add(P.part(at(cyl(0.048, 0.048, 0.045, M.graphite, 'x'), 0.05 * s, 0, 0), 'qknee', 1, i));
    hipFE.add(P.part(at(torus(0.048, 0.004, M.gold, 'x'), 0.074 * s, 0, 0), 'qknee', 1, i));
    hipFE.add(P.part(at(box(0.04, 0.22, 0.055, M.graphite, 0.012), 0.03 * s, -0.11, 0), 'qthigh', 1, i));
    hipFE.add(P.part(at(capsule(0.007, 0.2, M.steel), 0.055 * s, -0.11, -0.02), 'qlink', 1, i));
    const knee = at(group(), 0.03 * s, -0.22, 0);
    hipFE.add(knee);
    P.joint('kn' + n, knee, 'x', 'qdd', 'qknee');
    knee.add(P.part(cyl(0.022, 0.022, 0.05, M.dark, 'x'), 'qcalf', 1, i));
    knee.add(P.part(at(capsule(0.013, 0.19, M.dark), 0, -0.11, 0), 'qcalf', 1, i));
    const foot = P.part(at(sph(0.025, M.rubber), 0, -0.22, 0), 'qcalf', 1, i);
    knee.add(foot);
    P.contacts.push(foot);
  });

  body.add(P.part(at(box(0.12, 0.06, 0.3, M.graphite, 0.012), 0, 0.085, -0.04), 'qbat', 2, 0));
  body.add(P.part(at(box(0.122, 0.012, 0.04, M.gold), 0, 0.09, -0.2), 'qbat', 2, 0));
  body.add(P.part(at(box(0.16, 0.012, 0.15, M.pcb), 0, 0.062, 0.17), 'qctrl', 2, 1));
  body.add(P.part(at(box(0.05, 0.012, 0.05, M.chip), 0.03, 0.074, 0.17), 'qctrl', 2, 1));
  const qimu = P.part(at(box(0.03, 0.012, 0.03, M.gold), -0.04, 0.074, 0.14), 'qctrl', 2, 1);
  body.add(qimu);
  P.sensor(qimu, 'imu', { label: 'IMU' });

  body.add(P.part(at(cyl(0.048, 0.052, 0.05, M.dark), 0, 0.15, 0.2), 'qlidar', 3, 0));
  body.add(P.part(at(cyl(0.04, 0.046, 0.025, M.glass), 0, 0.185, 0.2), 'qlidar', 3, 0));
  const lid = at(new THREE.Object3D(), 0, 0.17, 0.2);
  body.add(lid);
  P.sensor(lid, 'lidar', { label: '4D 激光雷达', range: 1.4 });
  for (const fz of [1, -1]) {
    body.add(P.part(at(box(0.11, 0.035, 0.025, M.dark, 0.008), 0, 0.0, 0.302 * fz), 'qcam', 3, 1));
    for (const k of [1, -1]) body.add(P.part(at(cyl(0.008, 0.008, 0.01, M.glass, 'z', 10), 0.03 * k, 0.0, 0.318 * fz), 'qcam', 3, 1));
    const ca = at(new THREE.Object3D(), 0, 0, 0.32 * fz);
    if (fz < 0) ca.rotation.y = Math.PI;
    body.add(ca);
    P.sensor(ca, 'camera', { label: fz > 0 ? '前深度相机' : '后深度相机', fov: 80, range: 0.9 });
  }

  body.add(P.part(at(box(0.25, 0.05, 0.5, M.graphite, 0.022), 0, 0.09, 0), 'qcover', 4, 0));
  for (const s of [1, -1]) body.add(P.part(at(box(0.016, 0.085, 0.46, M.yellow, 0.006), 0.13 * s, 0.015, 0), 'qcover', 4, 0));
  body.add(P.part(at(box(0.025, 0.035, 0.11, M.dark, 0.01), 0, 0.13, -0.12), 'qcover', 4, 0));
  body.add(P.part(at(box(0.12, 0.006, 0.004, M.ledCyan), 0, 0.09, 0.252), 'qcover', 4, 0));

  P.finalize();
  P.pose = (mode, t) => quadPose(P, mode, t);
  quadPose(P, 'stand', 0);
  return P;
}

function quadPose(P, mode, t) {
  const g = GAITS[mode] || GAITS.stand;
  const a = 0.72;
  P.phases = [];
  let bob = 0, pitch = 0;
  LEG_NAMES.forEach((n, i) => {
    let fe = a, kn = -2 * a, stance = true;
    if (g.f > 0) {
      const p = ((t * g.f + g.off[i]) % 1 + 1) % 1;
      const A = mode === 'walk' ? 0.22 : 0.3;
      if (p < g.duty) {
        fe = a + A * (2 * p / g.duty - 1);
        kn = -2 * a - 0.08 * Math.sin(Math.PI * p / g.duty);
      } else {
        const s = (p - g.duty) / (1 - g.duty);
        fe = a + A * (1 - 2 * s);
        kn = -2 * a - 0.62 * Math.sin(Math.PI * s);
        stance = false;
      }
      fe += -0.5 * (kn + 2 * a) * 0.35;
      P.phases.push({ p, stance });
    } else {
      P.phases.push({ p: 0, stance: true });
      kn += 0.02 * Math.sin(t * 2);
    }
    P.set('fe' + n, fe);
    P.set('kn' + n, kn);
    P.set('aa' + n, 0);
  });
  if (mode === 'bound') pitch = 0.06 * Math.sin((t * g.f) * Math.PI * 2);
  if (g.f > 0) bob = 0.008 * Math.cos(t * g.f * Math.PI * 4);
  P.body.position.y = 0.36 + bob;
  P.body.rotation.x = pitch;
  P.bob = 0;
}

/* ------------------------------------------------------------------ */
/* Wheeled mobile manipulator                                          */
/* ------------------------------------------------------------------ */
export const WHEELS = [['FL', 0.23, 0.26], ['FR', -0.23, 0.26], ['RL', 0.23, -0.26], ['RR', -0.23, -0.26]];

export function buildWheeled() {
  const P = new Product('wheeled');
  const R = P.root;
  R.add(P.part(at(box(0.58, 0.15, 0.68, M.graphite, 0.03), 0, 0.215, 0), 'wchassis', 0, 0));
  R.add(P.part(at(box(0.54, 0.02, 0.64, M.aluDark, 0.006), 0, 0.3, 0), 'wchassis', 0, 0));
  WHEELS.forEach(([n, x, z], i) => {
    const steer = at(group(), x, 0.14, z);
    R.add(steer);
    P.joint('st' + n, steer, 'y', 'swerve', 'swerve');
    steer.add(P.part(at(cyl(0.055, 0.055, 0.05, M.alu), 0, 0.02, 0), 'swerve', 0, i));
    steer.add(P.part(at(cyl(0.025, 0.025, 0.07, M.dark), 0.06, 0.03, 0), 'swerve', 0, i));
    steer.add(P.part(at(box(0.02, 0.07, 0.05, M.aluDark), 0.04, -0.03, 0), 'swerve', 0, i));
    const wheel = at(group(), 0, -0.07, 0);
    steer.add(wheel);
    P.joint('wh' + n, wheel, 'x', 'drive', 'swerve', { hidden: true });
    const tyre = P.part(cyl(0.07, 0.07, 0.045, M.rubber, 'x', 24), 'swerve', 0, i);
    wheel.add(tyre);
    wheel.add(P.part(cyl(0.035, 0.035, 0.047, M.alu, 'x', 12), 'swerve', 0, i));
    wheel.add(P.part(at(box(0.048, 0.012, 0.05, M.gold), 0, 0.045, 0), 'swerve', 0, i));
    P.contacts.push(tyre);
  });

  R.add(P.part(at(box(0.36, 0.09, 0.28, M.graphite, 0.012), 0, 0.355, -0.13), 'wbat', 1, 0));
  R.add(P.part(at(box(0.362, 0.012, 0.04, M.gold), 0, 0.37, -0.2), 'wbat', 1, 0));
  for (const s of [1, -1]) R.add(P.part(at(box(0.04, 0.03, 0.01, M.gold), 0.06 * s, 0.2, -0.345), 'wbat', 1, 0));

  R.add(P.part(at(box(0.16, 0.66, 0.14, M.alu, 0.012), 0, 0.64, 0.06), 'lift', 2, 0));
  const lift = at(group('lift'), 0, 0.95, 0.06);
  R.add(lift);
  P.joint('lift', lift, 'py', 'lift', 'lift');
  lift.add(P.part(at(box(0.12, 0.5, 0.1, M.aluDark, 0.01), 0, -0.1, 0), 'lift', 2, 0));
  const torso = at(group('torso'), 0, 0.22, 0);
  lift.add(torso);
  torso.add(P.part(box(0.38, 0.17, 0.2, M.graphite, 0.03), 'wtorso', 2, 1));
  torso.add(P.part(at(box(0.3, 0.1, 0.012, M.screen), 0, 0.0, 0.102), 'wtorso', 2, 1));

  for (const s of [1, -1]) {
    const sd = s > 0 ? 'L' : 'R';
    const g0 = s > 0 ? 0 : 1;
    const j1 = at(group(), 0.215 * s, 0.03, 0);
    torso.add(j1);
    P.joint('a1' + sd, j1, 'x', 'harmonic', 'warm');
    j1.add(P.part(at(cyl(0.045, 0.045, 0.06, M.shell2, 'x'), 0.01 * s, 0, 0), 'warm', 3, g0));
    const j2 = at(group(), 0.055 * s, 0, 0);
    j1.add(j2);
    P.joint('a2' + sd, j2, 'z', 'harmonic', 'warm');
    j2.add(P.part(cyl(0.04, 0.04, 0.07, M.armJoint, 'z'), 'warm', 3, g0));
    const j3 = at(group(), 0, -0.05, 0);
    j2.add(j3);
    P.joint('a3' + sd, j3, 'y', 'harmonic', 'warm');
    j3.add(P.part(at(capsule(0.038, 0.17, M.shell2), 0, -0.11, 0), 'warm', 3, g0));
    const j4 = at(group(), 0, -0.24, 0);
    j3.add(j4);
    P.joint('a4' + sd, j4, 'x', 'harmonic', 'warm');
    j4.add(P.part(cyl(0.036, 0.036, 0.075, M.armJoint, 'x'), 'warm', 3, g0));
    j4.add(P.part(at(capsule(0.032, 0.16, M.shell2), 0, -0.11, 0), 'warm', 3, g0));
    const j5 = at(group(), 0, -0.22, 0);
    j4.add(j5);
    P.joint('a5' + sd, j5, 'y', 'harmonic', 'warm');
    j5.add(P.part(cyl(0.03, 0.03, 0.04, M.armJoint), 'warm', 3, g0));
    const j6 = at(group(), 0, -0.035, 0);
    j5.add(j6);
    P.joint('a6' + sd, j6, 'x', 'harmonic', 'warm');
    j6.add(P.part(cyl(0.026, 0.026, 0.055, M.armJoint, 'x'), 'warm', 3, g0));
    const j7 = group();
    j6.add(j7);
    P.joint('a7' + sd, j7, 'y', 'harmonic', 'warm');
    const wf = P.part(at(cyl(0.03, 0.03, 0.02, M.gold), 0, -0.03, 0), 'gripper', 3, g0 + 2);
    j7.add(wf);
    P.sensor(wf, 'ft', { label: '腕部六维力' });
    j7.add(P.part(at(box(0.08, 0.04, 0.05, M.dark, 0.01), 0, -0.06, 0), 'gripper', 3, g0 + 2));
    const fg = group();
    j7.add(fg);
    P.joint('grip' + sd, fg, 'py', 'linear', 'gripper', { hidden: true });
    for (const k of [1, -1]) fg.add(P.part(at(box(0.012, 0.06, 0.035, M.aluDark), 0.025 * k, -0.105, 0), 'gripper', 3, g0 + 2));
  }

  for (const [x, z, ry] of [[0.27, 0.32, 0], [-0.27, -0.32, Math.PI]]) {
    R.add(P.part(at(cyl(0.045, 0.045, 0.075, M.yellow), x, 0.2, z), 'wsafety', 4, 0));
    R.add(P.part(at(cyl(0.047, 0.047, 0.025, M.dark), x, 0.205, z), 'wsafety', 4, 0));
    const a = rot(at(new THREE.Object3D(), x, 0.205, z), 0, ry + (x > 0 ? 0.785 : 0.785), 0);
    R.add(a);
    P.sensor(a, 'scanner', { label: '安全激光扫描仪', range: 1.2 });
  }
  for (const z of [0.35, -0.35]) R.add(P.part(at(box(0.5, 0.035, 0.03, M.rubber, 0.01), 0, 0.12, z), 'wsafety', 4, 0));
  R.add(P.part(at(cyl(0.025, 0.03, 0.025, M.red), 0.2, 0.32, -0.3), 'wsafety', 4, 0));
  torso.add(P.part(at(cyl(0.022, 0.026, 0.022, M.red), 0.12, 0.0, -0.11), 'wsafety', 4, 0));
  const pan = at(group(), 0, 0.1, 0.02);
  torso.add(pan);
  P.joint('pan', pan, 'y', 'harmonic', 'whead');
  pan.add(P.part(cyl(0.025, 0.03, 0.04, M.dark), 'whead', 4, 1));
  const tilt = at(group(), 0, 0.05, 0);
  pan.add(tilt);
  P.joint('tilt', tilt, 'x', 'harmonic', 'whead');
  tilt.add(P.part(box(0.17, 0.06, 0.07, M.dark, 0.015), 'whead', 4, 1));
  for (const k of [1, -1]) tilt.add(P.part(at(cyl(0.012, 0.012, 0.01, M.glass, 'z', 12), 0.045 * k, 0, 0.037), 'whead', 4, 1));
  const wcam = at(new THREE.Object3D(), 0, 0, 0.04);
  tilt.add(wcam);
  P.sensor(wcam, 'camera', { label: '头部 RGB-D', fov: 75, range: 1.4 });

  R.add(P.part(at(box(0.62, 0.11, 0.72, M.shell, 0.04), 0, 0.2, 0), 'wcover', 4, 0));
  R.add(P.part(at(box(0.6, 0.012, 0.7, M.ledCyan, 0.005), 0, 0.262, 0), 'wcover', 4, 0));
  R.add(P.part(at(box(0.185, 0.6, 0.165, M.shell, 0.03), 0, 0.62, 0.06), 'wcover', 4, 1));
  torso.add(P.part(at(box(0.4, 0.07, 0.21, M.shell, 0.025), 0, 0.07, 0), 'wcover', 4, 1));

  P.finalize();
  P.pose = (mode, t, o) => wheeledPose(P, mode, t, o);
  wheeledPose(P, 'rest', 0);
  return P;
}

// Steering angle and wheel speed for each module given a body twist (vx, vz, w) in the body frame.
export function swerveKinematics(vx, vz, w) {
  return WHEELS.map(([n, x, z]) => {
    const wx = vx - w * z, wz = vz + w * x;
    const sp = Math.hypot(wx, wz);
    return { n, x, z, angle: sp > 1e-6 ? Math.atan2(wx, wz) : 0, speed: sp };
  });
}

export const SWERVE_MODES = {
  forward: [0, 0.6, 0], crab: [0.5, 0.0, 0], spin: [0, 0, 1.2], arc: [0, 0.5, 0.9],
};

function wheeledPose(P, mode, t, o = {}) {
  const set = (n, v) => P.set(n, v);
  for (const sd of ['L', 'R']) for (let i = 1; i <= 7; i++) set('a' + i + sd, 0);
  for (const [sd, s] of [['L', 1], ['R', -1]]) {
    set('a1' + sd, -0.35); set('a2' + sd, 0.12 * s); set('a4' + sd, -1.3); set('a6' + sd, -0.3); set('grip' + sd, 0);
  }
  set('lift', o.lift ?? 0);
  set('pan', 0); set('tilt', 0);
  let twist = null;
  if (mode === 'drive') {
    const m = (t * 0.12) % 1;
    twist = m < 0.4 ? SWERVE_MODES.forward : m < 0.6 ? SWERVE_MODES.crab : m < 0.8 ? SWERVE_MODES.spin : SWERVE_MODES.arc;
  } else if (SWERVE_MODES[mode]) twist = SWERVE_MODES[mode];
  if (o.twist) twist = o.twist;
  if (twist) {
    const ks = swerveKinematics(...twist);
    P.wheelState = ks;
    for (const k of ks) {
      P.set('st' + k.n, k.angle);
      P.set('wh' + k.n, (t * k.speed / 0.07) % (Math.PI * 2));
    }
    set('pan', 0.4 * Math.sin(t * 0.7));
  } else {
    P.wheelState = null;
    for (const [n] of WHEELS) { P.set('st' + n, 0); P.set('wh' + n, (o.roll || 0)); }
  }
  if (mode === 'calib') {
    const k = Math.floor(t * 0.6) % 5, u = (t * 0.6) % 1, e = Math.min(1, u * 3);
    const poses = [[-0.4, 0.1, -1.2, 0.2], [-0.9, 0.3, -0.8, -0.5], [-0.2, 0.5, -1.6, 0.4], [-1.2, 0.0, -0.4, 0.0], [-0.6, 0.2, -1.0, -0.8]];
    const p0 = poses[(k + 4) % 5], p1 = poses[k];
    const L = (i) => p0[i] + (p1[i] - p0[i]) * e;
    for (const [sd, s] of [['L', 1], ['R', -1]]) { set('a1' + sd, L(0)); set('a2' + sd, L(1) * s); set('a4' + sd, L(2)); set('a6' + sd, L(3)); set('a3' + sd, 0.3 * s * Math.sin(t)); }
    set('tilt', 0.25); set('pan', 0.3 * Math.sin(t * 0.8));
  }
  if (o.reach != null) {
    const r = o.reach;
    for (const [sd, s] of [['L', 1], ['R', -1]]) { set('a1' + sd, -0.35 - 1.2 * r); set('a4' + sd, -1.3 + 1.2 * r); set('a6' + sd, -0.3 + 0.1 * r); set('a2' + sd, 0.12 * s); }
  }
  P.bob = 0;
}

/* ------------------------------------------------------------------ */
/* Actuator (joint module)                                              */
/* ------------------------------------------------------------------ */
// hi: detailed single module for the lab. lo: compact version used on trays.
export function buildActuator({ hi = false, variant = 'planetary', P = null, stage0 = 0, ox = 0, oz = 0, grp = 0 } = {}) {
  const own = !P;
  if (own) P = new Product('actuator');
  const A = at(group('act'), ox, 0, oz);
  P.root.add(A);
  const st = (n) => stage0 + n;
  const ex = (y) => (hi ? { explode: [0, y * 0.45, 0] } : {});
  if (!hi) {
    A.add(at(ring(0.048, 0.042, 0.07, M.aluDark, 28), 0, 0.035, 0));
    A.add(P.part(at(ring(0.042, 0.03, 0.04, M.copper, 24), 0, 0.03, 0), 'stator', st(0), grp));
    A.add(P.part(at(cyl(0.028, 0.028, 0.04, M.magN, 'y', 16), 0, 0.035, 0), 'rotor', st(1), grp));
    A.add(P.part(at(cyl(0.04, 0.04, 0.02, M.gold, 'y', 20), 0, 0.06, 0), 'reducer', st(2), grp));
    A.add(P.part(at(cyl(0.045, 0.045, 0.006, M.pcb, 'y', 20), 0, 0.074, 0), 'driver', st(3), grp));
    A.add(P.part(at(cyl(0.049, 0.049, 0.01, M.graphite, 'y', 24), 0, 0.082, 0), 'cap', st(4), grp));
    if (own) P.finalize();
    return P;
  }

  // Detailed module, output flange up (+y). Exploded along the axis.
  A.add(P.part(at(ring(0.048, 0.043, 0.07, M.aluDark, 48), 0, 0, 0), 'housing', -1, 0, ex(-0.16)));
  A.add(P.part(at(ring(0.056, 0.043, 0.008, M.aluDark, 48), 0, -0.031, 0), 'housing', -1, 0, ex(-0.16)));
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    A.add(P.part(at(cyl(0.004, 0.004, 0.01, M.steel, 'y', 8), Math.cos(a) * 0.052, -0.031, Math.sin(a) * 0.052), 'housing', -1, 0, ex(-0.16)));
  }
  // Stator: back iron + 12 copper-wound teeth
  const stator = group();
  A.add(stator);
  stator.add(P.part(ring(0.0425, 0.037, 0.04, M.steel, 40), 'stator', 0, 0, ex(0)));
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const t = rot(at(box(0.012, 0.038, 0.009, M.copper, 0.003), Math.cos(a) * 0.032, 0, Math.sin(a) * 0.032), 0, -a, 0);
    stator.add(P.part(t, 'stator', 0, 0, ex(0)));
  }
  // Rotor: spins at motor speed; magnets alternate N/S.
  const rotor = group('rotor');
  A.add(rotor);
  P.joint('rotor', rotor, 'y', 'rotor', 'rotor');
  rotor.add(P.part(ring(0.02, 0.008, 0.036, M.steel, 32), 'rotor', 1, 0, ex(0.16)));
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2;
    const m = rot(at(box(0.008, 0.034, 0.0075, i % 2 ? M.magS : M.magN), Math.cos(a) * 0.0235, 0, Math.sin(a) * 0.0235), 0, -a, 0);
    rotor.add(P.part(m, 'rotor', 1, 0, ex(0.16)));
  }
  rotor.add(P.part(at(cyl(0.007, 0.007, 0.07, M.steel, 'y', 12), 0, 0.02, 0), 'rotor', 1, 0, ex(0.16)));
  A.add(P.part(at(torus(0.039, 0.0045, M.steel, 'y', 40), 0, 0.04, 0), 'bearing', 1, 1, ex(0.24)));

  // Reducer
  const output = group('output');
  at(output, 0, 0.052, 0);
  A.add(output);
  P.joint('output', output, 'y', variant === 'planetary' ? 'qdd' : 'harmonic', 'reducer');
  P.planets = [];
  if (variant === 'planetary') {
    A.add(P.part(at(ring(0.044, 0.036, 0.022, M.aluDark, 40), 0, 0.052, 0), 'reducer', 2, 0, ex(0.32)));
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2;
      A.add(P.part(rot(at(box(0.004, 0.02, 0.003, M.steel), Math.cos(a) * 0.035, 0.052, Math.sin(a) * 0.035), 0, -a, 0), 'reducer', 2, 0, ex(0.32)));
    }
    const sun = at(cyl(0.009, 0.009, 0.022, M.gold, 'y', 12), 0, 0.052, 0);
    rotor.add(P.part(at(sun, 0, 0.052, 0), 'reducer', 2, 0, ex(0.32)));
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      const pg = at(group(), Math.cos(a) * 0.022, 0, Math.sin(a) * 0.022);
      output.add(pg);
      pg.add(P.part(cyl(0.0125, 0.0125, 0.02, M.gold, 'y', 14), 'reducer', 2, 0, ex(0.32)));
      for (let k = 0; k < 6; k++) {
        const b = k / 6 * Math.PI * 2;
        pg.add(P.part(at(box(0.004, 0.021, 0.004, M.steel), Math.cos(b) * 0.012, 0, Math.sin(b) * 0.012), 'reducer', 2, 0, ex(0.32)));
      }
      P.planets.push(pg);
    }
    output.add(P.part(at(cyl(0.034, 0.034, 0.004, M.steel, 'y', 32), 0, 0.013, 0), 'reducer', 2, 0, ex(0.32)));
  } else {
    // Strain wave: elliptical wave generator, flexspline cup, circular spline
    const wg = at(cyl(0.024, 0.024, 0.012, M.steel, 'y', 32), 0, 0.052, 0);
    wg.scale.set(1.12, 1, 0.88);
    rotor.add(P.part(wg, 'reducer', 2, 0, ex(0.3)));
    const fs = at(ring(0.031, 0.0285, 0.03, M.steel, 48), 0, 0.0, 0);
    fs.scale.set(1.04, 1, 0.96);
    output.add(P.part(fs, 'reducer', 2, 0, ex(0.34)));
    output.add(P.part(at(cyl(0.031, 0.031, 0.003, M.steel, 'y', 40), 0, 0.016, 0), 'reducer', 2, 0, ex(0.34)));
    A.add(P.part(at(ring(0.044, 0.0325, 0.016, M.aluDark, 48), 0, 0.052, 0), 'reducer', 2, 1, ex(0.38)));
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * Math.PI * 2;
      A.add(P.part(rot(at(box(0.0025, 0.016, 0.002, M.gold), Math.cos(a) * 0.032, 0.052, Math.sin(a) * 0.032), 0, -a, 0), 'reducer', 2, 1, ex(0.38)));
    }
  }
  const fl = at(group(), 0, 0.028, 0);
  output.add(fl);
  fl.add(P.part(cyl(0.032, 0.032, 0.012, M.alu, 'y', 40), 'flange', 2, 1, ex(0.46)));
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    fl.add(P.part(at(cyl(0.003, 0.003, 0.013, M.dark, 'y', 8), Math.cos(a) * 0.024, 0, Math.sin(a) * 0.024), 'flange', 2, 1, ex(0.46)));
  }
  fl.add(P.part(at(cyl(0.008, 0.008, 0.013, M.dark, 'y', 16), 0, 0, 0), 'flange', 2, 1, ex(0.46)));

  // Encoders and drive electronics at the back.
  A.add(P.part(at(ring(0.018, 0.01, 0.006, M.dark, 24), 0, -0.024, 0), 'encoder', 3, 0, ex(-0.26)));
  A.add(P.part(at(cyl(0.04, 0.04, 0.003, M.pcb, 'y', 36), 0, -0.032, 0), 'encoder', 3, 0, ex(-0.28)));
  A.add(P.part(at(box(0.008, 0.002, 0.008, M.chip), 0, -0.03, 0.012), 'encoder', 3, 0, ex(-0.28)));
  A.add(P.part(at(cyl(0.044, 0.044, 0.004, M.pcb, 'y', 36), 0, -0.045, 0), 'driver', 3, 1, ex(-0.36)));
  const comps = [[0.012, 0.003, 0.012, M.chip, 0, 0.0], [0.006, 0.003, 0.009, M.chip, 0.02, 0.012], [0.006, 0.003, 0.009, M.chip, 0.02, -0.012], [0.006, 0.003, 0.009, M.chip, -0.02, 0.012], [0.006, 0.003, 0.009, M.chip, -0.02, -0.012], [0.006, 0.003, 0.009, M.chip, 0.0, 0.026], [0.006, 0.003, 0.009, M.chip, 0.0, -0.026]];
  for (const [w, h, d, m, x, z] of comps) A.add(P.part(at(box(w, h, d, m), x, -0.049, z), 'driver', 3, 1, ex(-0.36)));
  for (const [x, z] of [[0.03, 0.0], [-0.03, 0.0], [0.0, 0.034]]) A.add(P.part(at(cyl(0.004, 0.004, 0.01, M.steel, 'y', 10), x, -0.052, z), 'driver', 3, 1, ex(-0.36)));
  A.add(P.part(at(box(0.016, 0.006, 0.008, M.dark), 0.0, -0.05, -0.036), 'driver', 3, 1, ex(-0.36)));
  A.add(P.part(at(cyl(0.049, 0.049, 0.01, M.graphite, 'y', 48), 0, -0.062, 0), 'cap', 4, 0, ex(-0.44)));
  A.add(P.part(at(box(0.014, 0.001, 0.014, M.shell), 0.02, -0.0675, 0.0), 'cap', 4, 0, ex(-0.44)));
  if (own) P.finalize();
  P.pose = (mode, t, o = {}) => {
    const N = o.ratio || (variant === 'planetary' ? 9 : 101);
    const wm = (o.speed ?? 6) * t;
    P.set('rotor', wm);
    P.set('output', -wm / N * (variant === 'planetary' ? 1 : -1));
    if (variant === 'planetary') for (const pg of P.planets) pg.rotation.y = wm * 0.7;
  };
  return P;
}

export const TRAY_SLOTS = (() => {
  const s = [];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) s.push([-0.21 + i * 0.14, k ? 0.09 : -0.09, i < 2 ? 0 : 1]);
  return s;
})();

export function buildTray() {
  const P = new Product('tray');
  P.root.add(at(box(0.66, 0.035, 0.44, M.pallet, 0.01), 0, 0.0175, 0));
  P.root.add(at(box(0.05, 0.012, 0.03, M.gold), 0.3, 0.04, 0.2));
  for (const [x, z, g] of TRAY_SLOTS) {
    buildActuator({ P, ox: x, oz: z, grp: g });
  }
  for (const c of P.root.children) if (c.name === 'act') c.position.y = 0.035;
  P.finalize();
  P.pose = () => {};
  return P;
}

export function buildProduct(kind, opts) {
  if (kind === 'humanoid') return buildHumanoid();
  if (kind === 'quadruped') return buildQuadruped();
  if (kind === 'wheeled') return buildWheeled();
  if (kind === 'actuator') return opts?.hi ? buildActuator({ hi: true, variant: opts.variant || 'planetary' }) : buildTray();
  throw new Error('unknown product ' + kind);
}

export { clamp };
