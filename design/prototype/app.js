/* ==========================================================================
   Vitals prototype — views, synthetic model, schedule painter, channel chart.
   Everything here is illustrative. The "model" is a toy with plausible shapes
   so the prototype responds to edits; it is NOT the engine.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const A = window.BodyAvatar;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const h = (tag, attrs = {}, html) => {
    const n = document.createElement(tag);
    for (const k in attrs) { if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (html != null) n.innerHTML = html;
    return n;
  };
  const fmt = (v, d = 1) => {
    const s = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-GB').replace(/,/g, ' ') : v.toFixed(d);
    return s.replace('-', '−');
  };
  const signed = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
  const mq = (q) => window.matchMedia(q).matches;
  const icon = (id, cls = 'icon icon--sm') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  /* ------------------------------------------------------------------------
     THEME
     ------------------------------------------------------------------------ */
  function effectiveDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return mq('(prefers-color-scheme: dark)');
  }
  $$('[data-theme-toggle]').forEach(b => b.addEventListener('click', () => {
    const next = effectiveDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('vitals-theme', next); } catch (e) { /* storage unavailable */ }
  }));

  /* ------------------------------------------------------------------------
     PROGRAMS + SCHEDULE (synthetic)
     ------------------------------------------------------------------------ */
  const M0 = 2540, BW = 84.9;
  const START = new Date(2026, 9, 5); // Mon 5 Oct 2026
  const DAYS = 84;
  const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayDate = (i) => { const d = new Date(START); d.setDate(d.getDate() + i); return d; };
  const dateLbl = (i, long) => { const d = dayDate(i); const w = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]; return long ? `${w} ${d.getDate()} ${MON[d.getMonth()]}` : `${d.getDate()} ${MON[d.getMonth()]}`; };

  const PROGRAMS = {
    A: { name: 'training day', pct: 0.85, prot: 2.0, carbs: 140, fibre: 30, win: [12, 20], meals: [[12.5, 0.45], [19, 0.55]], lift: [17.5, 18.5], steps: 8000, train: true },
    B: { name: 'rest day', pct: 0.75, prot: 2.0, carbs: 60, fibre: 30, win: [12, 20], meals: [[12.5, 0.5], [19, 0.5]], steps: 7000 },
    C: { name: 'long walk day', pct: 0.80, prot: 2.0, carbs: 100, fibre: 32, win: [9, 19], meals: [[9.5, 0.3], [13.5, 0.3], [18.5, 0.4]], walk: [7.5, 9], steps: 15000 },
    D: { name: 'water-only fast', pct: 0, prot: 0, carbs: 0, fibre: 0, win: null, meals: [], steps: 6000, fast: true, fastH: 36 },
    E: { name: 'maintenance', pct: 1.0, prot: 1.8, carbs: 260, fibre: 35, win: [8, 20], meals: [[8.5, 0.3], [13, 0.35], [19, 0.35]], steps: 8000 },
    F: { name: 'training, maintenance', pct: 1.0, prot: 2.0, carbs: 240, fibre: 32, win: [9, 20], meals: [[9.5, 0.3], [13.5, 0.3], [19, 0.4]], lift: [17.5, 18.5], steps: 8000, train: true },
  };
  const PHASES = [
    { name: 'fat-loss base', from: 0, to: 27, sub: 'wk 1–4' },
    { name: 'diet break', from: 28, to: 34, sub: 'wk 5' },
    { name: 'fasting block', from: 35, to: 69, sub: 'wk 6–10' },
    { name: 'maintenance', from: 70, to: 83, sub: 'wk 11–12' },
  ];
  function macros(p) {
    const kcal = p.pct * M0;
    const pg = p.prot * BW, cg = p.carbs, fib = p.fibre;
    const fg = Math.max(0, (kcal - pg * 4 - cg * 4 - fib * 2) / 9);
    return { kcal, pg, cg, fib, fg, pk: pg * 4, ck: cg * 4, fk: fg * 9 };
  }
  function buildSchedule() {
    const s = [];
    for (let w = 0; w < 12; w++) for (let d = 0; d < 7; d++) {
      if (w < 4) s.push('ABABACB'[d]);
      else if (w === 4) s.push('E');
      else if (w < 10) s.push('ABADACB'[d]);
      else s.push('FEFEFCE'[d]);
    }
    return s;
  }
  const state = {
    schedule: buildSchedule(),
    armed: 'A',
    focusDay: 37, // Wed 11 Nov
    sel: new Set([37]),
    stale: false,
  };

  /* ------------------------------------------------------------------------
     TOY MODEL (daily). Shapes only; labelled synthetic everywhere.
     ------------------------------------------------------------------------ */
  function simulate(schedule) {
    let F = 24.1, Lc = 59.0, G = 450, K = 0.15, KA = 0, Ad = 0, H = 34, IS = 50, AU = 18;
    const bals = [], out = { fat: [], lean: [], weight: [], glyc: [], ket: [], tdee: [], adapt: [], hunger: [], insulin: [], autoph: [], intake: [], events: [], warns: [] };
    const carbs3 = [];
    out.base = { fat: F, lean: Lc + G * 4 / 1000, weight: F + Lc + G * 4 / 1000, tdee: M0 };
    for (let i = 0; i < schedule.length; i++) {
      const pid = schedule[i], p = PROGRAMS[pid], m = macros(p);
      const prev = i > 0 ? PROGRAMS[schedule[i - 1]] : null;
      const W = F + Lc + G * 4 / 1000;
      const Mt = M0 + Ad - 22 * (BW - W) + (p.steps - 8000) * 0.035 + (p.train ? 120 : 0);
      const bal = m.kcal - Mt;
      bals.push(bal);
      const E7 = bals.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, bals.length);
      carbs3.push(m.cg);
      const c3 = carbs3.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, carbs3.length);
      const Gt = p.fast ? 150 : clamp(120 + 1.6 * c3 - (p.train ? 40 : 0), 110, 530);
      G += (Gt - G) * (p.fast ? 0.6 : 0.45);
      const Kt = 0.1 + (p.fast ? 1.7 : 0) + Math.max(0, (260 - G) / 220) * (m.cg < 80 ? 1.0 : 0.25) + KA * 0.15;
      const Kprev = K;
      K += (Kt - K) * (p.fast ? 0.78 : 0.6);
      KA = clamp(KA + (K > 0.5 ? 0.05 : -0.02), 0, 1);
      const protOK = m.pg / BW >= 1.6;
      const share = p.fast ? 0.8 : bal < 0 ? (protOK ? 0.94 : 0.8) : 0.5;
      let gain = p.train && protOK ? 0.02 : 0;
      if (bal < -800) gain *= 0.5;
      F += bal * share / 7700;
      Lc += bal * (1 - share) / 1800 + gain - (p.fast && prev && prev.train ? 0.03 : 0);
      const At = clamp(0.2 * E7, -260, 0);
      Ad += (At - Ad) * (At < Ad ? 0.035 : 0.08);
      const Ht = 32 + 0.05 * Math.max(0, -E7) + (p.fast ? 22 : 0) + 1.1 * (24.1 - F);
      H += (Ht - H) * 0.45;
      IS += ((50 + 1.5 * (24.1 - F) + 5 * KA + (p.train ? 1 : 0)) - IS) * 0.08;
      const fastLen = p.fast ? 36 : 24 - (p.win[1] - p.win[0]);
      const AUt = p.fast ? 74 : fastLen >= 16 ? 31 : fastLen >= 14 ? 25 : 20;
      AU += (AUt - AU) * 0.7;
      const Wn = F + Lc + G * 4 / 1000;
      const sp = (a, b) => a + b * i;
      out.fat.push([F, F - sp(0.12, 0.0125), F + sp(0.12, 0.0125)]);
      const lean = Lc + G * 4 / 1000;
      out.lean.push([lean, lean - sp(0.18, 0.009), lean + sp(0.18, 0.009)]);
      out.weight.push([Wn, Wn - sp(0.35, 0.014), Wn + sp(0.35, 0.014)]);
      out.glyc.push([G, G - sp(30, 0.35), G + sp(30, 0.35)]);
      out.ket.push([K, K * 0.68, K * 1.45]);
      out.tdee.push([Mt, Mt - sp(45, 1.1), Mt + sp(45, 1.1)]);
      out.adapt.push([Ad, Ad - sp(12, 1.5), Math.min(0, Ad + sp(12, 1.3))]);
      out.hunger.push([H, H - sp(5, 0.1), H + sp(5, 0.1)]);
      out.insulin.push([IS, IS - sp(3, 0.07), IS + sp(3, 0.07)]);
      out.autoph.push([AU, AU - sp(9, 0.1), AU + sp(9, 0.1)]);
      out.intake.push({ p: m.pk, c: m.ck, f: m.fk, fast: !!p.fast, train: !!p.train, walk: p.steps >= 12000, mt: Mt });
      if (Kprev < 0.5 && K >= 0.5) out.events.push({ i, type: 'keto', label: 'ketosis entered' });
      if (Kprev >= 0.5 && K < 0.5) out.events.push({ i, type: 'ketoOff', label: 'ketosis exited' });
      if (p.fast && prev && prev.train) out.events.push({ i, type: 'caution', label: '36 h fast right after a lifting day' });
    }
    // warnings
    const fastAfterLift = out.events.filter(e => e.type === 'caution').map(e => e.i);
    if (fastAfterLift.length) {
      const wk = [...new Set(fastAfterLift.map(i => Math.floor(i / 7) + 1))];
      out.warns.push({ sev: 'caution', title: `36 h fasts follow lifting days in weeks ${wk[0]}–${wk[wk.length - 1]}`, body: 'Fasting straight after resistance training cuts the protein available for repair. Lean mass ends about 0.4 kg lower than with the fast moved to a rest day.', days: fastAfterLift, fix: 'Move fasts to Tuesdays' });
    }
    out.warns.push({ sev: 'info', title: 'Wide range for metabolic adaptation after week 8', body: 'People differ a lot in how much their expenditure drops. Likely range at week 12: −60 to −340 kcal a day.', days: [56, 83] });
    return out;
  }
  let RUN = simulate(state.schedule);   // what Results shows (last run)
  let LIVE = RUN;                         // what the preview shows (current schedule)

  /* ------------------------------------------------------------------------
     ROUTER
     ------------------------------------------------------------------------ */
  const VIEWS = { body: 'view-body', schedule: 'view-schedule', results: 'view-results' };
  function route() {
    let r = (location.hash || '#body').slice(1);
    const known = ['body', 'schedule', 'results', 'plan', 'evidence', 'settings'];
    if (!known.includes(r)) r = 'body';
    $$('.view').forEach(v => v.classList.remove('is-active'));
    const vid = VIEWS[r] || 'view-other';
    $('#' + vid).classList.add('is-active');
    if (!VIEWS[r]) $('#otherTitle').textContent = { plan: 'Planner', evidence: 'Evidence', settings: 'Settings' }[r];
    const nav = r === 'schedule' || r === 'results' ? 'simulate' : r;
    $$('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === nav ? 'page' : 'false'));
    $$('[data-go]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.go === r)));
    if (r === 'body') renderBody();
    if (r === 'schedule') renderSchedule();
    if (r === 'results') renderResults();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  $$('[data-go]').forEach(b => b.addEventListener('click', () => { location.hash = '#' + b.dataset.go; }));

  /* ------------------------------------------------------------------------
     SCALE SLIDER (radio tuning window)
     ------------------------------------------------------------------------ */
  function scaleSlider(o) {
    const wrap = h('div', { class: 'scale' + (o.small ? ' scale--sm' : '') });
    const id = 'sl-' + Math.random().toString(36).slice(2, 8);
    wrap.innerHTML = `<div class="scale-top"><label class="eng" for="${id}">${o.label}</label><span class="lock" hidden>${icon('lock')}</span><span class="v"></span></div>
      <div class="scale-well"><svg class="ticks" preserveAspectRatio="none" aria-hidden="true"></svg><div class="needle"></div><div class="cap"></div>
      <input type="range" id="${id}" min="${o.min}" max="${o.max}" step="${o.step}" value="${o.value}" style="pointer-events:none"></div>
      ${o.nums ? '<div class="scale-nums"></div>' : ''}${o.note ? `<div class="scale-note">${o.note}</div>` : ''}`;
    const well = $('.scale-well', wrap), input = $('input', wrap), vEl = $('.v', wrap), needle = $('.needle', wrap), cap = $('.cap', wrap);
    const svg = $('svg.ticks', wrap);
    svg.setAttribute('viewBox', '0 0 1000 28');
    const span = o.max - o.min;
    const minor = o.minor || span / 40, major = o.major || span / 8;
    (o.zones || []).forEach(z => { const d = h('div', { class: 'zone' }); d.style.left = ((z[0] - o.min) / span * 100) + '%'; d.style.width = ((z[1] - z[0]) / span * 100) + '%'; d.style.background = z[2]; well.insertBefore(d, svg); });
    for (let v = o.min; v <= o.max + 1e-9; v += minor) {
      const x = (v - o.min) / span * 1000;
      const isMaj = Math.abs(((v - o.min) / major) - Math.round((v - o.min) / major)) < 1e-6;
      el('line', { x1: x, x2: x, y1: isMaj ? 0 : 0, y2: isMaj ? 10 : 6, class: isMaj ? 'maj' : '', 'vector-effect': 'non-scaling-stroke' }, svg);
    }
    if (o.ref != null) { const r = h('div', { class: 'ref', title: o.refLabel || '' }); r.style.left = ((o.ref - o.min) / span * 100) + '%'; well.appendChild(r); }
    if (o.nums) {
      const nums = $('.scale-nums', wrap);
      o.nums.forEach(([v, t]) => { const s = h('span', {}, t); s.style.left = ((v - o.min) / span * 100) + '%'; if (v === o.min) s.style.transform = 'none'; if (v === o.max) s.style.transform = 'translateX(-100%)'; nums.appendChild(s); });
    }
    let rngEl = null;
    const api = {
      el: wrap, input,
      set(v, silent) {
        v = clamp(Math.round(v / o.step) * o.step, o.min, o.max);
        input.value = v;
        const pct = (v - o.min) / span * 100;
        needle.style.left = pct + '%'; cap.style.left = pct + '%';
        vEl.innerHTML = o.format ? o.format(v) : v;
        input.setAttribute('aria-valuetext', o.valuetext ? o.valuetext(v) : String(v));
        if (!silent && o.onInput) o.onInput(v);
      },
      range(lo, hi) {
        if (!rngEl) { rngEl = h('div', { class: 'rng' }); well.insertBefore(rngEl, needle); }
        rngEl.style.left = ((clamp(lo, o.min, o.max) - o.min) / span * 100) + '%';
        rngEl.style.width = ((clamp(hi, o.min, o.max) - clamp(lo, o.min, o.max)) / span * 100) + '%';
      },
      lock(on) { wrap.classList.toggle('is-locked', on); $('.lock', wrap).hidden = !on; },
    };
    input.addEventListener('input', () => api.set(+input.value));
    let dragging = false;
    const fromX = (e) => { const r = well.getBoundingClientRect(); return o.min + clamp((e.clientX - r.left) / r.width, 0, 1) * span; };
    well.addEventListener('pointerdown', (e) => {
      if (wrap.classList.contains('is-locked')) return;
      dragging = true; well.setPointerCapture(e.pointerId); input.focus({ preventScroll: true }); api.set(fromX(e));
    });
    well.addEventListener('pointermove', (e) => { if (dragging) api.set(fromX(e)); });
    const end = () => { dragging = false; if (o.onChange) o.onChange(+input.value); };
    well.addEventListener('pointerup', end); well.addEventListener('pointercancel', end);
    input.addEventListener('change', () => o.onChange && o.onChange(+input.value));
    api.set(o.value, true);
    return api;
  }

  /* ------------------------------------------------------------------------
     YOUR BODY
     ------------------------------------------------------------------------ */
  const body = {
    sex: 'male', base: 'male', baseFollowsSex: true, age: 36, heightCm: 178, weightKg: 84.9, bodyFatPct: 28.4,
    dist: { ...A.BASE_DIST.male }, muscle: { upper: 0.42, lower: 0.46 }, waistOn: false, waistCm: 96, units: 'metric', showVisceral: false,
  };
  const REGIONS = [['abdomen', 'belly & waist'], ['hips', 'hips & thighs'], ['chest', 'chest'], ['arms', 'arms']];
  const REGION_W = { abdomen: 0.34, hips: 0.38, chest: 0.14, arms: 0.14 };
  const muscleWord = (v) => v < 0.2 ? 'untrained' : v < 0.45 ? 'some training' : v < 0.7 ? 'trained' : v < 0.9 ? 'very trained' : 'exceptional';
  function fatShare(region) {
    const m = {}; let s = 0;
    for (const r of Object.keys(REGION_W)) { m[r] = 1 + 0.6 * body.dist[r]; s += REGION_W[r] * m[r]; }
    return Math.round(REGION_W[region] * m[region] / s * 100);
  }
  let sliders = {};
  let bodyBuilt = false;
  function buildBody() {
    if (bodyBuilt) return; bodyBuilt = true;
    const host = $('#shapeSliders');
    sliders.bf = scaleSlider({
      label: 'body fat', min: 4, max: 60, step: 0.1, value: body.bodyFatPct, minor: 1, major: 5, nums: [[5, '5'], [15, '15'], [25, '25'], [35, '35'], [45, '45'], [55, '55']],
      format: v => `${v.toFixed(1)}<span class="unit">%</span>`, valuetext: v => `${v.toFixed(1)} percent body fat`,
      onInput: v => { body.bodyFatPct = v; if (body.waistOn) solveWaist(); drawBody(); },
    });
    host.appendChild(sliders.bf.el);
    host.appendChild(h('div', { class: 'group-lbl' }, '<span class="h3">Where it sits</span>'));
    REGIONS.forEach(([r, label]) => {
      sliders[r] = scaleSlider({
        label, min: -1, max: 1, step: 0.01, value: body.dist[r], minor: 0.1, major: 0.5, small: true,
        nums: [[-1, 'less'], [0, 'typical'], [1, 'more']], format: () => `${fatShare(r)}<span class="unit">% of fat</span>`,
        valuetext: () => `${label}: ${fatShare(r)} percent of body fat`,
        onInput: v => { body.dist[r] = v; drawBody(); refreshShares(); },
      });
      host.appendChild(sliders[r].el);
    });
    host.appendChild(h('div', { class: 'group-lbl' }, '<span class="h3">Muscle</span>'));
    [['upper', 'upper body'], ['lower', 'lower body']].forEach(([k, label]) => {
      sliders['m' + k] = scaleSlider({
        label, min: 0, max: 1, step: 0.01, value: body.muscle[k], minor: 0.05, major: 0.25, small: true,
        nums: [[0, 'untrained'], [0.5, 'trained'], [1, 'very muscular']], format: v => muscleWord(v), valuetext: v => `${label} muscle: ${muscleWord(v)}`,
        onInput: v => { body.muscle[k] = v; drawBody(); },
      });
      host.appendChild(sliders['m' + k].el);
    });
    host.appendChild(h('div', { class: 'group-lbl' }, '<span class="h3">Waist</span><label class="switch" style="margin-left:auto;order:3"><span class="eng">use measurement</span><input type="checkbox" id="waistOn"><span class="track"></span></label>'));
    sliders.waist = scaleSlider({
      label: 'waist at the navel', min: 55, max: 160, step: 0.5, value: body.waistCm, minor: 5, major: 25, small: true,
      nums: [[55, '55'], [80, '80'], [105, '105'], [130, '130'], [155, '155']], format: v => `${v.toFixed(1)}<span class="unit">cm</span>`,
      onInput: v => { body.waistCm = v; if (body.waistOn) { solveWaist(); drawBody(); } },
      note: 'Optional. A tape measure at the navel narrows the body-fat range and sets where fat sits.',
    });
    host.appendChild(sliders.waist.el);
    sliders.waist.lock(true);
    $('#waistOn').addEventListener('change', (e) => {
      body.waistOn = e.target.checked; sliders.waist.lock(!body.waistOn); sliders.abdomen.lock(body.waistOn);
      if (body.waistOn) solveWaist(); drawBody();
    });
    // basics
    $$('[data-bind="sex"] button').forEach(b => b.addEventListener('click', () => {
      body.sex = b.dataset.v; pressIn(b);
      if (body.baseFollowsSex) { const nb = body.sex === 'unspecified' ? 'neutral' : body.sex; setBase(nb, true); }
      drawBody();
    }));
    $$('[data-bind="base"] button').forEach(b => b.addEventListener('click', () => { body.baseFollowsSex = false; setBase(b.dataset.v); drawBody(); }));
    $$('[data-units]').forEach(b => b.addEventListener('click', () => { body.units = b.dataset.units; pressIn(b); syncSteppers(); drawBody(); }));
    stepper('age', v => { body.age = clamp(Math.round(v), 18, 90); }, () => body.age, 1);
    stepper('height', v => { body.heightCm = clamp(body.units === 'metric' ? v : v * 2.54, 140, 210); }, () => body.units === 'metric' ? body.heightCm : body.heightCm / 2.54, 1, 1);
    stepper('weight', v => { body.weightKg = clamp(body.units === 'metric' ? v : v / 2.2046, 35, 250); }, () => body.units === 'metric' ? body.weightKg : body.weightKg * 2.2046, 0.1, 1);
    $('#visceralToggle').addEventListener('change', e => { body.showVisceral = e.target.checked; drawBody(); });
    $('#resetShape').addEventListener('click', () => {
      body.dist = { ...A.BASE_DIST[body.base] }; body.bodyFatPct = 28.4; body.muscle = { upper: 0.42, lower: 0.46 };
      Object.keys(body.dist).forEach(r => sliders[r].set(body.dist[r], true)); sliders.bf.set(body.bodyFatPct, true);
      sliders.mupper.set(body.muscle.upper, true); sliders.mlower.set(body.muscle.lower, true); drawBody();
    });
    setupHandles();
  }
  function pressIn(btn) { $$('button', btn.parentElement).forEach(x => x.setAttribute('aria-pressed', String(x === btn))); }
  function setBase(b, fromSex) {
    body.base = b; pressIn($(`[data-bind="base"] button[data-v="${b}"]`));
    if (fromSex || true) { body.dist = { ...A.BASE_DIST[b] }; Object.keys(body.dist).forEach(r => sliders[r] && sliders[r].set(body.dist[r], true)); }
  }
  function stepper(name, write, read, step, dec = 0) {
    const root = $(`[data-step="${name}"]`); const input = $('input', root); const [minus, plus] = $$('button', root);
    const show = () => { input.value = read().toFixed(dec); };
    const bump = (d) => { write(read() + d); show(); drawBody(); };
    let t1, t2;
    const hold = (d) => { bump(d); t1 = setTimeout(() => { t2 = setInterval(() => bump(d), 80); }, 400); };
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    minus.addEventListener('pointerdown', () => hold(-step)); plus.addEventListener('pointerdown', () => hold(step));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => { minus.addEventListener(ev, stop); plus.addEventListener(ev, stop); });
    input.addEventListener('change', () => { const v = parseFloat(input.value); if (!isNaN(v)) write(v); show(); drawBody(); });
    root._show = show;
  }
  function syncSteppers() {
    $('[data-u="height"]').textContent = body.units === 'metric' ? 'cm' : 'in';
    $('[data-u="weight"]').textContent = body.units === 'metric' ? 'kg' : 'lb';
    ['height', 'weight'].forEach(n => $(`[data-step="${n}"]`)._show());
  }
  function refreshShares() { REGIONS.forEach(([r]) => sliders[r].set(body.dist[r], true)); }
  function avatarParams(extra) {
    return Object.assign({ base: body.base, heightCm: body.heightCm, weightKg: body.weightKg, bodyFatPct: body.bodyFatPct, dist: { ...body.dist }, muscle: { ...body.muscle } }, extra || {});
  }
  function solveWaist() {
    let lo = -1, hi = 1;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2; const p = avatarParams(); p.dist.abdomen = mid;
      if (A.waistGirth(p) < body.waistCm) lo = mid; else hi = mid;
    }
    body.dist.abdomen = (lo + hi) / 2; sliders.abdomen.set(body.dist.abdomen, true); refreshShares();
  }
  function estimates() {
    const bf = body.bodyFatPct, W = body.weightKg;
    const fm = W * bf / 100, lm = W - fm;
    const sd = body.waistOn ? 4.5 : 6; // 80 % half-width, dossier 14 M3 fusion (figure only ≈ ±6, + waist ≈ ±4.5)
    const maint = (370 + 21.6 * lm) * 1.51;
    return [
      { k: 'body fat', v: bf, d: 1, u: '%', lo: bf - sd, hi: bf + sd, how: body.waistOn ? 'From your figure, weight and waist. A DEXA scan would narrow this to about ±3 points.' : 'From your figure and weight. Add a waist measurement to narrow the range.' },
      { k: 'fat mass', v: fm, d: 1, u: 'kg', lo: W * (bf - sd) / 100, hi: W * (bf + sd) / 100, how: 'Body fat × weight.' },
      { k: 'lean mass', v: lm, d: 1, u: 'kg', lo: W - W * (bf + sd) / 100, hi: W - W * (bf - sd) / 100, how: 'Everything that isn’t fat: muscle, organs, bone, water, glycogen.' },
      { k: 'maintenance', v: maint, d: 0, u: 'kcal/day', lo: maint * 0.91, hi: maint * 1.09, how: 'Resting energy from lean mass (Katch–McArdle), × your activity: 8 400 steps, 4 sessions a week.' },
    ];
  }
  function rangeBarSVG(lo, hi, v, min, max, ghost) {
    const X = (x) => 2 + (clamp(x, min, max) - min) / (max - min) * 92;
    return `<svg viewBox="0 0 96 10" aria-hidden="true"><line class="axis" x1="2" x2="94" y1="5" y2="5" vector-effect="non-scaling-stroke"/><rect class="span" x="${X(lo)}" y="3" width="${Math.max(1, X(hi) - X(lo))}" height="4" rx="2"/>${ghost != null ? `<rect class="ghost" x="${X(ghost) - 1}" y="1" width="2" height="8"/>` : ''}<rect class="pt" x="${X(v) - 1}" y="1" width="2" height="8"/></svg>`;
  }
  function drawEstimates() {
    const g = $('#estGrid'); g.innerHTML = '';
    for (const e of estimates()) {
      const span = e.hi - e.lo, min = e.lo - span * 0.6, max = e.hi + span * 0.6;
      const r = h('div', { class: 'readout' });
      r.innerHTML = `<span class="eng">${e.k}</span><span class="big readout-num">${fmt(e.v, e.d)}<span class="unit">${e.u}</span></span>
        <span class="rangebar">${rangeBarSVG(e.lo, e.hi, e.v, min, max)}likely ${fmt(e.lo, e.d)}–${fmt(e.hi, e.d)}</span><span class="howto">${e.how}</span>`;
      g.appendChild(r);
    }
  }
  function figureSVG(svg, p, opts = {}) {
    const f = A.front(p), s = A.side(p);
    const H = p.heightCm;
    let out = '';
    // ruler
    out += '<g class="ruler">';
    out += `<line x1="-58" x2="-58" y1="0" y2="-210" vector-effect="non-scaling-stroke"/>`;
    for (let c = 0; c <= 210; c += 10) out += `<line x1="-58" x2="${c % 50 === 0 ? -54 : -56}" y1="${-c}" y2="${-c}" vector-effect="non-scaling-stroke"/>`;
    for (let c = 50; c <= 200; c += 50) out += `<text x="-53" y="${-c + 1.3}">${c}</text>`;
    out += `<line class="me" x1="-60" x2="-46" y1="${-H}" y2="${-H}" vector-effect="non-scaling-stroke"/><text class="me" x="-45" y="${-H + 1.3}">${Math.round(H)}</text>`;
    out += '</g>';
    const ghost = opts.ghost ? { f: A.front(opts.ghost), s: A.side(opts.ghost) } : null;
    const figFront = (F) => {
      let g = `<path class="env" d="${A.pathD(F.env)}"/><path class="core" d="${A.pathD(F.core)}"/>`;
      for (let i = 0; i < 2; i++) g += `<path class="env" d="${A.pathD(F.armsEnv[i])}"/><path class="core" d="${A.pathD(F.armsCore[i])}"/>`;
      g += `<ellipse class="headc" cx="0" cy="${-F.head.cy}" rx="${F.head.rx}" ry="${F.head.ry}"/>`;
      for (const d of F.defs) if (d.o > 0.02) g += `<path class="def" style="opacity:${d.o.toFixed(2)}" d="${A.polyD(d.pts)}"/>`;
      return g;
    };
    out += `<g>${figFront(f)}`;
    if (opts.visceral) out += `<ellipse class="visc" cx="0" cy="${-f.visceral.cy}" rx="${f.visceral.rx}" ry="${f.visceral.ry}"/>`;
    if (ghost) { out += `<path class="ghost" d="${A.pathD(ghost.f.env)}" vector-effect="non-scaling-stroke"/>`; for (let i = 0; i < 2; i++) out += `<path class="ghost" d="${A.pathD(ghost.f.armsEnv[i])}" vector-effect="non-scaling-stroke"/>`; }
    out += `<text class="viewlbl" x="0" y="6">front</text></g>`;
    const sx = opts.sideX || 88;
    out += `<g transform="translate(${sx} 0)"><path class="env" d="${A.pathD(s.env)}"/><path class="core" d="${A.pathD(s.core)}"/><ellipse class="headc" cx="${s.head.cx}" cy="${-s.head.cy}" rx="${s.head.rx}" ry="${s.head.ry}"/>`;
    if (opts.visceral) out += `<ellipse class="visc" cx="${s.visceral.cx}" cy="${-s.visceral.cy}" rx="${s.visceral.rx}" ry="${s.visceral.ry}"/>`;
    if (ghost) out += `<path class="ghost" d="${A.pathD(ghost.s.env)}" vector-effect="non-scaling-stroke"/>`;
    out += `<text class="viewlbl" x="0" y="6">side</text></g>`;
    if (opts.handles) {
      out += '<g class="handles">';
      for (const [k, pt] of Object.entries(f.handles)) out += `<g class="handle" data-h="${k}" transform="translate(${pt[0]} ${-pt[1]})"><circle class="hit" r="6"/><circle class="capc" r="2.6" vector-effect="non-scaling-stroke"/><circle class="dotc" r=".8"/></g>`;
      out += '</g>';
    }
    svg.innerHTML = out;
    const dwords = { abdomen: 'the belly', hips: 'hips and thighs', chest: 'the chest', arms: 'the arms' };
    const top = Object.entries(p.dist).sort((a, b) => b[1] - a[1])[0][0];
    svg.setAttribute('aria-label', `Figure, ${p.base} base, ${Math.round(H)} cm. Body fat about ${Math.round(p.bodyFatPct)} percent, weighted toward ${dwords[top]}. Upper-body muscle ${muscleWord(p.muscle.upper)}, lower-body ${muscleWord(p.muscle.lower)}.`);
  }
  function drawBody() {
    figureSVG($('#bodyFig'), avatarParams(), { handles: true, visceral: body.showVisceral });
    drawEstimates();
    const sdv = body.waistOn ? 4.5 : 6;
    sliders.bf && sliders.bf.range(body.bodyFatPct - sdv, body.bodyFatPct + sdv);
  }
  function setupHandles() {
    const svg = $('#bodyFig'), tip = $('#dragTip'), stage = $('#bodyStage');
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      const hnd = e.target.closest('.handle'); if (!hnd) return;
      e.preventDefault();
      const k = hnd.dataset.h;
      const map = { waist: 'abdomen', hips: 'hips', chest: 'chest', arm: 'arms' };
      const mus = { hips: 'lower', chest: 'upper', arm: 'upper' };
      drag = { k, region: map[k], muscle: mus[k], x0: e.clientX, v0: e.shiftKey && mus[k] ? body.muscle[mus[k]] : body.dist[map[k]], shift: e.shiftKey && !!mus[k], el: hnd };
      hnd.classList.add('is-drag'); svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x0;
      if (drag.shift) { const v = clamp(drag.v0 + dx / 120, 0, 1); body.muscle[drag.muscle] = v; sliders['m' + drag.muscle].set(v, true); }
      else { if (drag.region === 'abdomen' && body.waistOn) return; const v = clamp(drag.v0 + dx / 60, -1, 1); body.dist[drag.region] = v; refreshShares(); }
      drawBody();
      const r = stage.getBoundingClientRect();
      tip.style.display = 'block'; tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px';
      tip.textContent = drag.shift ? `${drag.muscle} muscle · ${muscleWord(body.muscle[drag.muscle])}` : `${REGIONS.find(x => x[0] === drag.region)[1]} · ${fatShare(drag.region)} % of fat`;
    });
    const end = () => { if (drag) { drag = null; tip.style.display = 'none'; drawBody(); } };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }
  function renderBody() { buildBody(); drawBody(); }

  /* ------------------------------------------------------------------------
     SCHEDULE
     ------------------------------------------------------------------------ */
  const energyTint = (pct, fast) => {
    if (fast) return 'var(--lm-energy-fast)';
    const d = (pct - 1) * 100;
    if (Math.abs(d) < 1) return 'var(--lm-energy-neutral)';
    const step = Math.abs(d) <= 10 ? 1 : Math.abs(d) <= 20 ? 2 : Math.abs(d) <= 35 ? 3 : 4;
    return `var(--lm-energy-${d < 0 ? 'deficit' : 'surplus'}-${step})`;
  };
  const macroBar = (p) => {
    if (p.fast) return '';
    const m = macros(p), t = m.pk + m.ck + m.fk;
    return `<i style="flex:${m.pk / t};background:var(--lm-macro-protein)"></i><i style="flex:${m.ck / t};background:var(--lm-macro-carbs)"></i><i style="flex:${m.fk / t};background:var(--lm-macro-fat)"></i>`;
  };
  const progSummary = (p) => p.fast ? `${p.fastH} h · water only` : `${Math.round(p.pct * 100)} % · P${p.prot} C${p.carbs} F${Math.round(macros(p).fg)}`;
  const glyphs = (p) => (p.train ? icon('lift') : '') + (p.steps >= 12000 ? icon('walk') : '') + (p.fast ? icon('fast') : '') + (!p.fast && p.win && 24 - (p.win[1] - p.win[0]) >= 16 ? icon('moon') : '');

  function renderTray() {
    const tray = $('#tray'); tray.innerHTML = '';
    const counts = {}; state.schedule.forEach(k => counts[k] = (counts[k] || 0) + 1);
    Object.entries(PROGRAMS).forEach(([k, p]) => {
      const b = h('button', { class: 'pkey', 'aria-pressed': String(state.armed === k), role: 'radio', 'aria-checked': String(state.armed === k), 'aria-label': `Program ${k}, ${p.name}, ${progSummary(p)}` });
      b.innerHTML = `<span class="count">${counts[k] || 0} d</span><span class="l1"><span class="letter">${k}</span><span class="ind"></span><span class="name">${p.name}</span></span>
        <span class="sum">${progSummary(p)}</span><span class="mb">${p.fast ? '<i style="flex:1;background:var(--lm-ink)"></i>' : macroBar(p).replace(/<i /g, '<i ')}</span>`;
      b.addEventListener('click', () => { state.armed = state.armed === k ? null : k; renderTray(); renderRasterBar(); $('#abProgram').textContent = state.armed ? `${state.armed} · ${PROGRAMS[state.armed].name}` : 'nothing · drag selects'; });
      tray.appendChild(b);
    });
    tray.appendChild(h('button', { class: 'pkey pkey--new' }, `${icon('plus')} New program`));
  }
  function renderRasterBar() {
    const bar = $('#rasterBar');
    const n = state.sel.size;
    const first = Math.min(...state.sel);
    const lbl = n > 1 ? `${n} days selected` : `${dateLbl(first, true)} · ${state.schedule[first]} ${PROGRAMS[state.schedule[first]].name}`;
    bar.innerHTML = `<span class="sel">${lbl}</span><span class="eng">${state.armed ? `drag to paint with ${state.armed}` : 'drag to select'}</span><div class="grow"></div>
      ${n > 1 && state.armed ? `<button class="key key--sm" data-act="paint">Paint with ${state.armed}</button>` : ''}
      <button class="key key--quiet key--sm" data-act="copy" aria-label="Copy week">${icon('copy')}<span class="lbl">Copy week</span></button>
      <button class="key key--quiet key--sm" data-act="repeat" aria-label="Repeat to end">${icon('repeat')}<span class="lbl">Repeat to end</span></button>
      <button class="key key--quiet key--sm" data-act="clear" aria-label="Clear">${icon('erase')}<span class="lbl">Clear</span></button>`;
    $$('[data-act]', bar).forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'paint') { state.sel.forEach(i => state.schedule[i] = state.armed); scheduleChanged(); }
      if (act === 'repeat') { const w = Math.floor(first / 7); for (let i = (w + 1) * 7; i < DAYS; i++) state.schedule[i] = state.schedule[w * 7 + (i % 7)]; scheduleChanged(); }
      if (act === 'clear') { state.sel.forEach(i => state.schedule[i] = 'E'); scheduleChanged(); }
      if (act === 'copy') { b.innerHTML = `${icon('copy')}<span class="lbl">Copied wk ${Math.floor(first / 7) + 1}</span>`; }
    }));
  }
  function cellHTML(i) {
    const k = state.schedule[i], p = PROGRAMS[k];
    const flagged = LIVE.events.some(e => e.type === 'caution' && e.i === i);
    return `<span class="t"><span class="lt">${k}</span><span class="pc">${p.fast ? p.fastH + ' h' : Math.round(p.pct * 100) + '%'}</span></span>
      <span class="gl">${glyphs(p)}</span><span class="mb">${macroBar(p)}</span>${flagged ? `<span class="flag" title="caution">${icon('caution')}</span>` : ''}`;
  }
  function styleCell(c, i) {
    const p = PROGRAMS[state.schedule[i]];
    c.style.background = energyTint(p.pct, p.fast);
    c.classList.toggle('is-fast', !!p.fast);
    c.classList.toggle('is-sel', state.sel.has(i));
    c.classList.toggle('is-focus', i === state.focusDay);
    c.innerHTML = cellHTML(i);
    const flagged = LIVE.events.some(e => e.type === 'caution' && e.i === i);
    c.setAttribute('aria-label', `${dateLbl(i, true)}, program ${state.schedule[i]} ${p.name}, ${p.fast ? 'water-only fast ' + p.fastH + ' hours' : Math.round(p.pct * 100) + ' percent energy'}${flagged ? ', caution' : ''}`);
    c.setAttribute('aria-selected', String(state.sel.has(i)));
  }
  function renderRaster() {
    const r = $('#raster'); r.innerHTML = '';
    const desk = mq('(min-width: 1024px)');
    if (desk) r.appendChild(h('div', { class: 'hd', style: 'text-align:left;padding-left:12px' }, 'block'));
    r.appendChild(h('div', { class: 'hd' }, ''));
    DOW.forEach(d => r.appendChild(h('div', { class: 'hd', role: 'columnheader' }, d)));
    for (let w = 0; w < 12; w++) {
      if (desk) {
        const ph = PHASES.find(p => p.from === w * 7);
        if (ph) { const span = Math.round((ph.to - ph.from + 1) / 7); const d = h('div', { class: 'phase', style: `grid-row: span ${span}` }, `<b>${ph.name}</b>${ph.sub} · ${phaseEnergy(ph)}`); r.appendChild(d); }
      }
      r.appendChild(h('div', { class: 'wk' }, `wk ${w + 1}`));
      for (let d = 0; d < 7; d++) {
        const i = w * 7 + d;
        const c = h('button', { class: 'cell', role: 'gridcell', 'data-i': i, tabindex: i === state.focusDay ? '0' : '-1' });
        styleCell(c, i);
        r.appendChild(c);
      }
    }
    setupPainter();
  }
  function phaseEnergy(ph) {
    let s = 0; for (let i = ph.from; i <= ph.to; i++) s += PROGRAMS[state.schedule[i]].pct; return Math.round(s / (ph.to - ph.from + 1) * 100) + ' %';
  }
  let painterBound = false;
  function setupPainter() {
    if (painterBound) return; painterBound = true;
    const r = $('#raster');
    let mode = null, startI = null, moved = false, holdT = null, pid = null;
    const cellAt = (e) => { const t = document.elementFromPoint(e.clientX, e.clientY); const c = t && t.closest('.cell'); return c ? +c.dataset.i : null; };
    const apply = (i) => {
      if (i == null) return;
      if (mode === 'paint') { if (state.schedule[i] !== state.armed) { state.schedule[i] = state.armed; styleCell($(`.cell[data-i="${i}"]`), i); } state.sel.add(i); }
      if (mode === 'select') { state.sel = new Set(); const a = Math.min(startI, i), b = Math.max(startI, i); for (let k = a; k <= b; k++) state.sel.add(k); $$('.cell', r).forEach(c => c.classList.toggle('is-sel', state.sel.has(+c.dataset.i))); }
    };
    r.addEventListener('pointerdown', (e) => {
      const i = cellAt(e); if (i == null) return;
      startI = i; moved = false; pid = e.pointerId;
      const begin = () => { mode = state.armed ? 'paint' : 'select'; state.sel = new Set(); r.setPointerCapture(pid); apply(i); };
      if (e.pointerType === 'touch') { holdT = setTimeout(() => { begin(); if (navigator.vibrate) navigator.vibrate(8); }, 350); }
      else { if (e.shiftKey) { mode = 'select'; apply(i); mode = null; renderRasterBar(); return; } begin(); }
    });
    r.addEventListener('pointermove', (e) => {
      if (holdT && !mode) { clearTimeout(holdT); holdT = null; return; }
      if (!mode) return;
      const i = cellAt(e); if (i !== startI) moved = true; apply(i);
    });
    const end = (e) => {
      clearTimeout(holdT);
      const i = startI;
      if (!mode && e.type === 'pointerup' && i != null) { openDay(i); startI = null; return; }
      if (mode === 'paint' && !moved) { // a click with a program armed: open the day, do not repaint
        state.sel = new Set([i]); mode = null; openDay(i); return;
      }
      if (mode === 'paint') scheduleChanged(); else if (mode === 'select') { renderRasterBar(); }
      mode = null; startI = null;
    };
    r.addEventListener('pointerup', end); r.addEventListener('pointercancel', () => { clearTimeout(holdT); mode = null; });
    r.addEventListener('keydown', (e) => {
      const c = e.target.closest('.cell'); if (!c) return;
      let i = +c.dataset.i;
      const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (mv) { e.preventDefault(); i = clamp(i + mv, 0, DAYS - 1); state.focusDay = i; if (!e.shiftKey) state.sel = new Set([i]); else state.sel.add(i); renderRaster(); renderRasterBar(); $(`.cell[data-i="${i}"]`).focus(); }
      if ((e.key === 'p' || e.key === 'P') && state.armed) { state.sel.forEach(k => state.schedule[k] = state.armed); scheduleChanged(); }
      if (e.key === 'Enter') { e.preventDefault(); openDay(i); }
    });
  }
  function openDay(i) {
    state.focusDay = i; if (!state.sel.has(i) || state.sel.size > 1) state.sel = new Set([i]);
    $$('.cell').forEach(c => { const k = +c.dataset.i; c.classList.toggle('is-sel', state.sel.has(k)); c.classList.toggle('is-focus', k === i); c.tabIndex = k === i ? 0 : -1; });
    renderRasterBar(); renderEditor();
    if (!mq('(min-width: 1280px)')) openSheet('#daySheet');
  }
  function scheduleChanged() {
    LIVE = simulate(state.schedule);
    state.stale = true; markStale();
    renderTray(); renderRaster(); renderRasterBar(); renderPreview(); renderEditor();
  }
  function markStale() {
    $$('[data-run]').forEach(b => b.classList.toggle('is-stale', state.stale));
    $$('[data-stale-badge]').forEach(b => b.classList.toggle('on', state.stale));
    $$('.tabbar .stale').forEach(b => b.style.display = state.stale ? 'block' : 'none');
  }
  function renderPreview() {
    const svg = $('#pvSvg'); const W = svg.clientWidth || 600, H = 52;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const f = LIVE.fat.map(x => x[0]);
    const lo = Math.min(...f) - 0.3, hi = Math.max(...f) + 0.3;
    const X = (i) => (i + 0.5) / DAYS * W, Y = (v) => 4 + (1 - (v - lo) / (hi - lo)) * (H - 18);
    let s = '';
    LIVE.ket.forEach((k, i) => { const v = k[0]; if (v >= 0.3) s += `<rect x="${X(i) - W / DAYS / 2}" y="${H - 7}" width="${W / DAYS + 0.5}" height="6" fill="var(--lm-keto-${v >= 3 ? 3 : v >= 0.5 ? 2 : 1})"/>`; });
    s += `<path d="${f.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('')}" fill="none" stroke="var(--lm-cat-body)" stroke-width="1.5" stroke-linejoin="round"/>`;
    s += `<circle cx="${X(DAYS - 1)}" cy="${Y(f[DAYS - 1])}" r="3" fill="var(--lm-cat-body)" stroke="var(--lm-face)" stroke-width="2"/>`;
    svg.innerHTML = s;
    const kd = LIVE.ket.filter(k => k[0] >= 0.5).length;
    $('#pvCap').innerHTML = `<span><b>fat mass ${signed(f[DAYS - 1] - f[0])} kg</b> by day 84 · ketosis on <b>${kd}</b> days</span><span>preview, rounded · press Run for the full projection</span>`;
  }

  /* ---- day editor ---- */
  function clockSVG(p) {
    const S = 176, c = S / 2, R = 64;
    const pt = (hr, r) => { const a = (hr / 24) * Math.PI * 2 - Math.PI / 2; return [c + Math.cos(a) * r, c + Math.sin(a) * r]; };
    const arc = (h0, h1, r) => { const [x0, y0] = pt(h0, r), [x1, y1] = pt(h1, r); const large = ((h1 - h0 + 24) % 24) > 12 ? 1 : 0; return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`; };
    let s = `<svg class="clock" viewBox="0 0 ${S} ${S}" role="img" aria-label="${p.fast ? 'Water-only fast all day' : `Eating window ${p.win[0]}:00 to ${p.win[1]}:00`}">`;
    s += `<circle cx="${c}" cy="${c}" r="${R + 11}" fill="var(--lm-well)" stroke="var(--lm-line-strong)"/>`;
    s += `<circle cx="${c}" cy="${c}" r="${R - 9}" fill="var(--lm-face)" stroke="var(--lm-line)"/>`;
    for (let hr = 0; hr < 24; hr++) { const maj = hr % 6 === 0; const [x0, y0] = pt(hr, R + 11), [x1, y1] = pt(hr, R + (maj ? 3 : 7)); s += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${maj ? 'var(--lm-edge)' : 'var(--lm-line-strong)'}" stroke-width="1"/>`; }
    [0, 6, 12, 18].forEach(hr => { const [x, y] = pt(hr, R - 19); s += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="10" fill="var(--lm-ink-3)" font-stretch="84%">${String(hr).padStart(2, '0')}</text>`; });
    // sleep (inner)
    s += `<path d="${arc(23.5, 7, R - 13)}" stroke="var(--lm-cat-recovery)" stroke-opacity=".55" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    if (p.fast) {
      s += `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="var(--lm-ink)" stroke-width="12" stroke-opacity=".9"/>`;
    } else {
      s += `<path id="winArc" d="${arc(p.win[0], p.win[1], R)}" stroke="var(--lm-ink)" stroke-opacity=".16" stroke-width="12" fill="none" style="cursor:grab"/>`;
      [p.win[0], p.win[1]].forEach((hr, k) => { const [x, y] = pt(hr, R); s += `<circle class="wthumb" data-k="${k}" cx="${x}" cy="${y}" r="7" fill="var(--lm-raised)" stroke="var(--lm-edge)" style="cursor:grab"/><circle cx="${x}" cy="${y}" r="1.6" fill="var(--lm-ink)" pointer-events="none"/>`; });
      const m = macros(p);
      p.meals.forEach(([hr, share]) => { const [x, y] = pt(hr, R); s += `<circle cx="${x}" cy="${y}" r="${4 + share * 6}" fill="var(--lm-ink)" stroke="var(--lm-face)" stroke-width="2"/>`; });
      void m;
    }
    if (p.lift) s += `<path d="${arc(p.lift[0], p.lift[1], R + 17)}" stroke="var(--lm-cat-performance)" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    if (p.walk) s += `<path d="${arc(p.walk[0], p.walk[1], R + 17)}" stroke="var(--lm-cat-energy)" stroke-width="3.5" stroke-dasharray="1 4" fill="none" stroke-linecap="round"/>`;
    const fastH = p.fast ? p.fastH : 24 - (p.win[1] - p.win[0]);
    s += `<text x="${c}" y="${c - 2}" text-anchor="middle" font-size="17" font-weight="600" fill="var(--lm-ink)" font-stretch="112%">fast ${fastH} h</text>`;
    s += `<text x="${c}" y="${c + 15}" text-anchor="middle" font-size="11" fill="var(--lm-ink-2)">${p.fast ? 'ends Fri 08:00' : `${fastH}:${24 - fastH} · window ${24 - fastH} h`}</text>`;
    return s + '</svg>';
  }
  function editorHTML(i) {
    const k = state.schedule[i], p = PROGRAMS[k], m = macros(p);
    const t = m.pk + m.ck + m.fk || 1;
    const hh = (x) => `${String(Math.floor(x)).padStart(2, '0')}:${x % 1 ? '30' : '00'}`;
    const others = state.schedule.filter(x => x === k).length;
    return `<div class="ed-head">
        <div class="r1"><div class="grow"><div class="date">${dateLbl(i, true)}</div><div class="eng">day ${i + 1} of ${DAYS} · ${PHASES.find(ph => i >= ph.from && i <= ph.to).name}</div></div>
          <span class="chip"><b style="font-stretch:112%">${k}</b> ${p.name}</span>
          <button class="key key--quiet key--icon key--sm sheet-close" aria-label="Close">${icon('x')}</button></div>
        <div><span class="eng">edits apply to</span><div class="bank bank--sm bank--full" style="margin-top:4px" role="radiogroup" aria-label="Edit scope"><button aria-pressed="false">this day</button><button aria-pressed="false">this block</button><button aria-pressed="true">all ${others} ${k} days</button></div></div>
      </div>
      <div class="ed-sec" data-sec="energy"><h4>Energy<span class="grow"></span><span class="ed-sub">${p.fast ? `0 kcal · fast ${p.fastH} h, Wed 20:00 → Fri 08:00` : `${fmt(m.kcal, 0)} kcal · ${signed(m.kcal - M0, 0)} vs maintenance`}</span></h4><div data-slot="energy"></div>
        ${p.fast ? `<div class="banner banner--info">${icon('info', 'icon')}<b>Fasts over 24 h: keep fluids and salt up.</b><p>Aim for 2–3 L of water and about 2 g of sodium across the day. Break the fast with a protein-first meal.</p></div>` : ''}</div>
      <div class="ed-sec" data-sec="macros"><h4>Macros<span class="grow"></span><span class="ed-sub">${p.fast ? 'none on a fast day' : 'energy held constant'}</span></h4>
        <div data-slot="macros"></div>
        ${p.fast ? '' : `<div class="macrobar" aria-hidden="true"><i style="flex:${m.pk / t};background:var(--lm-macro-protein)"></i><i style="flex:${m.ck / t};background:var(--lm-macro-carbs)"></i><i style="flex:${m.fk / t};background:var(--lm-macro-fat)"></i></div>
        <div class="macro-legend"><span><i class="sw sw--sq" style="color:var(--lm-macro-protein)"></i>protein ${Math.round(m.pg)} g · ${Math.round(m.pk / t * 100)} %</span><span><i class="sw sw--sq" style="color:var(--lm-macro-carbs)"></i>net carbs ${Math.round(m.cg)} g · ${Math.round(m.ck / t * 100)} %</span><span><i class="sw sw--sq" style="color:var(--lm-macro-fat)"></i>fat ${Math.round(m.fg)} g · ${Math.round(m.fk / t * 100)} %</span><span>fibre ${p.fibre} g</span></div>`}
      </div>
      <div class="ed-sec"><h4>Meals &amp; window<span class="grow"></span><span class="ed-sub">drag the window</span></h4>
        <div class="clock-wrap"><div data-slot="clock">${clockSVG(p)}</div>
        <div class="meal-list">${p.fast ? '<div><i></i>No food · water, salt, black coffee</div><div><i></i>Fast began Wed 20:00</div>' : p.meals.map(([hr, sh]) => `<div><i></i>${hh(hr)} · ${fmt(m.kcal * sh, 0)} kcal</div>`).join('')}
          ${p.lift ? `<div><i class="tr"></i>${hh(p.lift[0])} lift · 60 min</div>` : ''}${p.walk ? `<div><i class="tr" style="background:var(--lm-cat-energy)"></i>${hh(p.walk[0])} walk · 90 min</div>` : ''}<div><i class="sl"></i>23:30 sleep · 7.5 h</div></div></div>
      </div>
      <div class="ed-sec"><h4>Exercise<span class="grow"></span><button class="key key--quiet key--sm">${icon('plus')}Add</button></h4>
        ${p.lift ? `<div class="session">${icon('lift', 'icon')}<div><b>Resistance · upper / lower split</b><span>16 hard sets · RIR 1–2 · 17:30</span></div><span class="eng">60 min</span></div>` : ''}
        <div class="session">${icon('walk', 'icon')}<div><b>Steps</b><span>${fmt(p.steps, 0)} a day${p.walk ? ' · incl. 90 min walk' : ''}</span></div><span class="eng">${p.steps >= 10000 ? 'high' : 'typical'}</span></div>
      </div>`;
  }
  function mountEditorControls(root, i) {
    const k = state.schedule[i], p = PROGRAMS[k];
    const refresh = () => { LIVE = simulate(state.schedule); state.stale = true; markStale(); $$('.cell').forEach(c => styleCell(c, +c.dataset.i)); renderPreview(); renderTray(); };
    if (!p.fast) {
      const zones = [[40, 65, 'var(--lm-energy-deficit-4)'], [65, 80, 'var(--lm-energy-deficit-3)'], [80, 90, 'var(--lm-energy-deficit-2)'], [90, 99, 'var(--lm-energy-deficit-1)'], [101, 110, 'var(--lm-energy-surplus-1)'], [110, 120, 'var(--lm-energy-surplus-2)'], [120, 135, 'var(--lm-energy-surplus-3)'], [135, 140, 'var(--lm-energy-surplus-4)']];
      const en = scaleSlider({ label: '% of maintenance', min: 40, max: 140, step: 1, value: Math.round(p.pct * 100), minor: 5, major: 20, zones, ref: 100, refLabel: 'maintenance',
        nums: [[40, '40'], [60, '60'], [80, '80'], [100, 'maint.'], [120, '120'], [140, '140']], format: v => `${v}<span class="unit">%</span>`, valuetext: v => `${v} percent of maintenance`,
        onInput: v => { p.pct = v / 100; $('[data-sec="energy"] .ed-sub', root).textContent = `${fmt(p.pct * M0, 0)} kcal · ${signed(p.pct * M0 - M0, 0)} vs maintenance`; },
        onChange: () => { refresh(); renderEditor(); } });
      $('[data-slot="energy"]', root).appendChild(en.el);
      const prot = scaleSlider({ label: 'protein', min: 0.8, max: 3.2, step: 0.1, value: p.prot, minor: 0.1, major: 0.4, small: true, ref: 1.6, refLabel: 'muscle-retention floor',
        zones: [[0.8, 1.2, 'var(--lm-caution-bg)']], format: v => `${v.toFixed(1)}<span class="unit">g/kg · ${Math.round(v * BW)} g</span>`, onChange: v => { p.prot = v; refresh(); renderEditor(); } });
      const carbs = scaleSlider({ label: 'net carbs', min: 0, max: 400, step: 5, value: p.carbs, minor: 10, major: 50, small: true, ref: 50, refLabel: 'ketosis likely below',
        format: v => `${v}<span class="unit">g</span>`, onChange: v => { p.carbs = v; refresh(); renderEditor(); } });
      $('[data-slot="macros"]', root).append(prot.el, carbs.el);
      const fat = h('div', { class: 'scale-top' }, `<span class="eng" style="flex:1">fat · takes the remaining energy</span><span class="v">${Math.round(macros(p).fg)}<span class="unit">g</span></span>`);
      $('[data-slot="macros"]', root).appendChild(fat);
      // clock drag: move the window
      const svg = $('.clock', root);
      let drag = null;
      const toHour = (e) => { const r = svg.getBoundingClientRect(); const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2; let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += Math.PI * 2; return a / (Math.PI * 2) * 24; };
      svg.addEventListener('pointerdown', (e) => { const th = e.target.closest('.wthumb'); if (!th && e.target.id !== 'winArc') return; drag = { k: th ? +th.dataset.k : 'move', h0: toHour(e), w0: [...p.win] }; svg.setPointerCapture(e.pointerId); });
      svg.addEventListener('pointermove', (e) => {
        if (!drag) return; let d = toHour(e) - drag.h0; if (d > 12) d -= 24; if (d < -12) d += 24; d = Math.round(d * 2) / 2;
        if (drag.k === 'move') p.win = [clamp(drag.w0[0] + d, 0, 24 - (drag.w0[1] - drag.w0[0])), 0].map((v, j) => j ? v + (drag.w0[1] - drag.w0[0]) : v);
        else { const w = [...drag.w0]; w[drag.k] = clamp(w[drag.k] + d, drag.k ? w[0] + 2 : 0, drag.k ? 24 : w[1] - 2); p.win = w; }
        const span = p.win[1] - p.win[0]; p.meals = p.meals.map(([hr, sh], j, arr) => [p.win[0] + 0.5 + (span - 1) * (arr.length === 1 ? 0.5 : j / (arr.length - 1)), sh]);
        $('[data-slot="clock"]', root).innerHTML = clockSVG(p); svgRebind();
      });
      const svgRebind = () => { const ns = $('.clock', root); if (ns !== svg) { ns.replaceWith(svg); svg.innerHTML = $('.clock', h('div', {}, clockSVG(p))).innerHTML; $('[data-slot="clock"]', root).innerHTML = ''; $('[data-slot="clock"]', root).appendChild(svg); } };
      svg.addEventListener('pointerup', () => { if (drag) { drag = null; refresh(); } });
    }
    $$('.sheet-close', root).forEach(b => b.addEventListener('click', closeSheets));
  }
  function renderEditor() {
    const i = state.focusDay;
    const dock = $('#editorFace'); dock.innerHTML = editorHTML(i); mountEditorControls(dock, i);
    const sb = $('#sheetBody'); sb.innerHTML = editorHTML(i); mountEditorControls(sb, i);
  }
  function renderSchedule() {
    renderTray(); renderRaster(); renderRasterBar(); renderEditor();
    requestAnimationFrame(renderPreview);
  }

  /* sheets */
  function openSheet(sel) { const s = $(sel); s.classList.add('open'); s.setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('open'); }
  function closeSheets() { $$('.sheet').forEach(s => { s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); }); $('#scrim').classList.remove('open'); }
  $('#scrim').addEventListener('click', closeSheets);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheets(); if (chartState.focusLane && chartState.view === 'focus') { /* keep */ } } });

  /* ------------------------------------------------------------------------
     RESULTS — readout strip, channel stack, overlay, focus, crosshair
     ------------------------------------------------------------------------ */
  const LANES = [
    { id: 'fat', name: 'Fat mass', unit: 'kg', cat: 'body', grade: 'A', dec: 1 },
    { id: 'lean', name: 'Lean mass', unit: 'kg', cat: 'body', grade: 'B', dec: 1 },
    { id: 'weight', name: 'Scale weight', unit: 'kg', cat: 'body', grade: 'A', dec: 1 },
    { id: 'glyc', name: 'Glycogen', unit: 'g', cat: 'fuel', grade: 'B', dec: 0 },
    { id: 'ket', name: 'Blood ketones', unit: 'mmol/L', cat: 'fuel', grade: 'B', dec: 2, thr: [[0.5, 'nutritional ketosis']] },
    { id: 'tdee', name: 'Energy expenditure', unit: 'kcal/d', cat: 'energy', grade: 'A', dec: 0 },
    { id: 'adapt', name: 'Metabolic adaptation', unit: 'kcal/d', cat: 'energy', grade: 'B', dec: 0, zero: true },
    { id: 'autoph', name: 'Autophagy signal', unit: 'index', cat: 'cellular', grade: 'D', dec: 0 },
    { id: 'insulin', name: 'Insulin sensitivity', unit: 'index', cat: 'cardio', grade: 'B', dec: 0 },
    { id: 'hunger', name: 'Hunger pressure', unit: 'index', cat: 'hormones', grade: 'C', dec: 0 },
  ];
  const CATS = { body: 'body composition', fuel: 'fuel & ketosis', energy: 'energy & metabolism', cellular: 'cellular signalling', performance: 'performance', recovery: 'recovery & wellbeing', cardio: 'cardiometabolic', hormones: 'hormones & appetite' };
  const OVERLAY = [['fat', 'pct', 1], ['lean', 'pct', 2], ['tdee', 'pct', 1], ['insulin', 'pts', 1], ['hunger', 'pts', 1]];
  // overlay compares direction and timing: 7-day centred mean when the window spans > 21 days (CHART_SPEC §5.3)
  const smooth7 = (arr) => arr.map((_, i) => { let a = 0, n = 0; for (let k = i - 3; k <= i + 3; k++) if (k >= 0 && k < arr.length) { a += arr[k]; n++; } return a / n; });
  const DASH = { 1: '', 2: '7 4', 3: '1.5 3.5' };
  const gradeHTML = (g) => { const n = { A: 4, B: 3, C: 2, D: 1 }[g]; return `<span class="grade grade--${g}" title="Evidence grade ${g}">${g}<i>${[0, 1, 2, 3].map(k => `<b class="${k < n ? '' : 'off'}"></b>`).join('')}</i></span>`; };
  const chartState = { view: 'lanes', x0: 0, x1: DAYS - 1, xi: null, pinned: false, focusLane: 'fat' };

  function renderStrip() {
    const R = RUN, L = DAYS - 1;
    const p0 = avatarParams({ weightKg: R.base.weight, bodyFatPct: R.base.fat / R.base.weight * 100 });
    const p1 = avatarParams({ weightKg: R.weight[L][0], bodyFatPct: R.fat[L][0] / R.weight[L][0] * 100 });
    const w0 = A.waistGirth(p0), w1 = A.waistGirth(p1);
    const items = [
      ['Fat mass', 'body', R.fat, 'kg', 1],
      ['Lean mass', 'body', R.lean, 'kg', 1],
      ['Scale weight', 'body', R.weight, 'kg', 1],
      ['Waist', 'body', [[w0, w0 - 2, w0 + 2], [w1, w1 - 3.5, w1 + 3.5]], 'cm', 1],
      ['Maintenance', 'energy', R.tdee, 'kcal', 0],
    ];
    const baseOf = { 'Fat mass': R.base.fat, 'Lean mass': R.base.lean, 'Scale weight': R.base.weight, 'Maintenance': R.base.tdee };
    $('#strip').innerHTML = items.map(([n, cat, s, u, d]) => {
      const a = baseOf[n] != null ? baseOf[n] : s[0][0], e = s[s.length - 1];
      const lo = e[1], hi = e[2], span = hi - lo;
      return `<div class="it"><span class="nm"><i class="sw" style="color:var(--lm-cat-${cat})"></i><span class="eng">${n.toLowerCase()}</span></span>
        <span class="se"><span class="from">${fmt(a, d)}</span><span class="arr">→</span>${fmt(e[0], d)}<span class="unit">${u}</span></span>
        <span class="dl">${signed(e[0] - a, d)} ${u}</span>
        <span class="rangebar">${rangeBarSVG(lo, hi, e[0], Math.min(lo, a) - span * 0.4, Math.max(hi, a) + span * 0.4, a)}likely ${fmt(lo, d)}–${fmt(hi, d)}</span></div>`;
    }).join('');
  }

  // domain hugs the data; ticks are nice values inside it (2–3 of them)
  function niceTicks(lo, hi) {
    const span = hi - lo || 1;
    const cands = [];
    for (let e = Math.floor(Math.log10(span)) - 2; e <= Math.floor(Math.log10(span)) + 1; e++) [1, 2, 2.5, 5].forEach(m => cands.push(m * Math.pow(10, e)));
    cands.sort((x, y) => x - y);
    for (const st of cands) {
      const first = Math.ceil(lo / st) * st; const n = Math.floor((hi - first) / st + 1e-9) + 1;
      if (n <= 3 && n >= 2) { const ticks = []; for (let k = 0; k < n; k++) ticks.push(+(first + k * st).toFixed(6)); return { lo, hi, ticks, step: st }; }
    }
    return { lo, hi, ticks: [lo, (lo + hi) / 2, hi], step: span / 2 };
  }
  function laneDims() {
    const mob = !mq('(min-width: 768px)');
    return { h: mob ? 64 : 72, inputs: mob ? 60 : 72, focus: mob ? 220 : 280, strip: 26, mob };
  }
  function plotWidth() { const b = $('#cbody'); const gut = mq('(min-width: 1024px)') ? 168 : mq('(min-width: 768px)') ? 150 : 0; return Math.max(200, b.clientWidth - gut); }
  // left padding reserves a column for y-tick labels so they never sit on data
  function xScale(W) { const n = chartState.x1 - chartState.x0 + 1; const pl = W < 500 ? 26 : 32, pr = 8; return { X: (i) => pl + (i - chartState.x0 + 0.5) / n * (W - pl - pr), slot: (W - pl - pr) / n, n, pad: pl }; }

  function phaseLayer(svg, W, H, xs) {
    PHASES.forEach((ph, k) => {
      const a = Math.max(ph.from, chartState.x0), b = Math.min(ph.to, chartState.x1); if (a > b) return;
      const x0 = xs.X(a) - xs.slot / 2, x1 = xs.X(b) + xs.slot / 2;
      if (k % 2 === 1) el('rect', { x: x0, y: 0, width: x1 - x0, height: H, class: 'phase-alt' }, svg);
      if (ph.from > chartState.x0 && ph.from <= chartState.x1) el('line', { x1: x0, x2: x0, y1: 0, y2: H, class: 'phase-b' }, svg);
    });
  }
  function seriesOf(id) { return RUN[id]; }

  function laneRow(lane, H, mode) {
    const W = plotWidth(), xs = xScale(W);
    const row = h('div', { class: 'crow lane', 'data-lane': lane.id });
    const s = seriesOf(lane.id);
    const cur = chartState.xi != null ? s[chartState.xi][0] : s[chartState.x1][0];
    const collapsed = mode === 'strip';
    row.innerHTML = `<div class="gut" role="button" tabindex="0" aria-label="Explain ${lane.name}">
        <span class="nm"><i class="sw" style="color:var(--lm-cat-${lane.cat})"></i><span class="t">${lane.name}</span></span>
        ${collapsed ? '' : `<span class="meta">${gradeHTML(lane.grade)}${lane.unit}${lane.grade === 'D' ? ' · exploratory' : ''}</span>`}
        <span class="val" data-val>${fmt(cur, lane.dec)}<span class="unit">${lane.unit === 'index' ? '' : lane.unit}</span></span></div>
      <div class="plot"></div>`;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' });
    const vis = s.slice(chartState.x0, chartState.x1 + 1);
    let lo = Math.min(...vis.map(v => v[1])), hi = Math.max(...vis.map(v => v[2]));
    if (lane.thr) { lane.thr.forEach(t => { hi = Math.max(hi, t[0] * 1.2); }); lo = 0; }
    const pad = (hi - lo) * 0.1; lo -= lane.thr ? 0 : pad; hi += pad;
    if (lane.unit === 'index') { lo = Math.max(0, lo); hi = Math.min(100, hi); }
    const nt = niceTicks(lo, hi);
    const top = collapsed ? 3 : 8, bot = collapsed ? 3 : 8;
    const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bot);
    svg._pl = xs.pad;
    phaseLayer(svg, W, H, xs);
    if (!collapsed) nt.ticks.forEach(t => el('line', { x1: xs.pad - 2, x2: W, y1: Math.round(Y(t)) + 0.5, y2: Math.round(Y(t)) + 0.5, class: 'grid-l' }, svg));
    if (lane.zero && lo < 0 && hi > 0) el('line', { x1: 0, x2: W, y1: Math.round(Y(0)) + 0.5, y2: Math.round(Y(0)) + 0.5, class: 'base-l' }, svg);
    const col = `var(--lm-cat-${lane.cat})`;
    const idx = []; for (let i = chartState.x0; i <= chartState.x1; i++) idx.push(i);
    if (!collapsed) {
      const up = idx.map(i => `${xs.X(i).toFixed(1)},${Y(s[i][2]).toFixed(1)}`), dn = idx.slice().reverse().map(i => `${xs.X(i).toFixed(1)},${Y(s[i][1]).toFixed(1)}`);
      el('path', { d: `M${up.join('L')}L${dn.join('L')}Z`, class: 'band', fill: col, 'fill-opacity': 'var(--lm-chart-band-alpha)', style: `fill-opacity:var(--lm-chart-band-alpha)` }, svg);
    }
    (lane.thr || []).forEach(([v, t]) => { if (v < lo || v > hi || collapsed) return; const y = Math.round(Y(v)) + 0.5; el('line', { x1: 0, x2: W, y1: y, y2: y, class: 'thr-l' }, svg); const tx = el('text', { x: W - 6, y: y - 4, 'text-anchor': 'end', class: 'thr-t' }, svg); tx.textContent = `${v} · ${t}`; });
    el('path', { d: 'M' + idx.map(i => `${xs.X(i).toFixed(1)},${Y(s[i][0]).toFixed(1)}`).join('L'), class: 'ser', stroke: col, 'stroke-width': collapsed ? 1.5 : 2, style: collapsed ? 'opacity:var(--lm-chart-dim-alpha)' : '' }, svg);
    if (!collapsed) {
      if (chartState.x0 === 0) el('circle', { cx: xs.X(0), cy: Y(s[0][0]), r: 4, fill: col, class: 'enddot' }, svg);
      // y ticks inside plot, on pills
      const dec = nt.step < 0.1 ? 2 : nt.step < 1 ? 1 : 0;
      nt.ticks.forEach((t) => {
        const y = clamp(Y(t) + 3.5, 11, H - 2);
        const txt = fmt(t, dec);
        const tx = el('text', { x: svg._pl - 5, y, class: 'ax-t', 'text-anchor': 'end' }, svg); tx.textContent = txt;
      });
    }
    el('circle', { r: 4, class: 'xdot', fill: col, 'data-dot': lane.id }, svg);
    svg._Y = Y; svg._xs = xs;
    $('.plot', row).appendChild(svg);
    $('.gut', row).addEventListener('click', () => openExplain(lane.id));
    $('.gut', row).addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openExplain(lane.id); } });
    return row;
  }

  function rulerRow() {
    const W = plotWidth(), xs = xScale(W), H = 28;
    const row = h('div', { class: 'crow ruler' }, `<div class="gut">${laneDims().mob ? '' : 'schedule blocks'}</div><div class="plot"></div>`);
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    phaseLayer(svg, W, H, xs);
    PHASES.forEach((ph) => {
      const a = Math.max(ph.from, chartState.x0), b = Math.min(ph.to, chartState.x1); if (a > b) return;
      const x0 = xs.X(a) - xs.slot / 2 + 6, w = (b - a + 1) * xs.slot - 10;
      const t = el('text', { x: x0, y: 17, class: 'ph-t' }, svg);
      const full = ph.name, short = ph.name.split(' ')[0];
      t.textContent = w > full.length * 6.4 ? full : w > short.length * 6.4 ? short : '';
    });
    $('.plot', row).appendChild(svg); return row;
  }
  function eventsRow() {
    const W = plotWidth(), xs = xScale(W), H = 22;
    const row = h('div', { class: 'crow events' }, `<div class="gut">${laneDims().mob ? '' : 'ketosis · events'}</div><div class="plot"></div>`);
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    phaseLayer(svg, W, H, xs);
    for (let i = chartState.x0; i <= chartState.x1; i++) {
      const k = RUN.ket[i][0]; if (k < 0.3) continue;
      el('rect', { x: xs.X(i) - xs.slot / 2, y: 7, width: xs.slot + 0.4, height: 8, fill: `var(--lm-keto-${k >= 3 ? 3 : k >= 0.5 ? 2 : 1})` }, svg);
    }
    RUN.events.filter(e => e.type === 'caution' && e.i >= chartState.x0 && e.i <= chartState.x1).forEach(e => {
      const g = el('g', { transform: `translate(${xs.X(e.i)} 11)` }, svg);
      el('circle', { r: 7, fill: 'var(--lm-face)' }, g);
      el('path', { d: 'M0,-5 L5.2,4 L-5.2,4 Z', fill: 'var(--lm-caution-mark)', stroke: 'var(--lm-face)', 'stroke-width': 1 }, g);
    });
    $('.plot', row).appendChild(svg); return row;
  }
  function inputsRow(H) {
    const W = plotWidth(), xs = xScale(W);
    const row = h('div', { class: 'crow lane', 'data-lane': 'intake' });
    const cur = RUN.intake[chartState.xi != null ? chartState.xi : chartState.x1];
    row.innerHTML = `<div class="gut"><span class="nm"><span class="t">Intake</span></span><span class="meta">kcal/d · <i class="sw sw--sq" style="color:var(--lm-macro-protein)"></i>P <i class="sw sw--sq" style="color:var(--lm-macro-carbs)"></i>C <i class="sw sw--sq" style="color:var(--lm-macro-fat)"></i>F</span><span class="val" data-val>${fmt(cur.p + cur.c + cur.f, 0)}<span class="unit">kcal</span></span></div><div class="plot"></div>`;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    phaseLayer(svg, W, H, xs);
    const max = 2900, base = H - 12, Y = (v) => base - v / max * (base - 6);
    const bw = Math.min(24, Math.max(2, xs.slot * 0.72));
    el('line', { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, class: 'base-l' }, svg);
    for (let i = chartState.x0; i <= chartState.x1; i++) {
      const d = RUN.intake[i], x = xs.X(i) - bw / 2;
      if (d.fast) { el('rect', { x: xs.X(i) - 1, y: base - 5, width: 2, height: 5, fill: 'var(--lm-ink)' }, svg); }
      let y = base;
      [['p', 'protein'], ['c', 'carbs'], ['f', 'fat']].forEach(([k, n], j) => {
        const hgt = d[k] / max * (base - 6); if (hgt <= 0) return;
        const gap = j > 0 ? 1 : 0;
        const r = el('rect', { x, y: y - hgt + gap, width: bw, height: Math.max(0.5, hgt - gap), fill: `var(--lm-macro-${n})`, class: 'mb' }, svg);
        if (j === 2 && bw >= 6) r.setAttribute('rx', 0);
        y -= hgt;
      });
      if (d.train) el('rect', { x: xs.X(i) - 2, y: base + 4, width: 4, height: 4, rx: 1, fill: 'var(--lm-cat-performance)' }, svg);
      if (d.walk) el('path', { d: `M${xs.X(i) - 2.5},${base + 8.5} L${xs.X(i)},${base + 3.5} L${xs.X(i) + 2.5},${base + 8.5} Z`, fill: 'var(--lm-cat-energy)' }, svg);
    }
    // maintenance step line
    let dpath = '';
    for (let i = chartState.x0; i <= chartState.x1; i++) { const x0 = xs.X(i) - xs.slot / 2, x1 = xs.X(i) + xs.slot / 2, y = Y(RUN.intake[i].mt); dpath += (i === chartState.x0 ? 'M' : 'L') + x0.toFixed(1) + ',' + y.toFixed(1) + 'L' + x1.toFixed(1) + ',' + y.toFixed(1); }
    el('path', { d: dpath, fill: 'none', stroke: 'var(--lm-ink)', 'stroke-width': 1.5 }, svg);
    const lt = el('text', { x: W - 6, y: Y(RUN.intake[chartState.x1].mt) - 4, 'text-anchor': 'end', class: 'thr-t', style: 'fill:var(--lm-ink-2)' }, svg); lt.textContent = 'maintenance';
    el('rect', { x: 0, y: 0, width: 0, height: 0, 'data-dot': 'intake' }, svg);
    $('.plot', row).appendChild(svg); return row;
  }
  function xaxisRow() {
    const W = plotWidth(), xs = xScale(W), H = 24;
    const row = h('div', { class: 'crow xaxis' }, '<div class="gut"></div><div class="plot"></div>');
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const n = chartState.x1 - chartState.x0 + 1;
    const every = n <= 7 ? 1 : n <= 28 ? 7 : (W < 500 ? 21 : 7);
    for (let i = chartState.x0; i <= chartState.x1; i++) {
      if (n > 7 && (i % every) !== 0) continue;
      const x = xs.X(i) - (n > 7 ? xs.slot / 2 : 0);
      el('line', { x1: x, x2: x, y1: 0, y2: 4, class: 'base-l' }, svg);
      const t = el('text', { x: x + (n > 7 ? 3 : 0), y: 15, class: 'wk-t', 'text-anchor': n > 7 ? 'start' : 'middle' }, svg);
      t.textContent = n <= 7 ? dateLbl(i, true).slice(0, 6) : `wk ${Math.floor(i / 7) + 1} · ${dateLbl(i)}`;
      if (n > 7 && W < 500) t.textContent = `wk ${Math.floor(i / 7) + 1}`;
    }
    $('.plot', row).appendChild(svg); return row;
  }
  function overlayBlock() {
    const mob = laneDims().mob;
    const W = plotWidth(), H = mob ? 300 : 360, labW = mob ? 96 : 176;
    const smoothOn = chartState.x1 - chartState.x0 + 1 > 21;
    const xs0 = xScale(W - labW);
    const wrap = h('div', {});
    const leg = h('div', { class: 'legend-row' });
    const row = h('div', { class: 'crow lane' }, `<div class="gut"><span class="nm"><span class="t">Change from start</span></span><span class="meta">% or index points</span><span class="eng" style="margin-top:6px">7-day average. Ketones vary ten-fold, so they stay in lanes.</span></div><div class="plot"></div>`);
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const ser = OVERLAY.map(([id, tr, dash]) => {
      const lane = LANES.find(l => l.id === id), s = RUN[id], v0 = s[0][0];
      const f = tr === 'pct' ? (v) => (v - v0) / Math.abs(v0) * 100 : (v) => v - v0;
      const raw = s.map(v => f(v[0]));
      return { lane, dash, pts: smoothOn ? smooth7(raw) : raw, tr };
    });
    let lo = 0, hi = 0;
    ser.forEach(S => S.pts.slice(chartState.x0, chartState.x1 + 1).forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    const nt = niceTicks(lo - 1.5, hi + 1.5);
    const Y = (v) => 12 + (1 - (v - nt.lo) / (nt.hi - nt.lo)) * (H - 24);
    phaseLayer(svg, W - labW, H, xs0);
    nt.ticks.forEach(t => { const y = Math.round(Y(t)) + 0.5; el('line', { x1: 0, x2: W - labW, y1: y, y2: y, class: 'grid-l' }, svg); const tx = el('text', { x: xs0.pad - 5, y: y + 3.5, class: 'ax-t', 'text-anchor': 'end' }, svg); tx.textContent = (t > 0 ? '+' : '') + fmt(t, 0); });
    el('line', { x1: 0, x2: W - labW, y1: Math.round(Y(0)) + 0.5, y2: Math.round(Y(0)) + 0.5, class: 'base-l', style: 'stroke:var(--lm-ink-3)' }, svg);
    const ends = [];
    ser.forEach(S => {
      const col = `var(--lm-cat-${S.lane.cat})`;
      const idx = []; for (let i = chartState.x0; i <= chartState.x1; i++) idx.push(i);
      el('path', { d: 'M' + idx.map(i => `${xs0.X(i).toFixed(1)},${Y(S.pts[i]).toFixed(1)}`).join('L'), class: 'ser', stroke: col, 'stroke-dasharray': DASH[S.dash], 'data-ov': S.lane.id }, svg);
      const ex = xs0.X(chartState.x1), ey = Y(S.pts[chartState.x1]);
      if (S.dash === 2) el('rect', { x: ex - 4, y: ey - 4, width: 8, height: 8, fill: col, class: 'enddot' }, svg);
      else el('circle', { cx: ex, cy: ey, r: 4, fill: col, class: 'enddot' }, svg);
      ends.push({ S, y: ey, ex, col });
      const chip = h('span', { class: 'chip' }, `<svg width="16" height="8" aria-hidden="true"><line x1="1" x2="15" y1="4" y2="4" stroke="${col}" stroke-width="2" stroke-dasharray="${DASH[S.dash] ? '4 2.5' : ''}"/></svg>${S.lane.name} <span class="muted">${S.tr === 'pct' ? '%' : 'pts'}</span>`);
      leg.appendChild(chip);
    });
    // end labels with collision relaxation
    ends.sort((a, b) => a.y - b.y);
    const minGap = 13;
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < minGap) ends[k].ly = (ends[k - 1].ly || ends[k - 1].y) + minGap;
    ends.forEach(e => { e.ly = Math.max(e.ly || e.y, (e.ly || e.y)); });
    ends.forEach(e => {
      const ly = e.ly || e.y;
      if (Math.abs(ly - e.y) > 1) el('path', { d: `M${e.ex + 6},${e.y} L${e.ex + 12},${ly}`, stroke: 'var(--lm-line-strong)', fill: 'none' }, svg);
      const v = e.S.pts[chartState.x1];
      const tv = el('text', { x: e.ex + 14, y: ly + 4, class: 'olbl' }, svg);
      tv.textContent = (v > 0 ? '+' : '') + fmt(v, 1) + (e.S.tr === 'pct' ? ' %' : '');
      const t = el('text', { x: e.ex + 14 + 52, y: ly + 4, class: 'olbl-v' }, svg);
      t.textContent = mob ? e.S.lane.name.split(' ')[0].toLowerCase() : e.S.lane.name.toLowerCase();
    });
    svg._ov = { ser, Y, xs: xs0 };
    $('.plot', row).appendChild(svg);
    wrap.append(leg, row);
    return wrap;
  }

  function renderChart() {
    const body = $('#cbody'); body.innerHTML = '';
    const d = laneDims();
    body.appendChild(rulerRow());
    body.appendChild(eventsRow());
    if (chartState.view === 'overlay') {
      body.appendChild(overlayBlock());
    } else {
      body.appendChild(inputsRow(d.inputs));
      let lastCat = null;
      LANES.forEach(l => {
        if (l.cat !== lastCat) { lastCat = l.cat; body.appendChild(h('div', { class: 'crow ghead' }, `<div class="gh"><i class="sw sw--sq" style="color:var(--lm-cat-${l.cat})"></i>${CATS[l.cat]}</div>`)); }
        const mode = chartState.view === 'focus' ? (l.id === chartState.focusLane ? 'focus' : 'strip') : 'lane';
        body.appendChild(laneRow(l, mode === 'focus' ? d.focus : mode === 'strip' ? d.strip : d.h, mode));
      });
    }
    body.appendChild(xaxisRow());
    body.appendChild(h('div', { class: 'xh', id: 'xh' }));
    body.appendChild(h('div', { class: 'sweep', id: 'sweep' }));
    if (chartState.xi != null) moveCrosshair(chartState.xi);
  }

  function crosshairX(i) {
    const W = plotWidth(), xs = chartState.view === 'overlay' ? xScale(W - (laneDims().mob ? 96 : 176)) : xScale(W);
    const gut = mq('(min-width: 1024px)') ? 168 : mq('(min-width: 768px)') ? 150 : 0;
    return gut + xs.X(i);
  }
  function moveCrosshair(i) {
    i = clamp(i, chartState.x0, chartState.x1);
    chartState.xi = i;
    const xh = $('#xh'); if (!xh) return;
    xh.style.left = crosshairX(i) + 'px'; xh.classList.add('on');
    $$('#cbody svg').forEach(svg => {
      const dot = svg.querySelector('.xdot');
      if (dot && svg._Y) { const id = dot.dataset.dot; const s = RUN[id]; dot.setAttribute('cx', svg._xs.X(i)); dot.setAttribute('cy', svg._Y(s[i][0])); dot.classList.add('on'); }
    });
    $$('#cbody .crow.lane').forEach(row => {
      const id = row.dataset.lane, v = $('[data-val]', row); if (!v) return;
      if (id === 'intake') { const d = RUN.intake[i]; v.innerHTML = `${d.fast ? '0' : fmt(d.p + d.c + d.f, 0)}<span class="unit">kcal</span>`; return; }
      const lane = LANES.find(l => l.id === id); if (!lane) return;
      v.innerHTML = `${fmt(RUN[id][i][0], lane.dec)}<span class="unit">${lane.unit === 'index' ? '' : lane.unit}</span>`;
    });
    updateTip(i);
    drawMorph(i);
  }
  function updateTip(i) {
    const tip = $('#tip'), mt = $('#mtip');
    const ph = PHASES.find(p => i >= p.from && i <= p.to);
    const k = state.schedule[i];
    const evs = RUN.events.filter(e => e.i === i);
    const list = chartState.view === 'overlay' ? OVERLAY.map(o => LANES.find(l => l.id === o[0])) : LANES;
    const rows = list.map(l => { const s = RUN[l.id][i]; return `<div class="tr"><i style="background:var(--lm-cat-${l.cat})"></i><b>${fmt(s[0], l.dec)}<span class="unit">${l.unit === 'index' ? '' : l.unit}</span></b><span>${l.name} · ${fmt(s[1], l.dec)}–${fmt(s[2], l.dec)}</span></div>`; }).join('');
    const d = RUN.intake[i];
    tip.innerHTML = `<div class="th"><b>${dateLbl(i, true)} · day ${i + 1}</b><span>${ph.name}</span></div>
      <div class="tr"><i style="background:var(--lm-ink)"></i><b>${d.fast ? '0' : fmt(d.p + d.c + d.f, 0)}<span class="unit">kcal</span></b><span>intake · ${k} ${PROGRAMS[k].name}</span></div>${rows}
      ${evs.length ? `<div class="ev">${evs.map(e => e.label).join(' · ')}</div>` : ''}`;
    mt.innerHTML = `<b>${dateLbl(i, true)} · day ${i + 1}</b> · ${ph.name} · ${k} ${PROGRAMS[k].name}<div class="vals">${list.map(l => `<span><i style="background:var(--lm-cat-${l.cat})"></i>${l.name.split(' ')[0].toLowerCase()} <b>${fmt(RUN[l.id][i][0], l.dec)}</b></span>`).join('')}</div>`;
  }
  function placeTip(e) {
    const tip = $('#tip'), chart = $('#chart'); const r = chart.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const tw = tip.offsetWidth || 240, th = tip.offsetHeight || 200;
    let left = x + 18; if (left + tw > r.width - 8) left = x - tw - 18;
    let top = clamp(y - th / 2, 50, Math.max(50, r.height - th - 10));
    tip.style.left = left + 'px'; tip.style.top = top + 'px'; tip.classList.add('on');
  }
  let chartBound = false;
  function bindChart() {
    if (chartBound) return; chartBound = true;
    const body = $('#cbody');
    const idxFromEvent = (e) => {
      const r = body.getBoundingClientRect();
      const gut = mq('(min-width: 1024px)') ? 168 : mq('(min-width: 768px)') ? 150 : 0;
      const W = plotWidth();
      const xs = chartState.view === 'overlay' ? xScale(W - (laneDims().mob ? 96 : 176)) : xScale(W);
      const x = e.clientX - r.left - gut;
      if (x < 0) return null;
      return clamp(Math.round((x - xs.pad) / xs.slot - 0.5) + chartState.x0, chartState.x0, chartState.x1);
    };
    let touchStart = null;
    body.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (!touchStart) return;
        if (!touchStart.h) { const dx = Math.abs(e.clientX - touchStart.x), dy = Math.abs(e.clientY - touchStart.y); if (dx > 8 && dx > dy) touchStart.h = true; else return; }
      }
      const i = idxFromEvent(e); if (i == null) return;
      if (chartState.pinned && e.pointerType !== 'touch') return;
      moveCrosshair(i); if (e.pointerType !== 'touch') placeTip(e);
    });
    body.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { touchStart = { x: e.clientX, y: e.clientY, h: false }; const i = idxFromEvent(e); if (i != null) moveCrosshair(i); } });
    body.addEventListener('pointerup', () => { touchStart = null; });
    body.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') $('#tip').classList.remove('on'); });
    body.addEventListener('click', (e) => {
      if (e.target.closest('.gut')) return;
      const i = idxFromEvent(e); if (i == null) return;
      chartState.pinned = !chartState.pinned;
      const pin = $('#pinned'); pin.style.display = chartState.pinned ? 'inline-flex' : 'none'; $('span', pin).textContent = `pinned · ${dateLbl(i, true)}`;
      moveCrosshair(i);
    });
    body.tabIndex = 0; body.setAttribute('aria-label', 'Projection chart. Use left and right arrows to move the crosshair.');
    body.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 7 : 1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); moveCrosshair((chartState.xi ?? chartState.x1) + (e.key === 'ArrowRight' ? step : -step)); }
      if (e.key === 'f' || e.key === 'F') setView('focus');
      if (e.key === 'Escape' && chartState.view === 'focus') setView('lanes');
    });
    $$('#viewBank button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('#zoomBank button').forEach(b => b.addEventListener('click', () => {
      pressIn(b); const n = +b.dataset.z; const c = chartState.xi ?? Math.floor(DAYS / 2);
      if (n >= DAYS) { chartState.x0 = 0; chartState.x1 = DAYS - 1; } else { chartState.x0 = clamp(c - Math.floor(n / 2), 0, DAYS - n); chartState.x1 = chartState.x0 + n - 1; }
      renderChart();
    }));
    $('#panL').addEventListener('click', () => pan(-1)); $('#panR').addEventListener('click', () => pan(1));
    $('#warnChip').addEventListener('click', () => { const w = $('#warns'); w.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    $('#playBtn').addEventListener('click', play);
  }
  function pan(dir) { const n = chartState.x1 - chartState.x0 + 1; if (n >= DAYS) return; chartState.x0 = clamp(chartState.x0 + dir * n, 0, DAYS - n); chartState.x1 = chartState.x0 + n - 1; renderChart(); }
  function setView(v) {
    chartState.view = v; $$('#viewBank button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    renderChart();
  }

  /* morph */
  function paramsAt(i) { if (i < 0) return avatarParams({ weightKg: RUN.base.weight, bodyFatPct: RUN.base.fat / RUN.base.weight * 100 }); return avatarParams({ weightKg: RUN.weight[i][0], bodyFatPct: RUN.fat[i][0] / RUN.weight[i][0] * 100 }); }
  function drawMorph(i) {
    i = i == null ? DAYS - 1 : i;
    figureSVG($('#morphFig'), paramsAt(i), { ghost: paramsAt(-1), sideX: 84 });
    $('#morphDay').textContent = `day ${i + 1} · ${dateLbl(i)}`;
    $('#morphCap').innerHTML = `fat ${fmt(RUN.base.fat, 1)} → <b>${fmt(RUN.fat[i][0], 1)} kg</b> · lean ${fmt(RUN.base.lean, 1)} → <b>${fmt(RUN.lean[i][0], 1)}</b>`;
  }
  let playing = null;
  function play() {
    if (playing) { cancelAnimationFrame(playing); playing = null; return; }
    const t0 = performance.now(), dur = 2200;
    const step = (t) => { const k = clamp((t - t0) / dur, 0, 1); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; moveCrosshair(Math.round(e * (DAYS - 1))); if (k < 1) playing = requestAnimationFrame(step); else playing = null; };
    playing = requestAnimationFrame(step);
  }

  function renderWarnings() {
    const w = $('#warns');
    w.innerHTML = RUN.warns.map((x, k) => `<div class="warn-row">
        <span class="w-${x.sev}">${icon(x.sev === 'caution' ? 'caution' : 'info', 'icon')}</span>
        <span class="ti w-${x.sev}">${x.title}</span>
        <p>${x.body}</p>
        <div class="acts"><button class="key key--sm" data-show="${k}">Show</button>${x.fix ? `<button class="key key--quiet key--sm" data-fix="${k}">${x.fix}</button>` : ''}</div></div>`).join('');
    $$('[data-show]', w).forEach(b => b.addEventListener('click', () => { const x = RUN.warns[+b.dataset.show]; moveCrosshair(x.days[0]); $('#chart').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    $$('[data-fix]', w).forEach(b => b.addEventListener('click', () => {
      for (let wk = 5; wk < 10; wk++) { state.schedule[wk * 7 + 1] = 'D'; state.schedule[wk * 7 + 3] = 'B'; }
      state.sel = new Set([36, 43, 50, 57, 64]); state.focusDay = 36; LIVE = simulate(state.schedule); state.stale = true; markStale(); location.hash = '#schedule';
    }));
    const n = RUN.warns.filter(x => x.sev === 'caution').length;
    $('#warnChip').style.display = n ? '' : 'none'; $('#warnChip span').textContent = `${n} caution${n > 1 ? 's' : ''}`;
    $('#h-warn').nextElementSibling.nextElementSibling.textContent = RUN.warns.length;
  }

  /* explain drawer */
  const EXPLAIN = {
    fat: { what: 'Stored body fat, in kilograms. It changes with the energy you don’t cover from food, less the share taken from lean tissue.', drivers: [['energy deficit', 71], ['protein & training', 18], ['adaptation', 11]], eq: 'change in fat ≈ <var>energy balance</var> × <var>fat share</var> ÷ 7 700 kcal per kg. The fat share rises with more body fat and with protein ≥ 1.6 g/kg plus lifting.', dyn: 'Responds within days; slows as adaptation and lower body mass shrink the deficit.', unc: 'Range widens from ±0.1 kg to ±1.2 kg by week 12, mostly from how much people adapt.', cites: ['Hall KD et al. Quantification of the effect of energy imbalance on bodyweight. Lancet 2011. doi:10.1016/S0140-6736(11)60812-X', 'Forbes GB. Body fat content influences the body composition response to nutrition and exercise. Ann N Y Acad Sci 2000.'] },
    ket: { what: 'Beta-hydroxybutyrate in blood, mmol/L. Above 0.5 counts as nutritional ketosis.', drivers: [['fasting days', 64], ['glycogen depletion', 27], ['low net carbs', 9]], eq: 'Ketones rise when liver glycogen runs low and insulin is low: the liver turns fatty acids into ketones. Entering takes 1–3 days; leaving takes hours after carbohydrate.', dyn: 'Onset lag 12–36 h into a fast; half-life on refeeding ≈ 6 h.', unc: 'People differ about two-fold at the same intake.', cites: ['Cahill GF. Fuel metabolism in starvation. Annu Rev Nutr 2006. doi:10.1146/annurev.nutr.26.061505.111258'] },
    hunger: { what: 'An index of appetite drive, 0–100, built from energy deficit, leptin and fat lost. Grade C: shape more reliable than level.', drivers: [['7-day deficit', 55], ['fasting days', 30], ['fat lost', 15]], eq: 'Hunger pressure = baseline + deficit term + fasting term + a slow term that grows as fat mass falls (leptin).', dyn: 'Fast part tracks the last week; slow part lags fat loss by weeks and eases during diet breaks.', unc: 'Wide: ±5 points at start, ±13 by week 12.', cites: ['Polidori D et al. How strongly does appetite counter weight loss? Obesity 2016. doi:10.1002/oby.21653'] },
    adapt: { what: 'How far energy expenditure falls below what your new size alone predicts, kcal a day.', drivers: [['sustained deficit', 78], ['diet break', -12], ['training', 10]], eq: 'Adaptation moves toward about 20 % of your 7-day deficit, with a time constant of about 4 weeks going down and 2 weeks recovering.', dyn: 'Builds slowly; the week-5 diet break recovers part of it.', unc: 'Large between people: likely −60 to −340 kcal a day by week 12.', cites: ['Rosenbaum M, Leibel RL. Adaptive thermogenesis in humans. Int J Obes 2010. doi:10.1038/ijo.2010.184'] },
  };
  function openExplain(id) {
    const lane = LANES.find(l => l.id === id); const x = EXPLAIN[id] || { what: `${lane.name} in ${lane.unit}. Mechanism text arrives with research dossier.`, drivers: [['energy balance', 50], ['schedule', 30], ['other', 20]], eq: 'See the Evidence library entry for the equation in plain language.', dyn: '—', unc: 'Shown as the band around the line.', cites: [] };
    const s = RUN[id], L = DAYS - 1;
    $('#explainBody').innerHTML = `<div class="xp">
      <div class="xp-head"><div class="grow"><span class="eng" style="display:flex;align-items:center;gap:6px"><i class="sw sw--sq" style="color:var(--lm-cat-${lane.cat})"></i>${CATS[lane.cat]}</span><h2>${lane.name}</h2></div>${gradeHTML(lane.grade)}<button class="key key--quiet key--icon key--sm" aria-label="Close" data-close>${icon('x')}</button></div>
      <p>${x.what}</p>
      <div class="readout"><span class="eng">day 84</span><span class="big readout-num" style="font-size:26px;line-height:30px">${fmt(s[L][0], lane.dec)}<span class="unit">${lane.unit === 'index' ? 'index' : lane.unit}</span></span><span class="rangebar">likely ${fmt(s[L][1], lane.dec)}–${fmt(s[L][2], lane.dec)} · start ${fmt(RUN.base[id] != null ? RUN.base[id] : s[0][0], lane.dec)}</span></div>
      <h3>what drives it in this scenario</h3>
      <div class="drv">${x.drivers.map(([n, v]) => `<div><span>${n}</span><i style="width:${Math.abs(v)}%;${v < 0 ? 'background:var(--lm-ink-3)' : ''}"></i><em>${v > 0 ? '' : '−'}${Math.abs(v)} %</em></div>`).join('')}</div>
      <h3>the mechanism, in plain language</h3>
      <div class="eq">${x.eq}</div>
      <h3>timing</h3><p class="small">${x.dyn}</p>
      <h3>uncertainty</h3><p class="small">${x.unc}</p>
      ${x.cites.length ? `<h3>sources</h3><ol class="cites">${x.cites.map(c => `<li>${c}</li>`).join('')}</ol>` : ''}
      <a class="key key--sm" href="#evidence">Open in Evidence</a>
    </div>`;
    $('[data-close]', $('#explainBody')).addEventListener('click', closeSheets);
    openSheet('#explainSheet');
  }

  /* run */
  function run() {
    const keys = $$('[data-run]');
    keys.forEach(k => k.classList.add('is-running'));
    $('#progRule').classList.add('on');
    const cb = $('#cbody'); cb && cb.classList.add('is-running');
    const t0 = performance.now();
    setTimeout(() => {
      RUN = simulate(state.schedule); LIVE = RUN; state.stale = false; markStale();
      keys.forEach(k => k.classList.remove('is-running'));
      $('#progRule').classList.remove('on');
      $('#lastRun').textContent = `last run ${((performance.now() - t0) / 1000).toFixed(1)} s · 84 days · 41 channels`;
      if (location.hash !== '#results') location.hash = '#results'; else renderResults();
      requestAnimationFrame(sweep);
    }, 1100);
  }
  function sweep() {
    const sw = $('#sweep'); if (!sw || mq('(prefers-reduced-motion: reduce)')) return;
    const gut = mq('(min-width: 1024px)') ? 168 : mq('(min-width: 768px)') ? 150 : 0;
    const W = plotWidth(); const t0 = performance.now(), dur = 700;
    sw.style.opacity = '1';
    const f = (t) => { const k = clamp((t - t0) / dur, 0, 1); const e = 1 - Math.pow(2, -10 * k); sw.style.left = (gut + e * W) + 'px'; if (k < 1) requestAnimationFrame(f); else sw.style.opacity = '0'; };
    requestAnimationFrame(f);
  }
  $$('[data-run]').forEach(b => b.addEventListener('click', run));

  function renderResults() {
    bindChart();
    renderStrip(); renderChart(); renderWarnings(); drawMorph(chartState.xi);
  }

  /* resize */
  let rT;
  window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { const r = (location.hash || '#body').slice(1); if (r === 'results') renderChart(); if (r === 'schedule') { renderRaster(); renderPreview(); } }, 120); });
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  if (mqDark.addEventListener) mqDark.addEventListener('change', () => { /* CSS vars re-theme SVG automatically */ });

  // deep-link state (IA §2): ?view=overlay|focus &xi=<day> &explain=<metric> &day=<index>
  (function applyQuery() {
    const q = new URLSearchParams(location.search);
    if (q.get('view')) chartState.view = q.get('view');
    if (q.get('focus')) chartState.focusLane = q.get('focus');
    if (q.get('xi')) chartState.xi = +q.get('xi');
    if (q.get('day')) { state.focusDay = +q.get('day'); state.sel = new Set([state.focusDay]); }
    route();
    if (chartState.view !== 'lanes') $$('#viewBank button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === chartState.view)));
    if (q.get('explain') && location.hash === '#results') openExplain(q.get('explain'));
    if (q.get('day') && location.hash === '#schedule' && !mq('(min-width: 1280px)')) openSheet('#daySheet');
    if (q.get('xi') && location.hash === '#results') { moveCrosshair(+q.get('xi')); const tip = $('#tip'); const x = crosshairX(+q.get('xi')); tip.style.left = Math.min(x + 40, $('#chart').clientWidth - 250) + 'px'; tip.style.top = '300px'; tip.classList.add('on'); }
  })();
})();
