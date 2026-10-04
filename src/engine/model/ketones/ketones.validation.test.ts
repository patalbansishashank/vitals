// @vitest-environment node
/**
 * Validation of the ketones module (MODEL_SPEC §1.7 "Validation", §9.2 row 05, 20 §4.3.4 BHB_ref).
 *
 * The upstream `fuel`/`intake` modules are written in parallel, so the module is driven with hand-built trajectories:
 * the hour aggregates of dossier 05 §4.17's reference model (its FALLBACK liver/muscle glycogen and insulin proxy are
 * used only as a trajectory generator; the module itself has no fallback, ruling R-KET). G50 = g50Frac × capacity of
 * the driving liver model (= 05's calibrated 55·FFM/60 g). The R-KET retune against the real `fuel` is the integration
 * pass's job; `coupled proxy` below previews it with 04 §4.2 liver kinetics and 20 §4B.1 k_Mf.
 *
 * Tolerances: 05 §7 — ±30 % or ±0.15 mM (whichever larger) for BHB, ±3 h for time to threshold; 20 §4.3.4 — ±30 %.
 * Protocol details the dossiers do not state are assumptions documented at each test (meal clock 08/13/19 h, habitual
 * 50/15/35 %E diet at maintenance, 14-day burn-in).
 */
import type { RefMeal, RefScenario } from './testing/reference05';
import { hourlyFromReference, runModule, coupledFastProxy } from './testing/harness';
import { runReference05 } from './testing/reference05';
import { simulateScenario } from './testing/sim';
import { BODY, BURN_IN_DAYS, bhbRef20, dietFromPct, dietScenario, fastScenario, habitual, mealsOfDay, mealsOfDays, tol05 } from './testing/scenarios';

const within05 = (pred: number, obs: number): void => {
  expect(Math.abs(pred - obs), `pred ${pred.toFixed(3)} vs obs ${obs} ± ${tol05(obs).toFixed(3)}`).toBeLessThanOrEqual(tol05(obs));
};
const withinPct = (pred: number, obs: number, pct: number): void => {
  expect(Math.abs(pred / obs - 1), `pred ${pred.toFixed(3)} vs ${obs.toFixed(3)} ± ${pct * 100} %`).toBeLessThanOrEqual(pct);
};

/** Fast from the day-0 dinner (t0 = 19 h). */
const T0 = 19;

describe('05 §7 must-pass targets (module driven by 05 reference trajectories)', () => {
  const man = simulateScenario(fastScenario(BODY.leanMan, 80).sc);
  const woman = simulateScenario(fastScenario(BODY.woman, 40).sc);

  it('V1 McDougal 2018: 0.1 mM at 12 h and 2.3 mM at 72 h of a water-only fast', () => {
    within05(man.pt(T0 + 12), 0.1);
    within05(man.pt(T0 + 72), 2.3);
  });

  it('V2 Haymond 1982: BHB at 30 h, men 0.9, women 1.7 mM', () => {
    within05(man.pt(T0 + 30), 0.9);
    within05(woman.pt(T0 + 30), 1.7);
    expect(woman.pt(T0 + 30)).toBeGreaterThan(man.pt(T0 + 30));
  });

  it('V3 Deru 2021 (11 M / 9 F): time to 0.5 mM 21.1 h at rest vs 17.5 h with exercise; AUC 0-36 h 19.2 vs 27.5', () => {
    // exercise: 1 h at 65 % VO2max once the dinner is absorbed (≥ 90 % of the gamma kernel, t0 + 3 h; 05 §4.10 protocol)
    const bout = [{ t0: T0 + 3, t1: T0 + 4, x: 0.65 }];
    const manEx = simulateScenario(fastScenario(BODY.leanMan, 40, { bouts: bout }).sc);
    const womanEx = simulateScenario(fastScenario(BODY.woman, 40, { bouts: bout }).sc);
    const cohort = (m: number, f: number): number => (11 * m + 9 * f) / 20;
    const tRest = cohort(man.tCross(T0, 0.5), woman.tCross(T0, 0.5));
    const tEx = cohort(manEx.tCross(T0, 0.5), womanEx.tCross(T0, 0.5));
    expect(Math.abs(tRest - 21.1)).toBeLessThanOrEqual(3);
    expect(Math.abs(tEx - 17.5)).toBeLessThanOrEqual(3);
    expect(tRest - tEx).toBeGreaterThan(1.5);
    withinPct(cohort(man.auc(T0, 36), woman.auc(T0, 36)), 19.2, 0.3);
    withinPct(cohort(manEx.auc(T0, 36), womanEx.auc(T0, 36)), 27.5, 0.3);
  });

  it('V4 Owen & Reichard 1971 / Balasse 1979 (obese): 3 d 2.23, 24 d BHB 5.29 / TKB 6.8, production 1.908 mmol/min', () => {
    const ob = simulateScenario(fastScenario(BODY.obese, 24 * 24 + 1).sc);
    within05(ob.pt(T0 + 72), 2.23);
    within05(ob.pt(T0 + 576), 5.29);
    withinPct(ob.ptTkb(T0 + 576), 6.8, 0.3);
    withinPct(ob.m.prodMmolMin[T0 + 576 - ob.inp.h0 - 1]!, 1.908, 0.3);
  });

  it('V5 Hall 2016 / Rosenbaum 2019: 5 %E carbohydrate, 15 %E protein, −300 kcal/d → 07:00 BHB 0.77 (wk 3-4); baseline 0.1', () => {
    const b = BODY.hall2016;
    const v = simulateScenario(dietScenario(b, dietFromPct(b.TEE - 300, 5, 15), 28));
    let wk34 = 0;
    for (let d = 14; d < 28; d++) wk34 += v.pt(24 * d + 7) / 14;
    within05(wk34, 0.77);
    within05(v.pt(-24 + 7), 0.1);
  });

  it('V6 Harvey 2019: 3-wk mean increase of waking BHB +0.62 / +0.41 / +0.27 mM at 5 / 15 / 25 %E carbohydrate', () => {
    // cohort 25 M / 52 F, BMI 27, 39 y, healthy (IR 1.0); energy = the group's prescriptions 2200 (M) / 1800 (F)
    // kcal (Harvey 2018), protein 1.4 g/kg; waking = 07:00; baseline = mean of the last 7 habitual days
    const men = { BW: 85.5, FFM: 64, IR: 1.0, TEE: 2200 };
    const women = { BW: 73.5, FFM: 47.8, IR: 1.0, TEE: 1800 };
    const obs = { 5: 0.62, 15: 0.41, 25: 0.27 } as const;
    for (const pct of [5, 15, 25] as const) {
      let delta = 0;
      for (const [b, w] of [[men, 25 / 77], [women, 52 / 77]] as const) {
        const v = simulateScenario(dietScenario(b, { kcal: b.TEE, carbG: (b.TEE * pct) / 400, proteinG: 1.4 * b.BW }, 21));
        let mean = 0;
        for (let d = 0; d < 21; d++) mean += v.pt(24 * d + 7) / 21;
        let base = 0;
        for (let d = -7; d < 0; d++) base += v.pt(24 * d + 7) / 7;
        delta += w * (mean - base);
      }
      within05(delta, obs[pct]);
    }
  });

  it('V7 Deru 2024: 24-h fast then a 110-g dextrose shake: 0.59 → 0.28 (1 h) → 0.19 (4 h) → 0.44 (14 h), ±0.15 mM', () => {
    const b = BODY.overweight;
    const hab = habitual(b);
    const day0 = mealsOfDay(0, hab).slice(0, 2);
    const meals: RefMeal[] = [
      ...mealsOfDays(-BURN_IN_DAYS, 0, hab), ...day0,
      { t: T0, netCarbG: (630 * 0.5) / 4, proteinG: (630 * 0.15) / 4, fatG: (630 * 0.35) / 9 }, // ~630-kcal dinner
      { t: T0 + 24, netCarbG: 110, proteinG: 31, fatG: 7 }, // HC/LF shake (70 % dextrose, 20 % casein, 10 % fat)
    ];
    const v = simulateScenario({ body: b, meals, tStart: -24 * BURN_IN_DAYS, tEnd: T0 + 40, habitualProteinG: hab.proteinG, habitualCarbG: hab.carbG });
    const pts = [[24, 0.59], [25, 0.28], [28, 0.19], [38, 0.44]] as const;
    for (const [tau, obs] of pts) expect(Math.abs(v.pt(T0 + tau) - obs), `t ${tau} h: ${v.pt(T0 + tau).toFixed(3)}`).toBeLessThanOrEqual(0.15);
    expect(v.pt(T0 + 25)).toBeLessThan(0.6 * v.pt(T0 + 24)); // halves within ~1 h
  });

  it('V9 Urbain & Bertz 2016: stable ketogenic diet wk 6, 24-h min 0.33 (daytime) and max 0.70 (night)', () => {
    const b = BODY.urbain;
    const v = simulateScenario(dietScenario(b, dietFromPct(b.TEE, 6.2, 19.5), 42));
    let mn = Infinity, mx = -Infinity, hMin = -1, hMax = -1;
    for (let h = 0; h < 24; h++) {
      const x = v.mean(24 * 41 + h);
      if (x < mn) [mn, hMin] = [x, h];
      if (x > mx) [mx, hMax] = [x, h];
    }
    within05(mn, 0.33);
    within05(mx, 0.7);
    expect(hMax).toBeLessThanOrEqual(8); // peak at the end of the overnight fast (meal clock 08/13/19)
    expect(hMin).toBeGreaterThanOrEqual(8);
    expect(mx / mn).toBeGreaterThan(1.8); // ~2.3-fold swing (05 §4.5)
  });

  it('V10 Féry & Balasse 1983: 2 h at 50 % VO2max after an overnight fast, TKB 0.20 → 0.39, 0.73 mM in recovery', () => {
    const v = simulateScenario(fastScenario(BODY.leanMan, 18, { bouts: [{ t0: 32, t1: 34, x: 0.5 }] }).sc);
    within05(v.ptTkb(32), 0.2);
    within05(v.ptTkb(34), 0.39);
    within05(v.m.tkb[34 - v.inp.h0]!, 0.73); // hour mean of the first recovery hour ≈ value at 30 min
    expect(v.m.tkb[34 - v.inp.h0]!).toBeGreaterThan(v.ptTkb(34)); // post-exercise ketosis
  });

  it('V11 Stubbs 2017 (fasted): 25 g D-BHB ester → Cmax 2.8-3.3 mM at 0.5-1 h, back to a post-absorptive level by 4 h', () => {
    const v = simulateScenario(fastScenario(BODY.leanMan, 20, { drinks: [{ t: 32, gBhbD: 25, fed: false }] }).sc);
    const c1 = v.pt(33);
    expect(c1).toBeGreaterThanOrEqual(2.8 * 0.7);
    expect(c1).toBeLessThanOrEqual(3.3 * 1.3);
    expect(v.pt(36)).toBeLessThanOrEqual(0.4); // ≤ 0.4 mM overnight-fasted reference (05 §4.6)
    // the 08 rule: endogenous BHB excludes the drink
    expect(v.m.bhbEndo[32 - v.inp.h0]!).toBeLessThan(0.3);
  });

  it('V12 Vandenberghe 2017: 2 × ~19 g C8 (breakfast, +4 h fasted) → day-long mean TKB +0.295 mM vs control', () => {
    const mk = (c8: number): RefScenario => {
      const sc = fastScenario(BODY.leanMan, 22).sc;
      sc.meals.push({ t: 32, netCarbG: 60, proteinG: 20, fatG: 20, mctC8G: c8 });
      if (c8 > 0) sc.meals.push({ t: 36, netCarbG: 0, proteinG: 0, fatG: 0, mctC8G: c8 });
      sc.meals.sort((a, b) => a.t - b.t);
      return sc;
    };
    const a = simulateScenario(mk(18.6), { mctC8Share: 1 });
    const c = simulateScenario(mk(0));
    let d = 0;
    for (let t = 32; t < 40; t++) d += (a.m.tkb[t - a.inp.h0]! - c.m.tkb[t - c.inp.h0]!) / 8;
    within05(d, 0.295);
  });

  it('V13 Burke 2021: 5-6 d < 50 g carbohydrate, 2.2 g/kg protein, daily training → resting BHB 1.2 mM; A_f ≈ 0.85; 55 % left after 24 h of CHO; reverted after 5 d', () => {
    // elite male race walkers, eucaloric; one 60-min session at 65 % VO2max per day (protocol assumption: the result is
    // dose-sensitive through the grade-D k_mgF term — 1.5 h/d gives ≈ 2.2 mM, 2 h/d ≈ 3.6 mM; calibration item)
    const b = { BW: 65, FFM: 58, IR: 1.0, TEE: 3500 };
    const hab = habitual(b);
    const lchf = { kcal: b.TEE, carbG: 40, proteinG: 2.2 * b.BW, hours: [10, 14, 19] };
    const hcho = { kcal: b.TEE, carbG: 8 * b.BW, proteinG: 2.2 * b.BW, hours: [10, 14, 19] };
    const bouts = [];
    for (let d = -BURN_IN_DAYS; d < 12; d++) bouts.push({ t0: 24 * d + 7, t1: 24 * d + 8, x: 0.65 });
    const sc: RefScenario = {
      body: b,
      meals: [...mealsOfDays(-BURN_IN_DAYS, 0, { ...hab, hours: [10, 14, 19] }), ...mealsOfDays(0, 6, lchf), ...mealsOfDays(6, 12, hcho)],
      bouts, tStart: -24 * BURN_IN_DAYS, tEnd: 24 * 12, habitualProteinG: hab.proteinG, habitualCarbG: hab.carbG,
    };
    const v = simulateScenario(sc);
    within05(v.pt(24 * 5 + 12), 1.2); // day 5, 2 h after breakfast, at rest
    const af = (t: number): number => v.m.aF[t - v.inp.h0 - 1]!;
    expect(af(24 * 6)).toBeGreaterThanOrEqual(0.8);
    expect(Math.abs(af(24 * 7 + 10) / af(24 * 6 + 10) - 0.55)).toBeLessThanOrEqual(0.1); // 24 h after the first HCHO meal
    expect(af(24 * 11)).toBeLessThan(0.1);
  });
});

describe('20 §4.3.4 BHB_ref (water-only fasts; owner of the zero-intake target beyond day 2)', () => {
  const lean = simulateScenario(fastScenario(BODY.lean20, 506).sc);
  const obese = simulateScenario(fastScenario(BODY.obese20, 506).sc);

  it('lean man (15 % BF) and obese woman (45 % BF) within ±30 % from 72 h to 21 d', () => {
    for (const tau of [72, 96, 120, 168, 240, 336, 504]) {
      withinPct(lean.pt(T0 + tau), bhbRef20(tau, 15), 0.3);
      withinPct(obese.pt(T0 + tau), bhbRef20(tau, 45), 0.3);
    }
  });

  // KNOWN CONFLICT (INTEGRATION_NOTES third batch; decisions note): before 72 h 05's own targets govern (V1-V3:
  // 0.56 mM at 24 h, men 0.9 / women 1.7 at 30 h), which 20's curve (0.30 at 24 h, 0.46 at 30 h) contradicts. The
  // orchestrator accepted ≈ 0.5 mM at 24 h. Reported with its error, not gating.
  it.fails('lean and obese within ±30 % of BHB_ref at 24, 36 and 48 h (conflicts with 05 V1-V3)', () => {
    for (const tau of [24, 36, 48]) {
      withinPct(lean.pt(T0 + tau), bhbRef20(tau, 15), 0.3);
      withinPct(obese.pt(T0 + tau), bhbRef20(tau, 45), 0.3);
    }
  });
});

describe('05 §4.7 dose-response surface (regression against the dossier model table, 80 kg / FFM 62, 1.3 g/kg protein)', () => {
  it('week-4 07:00 and 24-h mean BHB by carbohydrate intake (eucaloric and 25 % deficit) within ±0.05 mM', () => {
    const b = { BW: 80, FFM: 62, IR: 1.0, TEE: 2600 };
    const table = [
      [0, 0.71, 0.53, 1.26, 0.92], [30, 0.64, 0.43, 1.04, 0.68], [50, 0.59, 0.37, 0.91, 0.56], [75, 0.51, 0.31, 0.74, 0.44],
      [100, 0.43, 0.25, 0.6, 0.34], [130, 0.33, 0.18, 0.44, 0.24], [175, 0.1, 0.06, 0.14, 0.07],
    ] as const;
    let prevMorning = Infinity;
    for (const [c, mEu, aEu, mDef, aDef] of table) {
      const eu = simulateScenario(dietScenario(b, { kcal: b.TEE, carbG: c, proteinG: 104 }, 28));
      const de = simulateScenario(dietScenario(b, { kcal: 0.75 * b.TEE, carbG: c, proteinG: 104 }, 28));
      let dayEu = 0;
      let dayDe = 0;
      for (let h = 0; h < 24; h++) {
        dayEu += eu.mean(24 * 27 + h) / 24;
        dayDe += de.mean(24 * 27 + h) / 24;
      }
      const morning = eu.pt(24 * 27 + 7);
      expect(Math.abs(morning - mEu), `${c} g eucaloric morning ${morning.toFixed(3)}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(dayEu - aEu)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(de.pt(24 * 27 + 7) - mDef)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(dayDe - aDef)).toBeLessThanOrEqual(0.05);
      expect(morning).toBeLessThan(prevMorning); // monotone in carbohydrate
      prevMorning = morning;
    }
  });
});

describe('tracked known misses (MODEL_SPEC §1.7; reported, not gating)', () => {
  it.fails('V8 Gipson 2025 (older adults, BMI ≥ 27): 24-h values 0.50 (6-g shake) / 0.31 mM (84-g shake)', () => {
    const b = { BW: 90, FFM: 55, IR: 1.3, TEE: 2300 };
    for (const [carb, obs24] of [[6, 0.5], [84, 0.31]] as const) {
      const hab = habitual(b);
      const meals = [...mealsOfDays(-BURN_IN_DAYS, 0, hab), { t: 7, netCarbG: carb, proteinG: 20, fatG: carb < 50 ? 25 : 0 }];
      const v = simulateScenario({ body: b, meals, tStart: -24 * BURN_IN_DAYS, tEnd: 7 + 25, habitualProteinG: hab.proteinG, habitualCarbG: hab.carbG });
      within05(v.pt(7 + 24), obs24);
    }
  });

  // 05's own reference gives −58 % (dossier known miss). The fed factor 0.75 is applied once, by intake (the full engine
  // applied it twice before the integration pass, A2); the harness input carries it like intake's `exoKetoneMmolH`.
  it.fails('V11 fed (Stubbs 2017): food lowers the ester Cmax by 33 % (fed 2.2 mM)', () => {
    const sc = fastScenario(BODY.leanMan, 20, { drinks: [{ t: 32, gBhbD: 25, fed: true }] }).sc;
    sc.meals.push({ t: 32, netCarbG: 60, proteinG: 20, fatG: 20 });
    const v = simulateScenario(sc);
    let peak = 0;
    for (let t = 33; t < 38; t++) peak = Math.max(peak, v.pt(t));
    within05(peak, 2.2);
  });

  it.fails('V14 Johnstone 2008: ad libitum 4 %E carbohydrate, 30 %E protein, 7.25 MJ/d, obese men → 1.52 mM', () => {
    const b = BODY.obese;
    const v = simulateScenario(dietScenario(b, { kcal: 1733, carbG: 17, proteinG: 130 }, 28));
    within05(v.pt(24 * 27 + 7), 1.52);
  });

  it.fails('V15 Veldhorst 2010: 1 day 0 % carbohydrate / 30 %E protein after glycogen-lowering exercise → 1.35 mM next morning', () => {
    const b = BODY.leanMan;
    const hab = habitual(b);
    const meals = [...mealsOfDays(-BURN_IN_DAYS, 0, hab), ...mealsOfDay(0, { kcal: b.TEE, carbG: 0, proteinG: (0.3 * b.TEE) / 4 })];
    const sc: RefScenario = { body: b, meals, bouts: [{ t0: 5, t1: 7, x: 0.7 }], tStart: -24 * BURN_IN_DAYS, tEnd: 32, habitualProteinG: hab.proteinG, habitualCarbG: hab.carbG };
    within05(simulateScenario(sc).pt(24 + 7), 1.35);
  });

  it.fails('Neudorf 2025: lean adults 3.7 mM at 48 h of fasting', () => {
    within05(simulateScenario(fastScenario(BODY.leanMan, 50).sc).pt(T0 + 48), 3.7);
  });

  it.fails('Harvey 2018: MCT 3 × 30 mL/d on a ketogenic diet raises morning BHB by +0.8 mM on days 7-19', () => {
    const b = BODY.woman;
    const keto = { kcal: 1800, carbG: 20, proteinG: 1.4 * b.BW };
    const run = (mct: number): number => {
      const sc = dietScenario(b, keto, 20);
      for (const m of sc.meals) if (m.t >= 0 && mct > 0) {
        m.mctC8G = mct * 0.6;
        m.mctC10G = mct * 0.4;
        m.fatG = Math.max(0, m.fatG - mct * (8.3 / 9));
      }
      const v = simulateScenario(sc);
      let s = 0;
      for (let d = 7; d < 20; d++) s += v.pt(24 * d + 7) / 13;
      return s;
    };
    within05(run(28) - run(0), 0.8);
  });
});

describe('coupled proxy preview for the R-KET retune (04 §4.2 liver τ 24 h / floor 5 g, 20 §4B.1 k_Mf, nominal G50)', () => {
  const proxy = (body: (typeof BODY)['lean20'] | (typeof BODY)['obese20'], overrides: Record<string, number>, kMf = 0.008) => {
    const { sc } = fastScenario(body, 506);
    const ref = runReference05(sc);
    const inp = coupledFastProxy(hourlyFromReference(ref, sc), T0 + 5, body.IR, { kMf });
    const m = runModule(inp, { habitualProteinG: sc.habitualProteinG, habitualCarbG: sc.habitualCarbG, overrides });
    return (tau: number): number => m.bhbEnd[T0 + tau - inp.h0 - 1]!;
  };

  it('stays finite and physical for 21 days at nominal parameters', () => {
    const v = proxy(BODY.lean20, {});
    for (const tau of [24, 72, 168, 504]) expect(Number.isFinite(v(tau))).toBe(true);
  });

  // CALIBRATION FINDING (module hand-back): 05's δ_M term (k_mgF 3.0, grade D, fitted to exercise-depleted athletes) saw
  // 20's fasting muscle-glycogen decline (k_Mf → 36 % by day 21) and tripled FFA (≈ 3.3 mM at 72 h, ≈ 18 mM at 21 d).
  // RESOLVED by integrator A2: δ_M is now fuel's exercise-driven deficit only (bus `muscleGlycogenExDefFrac`), and the
  // coupled-engine calibration is checked in ../integration/fastingBhb.test.ts. This proxy keeps 05's own calibration
  // with 04's liver (τ 24 h) and 05's liver-only insulin decline, which rise too slowly (72 h ≈ 1.4 mM lean): still a miss.
  it.fails('05 calibration on the 04 liver proxy reproduces BHB_ref from 72 h to 21 d (±30 %)', () => {
    const lean = proxy(BODY.lean20, {});
    const obese = proxy(BODY.obese20, {});
    for (const tau of [72, 120, 168, 240, 336, 504]) {
      withinPct(lean(tau), bhbRef20(tau, 15), 0.3);
      withinPct(obese(tau), bhbRef20(tau, 45), 0.3);
    }
  });
});
