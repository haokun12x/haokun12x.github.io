// Product lab: one product on a turntable with exploded view, joint axes, sensor FOVs,
// centre of mass vs support polygon, and product-specific principle widgets.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PRODUCTS, PART_INFO } from './data.js';
import { buildProduct, JOINT_COLORS, JOINT_LABEL, GAITS, LEG_NAMES, swerveKinematics, SWERVE_MODES, WHEELS } from './products.js';

const $ = (s, r = document) => r.querySelector(s);
const KINDS = [['humanoid', '人形'], ['quadruped', '四足'], ['wheeled', '轮式'], ['actuator', '关节模组']];
const _v = new THREE.Vector3(), _b = new THREE.Box3();

function hull(pts) {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

// Signed distance from point to convex polygon boundary (+ inside).
function margin(poly, x, z) {
  if (poly.length < 3) {
    if (poly.length === 2) {
      const [a, b] = poly;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      return -Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    }
    return -Infinity;
  }
  let inside = true, md = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const cr = dx * (z - a[1]) - dz * (x - a[0]);
    if (cr < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    md = Math.min(md, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
  }
  return inside ? md : -md;
}

export class Lab {
  constructor(el, { onClose } = {}) {
    this.el = el;
    this.onClose = onClose;
    this.kind = null;
    this.opts = { explode: 0, axes: true, sensors: false, com: true, xray: false, rotate: false };
    this.demo = null;
    this.t = 0;
    this.variant = 'planetary';
    this.ratio = 9;
    this.lift = 0; this.reach = 0; this.payload = false;
    this.buildDom();
  }

  buildDom() {
    const e = this.el;
    $('.lab-tabs', e).innerHTML = KINDS.map(([k, n]) => `<button data-kind="${k}">${n}<em>${PRODUCTS[k].code}</em></button>`).join('');
    $('.lab-tabs', e).onclick = (ev) => { const b = ev.target.closest('button'); if (b) this.load(b.dataset.kind); };
    $('.lab-close', e).onclick = () => this.close();
    $('#lab-explode').oninput = (ev) => { this.opts.explode = +ev.target.value; this.applyExplode(); };
    $('.lab-toggles', e).onchange = (ev) => {
      const k = ev.target.dataset.opt;
      if (!k) return;
      this.opts[k] = ev.target.checked;
      if (k === 'xray') this.refreshMaterials();
      if (k === 'rotate') this.controls.autoRotate = this.opts.rotate;
      this.refreshOverlays();
    };
    $('#lab-demos').onclick = (ev) => { const b = ev.target.closest('button'); if (b) this.setDemo(b.dataset.d); };
    $('.lab-parts', e).onclick = (ev) => { const li = ev.target.closest('[data-key]'); if (li) this.selectPart(li.dataset.key === this.selKey ? null : li.dataset.key); };
    window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && this.isOpen) this.close(); });
  }

  init() {
    const stage = $('.lab-stage', this.el);
    const canvas = $('canvas', stage);
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101113);
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.75;
    scene.add(new THREE.HemisphereLight(0xe8eef5, 0x1a1816, 0.5));
    const key = this.key = new THREE.DirectionalLight(0xfff1de, 2.4);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9cc7ff, 0.8);
    rim.position.set(-3, 2, -3);
    scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.005, 100);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.autoRotateSpeed = 0.8;
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);
    this.grid = new THREE.PolarGridHelper(1, 12, 6, 64, 0x3a3d42, 0x26292d);
    scene.add(this.grid);
    this.overlay = new THREE.Group();
    scene.add(this.overlay);
    // CoM / support polygon visuals
    const lm = (c) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
    this.comBall = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x4fbf7f, depthTest: false, transparent: true }));
    this.comBall.renderOrder = 10;
    this.comLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lm(0x4fbf7f));
    this.comDot = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x4fbf7f, depthTest: false, transparent: true }));
    this.comDot.rotation.x = -Math.PI / 2;
    this.poly = new THREE.LineLoop(new THREE.BufferGeometry(), lm(0xd9b77a));
    this.polyFill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xd9b77a, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    this.icr = new THREE.Group();
    for (const o of [this.comBall, this.comLine, this.comDot, this.poly, this.polyFill]) { o.renderOrder = 10; scene.add(o); }
    scene.add(this.icr);
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const k = this.pick(e); this.selectPart(k); }
      down = null;
    });
    canvas.addEventListener('pointermove', (e) => this.hover(e));
    canvas.addEventListener('pointerleave', () => { $('.lab-tip', this.el).style.opacity = 0; });
    new ResizeObserver(() => this.resize()).observe(stage);
    this.clock = new THREE.Clock();
    this.hl = new Map();
    this.xrayMat = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.12, roughness: 0.1, depthWrite: false });
  }

  resize() {
    const s = $('.lab-stage', this.el);
    const w = s.clientWidth, h = s.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  open(kind = 'humanoid') {
    if (!this.renderer) this.init();
    this.isOpen = true;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lab-open');
    this.resize();
    this.load(kind);
    this.clock.getDelta();
    const loop = () => { if (!this.isOpen) return; this.frame(); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  close() {
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lab-open');
    this.onClose?.();
  }

  load(kind) {
    if (this.prod) {
      this.scene.remove(this.prod.root);
      this.prod.root.traverse((o) => { if (o.geometry?.userData?.own) o.geometry.dispose(); });
    }
    this.kind = kind;
    this.selKey = null;
    const P = this.prod = buildProduct(kind, { hi: true, variant: this.variant });
    P.setStage(Infinity, -1);
    this.scene.add(P.root);
    P.resetJoints();
    if (P.pose) P.pose(kind === 'humanoid' ? 'stand' : kind === 'quadruped' ? 'stand' : 'rest', 0, {});
    P.root.updateMatrixWorld(true);
    if (kind === 'actuator') { P.root.updateMatrixWorld(true); P.root.position.y = -new THREE.Box3().setFromObject(P.root).min.y + 0.15; P.root.updateMatrixWorld(true); }
    const bb = new THREE.Box3().setFromObject(P.root);
    if (kind === 'actuator') { P.setExplode(0.7); P.root.updateMatrixWorld(true); bb.union(new THREE.Box3().setFromObject(P.root)); P.setExplode(0); }
    const size = bb.getSize(new THREE.Vector3());
    const c = bb.getCenter(new THREE.Vector3());
    this.size = Math.max(size.x, size.y, size.z);
    const S = this.size;
    this.ground.scale.setScalar(S * 1.6);
    this.grid.scale.setScalar(S * 1.4);
    this.camera.near = S * 0.01; this.camera.far = S * 60; this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    const dir = new THREE.Vector3(0.9, 0.45, 1.3).normalize();
    this.camera.position.copy(c).addScaledVector(dir, S * 2.1);
    this.controls.minDistance = S * 0.4; this.controls.maxDistance = S * 6;
    this.key.position.set(c.x + S * 1.5, S * 3, c.z + S * 2);
    this.key.target.position.copy(c);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -S * 1.5; sc.right = sc.top = S * 1.5; sc.near = 0.01; sc.far = S * 8; sc.updateProjectionMatrix();
    for (const b of $('.lab-tabs', this.el).children) b.classList.toggle('on', b.dataset.kind === kind);
    this.buildOverlays();
    this.renderInfo();
    this.renderParts();
    this.renderWidget();
    const demos = PRODUCTS[kind].demos;
    this.setDemo(kind === 'wheeled' ? 'rest' : demos[0][0]);
    $('#lab-explode').value = this.opts.explode;
    this.applyExplode();
    this.refreshMaterials();
    this.refreshOverlays();
    $('.lab-toggles [data-opt="com"]', this.el).closest('label').style.display = kind === 'actuator' ? 'none' : '';
  }

  /* -------- overlays -------- */
  buildOverlays() {
    const P = this.prod, S = this.size;
    this.axisMarkers = [];
    this.sensorMarkers = [];
    const geoRing = new THREE.TorusGeometry(S * 0.035, S * 0.0035, 8, 32);
    const geoRod = new THREE.CylinderGeometry(S * 0.0025, S * 0.0025, S * 0.13, 6);
    for (const j of P.joints) {
      if (j.hidden) continue;
      const mat = new THREE.MeshBasicMaterial({ color: JOINT_COLORS[j.type] || '#fff', depthTest: false, transparent: true, opacity: 0.95 });
      const g = new THREE.Group();
      if (j.axis !== 'py') g.add(new THREE.Mesh(geoRing, mat));
      const rod = new THREE.Mesh(geoRod, mat);
      rod.rotation.x = Math.PI / 2;
      g.add(rod);
      if (j.axis === 'x') g.rotation.y = Math.PI / 2;
      if (j.axis === 'y' || j.axis === 'py') g.rotation.x = Math.PI / 2;
      g.traverse((o) => { o.renderOrder = 9; });
      g.userData.overlay = true;
      j.obj.add(g);
      this.axisMarkers.push(g);
    }
    for (const s of P.sensors) {
      const g = new THREE.Group();
      g.userData.overlay = true;
      const R = (s.range || 1) * (this.kind === 'actuator' ? 0.1 : 1);
      if (s.type === 'camera') {
        const h = R, r = Math.tan((s.fov || 60) * Math.PI / 360) * h * Math.SQRT2;
        const cg = new THREE.ConeGeometry(r, h, 4, 1, true);
        cg.rotateY(Math.PI / 4); cg.translate(0, -h / 2, 0); cg.rotateX(-Math.PI / 2);
        g.add(new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0x5fd1ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })));
        g.add(new THREE.LineSegments(new THREE.EdgesGeometry(cg), new THREE.LineBasicMaterial({ color: 0x5fd1ff, transparent: true, opacity: 0.6 })));
      } else if (s.type === 'lidar') {
        const rg = new THREE.RingGeometry(R * 0.15, R, 48);
        rg.rotateX(-Math.PI / 2);
        g.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x5fd1ff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })));
        const sw = new THREE.CircleGeometry(R, 16, 0, 0.35);
        sw.rotateX(-Math.PI / 2);
        const sweep = new THREE.Mesh(sw, new THREE.MeshBasicMaterial({ color: 0x5fd1ff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
        sweep.userData.spin = 4;
        g.add(sweep);
      } else if (s.type === 'scanner') {
        const fg = new THREE.CircleGeometry(R, 40, -Math.PI * 0.75, Math.PI * 1.5);
        fg.rotateX(-Math.PI / 2);
        g.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xe9b627, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })));
        const pf = new THREE.CircleGeometry(R * 0.55, 40, -Math.PI * 0.75, Math.PI * 1.5);
        pf.rotateX(-Math.PI / 2);
        g.add(new THREE.Mesh(pf, new THREE.MeshBasicMaterial({ color: 0xe5534b, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })));
      } else if (s.type === 'imu') {
        const ax = new THREE.AxesHelper(S * 0.08);
        ax.material.depthTest = false;
        ax.renderOrder = 9;
        g.add(ax);
      } else if (s.type === 'ft' || s.type === 'tactile') {
        const m = new THREE.Mesh(new THREE.SphereGeometry(S * (s.type === 'ft' ? 0.02 : 0.015), 12, 8), new THREE.MeshBasicMaterial({ color: s.type === 'ft' ? 0xd9b77a : 0xe06cc4, transparent: true, opacity: 0.55, depthTest: false }));
        m.renderOrder = 9;
        g.add(m);
      }
      s.obj.add(g);
      this.sensorMarkers.push(g);
    }
  }

  refreshOverlays() {
    for (const g of this.axisMarkers || []) g.visible = this.opts.axes;
    for (const g of this.sensorMarkers || []) g.visible = this.opts.sensors;
    const com = this.opts.com && this.kind !== 'actuator';
    for (const o of [this.comBall, this.comLine, this.comDot, this.poly, this.polyFill]) o.visible = com;
    $('.lab-hud', this.el).style.display = com ? '' : 'none';
    this.renderLegend();
  }

  renderLegend() {
    const types = [...new Set(this.prod.joints.filter((j) => !j.hidden).map((j) => j.type))];
    const dof = this.prod.joints.filter((j) => !j.hidden && j.type !== 'rotor').length;
    $('.lab-legend', this.el).innerHTML = this.opts.axes ? `<b>${dof} 个驱动轴</b>` + types.map((t) => `<span><i style="background:${JOINT_COLORS[t]}"></i>${JOINT_LABEL[t] || t}</span>`).join('') : '';
  }

  applyExplode() {
    const t = this.opts.explode;
    this.prod.setExplode(t);
    $('#lab-explode-v').textContent = Math.round(t * 100) + '%';
  }

  /* -------- materials (selection highlight + x-ray) -------- */
  refreshMaterials() {
    const sel = this.selKey;
    for (const p of this.prod.parts) {
      p.obj.traverse((o) => {
        if (!o.isMesh || o.userData.overlay) return;
        if (!o.userData.base) o.userData.base = o.material;
        let m = o.userData.base;
        if (this.opts.xray && p.cover) m = this.xrayMat;
        if (sel && p.key === sel) {
          let h = this.hl.get(m.uuid);
          if (!h) { h = m.clone(); h.emissive = new THREE.Color(0xd9b77a); h.emissiveIntensity = 0.55; this.hl.set(m.uuid, h); }
          m = h;
        } else if (sel && this.opts.explode < 0.01) {
          // keep others as-is
        }
        o.material = m;
      });
    }
  }

  pick(e) {
    const c = $('canvas', this.el).getBoundingClientRect();
    this.mouse.set((e.clientX - c.left) / c.width * 2 - 1, -(e.clientY - c.top) / c.height * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObject(this.prod.root, true);
    for (const h of hits) {
      let o = h.object;
      if (!o.visible) continue;
      let ov = false;
      for (let p = o; p; p = p.parent) if (p.userData.overlay) ov = true;
      if (ov) continue;
      if (this.opts.xray && o.material === this.xrayMat) continue;
      while (o && !o.userData.part) o = o.parent;
      if (o) return o.userData.part;
    }
    return null;
  }

  hover(e) {
    const k = this.pick(e);
    const tip = $('.lab-tip', this.el);
    if (!k) { tip.style.opacity = 0; $('canvas', this.el).style.cursor = ''; return; }
    const info = PART_INFO[k];
    tip.textContent = info ? info[0] : k;
    const c = $('.lab-stage', this.el).getBoundingClientRect();
    tip.style.transform = `translate(${e.clientX - c.left + 14}px, ${e.clientY - c.top + 10}px)`;
    tip.style.opacity = 1;
    $('canvas', this.el).style.cursor = 'pointer';
  }

  selectPart(k) {
    this.selKey = k;
    this.refreshMaterials();
    for (const li of this.el.querySelectorAll('.lab-parts [data-key]')) li.classList.toggle('on', li.dataset.key === k);
    const d = $('.lab-part-detail', this.el);
    if (!k) { d.innerHTML = '<p class="muted">点击模型或左侧列表中的部件查看说明。</p>'; return; }
    const info = PART_INFO[k] || [k, '', ''];
    const p = this.prod.parts.find((x) => x.key === k);
    const stIdx = p?.stage;
    const lineId = { humanoid: 'H', quadruped: 'Q', wheeled: 'W', actuator: 'J' }[this.kind];
    const joints = this.prod.joints.filter((j) => j.key === k && !j.hidden);
    d.innerHTML = `<p class="kicker">${info[1]}</p><h4>${info[0]}</h4><p>${info[2]}</p>
      <dl class="kv kv2"><div><dt>装配工位</dt><dd>${stIdx >= 0 ? `${lineId}${(stIdx + 1) * 10}` : '来料'}</dd></div><div><dt>零件数</dt><dd>${this.prod.parts.filter((x) => x.key === k).length}</dd></div>
      ${joints.length ? `<div><dt>驱动轴</dt><dd>${joints.length} · ${JOINT_LABEL[joints[0].type] || joints[0].type}</dd></div>` : ''}</dl>`;
  }

  /* -------- info panels -------- */
  renderInfo() {
    const P = PRODUCTS[this.kind];
    $('.lab-left', this.el).innerHTML = `
      <p class="kicker">${P.code} · REFERENCE DESIGN</p>
      <h2>${P.name}</h2><p class="en">${P.en}</p>
      <dl class="kv kv2">${P.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <h3>原理</h3>
      ${P.principles.map((p) => `<div class="pcard"><b>${p.t}</b><p>${p.d}</p></div>`).join('')}`;
  }

  renderParts() {
    const groups = new Map();
    const seen = new Set();
    for (const p of this.prod.parts) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      const info = PART_INFO[p.key] || [p.key, '其他'];
      if (!groups.has(info[1])) groups.set(info[1], []);
      groups.get(info[1]).push([p.key, info[0], p.stage]);
    }
    const lineId = { humanoid: 'H', quadruped: 'Q', wheeled: 'W', actuator: 'J' }[this.kind];
    $('.lab-parts', this.el).innerHTML = `<h3>部件 <small>${this.prod.parts.length} 个零件 · 按子系统</small></h3>` + [...groups].map(([g, items]) => `
      <div class="pg"><p class="kicker">${g}</p><ul>${items.map(([k, n, s]) => `<li data-key="${k}"><span>${n}</span><em>${s >= 0 ? lineId + (s + 1) * 10 : '来料'}</em></li>`).join('')}</ul></div>`).join('');
    this.selectPart(null);
  }

  setDemo(d) {
    this.demo = d;
    const demos = this.kind === 'wheeled' ? [['rest', '静止'], ...PRODUCTS.wheeled.demos] : PRODUCTS[this.kind].demos;
    $('#lab-demos').innerHTML = demos.map(([k, n]) => `<button data-d="${k}" class="${k === d ? 'on' : ''}">${n}</button>`).join('');
    if (this.opts.explode > 0.01) { this.opts.explode = 0; $('#lab-explode').value = 0; this.applyExplode(); }
  }

  renderWidget() {
    const w = $('#lab-widget');
    const k = this.kind;
    if (k === 'actuator') {
      w.innerHTML = `
        <div class="seg" data-w="variant"><button data-v="planetary" class="${this.variant === 'planetary' ? 'on' : ''}">行星 QDD</button><button data-v="harmonic" class="${this.variant === 'harmonic' ? 'on' : ''}">谐波</button></div>
        <label class="sl">减速比 N <b data-k="nv">${this.ratio}:1</b><input type="range" min="1" max="160" step="1" value="${this.ratio}" data-w="ratio"></label>
        <dl class="kv kv4 tight" data-k="act"></dl>`;
      w.onclick = (e) => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        this.variant = b.dataset.v;
        this.ratio = this.variant === 'planetary' ? 9 : 101;
        this.load('actuator');
      };
      w.oninput = (e) => { if (e.target.dataset.w === 'ratio') { this.ratio = +e.target.value; this.updateActuatorReadout(); } };
      this.updateActuatorReadout();
    } else if (k === 'quadruped') {
      w.innerHTML = `<div class="gait"><canvas data-k="gait"></canvas><p class="small muted">步态图：横轴为一个步态周期，色条为支撑相</p></div>`;
      w.onclick = w.oninput = null;
    } else if (k === 'wheeled') {
      w.innerHTML = `
        <label class="sl">立柱升降 <b data-k="lv">0 mm</b><input type="range" min="0" max="0.4" step="0.01" value="${this.lift}" data-w="lift"></label>
        <label class="sl">手臂外伸 <b data-k="rv">0%</b><input type="range" min="0" max="1" step="0.01" value="${this.reach}" data-w="reach"></label>
        <label class="chk"><input type="checkbox" data-w="payload" ${this.payload ? 'checked' : ''}> 双臂各 5 kg 负载</label>`;
      w.oninput = (e) => {
        const t = e.target.dataset.w;
        if (t === 'lift') this.lift = +e.target.value;
        if (t === 'reach') this.reach = +e.target.value;
        if (t === 'payload') this.payload = e.target.checked;
        $('[data-k="lv"]', w).textContent = Math.round(this.lift * 2000) + ' mm';
        $('[data-k="rv"]', w).textContent = Math.round(this.reach * 100) + '%';
      };
      w.onclick = null;
    } else {
      w.innerHTML = `
        <div class="ladder">
          <div><b>VLA / 任务规划</b><span>1–10 Hz</span></div>
          <div><b>RL 运动策略</b><span>50 Hz</span></div>
          <div><b>全身控制 QP</b><span>500 Hz</span></div>
          <div><b>关节阻抗 / PD</b><span>1 kHz</span></div>
          <div><b>FOC 电流环</b><span>40 kHz</span></div>
        </div>`;
      w.onclick = w.oninput = null;
    }
  }

  updateActuatorReadout() {
    const w = $('#lab-widget');
    const N = this.ratio;
    const eta = this.variant === 'planetary' ? (N <= 12 ? 0.93 : 0.85) : 0.72;
    const Kt = 0.12, I = 20, J = 1.2e-4, nm = 3000;
    const tau = N * Kt * I * eta;
    const out = nm / N;
    const Jr = N * N * J;
    const bd = 0.015 * N / (eta * eta);
    $('[data-k="nv"]', w).textContent = N + ':1';
    $('[data-k="act"]', w).innerHTML = `
      <div><dt>峰值输出扭矩</dt><dd>${tau.toFixed(1)} N·m</dd></div>
      <div><dt>输出转速</dt><dd>${out.toFixed(out < 10 ? 1 : 0)} rpm</dd></div>
      <div><dt>反射惯量 N²J</dt><dd>${Jr < 0.01 ? (Jr * 1e3).toFixed(2) + 'e-3' : Jr.toFixed(2)} kg·m²</dd></div>
      <div><dt>反驱扭矩</dt><dd class="${bd > 1 ? 'warn' : ''}">${bd.toFixed(2)} N·m${bd > 1 ? ' · 难反驱' : ''}</dd></div>`;
  }

  /* -------- frame -------- */
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.t += dt;
    const P = this.prod, k = this.kind;
    const exploded = this.opts.explode > 0.01;
    if (!exploded) {
      if (k === 'actuator') P.pose('spin', this.t, { ratio: this.ratio, speed: 5 });
      else if (k === 'wheeled') {
        const tw = this.demo === 'rest' ? null : SWERVE_MODES[this.demo];
        P.pose(this.demo === 'rest' ? 'rest' : this.demo, this.t, { lift: this.lift, reach: this.reach, twist: tw });
      } else P.pose(this.demo, this.t, {});
      if (k === 'humanoid') P.root.position.y = P.bob || 0;
    } else if (k === 'actuator') P.pose('spin', this.t, { ratio: this.ratio, speed: 5 });
    for (const g of this.sensorMarkers) g.traverse((o) => { if (o.userData.spin) o.rotation.y += o.userData.spin * dt; });
    P.root.updateMatrixWorld(true);
    if (this.opts.com && k !== 'actuator') this.updateCom();
    this.updateIcr();
    if (k === 'quadruped') this.drawGait();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  updateCom() {
    const P = this.prod, S = this.size;
    const com = P.centerOfMass(new THREE.Vector3());
    if (this.kind === 'wheeled' && this.payload) {
      // Two 5 kg payloads at the grippers vs ~85 kg robot.
      const g = [];
      for (const sd of ['L', 'R']) { const j = P.J['a7' + sd]; if (j) g.push(j.obj.localToWorld(new THREE.Vector3(0, -0.1, 0))); }
      const wr = 10 / 85;
      com.multiplyScalar(1 - wr).addScaledVector(g[0].add(g[1]).multiplyScalar(0.5), wr);
    }
    let minY = Infinity;
    const boxes = P.contacts.map((m) => { _b.setFromObject(m); minY = Math.min(minY, _b.min.y); return _b.clone(); });
    const pts = [];
    const eps = S * 0.012;
    for (const b of boxes) {
      if (b.min.y > Math.max(0, minY) + eps) continue;
      if (this.kind === 'humanoid') pts.push([b.min.x, b.min.z], [b.max.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.max.z]);
      else pts.push([(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2]);
    }
    const h = hull(pts);
    const gy = 0.003;
    const mg = margin(h, com.x, com.z);
    const ok = mg > 0;
    const col = ok ? 0x4fbf7f : 0xe5534b;
    this.comBall.position.copy(com);
    this.comBall.scale.setScalar(S * 0.018);
    this.comBall.material.color.setHex(col);
    this.comLine.geometry.setFromPoints([com, new THREE.Vector3(com.x, gy, com.z)]);
    this.comLine.material.color.setHex(col);
    this.comDot.position.set(com.x, gy, com.z);
    this.comDot.scale.setScalar(S * 0.012);
    this.comDot.material.color.setHex(col);
    if (h.length >= 2) {
      const v = h.map(([x, z]) => new THREE.Vector3(x, gy, z));
      this.poly.geometry.dispose();
      this.poly.geometry = new THREE.BufferGeometry().setFromPoints(v);
      if (h.length >= 3) {
        const pos = [];
        for (let i = 1; i < v.length - 1; i++) pos.push(v[0].x, gy, v[0].z, v[i].x, gy, v[i].z, v[i + 1].x, gy, v[i + 1].z);
        this.polyFill.geometry.dispose();
        this.polyFill.geometry = new THREE.BufferGeometry();
        this.polyFill.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      }
    }
    const phase = this.kind === 'humanoid' ? (pts.length >= 8 ? '双脚支撑' : pts.length >= 4 ? '单脚支撑' : '腾空') : this.kind === 'quadruped' ? `${pts.length} 足着地` : '4 轮着地';
    $('.lab-hud', this.el).innerHTML = `<div><span>质心高度</span><b>${(com.y * 1000).toFixed(0)} mm</b></div><div><span>支撑状态</span><b>${phase}</b></div><div><span>${ok ? '稳定裕度' : '超出支撑域'}</span><b class="${ok ? 'ok' : 'bad'}">${isFinite(mg) ? (mg * 1000).toFixed(0) + ' mm' : '—'}</b></div>${this.kind !== 'wheeled' ? '<p>动态行走时质心可暂时离开支撑域，由 ZMP / 捕获点控制保证不倒</p>' : '<p>倾覆裕度 = 质心投影到支撑多边形边界的最短距离</p>'}`;
  }

  updateIcr() {
    this.icr.clear();
    if (this.kind !== 'wheeled' || this.demo === 'rest' || this.opts.explode > 0.01) return;
    const [vx, vz, w] = SWERVE_MODES[this.demo];
    const P = this.prod;
    const mat = new THREE.LineDashedMaterial({ color: 0x4fbf7f, dashSize: 0.04, gapSize: 0.03, depthTest: false, transparent: true });
    if (Math.abs(w) < 1e-6) {
      for (const [, x, z] of WHEELS) {
        const a = P.root.localToWorld(new THREE.Vector3(x, 0.01, z));
        const dir = new THREE.Vector3(vx, 0, vz).normalize().multiplyScalar(0.35);
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, a.clone().add(dir)]), mat);
        l.computeLineDistances(); l.renderOrder = 10;
        this.icr.add(l);
      }
      return;
    }
    const icr = new THREE.Vector3(-vz / w, 0.01, vx / w);
    const icrW = P.root.localToWorld(icr.clone());
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: 0x4fbf7f, depthTest: false }));
    dot.position.copy(icrW); dot.renderOrder = 11;
    this.icr.add(dot);
    for (const [, x, z] of WHEELS) {
      const a = P.root.localToWorld(new THREE.Vector3(x, 0.01, z));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, icrW]), mat);
      l.computeLineDistances(); l.renderOrder = 10;
      this.icr.add(l);
    }
  }

  drawGait() {
    const cv = $('[data-k="gait"]');
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const G = GAITS[this.demo] || GAITS.stand;
    const rowH = (H - 8) / 4, lx = 26;
    g.font = '10px "JetBrains Mono", monospace';
    LEG_NAMES.forEach((n, i) => {
      const y = 4 + i * rowH;
      g.fillStyle = '#8a8984'; g.fillText(n, 2, y + rowH * 0.65);
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(lx, y + 2, W - lx - 4, rowH - 4);
      g.fillStyle = '#d9b77a';
      const w = W - lx - 4;
      if (G.f === 0) { g.fillRect(lx, y + 2, w, rowH - 4); return; }
      const s = G.off[i], e = (G.off[i] + G.duty);
      if (e <= 1) g.fillRect(lx + s * w, y + 2, G.duty * w, rowH - 4);
      else { g.fillRect(lx + s * w, y + 2, (1 - s) * w, rowH - 4); g.fillRect(lx, y + 2, (e - 1) * w, rowH - 4); }
    });
    if (G.f > 0) {
      const ph = (this.t * G.f) % 1;
      g.strokeStyle = '#f2f0ea'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(lx + ph * (W - lx - 4), 0); g.lineTo(lx + ph * (W - lx - 4), H); g.stroke();
    }
  }
}
