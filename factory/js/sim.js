// Discrete-time line simulation: stations, conveyors with no-overtaking queues,
// stochastic cycle times, MTBF/MTTR faults, inline quality with retry, kanban + AMR logistics.
import { LINES, LAYOUT } from './data.js';
import { rng, gauss, clamp } from './kit.js';

const WEEK = '2644';
const pad = (n, k) => String(n).padStart(k, '0');
const PREFIX = { J: 'JT', H: 'HM', Q: 'QD', W: 'WM' };

class Station {
  constructor(def, idx, line) {
    this.def = def; this.id = def.id; this.idx = idx; this.line = line;
    this.x = line.def.x0 + idx * line.def.pitch;
    this.unit = null; this.started = false; this.finished = false; this.retried = false;
    this.t = 0; this.ct = 0; this.down = 0; this.downTotal = 0; this.fault = null;
    this.state = 'idle';
    this.ctFactor = 1;
    this.stock = {}; this.inTransit = {}; this.cap = {}; this.reorder = {};
    for (const [k, n] of Object.entries(def.consumes || {})) {
      this.cap[k] = k === 'act' ? Math.max(32, n * 3) : 6;
      this.reorder[k] = k === 'act' ? n * 2 + 4 : 3;
      this.stock[k] = [];
      this.inTransit[k] = 0;
    }
    this.resetStats();
  }

  resetStats() {
    this.acc = { work: 0, idle: 0, blocked: 0, down: 0, mat: 0 };
    this.count = 0; this.nok = 0; this.retries = 0; this.faults = 0;
    this.cts = [];
  }

  get sim() { return this.line.sim; }
  get baseCt() { return this.def.ct * this.ctFactor; }
  get progress() { return this.unit && this.started ? clamp(this.t / this.ct, 0, 1) : (this.unit && this.finished ? 1 : -1); }

  accept(u) {
    this.unit = u; u.st = this;
    this.started = false; this.finished = false; this.retried = false; this.t = 0;
  }

  release() { this.unit = null; this.started = false; this.finished = false; this.t = 0; }

  tryConsume() {
    const c = this.def.consumes;
    if (!c) return true;
    for (const [k, n] of Object.entries(c)) if (this.stock[k].length < n) return false;
    for (const [k, n] of Object.entries(c)) this.unit.gen.push({ st: this.id, type: k, items: this.stock[k].splice(0, n) });
    return true;
  }

  step(dt) {
    const sim = this.sim;
    if (this.down > 0) {
      this.down -= dt; this.acc.down += dt; this.state = 'down';
      if (this.down <= 0) {
        this.down = 0;
        sim.log('repair', `${this.id} 恢复运行（${this.fault}）`, this);
        this.fault = null;
      }
      return;
    }
    if (!this.unit) { this.state = 'idle'; this.acc.idle += dt; return; }
    if (this.finished) { this.state = 'blocked'; this.acc.blocked += dt; return; }
    if (!this.started) {
      if (!this.tryConsume()) { this.state = 'mat'; this.acc.mat += dt; return; }
      this.started = true; this.t = 0;
      const b = this.baseCt;
      this.ct = clamp(b * (1 + 0.055 * gauss(sim.r)), b * 0.88, b * 1.3);
    }
    this.state = 'work'; this.acc.work += dt; this.t += dt;
    if (sim.faultsOn && sim.r() < dt / this.def.mtbf) { this.fail(); return; }
    if (this.t >= this.ct) this.complete();
  }

  fail(code) {
    const sim = this.sim;
    const f = this.def.faults || ['未知故障'];
    this.fault = code || f[Math.floor(sim.r() * f.length)];
    this.down = clamp(-Math.log(Math.max(1e-6, sim.r())) * this.def.mttr, 45, this.def.mttr * 4);
    this.downTotal = this.down;
    this.faults++;
    this.state = 'down';
    sim.log('fault', `${this.id} ${this.def.name} 停机：${this.fault}`, this);
  }

  complete() {
    const sim = this.sim, u = this.unit;
    // First check uses the station FPY; a retry recovers ~55% of NOK parts.
    const ok = sim.r() < (this.retried ? 0.55 : this.def.fpy);
    this.last = { sn: u.sn, ok, seed: (sim.r() * 1e9) | 0, t: sim.t, retry: this.retried };
    if (!ok && !this.retried) {
      this.retried = true; this.nok++; this.retries++;
      this.ct += this.baseCt * 0.35;
      sim.log('quality', `${this.id} ${u.sn} 判定 NOK → 自动返工重试`, this);
      return;
    }
    if (!ok) {
      u.nok = true; u.defects.push(this.id); this.nok++;
      sim.log('quality', `${this.id} ${u.sn} 复测仍 NOK → 标记下线返修`, this);
    }
    this.finished = true;
    this.count++;
    this.cts.push(this.t);
    if (this.cts.length > 40) this.cts.shift();
    u.hist.push({ id: this.id, ct: this.t, ok: !(!ok), retry: this.retried, t: sim.t, seed: this.last.seed });
    u.stage++;
  }
}

class Line {
  constructor(def, sim) {
    this.def = def; this.id = def.id; this.sim = sim;
    this.stations = def.stations.map((s, i) => new Station(s, i, this));
    this.units = [];
    this.seq = 0;
    this.conwip = def.conwip || this.stations.length + 5;
    this.winStart = 0;
    this.resetStats();
  }

  resetStats() {
    this.out = 0; this.good = 0; this.leads = []; this.outT = []; this.uphHist = [];
    this.t0 = this.sim.t;
    for (const s of this.stations) s.resetStats();
  }

  spawn() {
    const d = this.def;
    this.seq++;
    const u = {
      id: d.id + this.seq, line: this, sn: `${PREFIX[d.id]}-${WEEK}-${pad(this.seq + (d.id === 'J' ? 400 : 0), d.id === 'J' ? 4 : 5)}`,
      pos: d.spawnX, stage: 0, st: null, nok: false, defects: [], hist: [], gen: [], tSpawn: this.sim.t, moving: false,
    };
    this.units.push(u);
    this.sim.emit('spawn', u);
    return u;
  }

  step(dt) {
    const d = this.def, N = this.stations.length, sim = this.sim;
    for (const st of this.stations) st.step(dt);
    const exits = [];
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.st && !u.st.finished) { u.moving = false; continue; }
      if (u.st && u.st.state === 'down') { u.moving = false; continue; }
      const front = i > 0 ? this.units[i - 1].pos - d.gap : Infinity;
      const next = u.stage < N ? this.stations[u.stage] : null;
      let stop = next ? next.x : d.endX;
      if (!next && d.id === 'J' && sim.jOut.length >= 12) stop = d.endX - 0.8;
      const np = Math.max(u.pos, Math.min(u.pos + d.speed * dt, front, stop));
      u.moving = np > u.pos + 1e-9;
      u.vel = (np - u.pos) / dt;
      u.pos = np;
      if (u.st && u.st.finished && u.pos > u.st.x + 0.05) { u.st.release(); u.st = null; }
      if (next && !u.st && !next.unit && u.pos >= next.x - 1e-6) next.accept(u);
      if (!next && u.pos >= d.endX - 1e-6) exits.push(u);
    }
    for (const u of exits) this.exit(u);
    const last = this.units[this.units.length - 1];
    // CONWIP release: a new carrier enters only while total WIP is under the cap.
    if ((!last || last.pos >= d.spawnX + d.gap + 0.01) && this.units.length < this.conwip) this.spawn();
  }

  exit(u) {
    const sim = this.sim;
    this.units.splice(this.units.indexOf(u), 1);
    this.out++;
    if (!u.nok) this.good++;
    this.outT.push(sim.t);
    this.leads.push(sim.t - u.tSpawn);
    if (this.leads.length > 30) this.leads.shift();
    if (this.id === 'J') {
      const n = u.nok ? 7 : 8;
      const items = [];
      for (let k = 1; k <= n; k++) items.push(`JA-${u.sn.slice(-4)}-${k}`);
      sim.jOut.push({ sn: u.sn, items });
    } else {
      sim.log(u.nok ? 'quality' : 'output', u.nok ? `${u.sn} 下线 → 返修区（${u.defects.join(', ')}）` : `${u.sn} 下线 ✓ 入成品库`, u);
    }
    sim.emit('exit', u);
  }

  get elapsed() { return Math.max(1, this.sim.t - this.t0); }

  get uph() {
    const t = this.sim.t;
    while (this.outT.length && this.outT[0] < t - 3600) this.outT.shift();
    const w = Math.min(3600, t - this.winStart);
    return w < 60 ? 0 : this.outT.length * 3600 / w;
  }

  get targetUph() { return 3600 / this.def.takt; }
  get wip() { return this.units.length; }
  get fpy() { return this.out ? this.good / this.out : 1; }
  get lead() { return this.leads.length ? this.leads.reduce((a, b) => a + b, 0) / this.leads.length : 0; }

  get idealCt() { return Math.max(...this.stations.map((s) => s.baseCt)); }

  get bottleneck() {
    let best = null, bv = -1;
    for (const s of this.stations) {
      const a = s.acc, tot = a.work + a.idle + a.blocked + a.down + a.mat || 1;
      const v = (a.work + a.down) / tot;
      if (v > bv) { bv = v; best = s; }
    }
    return best;
  }

  get oee() {
    const el = this.elapsed;
    const b = this.bottleneck;
    const A = b ? 1 - b.acc.down / el : 1;
    const Q = this.fpy;
    const oee = clamp(this.good * this.idealCt / el, 0, 1);
    const P = clamp(oee / Math.max(1e-3, A * Q), 0, 1);
    return { oee, A, P, Q };
  }
}

class AMR {
  constructor(id, slot) {
    this.id = id; this.name = 'AMR-' + pad(id, 2); this.slot = slot;
    const c = chargerLoc(slot);
    this.x = c.x; this.z = c.z; this.hd = Math.PI;
    this.state = 'idle'; this.path = []; this.seg = 0; this.battery = 0.7 + 0.3 * ((id * 37) % 10) / 10;
    this.load = null; this.task = null; this.timer = 0; this.odo = 0; this.trips = 0; this.retire = false;
  }
}

const STATE_ZH = { idle: '待命充电', toPick: '前往取料', pick: '装载中', wait: '等待物料', toDrop: '配送中', drop: '卸载中', toCharge: '返回充电位', charge: '充电中' };
export { STATE_ZH as AMR_STATE };

function chargerLoc(slot) {
  const c = LAYOUT.chargers;
  const z = c.z0 + slot * c.dz;
  return { x: c.dockX, z, az: z, forceX: LAYOUT.crossX[0] };
}

function dockFor(st) {
  const L = st.line.def;
  const aisle = { H: LAYOUT.aisles.A1, Q: LAYOUT.aisles.A2, W: LAYOUT.aisles.A3 }[L.id];
  return { x: st.x, z: L.z + L.rackZ - 1.2, az: aisle };
}

function pickLoc(type) {
  if (type === 'act') return { x: LAYOUT.jOut.x, z: LAYOUT.jOut.dockZ, az: LAYOUT.jOut.az };
  const p = LAYOUT.store.pick;
  return { x: p.x, z: p.dockZ, az: p.az };
}

export function route(a, b) {
  const pts = [[a.x, a.z]];
  if (Math.abs(a.z - a.az) > 1e-6) pts.push([a.x, a.az]);
  if (Math.abs(a.az - b.az) < 1e-6 && !a.forceX && !b.forceX) pts.push([b.x, b.az]);
  else {
    const fx = a.forceX ?? b.forceX;
    const xc = fx ?? LAYOUT.crossX.reduce((best, x) => (Math.abs(a.x - x) + Math.abs(b.x - x) < Math.abs(a.x - best) + Math.abs(b.x - best) ? x : best));
    pts.push([xc, a.az], [xc, b.az], [b.x, b.az]);
  }
  if (Math.abs(b.z - b.az) > 1e-6) pts.push([b.x, b.z]);
  const out = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-3) out.push(p);
  }
  // Remove collinear midpoints.
  for (let i = out.length - 2; i >= 1; i--) {
    const [a0, a1] = [out[i - 1], out[i + 1]];
    if ((Math.abs(a0[0] - out[i][0]) < 1e-6 && Math.abs(a1[0] - out[i][0]) < 1e-6) || (Math.abs(a0[1] - out[i][1]) < 1e-6 && Math.abs(a1[1] - out[i][1]) < 1e-6)) out.splice(i, 1);
  }
  return offsetPath(out, 0.6);
}

// Right-hand traffic: offset the polyline to the right of travel direction.
function offsetPath(pts, o) {
  if (pts.length < 2) return pts.map((p) => ({ x: p[0], z: p[1] }));
  const dir = (i) => { const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1]; const L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
  const right = (d) => [-d[1], d[0]];
  const res = [];
  for (let i = 0; i < pts.length; i++) {
    let r;
    if (i === 0) r = right(dir(0));
    else if (i === pts.length - 1) r = right(dir(i - 1));
    else {
      const r1 = right(dir(i - 1)), r2 = right(dir(i));
      const m = [r1[0] + r2[0], r1[1] + r2[1]];
      const L = Math.hypot(m[0], m[1]);
      if (L < 1e-6) r = r1;
      else { const k = 1 / ((m[0] / L) * r1[0] + (m[1] / L) * r1[1]); r = [m[0] / L * k, m[1] / L * k]; }
    }
    res.push({ x: pts[i][0] + r[0] * o, z: pts[i][1] + r[1] * o });
  }
  return res;
}

export class Sim {
  constructor(seed = 20261028) {
    this.r = rng(seed);
    this.t = 0;
    this.faultsOn = true;
    this.handlers = {};
    this.logs = [];
    this.jOut = [];
    this.batSeq = 1000;
    this.lines = LINES.map((d) => new Line(d, this));
    this.lineById = Object.fromEntries(this.lines.map((l) => [l.id, l]));
    this.stations = this.lines.flatMap((l) => l.stations);
    this.stationById = Object.fromEntries(this.stations.map((s) => [s.id, s]));
    this.consumers = this.stations.filter((s) => s.def.consumes);
    this.amrs = [];
    this.tasks = [];
    this.taskSeq = 0;
    this.amrSeq = 0;
    this.amrSpeed = 1.5;
    // Initial line-side stock and outbound buffer.
    let k = 0;
    for (const s of this.consumers) for (const t of Object.keys(s.stock)) {
      for (let i = 0; i < s.cap[t] - 8; i++) s.stock[t].push(t === 'act' ? `JA-0${300 + (k >> 3)}-${(k++ & 7) + 1}` : `BAT-${this.batSeq++}`);
    }
    for (let i = 0; i < 6; i++) this.jOut.push({ sn: `JT-${WEEK}-0${390 + i}`, items: Array.from({ length: 8 }, (_, c) => `JA-0${390 + i}-${c + 1}`) });
    this.setAmrCount(4);
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const f of this.handlers[ev] || []) f(...a); }

  log(type, msg, ref) {
    if (this.quiet) return;
    const e = { t: this.t, type, msg, ref };
    this.logs.push(e);
    if (this.logs.length > 300) this.logs.shift();
    this.emit('log', e);
  }

  clock(t = this.t) {
    const s = 8 * 3600 + t;
    const day = Math.floor(s / 86400) + 1;
    const r = s % 86400;
    return `D${day} ${pad(Math.floor(r / 3600), 2)}:${pad(Math.floor(r / 60) % 60, 2)}:${pad(Math.floor(r) % 60, 2)}`;
  }

  setAmrCount(n) {
    n = clamp(n, 1, 8);
    const active = this.amrs.filter((a) => !a.retire);
    if (n > active.length) {
      for (let i = active.length; i < n; i++) {
        const used = new Set(this.amrs.map((a) => a.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        const a = new AMR(++this.amrSeq, slot);
        this.amrs.push(a);
        this.emit('amrAdd', a);
      }
    } else {
      let drop = active.length - n;
      for (const a of [...active].sort((x, y) => (x.state === 'idle' ? -1 : 1) - (y.state === 'idle' ? -1 : 1))) {
        if (drop <= 0) break;
        a.retire = true; drop--;
        if (a.state === 'idle') this.removeAmr(a);
      }
    }
  }

  removeAmr(a) {
    this.amrs.splice(this.amrs.indexOf(a), 1);
    this.emit('amrRemove', a);
  }

  get amrCount() { return this.amrs.filter((a) => !a.retire).length; }

  step(dt) {
    this.t += dt;
    for (const l of this.lines) l.step(dt);
    this.kanban();
    this.dispatch();
    for (const a of [...this.amrs]) this.stepAmr(a, dt);
    if (Math.floor(this.t / 300) !== Math.floor((this.t - dt) / 300)) {
      for (const l of this.lines) { l.uphHist.push(l.uph); if (l.uphHist.length > 144) l.uphHist.shift(); }
    }
  }

  kanban() {
    for (const s of this.consumers) for (const k of Object.keys(s.stock)) {
      if (s.stock[k].length + s.inTransit[k] < s.reorder[k]) {
        const qty = k === 'act' ? 16 : 4;
        s.inTransit[k] += qty;
        this.tasks.push({ id: ++this.taskSeq, type: k, st: s, qty, created: this.t });
      }
    }
  }

  dispatch() {
    while (this.tasks.length) {
      const task = this.tasks[0];
      const pick = pickLoc(task.type);
      let best = null, bd = Infinity;
      for (const a of this.amrs) {
        if (a.retire || a.state !== 'idle' || a.battery < 0.35) continue;
        const d = Math.abs(a.x - pick.x) + Math.abs(a.z - pick.z);
        if (d < bd) { bd = d; best = a; }
      }
      if (!best) return;
      this.tasks.shift();
      this.assign(best, task);
    }
  }

  assign(a, task) {
    a.task = task;
    a.state = 'toPick';
    a.path = route(this.amrLoc(a), pickLoc(task.type));
    a.seg = 0;
    this.log('logistics', `${a.name} ← 任务：${task.type === 'act' ? '关节模组' : '电池包'} ×${task.qty} → ${task.st.id}`, a);
  }

  amrLoc(a) {
    if (a.state === 'idle' || a.state === 'charge' || a.atSlot) return chargerLoc(a.slot);
    const near = [LAYOUT.aisles.A1, LAYOUT.aisles.A2, LAYOUT.aisles.A3].reduce((b, z) => (Math.abs(z - a.z) < Math.abs(b - a.z) ? z : b));
    return { x: a.x, z: a.z, az: a.lastDock?.az ?? near };
  }

  stepAmr(a, dt) {
    const moving = a.path.length && a.seg < a.path.length - 1;
    a.atSlot = false;
    if (moving) {
      let rem = this.amrSpeed * dt;
      while (rem > 0 && a.seg < a.path.length - 1) {
        const p = a.path[a.seg + 1];
        const dx = p.x - a.x, dz = p.z - a.z, L = Math.hypot(dx, dz);
        if (L <= rem) { a.x = p.x; a.z = p.z; rem -= L; a.seg++; a.odo += L; }
        else { a.x += dx / L * rem; a.z += dz / L * rem; a.odo += rem; a.hdT = Math.atan2(-dz, dx); rem = 0; }
        if (L > 1e-4) a.hdT = Math.atan2(-dz, dx);
      }
      a.battery = Math.max(0, a.battery - dt / 10800);
      if (a.seg >= a.path.length - 1) { a.path = []; this.arrive(a); }
      return;
    }
    a.timer -= dt;
    if (a.state === 'idle' || a.state === 'charge') {
      a.atSlot = true;
      a.battery = Math.min(1, a.battery + dt / 2400);
      if (a.state === 'charge' && a.battery > 0.95) a.state = 'idle';
      if (a.retire && a.state === 'idle') this.removeAmr(a);
      return;
    }
    if (a.state === 'pick' || a.state === 'wait') {
      if (a.timer > 0) return;
      const t = a.task;
      if (t.type === 'act') {
        if (!this.jOut.length) { a.state = 'wait'; return; }
        const trays = this.jOut.splice(0, Math.min(this.jOut.length, Math.ceil(t.qty / 8)));
        const items = trays.flatMap((x) => x.items);
        a.load = { type: 'act', items, trays: trays.map((x) => x.sn) };
        t.st.inTransit.act += items.length - t.qty;
        t.qty = items.length;
      } else {
        a.load = { type: 'bat', items: Array.from({ length: t.qty }, () => `BAT-${this.batSeq++}`) };
      }
      this.emit('amrLoad', a);
      a.state = 'toDrop';
      a.lastDock = pickLoc(t.type);
      a.path = route({ ...a.lastDock, x: a.x, z: a.z }, dockFor(t.st));
      a.seg = 0;
      return;
    }
    if (a.state === 'drop') {
      if (a.timer > 0) return;
      const t = a.task;
      t.st.stock[t.type].push(...a.load.items);
      t.st.inTransit[t.type] -= t.qty;
      a.load = null; a.task = null; a.trips++;
      this.emit('amrLoad', a);
      a.lastDock = dockFor(t.st);
      if (!a.retire && a.battery > 0.3 && this.tasks.length) {
        const task = this.tasks.shift();
        a.task = task;
        a.state = 'toPick';
        a.path = route({ ...a.lastDock, x: a.x, z: a.z }, pickLoc(task.type));
        a.seg = 0;
        this.log('logistics', `${a.name} ← 任务：${task.type === 'act' ? '关节模组' : '电池包'} ×${task.qty} → ${task.st.id}`, a);
      } else {
        if (a.battery <= 0.3) this.log('logistics', `${a.name} 电量 ${Math.round(a.battery * 100)}% → 返回充电`, a);
        a.state = 'toCharge';
        a.path = route({ ...a.lastDock, x: a.x, z: a.z }, chargerLoc(a.slot));
        a.seg = 0;
      }
    }
  }

  arrive(a) {
    if (a.state === 'toPick') { a.state = 'pick'; a.timer = 14; }
    else if (a.state === 'toDrop') { a.state = 'drop'; a.timer = 14; }
    else if (a.state === 'toCharge') { a.state = a.battery < 0.6 ? 'charge' : 'idle'; a.hdT = Math.PI; }
  }

  warmup(seconds) {
    this.quiet = true;
    const dt = 0.5;
    for (let t = 0; t < seconds; t += dt) this.step(dt);
    this.quiet = false;
    // Keep the warm-up statistics (it is the start of the shift) and re-base time to 0.
    const T = this.t;
    this.t = 0;
    for (const l of this.lines) {
      l.outT = l.outT.map((x) => x - T);
      l.t0 -= T; l.winStart -= T;
      for (const u of l.units) { u.tSpawn -= T; for (const h of u.hist) h.t -= T; }
    }
    for (const s of this.stations) if (s.last) s.last.t -= T;
    for (const tk of this.tasks) tk.created -= T;
    this.logs = [];
  }

  // Aggregate KPIs over the three final-assembly lines.
  get kpi() {
    const fa = this.lines.filter((l) => l.id !== 'J');
    const out = fa.reduce((s, l) => s + l.out, 0);
    const good = fa.reduce((s, l) => s + l.good, 0);
    const oee = fa.reduce((s, l) => s + l.oee.oee, 0) / fa.length;
    const wip = fa.reduce((s, l) => s + l.wip, 0);
    const uph = fa.reduce((s, l) => s + l.uph, 0);
    let bn = null, bv = -1;
    for (const l of fa) { const b = l.bottleneck; const a = b.acc; const v = (a.work + a.down) / (a.work + a.idle + a.blocked + a.down + a.mat || 1); if (v > bv) { bv = v; bn = b; } }
    const down = this.stations.filter((s) => s.state === 'down').length;
    return { out, good, fpy: out ? good / out : 1, oee, wip, uph, bn, down };
  }
}
