// Process signatures recorded at each station (tightening curves, press envelopes, ...)
// and a small canvas plotter for them. Traces are regenerated from the stored seed.
import { rng, gauss } from './kit.js';

const range = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
const f2 = (v, d = 2) => v.toFixed(d);

export function genTrace(st) {
  const L = st.last;
  if (!L) return null;
  const r = rng(L.seed);
  const g = () => gauss(r);
  const ok = L.ok;
  const d = st.def;
  switch (d.trace) {
    case 'torque': {
      const T = d.torque || 10;
      const mode = ok ? 'ok' : r() < 0.5 ? 'strip' : 'hard';
      const af = mode === 'ok' ? 60 + 5 * g() : mode === 'hard' ? 36 + 2 * g() : 112;
      const Tf = mode === 'ok' ? T * (1 + 0.015 * g()) : mode === 'hard' ? T * 1.11 : T * 0.46;
      const pts = range(0, af, 90).map((a) => {
        let y;
        if (a < 12) y = 0.06 * T * (0.8 + 0.4 * r());
        else if (mode === 'strip') {
          const k = (a - 12) / 40;
          y = a < 52 ? 0.06 * T + 0.66 * T * Math.pow(k, 1.1) : 0.72 * T - (a - 52) * 0.006 * T * 1.4;
          y = Math.max(y, Tf) + 0.01 * T * g();
        } else y = 0.06 * T + (Tf - 0.06 * T) * Math.pow((a - 12) / (af - 12), 1.15) + 0.006 * T * g();
        return [a, y];
      });
      return {
        x: { min: 0, max: 120, label: '角度 °' }, y: { min: 0, max: T * 1.3, label: '扭矩 N·m' },
        series: [{ pts, color: 'accent' }],
        boxes: [{ x0: 45, x1: 75, y0: T * 0.94, y1: T * 1.06, label: '判定窗口' }],
        readouts: [['终扭矩', f2(pts[pts.length - 1][1], T < 1 ? 3 : 2) + ' N·m'], ['终角度', f2(af, 1) + '°'], ['策略', '扭矩控制 + 角度监控']],
        ok,
      };
    }
    case 'press': {
      const spike = !ok ? 4 + 4 * r() : -1;
      const F = (x) => (x < 2 ? 0.15 : x < 10.5 ? 0.15 + 9.2 * Math.pow((x - 2) / 8.5, 1.3) : 9.35 + (x - 10.5) * 8);
      const end = 11 + 0.006 * g();
      const pts = range(0, end, 120).map((x) => [x, F(x) * (1 + 0.012 * g()) + (spike > 0 ? 3.6 * Math.exp(-((x - spike) ** 2) / 0.15) : 0)]);
      const xs = range(0, 11, 40);
      return {
        x: { min: 0, max: 12, label: '位移 mm' }, y: { min: 0, max: 15, label: '压装力 kN' },
        series: [{ pts, color: 'accent' }],
        bands: [{ lo: xs.map((x) => [x, Math.max(0, F(x) * 0.88 - 0.4)]), hi: xs.map((x) => [x, F(x) * 1.12 + 0.6]) }],
        boxes: [{ x0: 10.95, x1: 11.05, y0: 11, y1: 14, label: '终点窗口' }],
        readouts: [['峰值力', f2(Math.max(...pts.map((p) => p[1]))) + ' kN'], ['终点位置', f2(end, 3) + ' mm'], ['判据', '包络 + 窗口']],
        ok,
      };
    }
    case 'insertion': {
      const pk = ok ? 1.0 + 0.06 * g() : 1.55;
      const pts = range(0, 40, 140).map((x) => {
        let y = 0.05;
        if (x > 6 && x < 31) y -= 0.62 * Math.sin(Math.PI * (x - 6) / 25) ** 1.4;
        if (x > 33) y += pk * Math.min(1, (x - 33) / 4.5) ** 1.6;
        return [x, y + 0.015 * g()];
      });
      return {
        x: { min: 0, max: 40, label: '行程 mm' }, y: { min: -0.9, max: 1.8, label: '力 kN' },
        series: [{ pts, color: 'accent' }],
        hlines: [{ y: 1.3, label: '轴承压装上限 1.3 kN', color: 'bad' }, { y: 0, color: 'grid' }],
        notes: [{ x: 18, y: -0.75, text: '磁吸段（负力）' }, { x: 34, y: 1.6, text: '轴承压装' }],
        readouts: [['磁吸峰值', f2(Math.min(...pts.map((p) => p[1]))) + ' kN'], ['压装峰值', f2(pk) + ' kN']],
        ok,
      };
    }
    case 'ripple': {
      const sp = !ok ? r() * 330 + 15 : -1;
      const m = 0.07 + 0.005 * g();
      const pts = range(0, 360, 240).map((a) => [a, m + 0.008 * Math.sin(a * Math.PI / 30) + 0.004 * Math.sin(a * Math.PI / 5) + 0.002 * g() + (sp > 0 ? 0.11 * Math.exp(-((a - sp) ** 2) / 20) : 0)]);
      const isLift = d.id === 'W30';
      return {
        x: { min: 0, max: 360, label: isLift ? '行程 %' : '输出角度 °' }, y: { min: 0, max: 0.22, label: isLift ? '电流 (归一)' : '空载扭矩 N·m' },
        series: [{ pts, color: 'accent' }],
        hlines: [{ y: 0.15, label: '上限', color: 'bad' }, { y: m, label: '均值', color: 'grid' }],
        readouts: [['均值', f2(m, 3)], ['峰峰值', f2(Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])), 3)]],
        ok,
      };
    }
    case 'bars': {
      if (d.bars === 'dmc') {
        const bad = ok ? -1 : Math.floor(r() * 8);
        const vals = range(1, 8, 8).map((_, i) => (i === bad ? 2 : r() < 0.8 ? 4 : 3));
        return {
          bars: { values: vals, labels: vals.map((_, i) => '#' + (i + 1)), max: 4, threshold: 3, tick: ['', 'D', 'C', 'B', 'A'] },
          x: { label: '穴位' }, y: { label: 'ISO 29158 等级' },
          readouts: [['A 级', vals.filter((v) => v === 4).length + ' / 8'], ['最低', 'ABCD'[4 - Math.min(...vals)]]],
          ok,
        };
      }
      const bad = ok ? -1 : Math.floor(r() * 31);
      const vals = range(1, 31, 31).map((_, i) => (i === bad ? 1450 : 60 + i * 9 + 60 * r()));
      return {
        bars: { values: vals, labels: vals.map((_, i) => (i % 5 === 0 ? String(i + 1) : '')), max: 1600, threshold: 1000 },
        x: { label: 'EtherCAT 从站' }, y: { label: 'DC 同步偏差 ns' },
        readouts: [['拓扑', '31 / 31 从站'], ['最大偏差', Math.round(Math.max(...vals)) + ' ns']],
        ok,
      };
    }
    case 'hysteresis': {
      const k = 25 + 1.5 * g();
      const b = ok ? 1.5 + 0.3 * g() : 3.6 + 0.2 * r();
      const up = range(-100, 100, 100).map((x) => [x, x / k + (b / 2) * Math.tanh((x + 4) / 5) + 0.03 * g()]);
      const dn = range(100, -100, 100).map((x) => [x, x / k + (b / 2) * Math.tanh((x - 4) / 5) + 0.03 * g()]);
      return {
        x: { min: -110, max: 110, label: '负载扭矩 N·m' }, y: { min: -8, max: 8, label: '扭转变形 arcmin' },
        series: [{ pts: up, color: 'accent' }, { pts: dn, color: 'accent2' }],
        hlines: [{ y: 0, color: 'grid' }],
        readouts: [['扭转刚度', f2(k, 1) + ' N·m/arcmin'], ['背隙', f2(b) + ' arcmin（上限 3）'], ['Kt 偏差', f2(Math.abs(g()) * 0.8, 1) + '%']],
        ok,
      };
    }
    case 'scatter': {
      const pts = range(0, 1, 10).map(() => [0.06 * g(), 0.06 * g()]);
      if (!ok) pts[3] = [0.22, -0.18];
      const mx = Math.max(...pts.map((p) => Math.hypot(...p)));
      return {
        x: { min: -0.3, max: 0.3, label: 'ΔX mm' }, y: { min: -0.3, max: 0.3, label: 'ΔY mm' }, square: true,
        points: [{ pts, color: 'accent' }], circles: [{ cx: 0, cy: 0, r: 0.2, label: '公差 Ø0.4' }],
        readouts: [['基准点', '10'], ['最大偏差', f2(mx, 3) + ' mm']],
        ok,
      };
    }
    case 'insulation': {
      const Rinf = ok ? 2200 + 300 * g() : 85;
      const pts = range(0, 60, 80).map((t) => [t, Rinf * (1 - 0.7 * Math.exp(-t / 12)) * (1 + 0.01 * g())]);
      const r15 = Rinf * (1 - 0.7 * Math.exp(-15 / 12)), r60 = Rinf * (1 - 0.7 * Math.exp(-5));
      return {
        x: { min: 0, max: 60, label: '时间 s' }, y: { min: 0, max: 3000, label: '绝缘电阻 MΩ @ 500 V' },
        series: [{ pts, color: 'accent' }],
        hlines: [{ y: 100, label: '下限 100 MΩ', color: 'bad' }],
        readouts: [['R60', Math.round(r60) + ' MΩ'], ['极化指数 PI', f2(r60 / r15)]],
        ok,
      };
    }
    case 'calib': {
      const s = ok ? 0.1 : 0.2;
      const bx = ok ? 0 : 0.12;
      const pts = range(0, 1, 70).map(() => [bx + s * g(), s * g()]);
      const rms = Math.sqrt(pts.reduce((a, p) => a + p[0] ** 2 + p[1] ** 2, 0) / pts.length);
      const mm = d.id === 'W60';
      return {
        x: { min: -0.6, max: 0.6, label: mm ? 'ex mm' : 'ex px' }, y: { min: -0.6, max: 0.6, label: mm ? 'ey mm' : 'ey px' }, square: true,
        points: [{ pts, color: 'accent' }], circles: [{ cx: 0, cy: 0, r: 0.3, label: 'RMS 上限' }],
        readouts: [['RMS 残差', f2(rms, 3) + (mm ? ' mm' : ' px')], ['样本', '70 角点 × 15 位姿']],
        ok,
      };
    }
    case 'gapflush': {
      const bad = ok ? -1 : Math.floor(r() * 24);
      const gap = range(1, 24, 24).map((x, i) => [x, i === bad ? 2.46 : 2.0 + 0.08 * g()]);
      const fl = range(1, 24, 24).map((x) => [x, 0.07 * g()]);
      return {
        x: { min: 0, max: 25, label: '测点' }, y: { min: -0.6, max: 2.8, label: 'mm' },
        series: [{ pts: gap, color: 'accent', dots: true }, { pts: fl, color: 'accent2', dots: true }],
        bands: [{ lo: [[0, 1.7], [25, 1.7]], hi: [[0, 2.3], [25, 2.3]] }, { lo: [[0, -0.25], [25, -0.25]], hi: [[0, 0.25], [25, 0.25]] }],
        notes: [{ x: 1, y: 2.55, text: '间隙 Gap' }, { x: 1, y: 0.45, text: '面差 Flush' }],
        readouts: [['间隙均值', f2(gap.reduce((a, p) => a + p[1], 0) / 24) + ' mm'], ['面差 σ', '0.07 mm']],
        ok,
      };
    }
    case 'tracking': {
      const f = d.id === 'Q70' ? 2.2 : d.id === 'W70' ? 0.5 : 0.95;
      const A = d.id === 'W70' ? 12 : 28;
      const lag = 0.0025, bad = ok ? 0 : 1;
      const cmd = range(0, 2, 160).map((t) => [t, A * Math.sin(2 * Math.PI * f * t) + 6 * Math.sin(4 * Math.PI * f * t + 0.6)]);
      const act = cmd.map(([t]) => {
        const tt = t - lag;
        return [t, A * Math.sin(2 * Math.PI * f * tt) + 6 * Math.sin(4 * Math.PI * f * tt + 0.6) + 0.15 * g() + (bad ? 1.4 * Math.exp(-((t - 1.2) ** 2) / 0.004) : 0)];
      });
      const err = cmd.map(([t, y], i) => [t, (act[i][1] - y) * 10]);
      const mx = Math.max(...err.map((p) => Math.abs(p[1]) / 10));
      const rms = Math.sqrt(err.reduce((a, p) => a + (p[1] / 10) ** 2, 0) / err.length);
      return {
        x: { min: 0, max: 2, label: '时间 s' }, y: { min: -45, max: 45, label: d.id === 'W70' ? '航向 °' : '关节角 °' },
        series: [{ pts: cmd, color: 'grid', dash: true }, { pts: act, color: 'accent' }, { pts: err, color: 'bad', width: 1 }],
        notes: [{ x: 0.04, y: 41, text: '虚线：指令  实线：实际  红：误差 ×10' }],
        readouts: [['RMS 误差', f2(rms) + '°'], ['最大误差', f2(mx) + '°（上限 0.8°）']],
        ok,
      };
    }
    case 'bead': {
      const gap = ok ? -1 : 300 + r() * 600;
      let drift = 0;
      const pts = range(0, 1200, 200).map((x) => { drift += 0.01 * g(); return [x, gap > 0 && x > gap && x < gap + 30 ? 0.2 : 3.0 + drift * 0.6 + 0.07 * g()]; });
      return {
        x: { min: 0, max: 1200, label: '轨迹长度 mm' }, y: { min: 0, max: 4.5, label: '胶宽 mm' },
        series: [{ pts, color: 'accent' }],
        bands: [{ lo: [[0, 2.6], [1200, 2.6]], hi: [[0, 3.4], [1200, 3.4]] }],
        readouts: [['均值', f2(pts.reduce((a, p) => a + p[1], 0) / pts.length) + ' mm'], ['断胶', gap > 0 ? '1 处' : '0']],
        ok,
      };
    }
    case 'leak': {
      const dp = ok ? 2.2 + 0.5 * g() : 8.6 + r();
      const pts = range(0, 12, 60).map((t) => [t, dp * t / 12 + 0.12 * g() + 0.3 * (1 - Math.exp(-t / 1.5))]);
      return {
        x: { min: 0, max: 12, label: '测量时间 s' }, y: { min: 0, max: 11, label: '压降 ΔP Pa' },
        series: [{ pts, color: 'accent' }],
        hlines: [{ y: 5, label: '阈值 5 Pa', color: 'bad' }],
        readouts: [['测试压力', '20.0 kPa'], ['ΔP', f2(dp, 1) + ' Pa'], ['等效泄漏', f2(1.8e-3 * dp / 101325 / 12 * 6e7, 2) + ' sccm']],
        ok,
      };
    }
    case 'brake': {
      const a = ok ? 3.2 + 0.2 * g() : 1.6, v0 = 1.2, tr = 0.045;
      const dStop = v0 * tr + v0 * v0 / (2 * a);
      const pts = range(0, dStop, 80).map((x) => [x, x < v0 * tr ? v0 : Math.sqrt(Math.max(0, v0 * v0 - 2 * a * (x - v0 * tr)))]);
      return {
        x: { min: 0, max: 0.8, label: '行驶距离 m' }, y: { min: 0, max: 1.6, label: '速度 m/s' },
        series: [{ pts, color: 'accent' }],
        vlines: [{ x: 0.5, label: '保护区边界', color: 'bad' }, { x: v0 * tr, label: '响应', color: 'grid' }],
        readouts: [['制动距离', f2(dStop, 3) + ' m'], ['减速度', f2(a, 1) + ' m/s²'], ['响应时间', '45 ms']],
        ok,
      };
    }
  }
  return null;
}

export function drawPlot(cv, spec, C) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!spec) { g.fillStyle = C.muted; g.font = '12px Inter, sans-serif'; g.fillText('等待首个工件完成…', 12, H / 2); return; }
  const col = (k) => ({ accent: C.accent, accent2: C.accent2, bad: C.bad, grid: C.muted }[k] || k);
  const m = { l: 40, r: 10, t: 10, b: 26 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  g.font = '10px "JetBrains Mono", monospace';
  g.strokeStyle = C.grid; g.lineWidth = 1;
  g.strokeRect(m.l + 0.5, m.t + 0.5, pw, ph);
  g.fillStyle = C.muted;
  g.fillText(spec.y.label, m.l + 4, m.t + 11);
  g.textAlign = 'right';
  g.fillText(spec.x.label, W - m.r - 2, H - 6);
  g.textAlign = 'left';

  if (spec.bars) {
    const B = spec.bars, n = B.values.length, bw = pw / n;
    const Y = (v) => m.t + ph - (v / B.max) * ph;
    B.values.forEach((v, i) => {
      g.fillStyle = v > B.threshold && !B.tick ? C.bad : B.tick && v < B.threshold ? C.bad : C.accent;
      g.globalAlpha = 0.85;
      g.fillRect(m.l + i * bw + bw * 0.15, Y(v), bw * 0.7, m.t + ph - Y(v));
      g.globalAlpha = 1;
      if (B.labels[i]) { g.fillStyle = C.muted; g.textAlign = 'center'; g.fillText(B.labels[i], m.l + i * bw + bw / 2, H - 14); g.textAlign = 'left'; }
    });
    g.strokeStyle = C.bad; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(m.l, Y(B.threshold)); g.lineTo(m.l + pw, Y(B.threshold)); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.muted; g.textAlign = 'right';
    if (B.tick) B.tick.forEach((t, i) => t && g.fillText(t, m.l - 6, Y(i) + 3));
    else [0, B.max / 2, B.max].forEach((v) => g.fillText(String(Math.round(v)), m.l - 6, Y(v) + 3));
    g.textAlign = 'left';
    return;
  }

  let { min: x0, max: x1 } = spec.x, { min: y0, max: y1 } = spec.y;
  const X = (x) => m.l + (x - x0) / (x1 - x0) * pw;
  const Y = (y) => m.t + ph - (y - y0) / (y1 - y0) * ph;
  g.fillStyle = C.muted; g.textAlign = 'right';
  for (const v of [y0, (y0 + y1) / 2, y1]) g.fillText(fmt(v), m.l - 5, Y(v) + 3);
  g.textAlign = 'center';
  for (const v of [x0, (x0 + x1) / 2, x1]) g.fillText(fmt(v), X(v), H - 14);
  g.textAlign = 'left';
  g.save();
  g.beginPath(); g.rect(m.l, m.t, pw, ph); g.clip();
  for (const b of spec.bands || []) {
    g.fillStyle = C.band;
    g.beginPath();
    b.hi.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    [...b.lo].reverse().forEach(([x, y]) => g.lineTo(X(x), Y(y)));
    g.closePath(); g.fill();
  }
  for (const b of spec.boxes || []) {
    g.strokeStyle = C.ok; g.lineWidth = 1.5; g.setLineDash([3, 2]);
    g.strokeRect(X(b.x0), Y(b.y1), X(b.x1) - X(b.x0), Y(b.y0) - Y(b.y1));
    g.setLineDash([]);
    g.fillStyle = C.ok; g.fillText(b.label, X(b.x0) - 2, Y(b.y1) - 4);
  }
  for (const h of spec.hlines || []) {
    g.strokeStyle = col(h.color); g.setLineDash([4, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(m.l, Y(h.y)); g.lineTo(m.l + pw, Y(h.y)); g.stroke(); g.setLineDash([]);
    if (h.label) { g.fillStyle = col(h.color); g.textAlign = 'right'; g.fillText(h.label, m.l + pw - 4, Y(h.y) - 4); g.textAlign = 'left'; }
  }
  for (const v of spec.vlines || []) {
    g.strokeStyle = col(v.color); g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(X(v.x), m.t); g.lineTo(X(v.x), m.t + ph); g.stroke(); g.setLineDash([]);
    g.fillStyle = col(v.color); g.fillText(v.label, X(v.x) + 4, m.t + 24);
  }
  for (const c of spec.circles || []) {
    g.strokeStyle = C.ok; g.setLineDash([3, 2]);
    g.beginPath(); g.ellipse(X(c.cx), Y(c.cy), Math.abs(X(c.r) - X(0)), Math.abs(Y(c.r) - Y(0)), 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }
  for (const s of spec.series || []) {
    g.strokeStyle = col(s.color); g.lineWidth = s.width || 1.8;
    if (s.dash) g.setLineDash([5, 4]);
    g.beginPath();
    s.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.stroke(); g.setLineDash([]);
    if (s.dots) { g.fillStyle = col(s.color); for (const [x, y] of s.pts) { g.beginPath(); g.arc(X(x), Y(y), 2.2, 0, 7); g.fill(); } }
  }
  for (const p of spec.points || []) {
    g.fillStyle = col(p.color);
    for (const [x, y] of p.pts) { g.beginPath(); g.arc(X(x), Y(y), 2.2, 0, 7); g.fill(); }
  }
  g.restore();
  g.fillStyle = C.muted;
  for (const n of spec.notes || []) g.fillText(n.text, X(n.x), Y(n.y));
}

function fmt(v) {
  const a = Math.abs(v);
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  if (a === 0) return '0';
  return v.toFixed(2);
}

export function drawSpark(cv, series, C, { max = null, target = null } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const mx = max ?? Math.max(1, ...series, target || 0) * 1.15;
  if (target != null) {
    g.strokeStyle = C.muted; g.setLineDash([3, 3]);
    const y = H - target / mx * H;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
  }
  if (series.length < 2) return;
  g.strokeStyle = C.accent; g.lineWidth = 1.5;
  g.beginPath();
  series.forEach((v, i) => { const x = i / (series.length - 1) * W, y = H - v / mx * H; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
}
