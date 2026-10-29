// DOM panels: KPI bar, line board, inspector, event log.
import { STATE, PRODUCTS } from './data.js';
import { AMR_STATE } from './sim.js';
import { genTrace, drawPlot, drawSpark } from './traces.js';

const $ = (s, r = document) => r.querySelector(s);
const pct = (v) => (v * 100).toFixed(1) + '%';
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const mins = (s) => (s >= 3600 ? (s / 3600).toFixed(1) + ' h' : Math.round(s / 60) + ' min');
const LOG_ZH = { fault: '故障', repair: '恢复', quality: '质量', output: '产出', logistics: '物流' };

function cssColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(k).trim();
  return { accent: v('--accent'), accent2: v('--accent-2'), bad: v('--bad'), ok: v('--ok'), muted: v('--ink-3'), grid: v('--line-strong'), band: v('--band') };
}

export class UI {
  constructor(app) {
    this.app = app;
    this.sim = app.sim;
    this.sel = null;
    this.logFilter = 'all';
    this.acc = 0; this.acc2 = 0;
    this.C = cssColors();
    this.buildBoard();
    this.buildTop();
    this.buildLog();
    this.showOverview();
  }

  setSim(sim) { this.sim = sim; this.buildBoard(); this.buildLog(); this.select(null); }

  /* ---------------- top bar ---------------- */
  buildTop() {
    const sp = $('#speed');
    sp.innerHTML = [0, 1, 5, 20, 60, 150].map((s) => `<button data-s="${s}" class="${s === this.app.speed ? 'on' : ''}" title="${s ? '×' + s + ' 仿真速度' : '暂停 (空格)'}">${s ? '×' + s : '❚❚'}</button>`).join('');
    sp.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.app.setSpeed(+b.dataset.s);
    });
    $('#btn-lab').addEventListener('click', () => this.app.openLab());
    $('#btn-help').addEventListener('click', () => { this.select(null); });
    const lay = $('#layers');
    lay.addEventListener('change', (e) => {
      const i = e.target;
      if (i.dataset.layer) this.app.setLayer(i.dataset.layer, i.checked);
    });
    $('#btn-layers').addEventListener('click', (e) => { e.stopPropagation(); lay.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (!lay.contains(e.target)) lay.classList.remove('open'); });
    $('#views').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.app.view(b.dataset.v);
    });
    $('#btn-board').addEventListener('click', () => document.body.classList.toggle('board-open'));
  }

  syncSpeed() {
    for (const b of $('#speed').children) b.classList.toggle('on', +b.dataset.s === this.app.speed);
  }

  /* ---------------- left board ---------------- */
  buildBoard() {
    const el = $('#board-lines');
    el.innerHTML = this.sim.lines.map((l) => `
      <section class="lc" data-line="${l.id}">
        <header>
          <button class="lid" data-act="line" title="产线详情">${l.id}</button>
          <div class="lname"><b>${l.def.name}</b><em>${l.def.en}</em></div>
          <button class="ico" data-act="view" title="定位到产线">⌖</button>
        </header>
        <div class="lk">
          <div><i>UPH</i><b data-k="uph">–</b><s>/ ${f1(l.targetUph)}</s></div>
          <div><i>OEE</i><b data-k="oee">–</b></div>
          <div><i>WIP</i><b data-k="wip">–</b></div>
          <div><i>FPY</i><b data-k="fpy">–</b></div>
        </div>
        <div class="chips">${l.stations.map((s) => `<button class="chip" data-st="${s.id}" title="${s.id} ${s.def.name}"><i></i><span>${s.id.slice(1)}</span><u><s></s></u></button>`).join('')}</div>
      </section>`).join('');
    el.onclick = (e) => {
      const chip = e.target.closest('.chip');
      if (chip) { this.app.select({ type: 'station', ref: this.sim.stationById[chip.dataset.st] }, true); return; }
      const lc = e.target.closest('.lc');
      if (!lc) return;
      const line = this.sim.lineById[lc.dataset.line];
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'view') this.app.view(line.id);
      else this.app.select({ type: 'line', ref: line }, true);
    };
    const lg = $('#board-log');
    lg.innerHTML = `
      <section class="lc lc-log">
        <header><span class="lid lid-amr">⇄</span><div class="lname"><b>内部物流</b><em>Kanban · AMR Fleet</em></div></header>
        <div class="amr-ctl">
          <span>AMR 数量</span>
          <button data-a="-1">−</button><b data-k="amrn">${this.sim.amrCount}</b><button data-a="1">+</button>
          <span class="sp"></span>
          <span>J-OUT</span><b data-k="jout">–</b>
          <span>待派</span><b data-k="tasks">–</b>
        </div>
        <ul class="amr-list" data-k="amrs"></ul>
      </section>`;
    lg.onclick = (e) => {
      const b = e.target.closest('[data-a]');
      if (b) { this.sim.setAmrCount(this.sim.amrCount + +b.dataset.a); this.refreshBoard(); return; }
      const li = e.target.closest('[data-amr]');
      if (li) { const a = this.sim.amrs.find((x) => x.id === +li.dataset.amr); if (a) this.app.select({ type: 'amr', ref: a }, true); }
    };
    this.refreshBoard();
  }

  refreshBoard() {
    for (const l of this.sim.lines) {
      const c = document.querySelector(`.lc[data-line="${l.id}"]`);
      if (!c) continue;
      const o = l.oee;
      c.querySelector('[data-k="uph"]').textContent = f1(l.uph);
      c.querySelector('[data-k="uph"]').classList.toggle('warn', l.id !== 'J' && l.uph < l.targetUph * 0.85 && l.elapsed > 1800);
      c.querySelector('[data-k="oee"]').textContent = l.elapsed > 600 ? pct(o.oee) : '–';
      c.querySelector('[data-k="wip"]').textContent = l.wip;
      c.querySelector('[data-k="fpy"]').textContent = l.out ? pct(l.fpy) : '–';
      const bn = l.bottleneck;
      for (const s of l.stations) {
        const ch = c.querySelector(`[data-st="${s.id}"]`);
        ch.querySelector('i').style.background = STATE[s.state].color;
        const a = s.acc, tot = a.work + a.idle + a.blocked + a.down + a.mat || 1;
        ch.querySelector('s').style.width = ((a.work + a.down) / tot * 100).toFixed(0) + '%';
        ch.classList.toggle('bn', s === bn && l.elapsed > 600);
        ch.classList.toggle('sel', this.sel?.type === 'station' && this.sel.ref === s);
      }
    }
    const sim = this.sim;
    const lg = $('#board-log');
    lg.querySelector('[data-k="amrn"]').textContent = sim.amrCount;
    lg.querySelector('[data-k="jout"]').textContent = sim.jOut.length + ' 盘';
    lg.querySelector('[data-k="tasks"]').textContent = sim.tasks.length;
    lg.querySelector('[data-k="amrs"]').innerHTML = sim.amrs.map((a) => `
      <li data-amr="${a.id}" class="${this.sel?.ref === a ? 'sel' : ''}${a.state === 'wait' ? ' warn' : ''}">
        <b>${a.name}</b><span>${AMR_STATE[a.state] || a.state}${a.task ? ' → ' + a.task.st.id : ''}</span>
        <i class="bat"><s style="width:${Math.round(a.battery * 100)}%" class="${a.battery < 0.3 ? 'low' : ''}"></s></i>
      </li>`).join('');
  }

  /* ---------------- KPI bar ---------------- */
  refreshKpi() {
    const k = this.sim.kpi;
    $('#clock').textContent = this.sim.clock();
    const el = $('#kpi');
    const set = (n, v, cls) => { const b = el.querySelector(`[data-k="${n}"]`); b.textContent = v; if (cls !== undefined) b.className = cls; };
    set('out', k.out);
    set('uph', f1(k.uph));
    set('oee', this.sim.lines[1].elapsed > 600 ? pct(k.oee) : '–');
    set('fpy', k.out ? pct(k.fpy) : '–');
    set('wip', k.wip);
    set('bn', k.bn ? k.bn.id : '–');
    set('down', k.down, k.down ? 'bad' : '');
  }

  /* ---------------- event log ---------------- */
  buildLog() {
    const el = $('#log');
    $('#log-filter').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.logFilter = b.dataset.f;
      for (const x of $('#log-filter').children) x.classList.toggle('on', x === b);
      this.renderLog();
    };
    $('#log-toggle').onclick = () => document.body.classList.toggle('log-min');
    $('#log-list').onclick = (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const entry = this.shownLogs[+li.dataset.i];
      if (!entry?.ref) return;
      const r = entry.ref;
      if (r.def && r.line) this.app.select({ type: 'station', ref: r }, true);
      else if (r.sn) { if (r.line.units.includes(r)) this.app.select({ type: 'unit', ref: r }, true); }
      else if (r.name?.startsWith('AMR') && this.sim.amrs.includes(r)) this.app.select({ type: 'amr', ref: r }, true);
    };
    this.renderLog();
    this.sim.on('log', () => { this.logDirty = true; });
    void el;
  }

  renderLog() {
    const list = this.sim.logs.filter((e) => this.logFilter === 'all' || e.type === this.logFilter).slice(-60).reverse();
    this.shownLogs = list;
    $('#log-list').innerHTML = list.map((e, i) => `<li data-i="${i}" class="t-${e.type}"><time>${this.sim.clock(e.t).slice(3)}</time><em>${LOG_ZH[e.type] || e.type}</em><span>${e.msg}</span></li>`).join('') || '<li class="empty">暂无事件（加速仿真或注入故障试试）</li>';
    this.logDirty = false;
  }

  /* ---------------- inspector ---------------- */
  select(sel) {
    this.sel = sel;
    const box = $('#inspector');
    box.scrollTop = 0;
    if (!sel) return this.showOverview();
    document.body.classList.add('insp-open');
    if (sel.type === 'station') this.showStation(sel.ref);
    else if (sel.type === 'unit') this.showUnit(sel.ref);
    else if (sel.type === 'amr') this.showAmr(sel.ref);
    else if (sel.type === 'line') this.showLine(sel.ref);
    this.refreshBoard();
  }

  head(kicker, title, en, extra = '') {
    return `<header class="ih"><button class="close" data-act="close" title="关闭 (Esc)">✕</button><p class="kicker">${kicker}</p><h2>${title}</h2><p class="en">${en}</p>${extra}</header>`;
  }

  bindInsp(handlers) {
    const box = $('#insp-body');
    box.onclick = (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const a = t.dataset.act;
      if (a === 'close') { this.app.select(null); return; }
      handlers[a]?.(t, e);
    };
    box.oninput = (e) => handlers.input?.(e.target);
  }

  showOverview() {
    document.body.classList.remove('insp-open');
    const s = this.sim;
    $('#insp-body').innerHTML = `
      <header class="ih"><p class="kicker">EMBODIED ASSEMBLY FLOOR · 01</p><h2>具身硬件总装车间</h2><p class="en">Multi-line simulation · humanoid / quadruped / wheeled</p></header>
      <p class="lead">一个按真实工艺组织的具身机器人车间：关节模组单元为三条总装线供料，AMR 按看板拉动配送，每个工位都有随机节拍、故障（MTBF / MTTR）与在线质量判定。</p>
      <div class="legend">${Object.values(STATE).map((x) => `<span><i style="background:${x.color}"></i>${x.zh}</span>`).join('')}</div>
      <h3>怎么玩</h3>
      <ul class="howto">
        <li><b>点击</b>工位、机器人或 AMR 查看工艺、过程曲线与实时数据</li>
        <li><b>拖拽</b>旋转视角，<b>滚轮</b>缩放，右键平移；数字键 <kbd>1–4</kbd> 切换产线，<kbd>0</kbd> 全景</li>
        <li><b>空格</b>暂停；顶部切换仿真倍速</li>
        <li>打开 <b>产品实验室</b>，拆解四种产品、查看关节轴线、传感器视场与质心</li>
      </ul>
      <h3>值得一试的实验</h3>
      <ol class="exps">
        <li data-act="exp1"><b>瓶颈漂移</b><span>把人形线瓶颈工位的节拍系数调到 0.8，看产出提升、瓶颈转移到下一个工位。</span></li>
        <li data-act="exp2"><b>故障传播</b><span>对 H40 注入故障：上游逐级堵塞（蓝），下游逐级待料（黄）。</span></li>
        <li data-act="exp3"><b>物流瓶颈</b><span>把 AMR 减到 1 台：线边库存耗尽后，装关节的工位变成紫色缺料。</span></li>
        <li data-act="exp4"><b>源头断供</b><span>让关节线 J60 测功机停机：J-OUT 缓存被耗尽，三条总装线同时受影响。</span></li>
      </ol>
      <h3>车间概况</h3>
      <dl class="kv">
        <div><dt>产线</dt><dd>4 条 · ${s.stations.length} 个工位</dd></div>
        <div><dt>输送方式</dt><dd>托盘线 · AGV 立式工装 · 倍速链 · 链板 + 自驱</dd></div>
        <div><dt>物流</dt><dd>看板拉动 · ${s.amrCount} 台 AMR · 右侧通行</dd></div>
        <div><dt>追溯</dt><dd>一物一码，关节 SN 绑定到整机</dd></div>
      </dl>`;
    this.bindInsp({
      exp1: () => { const st = this.sim.lineById.H.bottleneck; this.app.select({ type: 'station', ref: st }, true); },
      exp2: () => { const st = this.sim.stationById.H40; st.fail('急停回路异常（人为注入）'); this.app.select({ type: 'line', ref: st.line }, true); this.app.view('H'); },
      exp3: () => { this.sim.setAmrCount(1); this.refreshBoard(); this.app.setLayer('paths', true); this.app.view('overview'); },
      exp4: () => { const st = this.sim.stationById.J60; st.fail('测功机扭矩传感器漂移（人为注入）'); st.down = 3600; st.downTotal = 3600; this.app.select({ type: 'station', ref: st }, true); },
    });
  }

  showStation(st) {
    const d = st.def, L = st.line.def;
    const cons = d.consumes ? Object.entries(d.consumes).map(([k, n]) => `${k === 'act' ? '关节模组' : '电池包'} × ${n}`).join('、') : '';
    $('#insp-body').innerHTML = `
      ${this.head(`${L.id} · ${L.name}`, `${st.id} · ${d.name}`, d.en, `<span class="pill" data-k="state"></span>`)}
      <div class="prog"><div class="bar"><i data-k="bar"></i></div><span data-k="step"></span></div>
      <dl class="kv kv4">
        <div><dt>名义节拍</dt><dd data-k="ct"></dd></div>
        <div><dt>实测均值</dt><dd data-k="act"></dd></div>
        <div><dt>完成</dt><dd data-k="count"></dd></div>
        <div><dt>NOK / 故障</dt><dd data-k="nok"></dd></div>
      </dl>
      <div class="unitline" data-k="unit"></div>
      <h3>时间分布 <small>运行 · 待料 · 堵塞 · 故障 · 缺料</small></h3>
      <div class="stack" data-k="stack"></div>
      <h3>过程曲线 <small data-k="trsn"></small></h3>
      <div class="plotwrap"><canvas class="plot" data-k="plot"></canvas><span class="verdict" data-k="verdict"></span></div>
      <dl class="kv kv3" data-k="readouts"></dl>
      <h3>工位控制</h3>
      <div class="ctl">
        <label>节拍系数 <b data-k="cf">${st.ctFactor.toFixed(2)}×</b><input type="range" min="0.6" max="1.4" step="0.05" value="${st.ctFactor}" data-act="cf"></label>
        <div class="btns"><button data-act="fault" class="danger">注入故障</button><button data-act="reset">复位 / 维修完成</button><button data-act="focus">定位</button></div>
      </div>
      ${d.consumes ? `<h3>线边物料 <small>${cons} / 件</small></h3><div class="stock" data-k="stock"></div>` : ''}
      <h3>工艺步骤</h3>
      <ol class="steps">${d.process.map((p) => `<li>${p}</li>`).join('')}</ol>
      <h3>关键技术</h3>
      <ul class="tech">${d.tech.map((t) => `<li>${t}</li>`).join('')}</ul>
      <h3>工艺参数</h3>
      <dl class="kv kv2">${d.params.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <h3>质量门</h3>
      <div class="gates">${(d.checks || []).map((c) => `<span>${c}</span>`).join('')}</div>
      <h3>可靠性参数</h3>
      <dl class="kv kv3"><div><dt>MTBF</dt><dd>${(d.mtbf / 3600).toFixed(1)} h</dd></div><div><dt>MTTR</dt><dd>${Math.round(d.mttr / 60)} min</dd></div><div><dt>一次合格率</dt><dd>${(d.fpy * 100).toFixed(1)}%</dd></div></dl>`;
    this.bindInsp({
      fault: () => { if (st.down <= 0) st.fail(); this.liveStation(st, true); },
      reset: () => { if (st.down > 0) st.down = Math.min(st.down, 2); },
      focus: () => this.app.focus({ type: 'station', ref: st }),
      unit: (t) => { const u = st.unit; if (u) this.app.select({ type: 'unit', ref: u }, true); },
      input: (i) => { if (i.dataset.act === 'cf') { st.ctFactor = +i.value; $('[data-k="cf"]').textContent = st.ctFactor.toFixed(2) + '×'; } },
    });
    this.liveStation(st, true);
  }

  liveStation(st, full) {
    const b = $('#insp-body');
    const q = (k) => b.querySelector(`[data-k="${k}"]`);
    if (!q('state')) return;
    const S = STATE[st.state];
    q('state').textContent = st.state === 'down' ? `故障 · ${st.fault}` : S.zh;
    q('state').style.setProperty('--c', S.color);
    const p = st.progress;
    q('bar').style.width = (Math.max(0, p) * 100).toFixed(1) + '%';
    q('bar').style.background = S.color;
    const steps = st.def.process;
    const si = p >= 0 && st.started && !st.finished ? Math.min(steps.length - 1, Math.floor(p * steps.length)) : -1;
    q('step').textContent = st.state === 'down' ? `维修剩余 ${Math.ceil(st.down / 60)} min` : si >= 0 ? `${si + 1}/${steps.length} ${steps[si]}` : st.state === 'mat' ? '等待线边物料…' : st.state === 'blocked' ? '下游未放行，工件滞留' : '等待来料';
    b.querySelectorAll('.steps li').forEach((li, i) => li.classList.toggle('on', i === si));
    q('ct').textContent = Math.round(st.baseCt) + ' s';
    const avg = st.cts.length ? st.cts.reduce((a, c) => a + c, 0) / st.cts.length : 0;
    q('act').textContent = avg ? Math.round(avg) + ' s' : '–';
    q('count').textContent = st.count;
    q('nok').textContent = `${st.nok} / ${st.faults}`;
    q('unit').innerHTML = st.unit ? `当前工件 <button data-act="unit" class="sn">${st.unit.sn}</button>${st.unit.nok ? ' <span class="badnok">NOK</span>' : ''}` : '<span class="muted">工位空闲</span>';
    const a = st.acc, tot = a.work + a.idle + a.blocked + a.down + a.mat || 1;
    q('stack').innerHTML = ['work', 'idle', 'blocked', 'down', 'mat'].map((k) => `<i style="flex:${a[k] / tot};background:${STATE[k].color}" title="${STATE[k].zh} ${pct(a[k] / tot)}"></i>`).join('') + `<span>${pct((a.work + a.down) / tot)} 活跃</span>`;
    if (q('stock')) {
      const k = Object.keys(st.def.consumes)[0];
      const n = st.stock[k].length, cap = st.cap[k];
      q('stock').innerHTML = `<div class="sbar"><i style="width:${n / cap * 100}%"></i><u style="left:${st.reorder[k] / cap * 100}%" title="再订货点"></u></div>
        <dl class="kv kv3"><div><dt>库存</dt><dd>${n} / ${cap}</dd></div><div><dt>在途</dt><dd>${st.inTransit[k]}</dd></div><div><dt>再订货点</dt><dd>${st.reorder[k]}</dd></div></dl>
        <p class="mono small">下一批：${st.stock[k].slice(0, 3).join(' · ') || '—'}</p>`;
    }
    if (full || st.last?.seed !== this.lastSeed) {
      this.lastSeed = st.last?.seed;
      const spec = genTrace(st);
      drawPlot(q('plot'), spec, this.C);
      q('trsn').textContent = st.last ? `${st.last.sn}${st.last.retry ? ' · 重试' : ''}` : '';
      q('verdict').textContent = spec ? (spec.ok ? 'OK' : 'NOK') : '';
      q('verdict').className = 'verdict ' + (spec ? (spec.ok ? 'ok' : 'nok') : '');
      q('readouts').innerHTML = spec ? spec.readouts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('') : '';
    }
  }

  showUnit(u) {
    const L = u.line.def;
    const P = PRODUCTS[L.product];
    $('#insp-body').innerHTML = `
      ${this.head(`${L.id} · ${L.name}`, u.sn, `${P.name} · ${P.en}${L.id === 'J' ? ' × 8 穴托盘' : ''}`, `<span class="pill" data-k="ustate"></span>`)}
      <div class="btns"><button data-act="follow" class="${this.app.follow === u ? 'on' : ''}">${this.app.follow === u ? '停止跟随' : '跟随视角'}</button><button data-act="lab">在实验室中拆解 →</button></div>
      <h3>工艺路线</h3>
      <ol class="route" data-k="route"></ol>
      <dl class="kv kv3">
        <div><dt>在线时长</dt><dd data-k="age"></dd></div>
        <div><dt>位置</dt><dd data-k="pos"></dd></div>
        <div><dt>质量</dt><dd data-k="q"></dd></div>
      </dl>
      <h3>物料谱系 <small>Genealogy</small></h3>
      <div class="gen" data-k="gen"></div>
      <h3>产品原理</h3>
      <ul class="tech">${P.principles.slice(0, 2).map((p) => `<li><b>${p.t}</b>　${p.d}</li>`).join('')}</ul>`;
    this.bindInsp({
      follow: () => { this.app.setFollow(this.app.follow === u ? null : u); this.showUnit(u); },
      lab: () => this.app.openLab(L.product),
      st: (t) => this.app.select({ type: 'station', ref: this.sim.stationById[t.dataset.id] }, true),
    });
    this.liveUnit(u);
  }

  liveUnit(u) {
    const b = $('#insp-body');
    const q = (k) => b.querySelector(`[data-k="${k}"]`);
    if (!q('route')) return;
    const gone = !u.line.units.includes(u);
    q('ustate').textContent = gone ? '已下线' : u.st ? `${u.st.id} · ${STATE[u.st.state].zh}` : '输送中';
    q('ustate').style.setProperty('--c', gone ? '#8a8984' : u.st ? STATE[u.st.state].color : '#5fd1ff');
    q('route').innerHTML = u.line.stations.map((s, i) => {
      const h = u.hist.find((x) => x.id === s.id);
      const cur = u.st === s && !s.finished;
      const cls = h ? (h.ok ? 'done' : 'bad') : cur ? 'cur' : '';
      const meta = h ? `${Math.round(h.ct)} s${h.retry ? ' · 重试' : ''}${h.ok ? '' : ' · NOK'}` : cur ? Math.round(s.progress * 100) + '%' : '';
      return `<li class="${cls}" data-act="st" data-id="${s.id}"><b>${s.id}</b><span>${s.def.name}</span><em>${meta}</em></li>`;
    }).join('');
    q('age').textContent = mins(this.sim.t - u.tSpawn);
    q('pos').textContent = `x = ${u.pos.toFixed(1)} m`;
    q('q').innerHTML = u.nok ? `<span class="badnok">NOK · ${u.defects.join(', ')}</span>` : 'OK';
    if (!u.gen.length) q('gen').innerHTML = '<p class="muted small">尚未装入外购 / 自制关键件。</p>';
    else if (q('gen').dataset.n !== String(u.gen.length)) {
      q('gen').dataset.n = u.gen.length;
      q('gen').innerHTML = u.gen.map((g) => `<div><b>${g.st}</b><span>${g.type === 'act' ? '关节模组' : '电池包'} × ${g.items.length}</span><code>${g.items.slice(0, 4).join(' ')}${g.items.length > 4 ? ' …' : ''}</code></div>`).join('');
    }
  }

  showAmr(a) {
    $('#insp-body').innerHTML = `
      ${this.head('内部物流 · AMR', a.name, 'Autonomous Mobile Robot · 顶升式', `<span class="pill" data-k="astate"></span>`)}
      <dl class="kv kv2">
        <div><dt>电量</dt><dd><span class="batbig"><s data-k="bat"></s></span><b data-k="batv"></b></dd></div>
        <div><dt>任务</dt><dd data-k="task"></dd></div>
        <div><dt>载荷</dt><dd data-k="load"></dd></div>
        <div><dt>里程 / 趟次</dt><dd data-k="odo"></dd></div>
      </dl>
      <h3>调度逻辑</h3>
      <ul class="tech">
        <li>线边库存 + 在途量低于再订货点 → 生成看板拉动任务（Kanban pull）</li>
        <li>就近派单：空闲且电量 &gt; 35% 的 AMR 中选距取料点最近的一台</li>
        <li>完成卸料后若队列非空则直接接续，减少空驶；电量 &lt; 30% 回充电位</li>
        <li>通道右侧通行，交叉口按曼哈顿路径规划；取 / 卸料各约 14 s</li>
      </ul>
      <div class="btns"><button data-act="paths">${this.app.world.layers.paths ? '隐藏路径' : '显示全部 AMR 路径'}</button><button data-act="focus">定位</button></div>`;
    this.bindInsp({
      paths: () => { this.app.setLayer('paths', !this.app.world.layers.paths); this.showAmr(a); },
      focus: () => this.app.focus({ type: 'amr', ref: a }),
    });
    this.liveAmr(a);
  }

  liveAmr(a) {
    const b = $('#insp-body');
    const q = (k) => b.querySelector(`[data-k="${k}"]`);
    if (!q('bat')) return;
    q('astate').textContent = AMR_STATE[a.state] || a.state;
    q('astate').style.setProperty('--c', a.state === 'wait' ? '#e5534b' : '#5fd1ff');
    q('bat').style.width = Math.round(a.battery * 100) + '%';
    q('batv').textContent = Math.round(a.battery * 100) + '%';
    q('task').textContent = a.task ? `${a.task.type === 'act' ? '关节模组' : '电池包'} × ${a.task.qty} → ${a.task.st.id}` : '—';
    q('load').textContent = a.load ? `${a.load.items.length} 件${a.load.trays ? '（' + a.load.trays.length + ' 盘）' : ''}` : '空载';
    q('odo').textContent = `${(a.odo / 1000).toFixed(2)} km / ${a.trips}`;
  }

  showLine(l) {
    const d = l.def;
    $('#insp-body').innerHTML = `
      ${this.head(`产线 ${d.id} · ${d.unitName}`, d.name, d.en)}
      <p class="lead">${d.desc}</p>
      <dl class="kv kv4">
        <div><dt>UPH</dt><dd data-k="uph"></dd></div>
        <div><dt>目标</dt><dd>${f1(l.targetUph)}</dd></div>
        <div><dt>WIP</dt><dd data-k="wip"></dd></div>
        <div><dt>FPY</dt><dd data-k="fpy"></dd></div>
      </dl>
      <h3>OEE 分解 <small>Availability × Performance × Quality</small></h3>
      <div class="oee" data-k="oee"></div>
      <h3>利特尔法则 <small>WIP = TH × LT</small></h3>
      <div class="little" data-k="little"></div>
      <h3>投料策略 <small>CONWIP · 在制品达到上限即停止投料</small></h3>
      <div class="ctl"><label>WIP 上限 <b data-k="cw">${l.conwip}</b><input type="range" min="${l.stations.length}" max="${l.stations.length + 14}" step="1" value="${l.conwip}" data-act="cw"></label></div>
      <h3>产线平衡 <small>名义节拍 vs 目标节拍 ${d.takt} s</small></h3>
      <div class="balance" data-k="bal"></div>
      <h3>瓶颈识别 <small>活跃时间占比（运行 + 故障）</small></h3>
      <div class="bnlist" data-k="bnl"></div>
      <h3>UPH 趋势 <small>每 5 min 采样</small></h3>
      <canvas class="spark" data-k="spark"></canvas>
      <div class="btns"><button data-act="view">定位到产线</button></div>`;
    this.bindInsp({
      view: () => this.app.view(d.id),
      input: (i) => { if (i.dataset.act === 'cw') { l.conwip = +i.value; $('[data-k="cw"]').textContent = l.conwip; } },
      st: (t) => this.app.select({ type: 'station', ref: this.sim.stationById[t.dataset.id] }, true),
    });
    this.liveLine(l, true);
  }

  liveLine(l, full) {
    const b = $('#insp-body');
    const q = (k) => b.querySelector(`[data-k="${k}"]`);
    if (!q('bal')) return;
    const o = l.oee;
    q('uph').textContent = f1(l.uph);
    q('wip').textContent = l.wip;
    q('fpy').textContent = l.out ? pct(l.fpy) : '–';
    q('oee').innerHTML = [['A 可用率', o.A], ['P 性能', o.P], ['Q 质量', o.Q], ['OEE', o.oee]].map(([k, v]) => `<div><span>${k}</span><u><s style="width:${(v * 100).toFixed(1)}%"></s></u><b>${pct(v)}</b></div>`).join('');
    const th = l.uph / 3600, lt = l.lead;
    q('little').innerHTML = `<div><dt>TH 产出率</dt><dd>${f1(l.uph)} /h</dd></div><div><dt>LT 平均流程时间</dt><dd>${lt ? mins(lt) : '–'}</dd></div><div><dt>TH × LT</dt><dd>${lt ? f1(th * lt) : '–'}</dd></div><div><dt>实际 WIP</dt><dd>${l.wip}</dd></div>`;
    const mx = Math.max(l.def.takt, ...l.stations.map((s) => s.baseCt)) * 1.15;
    q('bal').innerHTML = l.stations.map((s) => {
      const avg = s.cts.length ? s.cts.reduce((a, c) => a + c, 0) / s.cts.length : 0;
      return `<button data-act="st" data-id="${s.id}"><u style="height:${s.baseCt / mx * 100}%" class="${s.baseCt > l.def.takt ? 'over' : ''}"></u>${avg ? `<i style="bottom:${avg / mx * 100}%"></i>` : ''}<span>${s.id.slice(1)}</span></button>`;
    }).join('') + `<hr style="bottom:calc(${l.def.takt / mx * 100}% + 18px)">`;
    const rows = l.stations.map((s) => { const a = s.acc, tot = a.work + a.idle + a.blocked + a.down + a.mat || 1; return { s, a, tot, v: (a.work + a.down) / tot }; }).sort((x, y) => y.v - x.v);
    q('bnl').innerHTML = rows.map(({ s, a, tot }, i) => `<div data-act="st" data-id="${s.id}" class="${i === 0 ? 'top' : ''}"><b>${s.id}</b><span class="stack sm">${['work', 'down', 'blocked', 'idle', 'mat'].map((k) => `<i style="flex:${a[k] / tot};background:${STATE[k].color}"></i>`).join('')}</span><em>${pct((a.work + a.down) / tot)}</em></div>`).join('');
    if (full || this.acc2 === 0) drawSpark(q('spark'), l.uphHist, this.C, { target: l.targetUph });
  }

  /* ---------------- tick ---------------- */
  tick(dt) {
    this.acc += dt;
    this.acc2 += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const redraw = this.acc2 > 1.5;
    if (redraw) this.acc2 = 0;
    this.refreshKpi();
    this.refreshBoard();
    if (this.logDirty) this.renderLog();
    const s = this.sel;
    if (!s) return;
    if (s.type === 'station') this.liveStation(s.ref);
    else if (s.type === 'unit') this.liveUnit(s.ref);
    else if (s.type === 'amr') { if (!this.sim.amrs.includes(s.ref)) this.app.select(null); else this.liveAmr(s.ref); }
    else if (s.type === 'line') this.liveLine(s.ref, redraw);
  }
}
