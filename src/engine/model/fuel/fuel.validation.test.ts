// @vitest-environment node
/**
 * Validation targets assigned to WP-M4 (MODEL_SPEC §1.6 "Validation (unit)", §9.1 O-3 and O-10, §9.2 row 04).
 * Scenario inputs are hand-built (the rig in ./testHarness.ts). Targets that the dossier rules cannot meet stay in
 * the suite as `it.fails` with the measured value in the comment (WP_BRIEF: never loosen silently).
 */
import { makeRig, runDays, threeMeals, dailyReducedForm, type HourTrace, type Meal, type Scenario } from './testHarness';
import { muscleGlycogenG } from './index';

const LIVER_V = 1.45; // fuel.vLiv (mmol/L ↔ g)
const mmolL = (g: number) => g / LIVER_V / 0.162;
const report: string[] = [];
const note = (s: string) => report.push(s);
afterAll(() => console.info(`[fuel validation]\n  ${report.join('\n  ')}`));

function menu(pct: number, tee = 2500) {
  const cho = ((pct / 100) * tee) / 4;
  return { glcG: cho * 0.85, fruG: cho * 0.15, protG: (0.15 * tee) / 4 };
}
const smmOf = (rig: ReturnType<typeof makeRig>) => rig.s.smmKg.reduce((a, x) => a + x, 0);
/** Meals for `days` days from `startDay` on menu `next`, preceded by day `startDay − 1` on menu `prev` (its evening tail). */
function switchMeals(prev: ReturnType<typeof menu>, next: ReturnType<typeof menu>, startDay: number, days: number): Meal[] {
  return threeMeals(1, prev, { startDay: startDay - 1 }).concat(threeMeals(days, next, { startDay }));
}

// ------------------------------------------------------------------------------------------------ 04 V3 liver
describe('04 V3 liver glycogen (Taylor 1996, Magnusson 1992) — ±20 %', () => {
  function overnight(tauL?: number) {
    const rig = makeRig(tauL ? { overrides: { 'fuel.tauL': tauL } } : {});
    rig.s.liverG = 350 * LIVER_V * 0.162;
    const tr: HourTrace[] = [];
    runDays(rig, 1, { meals: [], teeKcalD: 2400 }, tr);
    return (tr[9]!.liverG + tr[10]!.liverG) / 2; // 10.5 h
  }
  function magnusson(tauL?: number) {
    const rig = makeRig(tauL ? { overrides: { 'fuel.tauL': tauL } } : {});
    rig.s.liverG = 282 * LIVER_V * 0.162;
    const tr: HourTrace[] = [];
    runDays(rig, 1, { meals: [], teeKcalD: 2400 }, tr);
    return (tr[17]!.liverG + tr[18]!.liverG) / 2; // 4 → 22.5 h = 18.5 h
  }

  it('Taylor overnight 350 → 207 mmol/L in 10.5 h', () => {
    const c = mmolL(overnight());
    note(`Taylor overnight: ${c.toFixed(0)} mmol/L (target 207 ± 20 %)`);
    expect(Math.abs(c / 207 - 1)).toBeLessThan(0.2);
  });

  // KNOWN MISS: 141 mmol/L vs 98 at the dossier's τ_L 24 h (+44 %); 125 (+28 %) at the calibrated 20 h (integrator A2;
  // 18 h would pass, 115, but breaks the 2 % O-10 band of the hourly liver form below).
  it.fails('Magnusson 282 → 98 mmol/L from 4 to 22.5 h', () => {
    const c = mmolL(magnusson());
    note(`Magnusson fast: ${c.toFixed(0)} mmol/L (target 98 ± 20 %) — known miss at the registry τ_L`);
    expect(Math.abs(c / 98 - 1)).toBeLessThan(0.2);
  });

  it('calibration note: the registry low τ_L = 18 h meets both Taylor and Magnusson', () => {
    const t = mmolL(overnight(18));
    const m = mmolL(magnusson(18));
    note(`τ_L 18 h: Taylor ${t.toFixed(0)} (207), Magnusson ${m.toFixed(0)} (98)`);
    expect(Math.abs(t / 207 - 1)).toBeLessThan(0.2);
    expect(Math.abs(m / 98 - 1)).toBeLessThan(0.2);
  });

  function taylorMeal() {
    const rig = makeRig();
    rig.s.liverG = 207 * LIVER_V * 0.162;
    const tr: HourTrace[] = [];
    runDays(rig, 1, { meals: [{ at: 0, glcG: 139, protG: 29, tpH: 0.5, gi: 100 }], teeKcalD: 2400, capGlc: true }, tr);
    let peak = 0;
    let at = 0;
    tr.slice(0, 12).forEach((h) => {
      if (h.liverG > peak) {
        peak = h.liverG;
        at = h.t + 1;
      }
    });
    return { peak: mmolL(peak), at };
  }

  it('Taylor 139-g glucose meal: peak 316 mmol/L (magnitude)', () => {
    const { peak } = taylorMeal();
    note(`Taylor meal peak: ${peak.toFixed(0)} mmol/L (target 316 ± 20 %)`);
    expect(Math.abs(peak / 316 - 1)).toBeLessThan(0.2);
  });

  // KNOWN MISS: hourly liver synthesis stops when absorption ends (peak at 3 h); 04's indirect pathway keeps filling
  // the liver to ≈ 5.3 h. Timing tolerance ±1 h.
  it.fails('Taylor 139-g glucose meal: peak at ≈ 5.3 h (± 1 h)', () => {
    const { at } = taylorMeal();
    note(`Taylor meal peak time: ${at} h (target 5.3 ± 1 h) — known miss`);
    expect(Math.abs(at - 5.3)).toBeLessThanOrEqual(1);
  });
});

// ------------------------------------------------------------------------------------------------ 04 V4 Bussau
describe('04 V4 Bussau 2002 — 10 g/kg/d high-GI CHO, inactive: 95 → 180 mmol/kg ww in 24 h (± 15)', () => {
  function bussau(days: number) {
    const bw = 72;
    const rig = makeRig({ vo2max: 60, profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 26, heightCm: 180, weightKg: bw }, habits: { trainingHistory: 'gt3y' } } });
    rig.s.cM.fill(95);
    const meals: Meal[] = [];
    for (let d = 0; d < days; d++) for (const h of [7, 10, 13, 16, 19, 22]) meals.push({ at: 24 * d + h, glcG: (10 * bw) / 6, protG: 10, tpH: 0.75, gi: 85 });
    const res = runDays(rig, days, { meals, teeKcalD: 2600, capGlc: true });
    return res.map((r) => r.muscleEndG / (0.162 * smmOf(rig)));
  }
  // KNOWN MISS: 04 §4.10 oxidises exogenous glucose before muscle uptake (step 5), so at ~30 g/h appearance and
  // f_C ≈ 0.9 only ~11-19 g/h reach muscle; S_M capacity itself would allow +85. Whole-body vs vastus scaling (04 §10.4).
  it.fails('reaches 180 ± 15 mmol/kg ww after 24 h', () => {
    const c = bussau(1)[0]!;
    note(`Bussau 24 h: ${c.toFixed(0)} mmol/kg ww (target 180 ± 15) — known miss`);
    expect(Math.abs(c - 180)).toBeLessThanOrEqual(15);
  });
  // KNOWN MISS (same cause): the model keeps rising on days 2-3 (to ≈ 185-195) instead of plateauing after day 1.
  it.fails('no further rise between 24 and 72 h', () => {
    const c = bussau(3);
    note(`Bussau days 1-3: ${c.map((x) => x.toFixed(0)).join(' / ')} mmol/kg ww`);
    expect(c[2]! - c[0]!).toBeLessThan(10);
  });
});

// ------------------------------------------------------------------------------------------------ 04 V1 Acheson 1982
describe('04 V1 Acheson 1982 — 479 g starch after an overnight fast, 10 h', () => {
  const rig = makeRig({ profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 21, heightCm: 178, weightKg: 70 } } });
  const habit = Array.from({ length: 20 }, (_, d) => [8, 13, 19].map((h) => ({ at: 24 * d + h, glcG: 90, protG: 25 }))).flat();
  runDays(rig, 20, { meals: habit, teeKcalD: 2300 });
  const tr: HourTrace[] = [];
  const t0 = rig.t;
  // 10-h EE ≈ RMR + 5.9 % TEF ≈ 82 kcal/h; 29 g protein oxidised in 10 h (observed)
  runDays(rig, 1, { meals: [{ at: t0 + 8, glcG: 479, protG: 29, tpH: 1.5, gi: 70 }], teeKcalD: 24 * 82, capGlc: true }, tr);
  const g0 = tr[7]!.liverG + tr[7]!.muscleG;
  const ten = tr.slice(8, 18);
  const ox = ten.reduce((a, h) => a + h.choOx, 0);
  const stored = tr[17]!.liverG + tr[17]!.muscleG - g0;
  it('CHO oxidised 133 g ± 20 % and glycogen +346 g ± 20 % at 10 h, NPRQ < 1, no net DNL', () => {
    note(`Acheson 1982: oxidised ${ox.toFixed(0)} g (133), stored ${stored.toFixed(0)} g (346), max RQ ${Math.max(...ten.map((h) => h.rq)).toFixed(3)}`);
    expect(Math.abs(ox / 133 - 1)).toBeLessThan(0.2);
    expect(Math.abs(stored / 346 - 1)).toBeLessThan(0.2);
    for (const h of ten) expect(h.rq).toBeLessThan(1);
    expect(ten.reduce((a, h) => a + h.dnlFat, 0)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ 04 V2 Acheson 1988
describe('04 V2 Acheson 1988 — 3-d depletion, then 7 d at 86 % CHO (3642 → 4930 kcal/d)', () => {
  // TEE is not in the dossier; assumed 2700 → 3060 kcal/d (inactive 70-kg men + TEF of massive overfeeding).
  const rig = makeRig({ profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 25, heightCm: 178, weightKg: 70 } } });
  runDays(rig, 3, {
    meals: threeMeals(3, { glcG: 45, protG: 60 }),
    teeKcalD: 2900,
    exercise: [0, 1, 2].map((d) => ({ at: 24 * d + 10, min: 90, intensity: 0.7, activeKg: 12, kcal: 800 })),
  });
  const meals: Meal[] = [];
  const kcal = (d: number) => 3642 + ((4930 - 3642) * d) / 6;
  for (let d = 0; d < 7; d++) for (const h of [8, 12, 16, 20]) meals.push({ at: 24 * (d + 3) + h, glcG: (0.86 * kcal(d)) / 4 / 4, protG: (0.11 * kcal(d)) / 4 / 4 });
  const res = runDays(rig, 7, { meals, teeKcalD: (dd) => 2700 + 60 * (dd - 3) });
  it('net DNL ≈ 150 ± 40 g/d on days 5-7; onset (NPRQ > 1) by day 2 ± 1; capacity ≈ 15 g/kg ± 20 %', () => {
    const dnl = res.slice(4, 7).map((r) => r.dnlFatG);
    const mean = dnl.reduce((a, x) => a + x, 0) / 3;
    const onset = res.findIndex((r) => r.dnlFatG > 1) + 1;
    const gMax = Math.max(...res.map((r) => r.liverEndG + r.muscleEndG));
    note(`Acheson 1988: DNL days 5-7 ${dnl.map((x) => x.toFixed(0)).join('/')} g/d (150 ± 40), onset day ${onset} (2 ± 1), max glycogen ${(gMax / 70).toFixed(1)} g/kg (15)`);
    expect(Math.abs(mean - 150)).toBeLessThanOrEqual(40);
    expect(Math.abs(onset - 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(gMax / 70 / 15 - 1)).toBeLessThan(0.2);
  });
});

// ------------------------------------------------------------------------------------------------ 04 V6 Schrauwen
describe('04 V6 Schrauwen 1997 — 55 → 25 %E CHO at energy balance: fat balance +1.06/+0.75/+0.55 MJ on days 1-3 (± 0.4)', () => {
  const rig = makeRig();
  runDays(rig, 30, { meals: threeMeals(30, menu(55)), teeKcalD: 2500 });
  const res = runDays(rig, 7, { meals: switchMeals(menu(55), menu(25), 30, 7), teeKcalD: 2500 });
  // at energy and protein balance the fat balance is minus the carbohydrate-store change (MJ = kcal/239)
  const fb = res.map((r) => (-4.207 * r.dGlycogenG) / 239.0057);
  const obs = [1.06, 0.75, 0.55];
  note(`Schrauwen fat balance days 1-7: ${fb.map((x) => x.toFixed(2)).join(' / ')} MJ (1.06/0.75/0.55 then → 0)`);
  // KNOWN MISSES: 1.66 / 0.21 / 0.11 MJ. The 3-day total (1.98 MJ) is within 16 % of the observed 2.36 MJ, but the
  // loss is front-loaded: glycogen above the fed reference is mobilised within a day (f_C,pa ∝ (G/G_ref)²), below it
  // only slowly (04 §4.11's own daily form gives 1.5 / 0.9 / 0.5).
  it.fails('day 1 within ± 0.4 MJ', () => {
    expect(Math.abs(fb[0]! - obs[0]!)).toBeLessThanOrEqual(0.4);
  });
  it.fails('day 2 within ± 0.4 MJ', () => {
    expect(Math.abs(fb[1]! - obs[1]!)).toBeLessThanOrEqual(0.4);
  });
  it.fails('day 3 within ± 0.4 MJ', () => {
    expect(Math.abs(fb[2]! - obs[2]!)).toBeLessThanOrEqual(0.4);
  });
  it('3-day total within ± 0.4·3 MJ and balance reached by day 5-9 (|fat balance| < 0.3 MJ from day 5)', () => {
    expect(Math.abs(fb[0]! + fb[1]! + fb[2]! - 2.36)).toBeLessThanOrEqual(1.2);
    expect(Math.abs(fb[4]!)).toBeLessThan(0.3);
  });
});

// ------------------------------------------------------------------------------------------------ 01 §7.2 Jebb
describe('01 §7.2 / 04 Jebb 1996 — 12-d chamber: CHO oxidation converges to intake', () => {
  const lean70 = { schemaVersion: 1 as const, body: { sex: 'male' as const, ageYears: 30, heightCm: 178, weightKg: 70 } };
  it('overfeeding (540 g/d CHO): CHO oxidation within 5 % of intake by day 5', () => {
    const rig = makeRig({ profile: lean70 });
    runDays(rig, 30, { meals: threeMeals(30, { glcG: 406, protG: 88 }), teeKcalD: 2960 });
    const over = runDays(rig, 12, { meals: switchMeals({ glcG: 406, fruG: 0, protG: 88 }, { glcG: 540, fruG: 0, protG: 118 }, 30, 12), teeKcalD: 3140 });
    note(`Jebb overfeeding CHO ox days 1-12: ${over.map((r) => r.choOxG.toFixed(0)).join(' ')} g/d (intake 540)`);
    expect(Math.abs(over[4]!.choOxG / 540 - 1)).toBeLessThan(0.05);
    expect(Math.abs(over[11]!.choOxG / 551 - 1)).toBeLessThan(0.15);
  });
  it('underfeeding (83 g/d CHO): CHO oxidation 106 g/d ± 15 % at day 12', () => {
    const rig = makeRig({ profile: lean70 });
    runDays(rig, 30, { meals: threeMeals(30, { glcG: 406, protG: 88 }), teeKcalD: 2960 });
    const under = runDays(rig, 12, { meals: switchMeals({ glcG: 406, fruG: 0, protG: 88 }, { glcG: 83, fruG: 0, protG: 40 }, 30, 12), teeKcalD: 2650 });
    note(`Jebb underfeeding CHO ox day 12: ${under[11]!.choOxG.toFixed(0)} g/d (106)`);
    expect(Math.abs(under[11]!.choOxG / 106 - 1)).toBeLessThan(0.15);
  });
});

// ------------------------------------------------------------------------------------------------ O-3 (R-ORACLE B)
describe('O-3 — hourly fluxes integrate to 04 §4.11 daily reduced form within ± 5 % (steady-state menus at maintenance)', () => {
  // Convention (review m4): the daily form is evaluated on the engine's conventions (protein 4 kcal/g, fat 9.44 kcal/g,
  // CHO 4.1 kcal/g oxidised, 4.207 kcal/g stored). ΔG (reference 0 at steady state) is compared as a share of the
  // day's carbohydrate intake.
  for (const pct of [30, 50, 70]) {
    it(`${pct} %E carbohydrate: 7 days of CHOox, fatOx, ΔG`, () => {
      const rig = makeRig();
      const m = menu(pct);
      runDays(rig, 60, { meals: threeMeals(60, m), teeKcalD: 2500 });
      const g0 = rig.s.liverG + muscleGlycogenG(rig.s);
      const res = runDays(rig, 7, { meals: switchMeals(m, m, 60, 7), teeKcalD: 2500 });
      const ci = m.glcG + m.fruG;
      // the daily form run to its own steady state (its k_G = CI_hab/G_ref² puts G_ref slightly below it, 04 §4.11)
      const full = dailyReducedForm({ days: 67, gRef: g0, ciHabG: ci, ciG: () => ci, teeKcalD: 2500, protOxGD: m.protG, gCap: rig.s.gCapG });
      const ref = { choOxG: full.choOxG.slice(60), fatOxG: full.fatOxG.slice(60), dG: full.dG.slice(60) };
      let worst = 0;
      for (let d = 0; d < 7; d++) {
        const r = res[d]!;
        const eCho = Math.abs(r.choOxG / ref.choOxG[d]! - 1);
        const eFat = Math.abs(r.fatOxG / ref.fatOxG[d]! - 1);
        const eG = Math.abs(r.dGlycogenG - ref.dG[d]!) / ci;
        worst = Math.max(worst, eCho, eFat, eG);
        expect(eCho).toBeLessThan(0.05);
        expect(eFat).toBeLessThan(0.05);
        expect(eG).toBeLessThan(0.05);
        expect(r.dnlFatG).toBe(0);
      }
      note(`O-3 ${pct} %E: CHOox ${res[6]!.choOxG.toFixed(1)} vs ${ref.choOxG[6]!.toFixed(1)} g/d, fatOx ${res[6]!.fatOxG.toFixed(1)} vs ${ref.fatOxG[6]!.toFixed(1)} g/d, worst rel. error ${(100 * worst).toFixed(2)} %`);
    });
  }

  it('transient after a switch from 50 %E (informational beyond the steady-state gate): day-7 values within 5 %', () => {
    for (const pct of [30, 70]) {
      const rig = makeRig();
      runDays(rig, 60, { meals: threeMeals(60, menu(50)), teeKcalD: 2500 });
      const g0 = rig.s.liverG + muscleGlycogenG(rig.s);
      const res = runDays(rig, 7, { meals: switchMeals(menu(50), menu(pct), 60, 7), teeKcalD: 2500 });
      const ciHab = menu(50).glcG + menu(50).fruG;
      const ci = menu(pct).glcG + menu(pct).fruG;
      const ref = dailyReducedForm({ days: 7, gRef: g0, ciHabG: ciHab, ciG: () => ci, teeKcalD: 2500, protOxGD: menu(pct).protG, gCap: rig.s.gCapG });
      const dev = res.map((r, d) => (100 * (r.choOxG / ref.choOxG[d]! - 1)).toFixed(1));
      const devF = res.map((r, d) => (100 * (r.fatOxG / ref.fatOxG[d]! - 1)).toFixed(1));
      note(`O-3 transient 50→${pct} %E: CHOox dev by day ${dev.join(' / ')} %; fatOx dev ${devF.join(' / ')} % (hourly τ is longer than Hall's ≈ 1 d, R-GLYTAU)`);
      expect(Math.abs(res[6]!.choOxG / ref.choOxG[6]! - 1)).toBeLessThan(0.05);
      expect(Math.abs(res[6]!.fatOxG / ref.fatOxG[6]! - 1)).toBeLessThan(0.05);
    }
  });
});

// ------------------------------------------------------------------------------------------------ O-10
describe('O-10 — hourly closed forms vs a 5-min explicit-Euler reference of the same rule set (2 % state)', () => {
  function compare(sc: Scenario, days: number) {
    const a = makeRig();
    const b = makeRig({ stepH: 1 / 12, euler: true });
    const ta: HourTrace[] = [];
    const tb: HourTrace[] = [];
    runDays(a, days, sc, ta);
    runDays(b, days, sc, tb);
    let eL = 0;
    let eM = 0;
    let eT = 0;
    ta.forEach((x, i) => {
      const y = tb[i]!;
      eL = Math.max(eL, Math.abs(x.liverG / y.liverG - 1));
      eM = Math.max(eM, Math.abs(x.muscleG / y.muscleG - 1));
      eT = Math.max(eT, Math.abs((x.liverG + x.muscleG) / (y.liverG + y.muscleG) - 1));
    });
    return { eL, eM, eT };
  }

  it("dossier's test case (04 §4.10 Acheson 479-g meal) and a mixed 3-day week with cardio: G_L, G_M, G_tot within 2 %", () => {
    const acheson = compare({ meals: [{ at: 8, glcG: 479, protG: 29, tpH: 1.5, gi: 70 }], teeKcalD: 24 * 82, capGlc: true }, 1);
    const mixed = compare(
      {
        meals: threeMeals(3, menu(50)).concat([{ at: 24 + 8, glcG: 200, tpH: 0.5 }]),
        teeKcalD: 2500,
        capGlc: true,
        exercise: [
          { at: 17.25, min: 60, intensity: 0.7, activeKg: 12, kcal: 600 },
          { at: 24 + 6, min: 45, intensity: 0.5, activeKg: 12, kcal: 350 },
        ],
      },
      3,
    );
    note(`O-10 Acheson: liver ${(100 * acheson.eL).toFixed(2)} %, muscle ${(100 * acheson.eM).toFixed(2)} %; mixed week: liver ${(100 * mixed.eL).toFixed(2)} %, muscle ${(100 * mixed.eM).toFixed(2)} %, total ${(100 * mixed.eT).toFixed(2)} %`);
    for (const e of [acheson.eL, acheson.eM, acheson.eT, mixed.eL, mixed.eM, mixed.eT]) expect(e).toBeLessThan(0.02);
  });

  it('whole-body 27-set RT session: total glycogen within 2 % (liver lags ≤ 1 h while RT lactate is re-routed, ≤ 4 %)', () => {
    const rt = compare({ meals: threeMeals(2, menu(50)), teeKcalD: 2500, rt: [{ at: 17, sets: [3, 3, 3, 3, 3, 3, 3, 3, 3], kcal: 250 }] }, 2);
    note(`O-10 RT session: liver ${(100 * rt.eL).toFixed(2)} %, muscle ${(100 * rt.eM).toFixed(2)} %, total ${(100 * rt.eT).toFixed(2)} %`);
    expect(rt.eT).toBeLessThan(0.02);
    expect(rt.eM).toBeLessThan(0.02);
    expect(rt.eL).toBeLessThan(0.04);
  });
});

// ------------------------------------------------------------------------------------------------ other dossier behaviours
describe('04 §4.2 / 04 §4.6 / 20 §4.3.1 / 04 §4.9 behaviours', () => {
  it('24-h fast from fed stores removes ≈ 60-65 % of liver glycogen; overnight fasting leaves muscle glycogen ≈ unchanged', () => {
    const rig = makeRig();
    rig.s.liverG = 90;
    const m0 = muscleGlycogenG(rig.s);
    const tr: HourTrace[] = [];
    runDays(rig, 1, { meals: [], teeKcalD: 2400, fast: () => true, fastProtOxGH: 2.5 }, tr);
    const gone = 1 - tr[23]!.liverG / 90;
    const rig2 = makeRig();
    runDays(rig2, 20, { meals: threeMeals(20, menu(50)), teeKcalD: 2500 });
    const tr2: HourTrace[] = [];
    runDays(rig2, 1, { meals: [{ at: rig2.t + 19, ...menu(50), glcG: menu(50).glcG / 3, fruG: menu(50).fruG / 3, protG: menu(50).protG / 3 }], teeKcalD: 2500 }, tr2);
    const tr3: HourTrace[] = [];
    runDays(rig2, 1, { meals: [], teeKcalD: 2500 }, tr3);
    const night = tr3[5]!.muscleG / tr2[19]!.muscleG - 1; // 20:00 → 06:00
    note(`24-h fast: ${(100 * gone).toFixed(0)} % of liver glycogen gone (60-65 %); muscle 20:00→06:00 ${(100 * night).toFixed(1)} % (−0 to +3 %, Iwayama); fast muscle day 1 ${(100 * (tr[23]!.muscleG / m0 - 1)).toFixed(1)} %`);
    expect(gone).toBeGreaterThan(0.55);
    expect(gone).toBeLessThan(0.7);
    expect(Math.abs(night)).toBeLessThan(0.1);
  });

  it('supercompensated muscle glycogen stays elevated ≤ 5 d on a normal diet (spec replacement of 04 §4.9 persistence)', () => {
    const rig = makeRig();
    runDays(rig, 20, { meals: threeMeals(20, menu(50)), teeKcalD: 2500 });
    runDays(rig, 3, { meals: switchMeals(menu(50), { glcG: 750, fruG: 0, protG: 80 }, 20, 3), teeKcalD: 2600, capGlc: true });
    const peak = muscleGlycogenG(rig.s) / rig.s.gMuscleRefG;
    const res = runDays(rig, 7, { meals: switchMeals({ glcG: 750, fruG: 0, protG: 80 }, menu(50), 23, 7), teeKcalD: 2500 });
    const rel = res.map((r) => r.muscleEndG / rig.s.gMuscleRefG);
    const decay = rel.map((x, i) => 100 * (1 - x / (i === 0 ? peak : rel[i - 1]!)));
    note(`supercompensation: peak ${peak.toFixed(2)} × ref, days 1-7 ${rel.map((x) => x.toFixed(2)).join(' / ')}; daily decay ${decay.map((x) => x.toFixed(0)).join('/')} % (target ≈ 5 %/d)`);
    expect(peak).toBeGreaterThan(1.3);
    expect(rel[4]!).toBeLessThan(1.3);
  });

  // KNOWN MISS (Q target): days 1-3 decay 14-18 %/d instead of ≈ 5 %/d. f_C,pa ∝ (G/G_ref)² plus the demand-driven
  // muscle glycogenolysis that O-3 requires (without it 45-70 %E maintenance diets saturate glycogen and trigger DNL)
  // empties supercompensated stores faster than 04 §4.9's k_Mr-only calibration.
  it.fails('supercompensated muscle glycogen decays ≈ 5 %/d (± 3) over the first 3 days', () => {
    const rig = makeRig();
    runDays(rig, 20, { meals: threeMeals(20, menu(50)), teeKcalD: 2500 });
    runDays(rig, 3, { meals: switchMeals(menu(50), { glcG: 750, fruG: 0, protG: 80 }, 20, 3), teeKcalD: 2600, capGlc: true });
    const g0 = muscleGlycogenG(rig.s);
    const res = runDays(rig, 3, { meals: switchMeals({ glcG: 750, fruG: 0, protG: 80 }, menu(50), 23, 3), teeKcalD: 2500 });
    const perDay = 1 - Math.pow(res[2]!.muscleEndG / g0, 1 / 3);
    expect(Math.abs(perDay - 0.05)).toBeLessThanOrEqual(0.03);
  });
});
