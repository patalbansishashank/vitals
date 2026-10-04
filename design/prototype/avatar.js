/* ==========================================================================
   Vitals — parametric body avatar (reference implementation of AVATAR_SPEC.md)
   Pure functions, no dependencies. Exposes window.BodyAvatar.
   Coordinates: centimetres, y up from the floor; rendered with y negated.
   ========================================================================== */
(function () {
  'use strict';

  // ---- templates (lean core half-widths at H = 175 cm) -------------------
  // [male, female]; neutral = mean
  const TORSO = [
    // id,          yFrac, core M, core F, fatK, region weights,               muscle {u,l}
    ['neck',        0.853, 5.6,  4.9,  0.10, { chest: 1 },                    { u: 0.9 }],
    ['trap',        0.842, 11.8, 10.2, 0.10, { chest: 1 },                    { u: 1.8 }],
    ['shoulder',    0.818, 19.6, 17.0, 0.10, { arms: 1 },                     { u: 3.2 }],
    ['chest',       0.735, 15.6, 13.9, 0.32, { chest: 1 },                    { u: 2.3 }],
    ['underbust',   0.680, 14.2, 12.6, 0.28, { chest: 0.5, abdomen: 0.5 },    { u: 1.3 }],
    ['waist',       0.625, 12.9, 11.2, 0.60, { abdomen: 1 },                  { u: 0.4 }],
    ['abdomen',     0.585, 13.3, 12.9, 0.70, { abdomen: 0.8, hips: 0.2 },     {}],
    ['hip',         0.520, 15.3, 16.6, 0.55, { hips: 1 },                     { l: 1.1 }],
    ['crotchOuter', 0.475, 15.2, 16.3, 0.60, { hips: 1 },                     { l: 1.5 }],
  ];
  // legs: id, yFrac, cx M/F, core hw M/F, fatK outer/inner, muscle lower outer/inner
  const LEG = [
    ['upperThigh', 0.440, 8.2, 8.6, 7.4, 7.9, 0.55, 0.38, 1.9, 1.9],
    ['midThigh',   0.370, 7.8, 8.0, 6.4, 6.6, 0.40, 0.30, 1.6, 1.6],
    ['aboveKnee',  0.315, 7.4, 7.4, 5.1, 5.2, 0.20, 0.18, 0.2, 0.9],
    ['knee',       0.285, 7.2, 7.0, 4.6, 4.5, 0.08, 0.08, 0.2, 0.2],
    ['calf',       0.210, 7.0, 6.8, 5.2, 4.8, 0.16, 0.14, 0.6, 0.8],
    ['ankle',      0.055, 6.8, 6.6, 2.7, 2.4, 0.03, 0.03, 0.0, 0.0],
  ];
  // arms: id, s, core hw M/F, fatK, muscle upper
  const ARM = [
    ['deltoid', 0.04, 5.0, 4.3, 0.12, 1.7],
    ['upper',   0.30, 4.2, 3.7, 0.32, 1.5],
    ['elbow',   0.52, 3.2, 2.9, 0.10, 0.2],
    ['forearm', 0.64, 3.6, 3.1, 0.12, 0.8],
    ['wrist',   0.92, 2.3, 2.0, 0.03, 0.0],
  ];
  // side view: id, yFrac, ant M/F, post M/F, fatK ant/post, region, muscle {ua, up, la, lp}
  const SIDE = [
    ['neck',      0.853, 5.0, 4.6, 5.2, 4.8, 0.08, 0.08, { chest: 1 }, {}],
    ['shoulder',  0.818, 7.6, 6.9, 8.4, 7.6, 0.10, 0.12, { chest: 1 }, { ua: 1.0, up: 1.5 }],
    ['chest',     0.735, 10.6, 9.6, 9.0, 8.2, 0.45, 0.20, { chest: 1 }, { ua: 1.8, up: 1.6 }],
    ['underbust', 0.680, 9.2, 8.4, 7.9, 7.2, 0.62, 0.20, { chest: 0.5, abdomen: 0.5 }, { ua: 0.8 }],
    ['waist',     0.625, 8.2, 7.4, 6.9, 6.4, 0.95, 0.22, { abdomen: 1 }, {}],
    ['belly',     0.580, 8.6, 8.2, 7.4, 7.8, 1.00, 0.30, { abdomen: 1 }, {}],
    ['lowerBelly',0.550, 8.3, 8.2, 8.6, 9.4, 0.90, 0.45, { abdomen: 0.6, hips: 0.4 }, { lp: 1.0 }],
    ['glute',     0.520, 7.8, 8.0, 10.2, 11.4, 0.55, 0.62, { hips: 1 }, { lp: 1.8 }],
    ['crotch',    0.475, 7.0, 7.2, 9.4, 10.4, 0.40, 0.55, { hips: 1 }, { lp: 1.2 }],
    ['thigh',     0.420, 7.8, 7.8, 6.6, 7.0, 0.35, 0.35, { hips: 1 }, { la: 1.5, lp: 1.0 }],
    ['aboveKnee', 0.320, 6.3, 6.1, 5.3, 5.2, 0.18, 0.15, { hips: 1 }, { la: 0.7 }],
    ['knee',      0.285, 5.1, 4.9, 4.5, 4.3, 0.06, 0.06, {}, {}],
    ['calf',      0.210, 4.1, 3.9, 6.3, 5.8, 0.10, 0.18, { hips: 1 }, { lp: 1.3 }],
    ['ankle',     0.055, 3.0, 2.8, 2.6, 2.4, 0, 0, {}, {}],
  ];
  const REGION_W = { abdomen: 0.34, hips: 0.38, chest: 0.14, arms: 0.14 };
  const BASE_DIST = {
    male:    { abdomen: 0.35, hips: -0.25, chest: 0, arms: 0 },
    female:  { abdomen: -0.20, hips: 0.40, chest: 0.15, arms: 0.05 },
    neutral: { abdomen: 0, hips: 0, chest: 0, arms: 0 },
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (base, m, f) => base === 'male' ? m : base === 'female' ? f : (m + f) / 2;

  function derived(p) {
    const fatMass = p.weightKg * p.bodyFatPct / 100;
    const FMI = fatMass / Math.pow(p.heightCm / 100, 2);
    const g = Math.max(0.25, FMI - 1.5);
    const m = {};
    let s = 0;
    for (const r of Object.keys(REGION_W)) { m[r] = 1 + 0.6 * clamp(p.dist[r], -1, 1); s += REGION_W[r] * m[r]; }
    for (const r of Object.keys(m)) m[r] /= s;
    return { fatMass, leanMass: p.weightKg - fatMass, FMI, g, m };
  }
  const regionMult = (weights, m) => { let v = 0, w = 0; for (const [r, k] of Object.entries(weights)) { v += k * m[r]; w += k; } return w ? v / w : 0; };

  // 3-point low-pass on fat thickness (weights .25/.5/.25, ends kept)
  function smooth(arr) {
    return arr.map((v, i) => (i === 0 || i === arr.length - 1) ? v : 0.25 * arr[i - 1] + 0.5 * v + 0.25 * arr[i + 1]);
  }

  // ---- front view ----------------------------------------------------------
  function front(p) {
    const H = p.heightCm, S = Math.sqrt(H / 175), d = derived(p), b = p.base;
    const u = p.muscle.upper, l = p.muscle.lower;
    const tRaw = TORSO.map(([, , , , k, reg]) => k * d.g * regionMult(reg, d.m));
    const t = smooth(tRaw);
    const torso = TORSO.map(([id, yf, cm, cf, , , mu], i) => {
      let core = mix(b, cm, cf) * S + (mu.u || 0) * u + (mu.l || 0) * l;
      if (id === 'chest') core += (b === 'female' ? 0.6 : b === 'neutral' ? 0.3 : 0);
      let y = yf * H;
      let env = core + t[i];
      if (id === 'abdomen') y = (yf - 0.004 * Math.max(0, d.g * d.m.abdomen - 4)) * H;
      return { id, y, core, env };
    });
    const legT = LEG.map(([id, yf, cxm, cxf, hm, hf, ko, ki, mo, mi]) => ({ id, yf, cx: mix(b, cxm, cxf) * S, hw: mix(b, hm, hf) * S, ko, ki, mo, mi }));
    const outT = smooth(legT.map(L => L.ko * d.g * d.m.hips));
    const inT = smooth(legT.map(L => L.ki * d.g * d.m.hips));
    const legs = legT.map((L, i) => {
      const coreOut = L.cx + L.hw + L.mo * l * 0.5, coreIn = L.cx - L.hw - L.mi * l * 0.5;
      return { id: L.id, y: L.yf * H, coreOut, coreIn: Math.max(0.15, coreIn), envOut: coreOut + outT[i], envIn: Math.max(0.15, coreIn - inT[i]) };
    });
    const foot = { cx: mix(b, 7.4, 7.1) * S, hw: mix(b, 3.4, 3.1) * S };

    function outline(layer) {
      const k = layer === 'env' ? 'env' : 'core';
      const pts = [];
      pts.push([torso[0][k] * 0.96, 0.905 * H], [torso[0][k], 0.878 * H]);
      for (const s of torso) pts.push([s[k], s.y]);
      for (const L of legs) pts.push([layer === 'env' ? L.envOut : L.coreOut, L.y]);
      pts.push([foot.cx + foot.hw, 0.022 * H], [foot.cx + foot.hw * 0.85, 0.002 * H], [foot.cx - foot.hw * 0.7, 0.002 * H], [foot.cx - foot.hw * 0.85, 0.02 * H]);
      for (let i = legs.length - 1; i >= 0; i--) pts.push([layer === 'env' ? legs[i].envIn : legs[i].coreIn, legs[i].y]);
      pts.push([0, 0.462 * H]);
      const mirrored = pts.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
      return pts.concat(mirrored);
    }

    // arms
    const shoulderCore = torso.find(s => s.id === 'shoulder').core;
    const joint = [shoulderCore - 4.2 * S, 0.812 * H];
    const Larm = 0.335 * H;
    const armFat = smooth(ARM.map(a => a[4] * d.g * d.m.arms));
    // arm angle: smallest angle >= 10deg whose inner envelope edge clears the torso envelope by 0.6 cm
    const envProfile = torso.map(s => [s.y, s.env]).concat(legs.map(L => [L.y, L.envOut]));
    const torsoEnvAt = (y) => {
      for (let i = 0; i < envProfile.length - 1; i++) {
        const [y0, x0] = envProfile[i], [y1, x1] = envProfile[i + 1];
        if (y <= y0 && y >= y1) return x0 + (x1 - x0) * (y0 - y) / (y0 - y1);
      }
      return 0;
    };
    const armHw = ARM.map(([, , hm, hf, , mu], i) => mix(b, hm, hf) * S + mu * u * 0.6 + armFat[i]);
    let theta = 10 * Math.PI / 180;
    // only the elbow and forearm must clear; the upper arm meets the chest at the armpit and the
    // hand may rest on the hip, as real arms do
    for (let deg = 9; deg <= 30; deg += 0.5) {
      theta = deg * Math.PI / 180;
      const ok = [2, 3].every(i => {
        const s = ARM[i][1];
        const ax = joint[0] + Math.sin(theta) * Larm * s, ay = joint[1] - Math.cos(theta) * Larm * s;
        return ax - Math.cos(theta) * armHw[i] >= torsoEnvAt(ay) + 0.3;
      });
      if (ok) break;
    }
    const dir = [Math.sin(theta), -Math.cos(theta)], nrm = [Math.cos(theta), Math.sin(theta)];
    function arm(layer, side) {
      const sx = side === 'R' ? 1 : -1;
      const st = ARM.map(([id, s, hm, hf, , mu], i) => {
        const core = mix(b, hm, hf) * S + mu * u * 0.6;
        return { s, hw: layer === 'env' ? core + armFat[i] : core };
      });
      const hand = mix(b, 3.3, 3.0) * S;
      st.push({ s: 1.03, hw: hand }, { s: 1.13, hw: hand * 0.78 });
      const at = (s, off) => [joint[0] + dir[0] * Larm * s + nrm[0] * off, joint[1] + dir[1] * Larm * s + nrm[1] * off];
      const pts = [];
      const topHw = st[0].hw;
      pts.push(at(-0.06, -topHw * 0.2), at(-0.035, topHw * 0.55));
      for (const q of st) pts.push(at(q.s, q.hw));
      pts.push(at(1.18, 0));
      for (let i = st.length - 1; i >= 1; i--) pts.push(at(st[i].s, -st[i].hw * (i < 2 ? 0.9 : 1)));
      pts.push(at(0.12, -st[0].hw * 0.8));
      return pts.map(([x, y]) => [x * sx, y]);
    }

    const head = { cx: 0, cy: 0.935 * H, rx: mix(b, 7.4, 7.0) * S, ry: 11.2 * (H / 175) };
    // definition strokes (visible when lean + muscular)
    const muscleVis = (m) => clamp((m - 0.25) * 1.6, 0, 1) * clamp(1 - (d.g - 2) / 5, 0, 1);
    const ch = torso.find(s => s.id === 'chest'), ub = torso.find(s => s.id === 'underbust');
    const defs = [
      { o: muscleVis(u), pts: [[-ch.core * 0.72, ub.y + 2.2], [-ch.core * 0.3, ub.y - 0.6], [0, ub.y + 0.4]] },
      { o: muscleVis(u), pts: [[ch.core * 0.72, ub.y + 2.2], [ch.core * 0.3, ub.y - 0.6], [0, ub.y + 0.4]] },
      { o: muscleVis(u) * 0.8, pts: [[0, ub.y - 1.5], [0, torso.find(s => s.id === 'abdomen').y - 2]] },
      { o: muscleVis(l), pts: [[legs[2].coreIn + 1.0, legs[1].y], [legs[2].coreIn + 0.6, legs[2].y + 1.5], [legs[3].coreIn + 1.4, legs[3].y + 0.8]] },
      { o: muscleVis(l), pts: [[-(legs[2].coreIn + 1.0), legs[1].y], [-(legs[2].coreIn + 0.6), legs[2].y + 1.5], [-(legs[3].coreIn + 1.4), legs[3].y + 0.8]] },
    ];
    const handles = {
      chest: [ch.env, ch.y],
      waist: [torso.find(s => s.id === 'waist').env, torso.find(s => s.id === 'waist').y],
      hips: [torso.find(s => s.id === 'hip').env, torso.find(s => s.id === 'hip').y],
      arm: (() => { const a = arm('env', 'R'); return a[3]; })(),
    };
    const ab = torso.find(s => s.id === 'abdomen');
    return {
      env: outline('env'), core: outline('core'),
      armsEnv: [arm('env', 'R'), arm('env', 'L')], armsCore: [arm('core', 'R'), arm('core', 'L')],
      head, defs, handles, visceral: { cx: 0, cy: ab.y + 1, rx: ab.core * 0.55, ry: 0.055 * H },
      waistHalfWidth: torso.find(s => s.id === 'waist').env,
    };
  }

  // ---- side view -------------------------------------------------------------
  function side(p) {
    const H = p.heightCm, S = Math.sqrt(H / 175), d = derived(p), b = p.base;
    const u = p.muscle.upper, l = p.muscle.lower;
    const fa = smooth(SIDE.map(r => r[6] * d.g * regionMult(r[8], d.m)));
    const fp = smooth(smooth(SIDE.map(r => r[7] * d.g * regionMult(r[8], d.m))));
    const st = SIDE.map((r, i) => {
      const [id, yf, am, af, pm, pf, , , , mu] = r;
      let coreA = mix(b, am, af) * S + (mu.ua || 0) * u + (mu.la || 0) * l;
      const coreP = mix(b, pm, pf) * S + (mu.up || 0) * u + (mu.lp || 0) * l;
      let envA = coreA + fa[i];
      if (id === 'chest') { const bust = b === 'female' ? 1 : b === 'neutral' ? 0.5 : 0; envA += bust * (2.2 + 0.35 * d.g * d.m.chest); coreA += bust * 1.2; }
      let y = yf * H;
      if (id === 'belly') y = (yf - 0.004 * Math.max(0, d.g * d.m.abdomen - 4)) * H;
      return { id, y, coreA, coreP, envA, envP: coreP + fp[i] };
    });
    const toe = mix(b, 17.5, 16.0) * S, heel = mix(b, 4.2, 3.8) * S;
    function outline(layer) {
      const A = layer === 'env' ? 'envA' : 'coreA', P = layer === 'env' ? 'envP' : 'coreP';
      const pts = [[st[0][A] * 0.96, 0.905 * H], [st[0][A], 0.878 * H]];
      for (const s of st) pts.push([s[A], s.y]);
      pts.push([toe * 0.55, 0.035 * H], [toe, 0.012 * H], [toe * 0.96, 0.001 * H], [-heel * 0.8, 0.001 * H], [-heel, 0.022 * H]);
      for (let i = st.length - 1; i >= 0; i--) pts.push([-st[i][P], st[i].y]);
      pts.push([-st[0][P], 0.878 * H], [-st[0][P] * 0.96, 0.905 * H]);
      return pts;
    }
    const bel = st.find(s => s.id === 'belly');
    return {
      env: outline('env'), core: outline('core'),
      head: { cx: 1.2 * S, cy: 0.935 * H, rx: 9.6 * S, ry: 11.2 * (H / 175) },
      visceral: { cx: bel.coreA * 0.25, cy: bel.y + 1, rx: bel.coreA * 0.62, ry: 0.05 * H },
      bellyDepth: bel.envA + bel.envP,
    };
  }

  // ---- path helpers ------------------------------------------------------------
  // centripetal Catmull-Rom (alpha .5) -> cubic Bezier; closed
  function pathD(pts, closed = true) {
    const P = pts.map(([x, y]) => [x, -y]);
    const n = P.length;
    const get = (i) => closed ? P[(i + n) % n] : P[clamp(i, 0, n - 1)];
    let dStr = `M${P[0][0].toFixed(2)},${P[0][1].toFixed(2)}`;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const d1 = Math.max(1e-4, Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5));
      const d2 = Math.max(1e-4, Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5));
      const d3 = Math.max(1e-4, Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5));
      const b1 = [
        (d1 * d1 * p2[0] - d2 * d2 * p0[0] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[0]) / (3 * d1 * (d1 + d2)),
        (d1 * d1 * p2[1] - d2 * d2 * p0[1] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[1]) / (3 * d1 * (d1 + d2)),
      ];
      const b2 = [
        (d3 * d3 * p1[0] - d2 * d2 * p3[0] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[0]) / (3 * d3 * (d3 + d2)),
        (d3 * d3 * p1[1] - d2 * d2 * p3[1] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[1]) / (3 * d3 * (d3 + d2)),
      ];
      dStr += `C${b1[0].toFixed(2)},${b1[1].toFixed(2)} ${b2[0].toFixed(2)},${b2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return dStr + (closed ? 'Z' : '');
  }
  const polyD = (pts) => pathD(pts, false);

  function interpParams(a, b, t) {
    return {
      base: t < 0.5 ? a.base : b.base,
      heightCm: lerp(a.heightCm, b.heightCm, t), weightKg: lerp(a.weightKg, b.weightKg, t),
      bodyFatPct: lerp(a.bodyFatPct, b.bodyFatPct, t),
      dist: Object.fromEntries(Object.keys(a.dist).map(k => [k, lerp(a.dist[k], b.dist[k], t)])),
      muscle: { upper: lerp(a.muscle.upper, b.muscle.upper, t), lower: lerp(a.muscle.lower, b.muscle.lower, t) },
    };
  }

  // Estimated waist girth (cm) from front half-width and side depth (Ramanujan ellipse)
  function waistGirth(p) {
    const f = front(p), s = side(p);
    const a = f.waistHalfWidth, bb = s.bellyDepth / 2 * 0.92;
    return Math.PI * (3 * (a + bb) - Math.sqrt((3 * a + bb) * (a + 3 * bb)));
  }

  window.BodyAvatar = { front, side, pathD, polyD, derived, interpParams, waistGirth, BASE_DIST };
})();
