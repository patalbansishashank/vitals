// @vitest-environment node
/**
 * Dossier 20 validation for the fasting module (MODEL_SPEC §1.4 "Validation", §9.2 row 20; WP-M6 acceptance: 20 V1-V10,
 * §4B.3, O-6). The real module runs inside `harness.ts`'s hand-built stand-ins for intake/energy/fuel/ketones/composition/
 * water (written from their MODEL_SPEC sections; BHB = 20 §4.3.4's BHB_ref). Two layers:
 *  1. quantities the fasting module owns (urinary N, protein oxidised, RMR multiplier, sparing, labile pool) against the
 *     dossier's own MODEL tables (Table 4.4.3, Tables A1-A4) — tight tolerances;
 *  2. whole-body outcomes (ΔBW, fat, DXA-lean) against the studies with 20 §7's tolerances — these also exercise the
 *     stand-ins, so the integration pass (WP-V) must re-run them with the real modules.
 * Targets missed here stay as `it.fails` with the reason (never loosened silently).
 */
import {
  runHarness,
  waterFast,
  mealsHour,
  type HarnessPerson,
  type HarnessRun,
  type IntakeFn,
} from './harness';
import { bhbRefMmolL } from './index';

// ---------------------------------------------------------------- persons (20 Tables A1-A4 and the §7 cohorts)
const LEAN_MAN: HarnessPerson = { sex: 'M', ageY: 35, heightCm: 178, bwKg: 75, bfPct: 15 };
const LEAN_WOMAN: HarnessPerson = {
  sex: 'F',
  ageY: 35,
  heightCm: 165,
  bwKg: 60,
  bfPct: 25,
  liverG0: 65,
  muscleG0: 263,
};
const OBESE_WOMAN: HarnessPerson = {
  sex: 'F',
  ageY: 45,
  heightCm: 165,
  bwKg: 100,
  bfPct: 45,
  activityFrac: 0.35,
  liverG0: 68,
  muscleG0: 273,
};
const OBESE_MAN: HarnessPerson = {
  sex: 'M',
  ageY: 45,
  heightCm: 178,
  bwKg: 115,
  bfPct: 35,
  activityFrac: 0.35,
  liverG0: 89,
  muscleG0: 430,
};

/** Fast from midnight (t = 0 = start of zero intake, 20 §4A) — DayRecord `days[d − 1]` = end of fast day d. */
function tableRun(p: HarnessPerson, days: number, extra = 0): HarnessRun {
  return runHarness(p, days + extra, waterFast(0, days * 24), {
    fastSpans: [{ startHour: 0, endHour: days * 24, electrolytes: true }],
  });
}

/** Dinner → dinner fasts (FastEvent from 19:00 of day 0, the dinner moved to 18:00) for the cohort and §4B.3 checks. */
const S = 19;
function dinnerRun(
  p: HarnessPerson,
  days: number,
  afterDays = 0,
  opts: { refeedFrac?: number } = {},
): HarnessRun {
  const nDays = Math.ceil((S + (days + afterDays) * 24) / 24) + 1;
  return runHarness(p, nDays, waterFast(S, days * 24, opts.refeedFrac ?? 1), {
    fastSpans: [{ startHour: S, endHour: S + days * 24, electrolytes: true }],
  });
}
/** Change from the hour before the fast to `h` hours after its start. */
function at(
  r: HarnessRun,
  h: number,
): { bw: number; fm: number; lt: number; dxa: number; rmr: number; n: number } {
  const i = S + h - 1;
  const b = S - 1;
  const bw = r.hourlyBw[i]! - r.hourlyBw[b]!;
  const fm = r.hourlyFm[i]! - r.hourlyFm[b]!;
  return {
    bw,
    fm,
    lt: r.hourlyLt[i]! - r.hourlyLt[b]!,
    dxa: bw - fm,
    rmr: r.hourlyRmrRel[i]!,
    n: r.hourlyN[i]!,
  };
}
/** Urinary N summed over fast hours [h0, h1), g. */
function nSum(r: HarnessRun, h0: number, h1: number): number {
  let s = 0;
  for (let i = S + h0; i < S + h1; i++) s += r.hourlyN[i]! / 24;
  return s;
}
/** Weighted cohort mean of `f(at(run, h))`. */
function mix(runs: [HarnessRun, number][], h: number, f: (x: ReturnType<typeof at>) => number): number {
  let sw = 0;
  let sv = 0;
  for (const [r, w] of runs) {
    sv += w * f(at(r, h));
    sw += w;
  }
  return sv / sw;
}
const within = (x: number, target: number, tol: number): void => {
  expect(x).toBeGreaterThanOrEqual(target - tol);
  expect(x).toBeLessThanOrEqual(target + tol);
};

// ================================================================== layer 1: module quantities vs the dossier's MODEL
describe('20 Table 4.4.3 and Tables A1-A4 — fasting-module quantities', () => {
  const lm = tableRun(LEAN_MAN, 21);
  const lw = tableRun(LEAN_WOMAN, 21);
  const ow = tableRun(OBESE_WOMAN, 21);
  const om = tableRun(OBESE_MAN, 21);
  const days = [1, 2, 3, 5, 7, 14, 21];
  const table = new Map<HarnessRun, { n: number[]; protKg: number; share21: number; name: string }>([
    [lm, { name: 'lean man', n: [13.8, 15.0, 15.3, 14.3, 13.1, 10.6, 9.7], protKg: 1.57, share21: 0.16 }],
    [lw, { name: 'lean woman', n: [9.5, 10.3, 10.5, 9.5, 8.4, 6.1, 5.2], protKg: 0.97, share21: 0.1 }],
    [ow, { name: 'obese woman', n: [9.5, 10.3, 10.6, 9.9, 9.2, 6.4, 4.6], protKg: 1.01, share21: 0.07 }],
    [om, { name: 'obese man', n: [13.4, 14.5, 14.8, 13.6, 12.2, 8.1, 6.3], protKg: 1.34, share21: 0.08 }],
  ]);

  for (const [run, t] of table) {
    it(`${t.name}: urinary N by day within ±10 % of Table 4.4.3 (end-of-day values)`, () => {
      days.forEach((d, i) => {
        const n = run.hourlyN[d * 24 - 1]!;
        expect(Math.abs(n / t.n[i]! - 1)).toBeLessThan(0.1);
      });
    });
    it(`${t.name}: 21-d protein oxidised ${t.protKg} kg ±10 %; day-21 protein share of energy ${t.share21} ± 0.03`, () => {
      const prot = run.rig.s.protOxCumG / 1000;
      expect(Math.abs(prot / t.protKg - 1)).toBeLessThan(0.1);
      const d21 = run.days[20]!;
      within((d21.protOxDay * 4.7) / d21.tee, t.share21, 0.03);
    });
  }

  it('lean man RMR change by day within ±2.5 points of Table A1 (+4, +4, +2, −1, −4, −9, −13, −17, −21 %)', () => {
    const d = [1, 2, 3, 4, 5, 7, 10, 14, 21];
    const ref = [4, 4, 2, -1, -4, -9, -13, -17, -21];
    d.forEach((day, i) => within(100 * lm.hourlyRmrRel[day * 24 - 1]!, ref[i]!, 2.5));
  });
  it('obese woman RMR change by day within ±2.5 points of Table A3 (+4, +5, +3, 0, −3, −6, −8, −10 %)', () => {
    const d = [1, 2, 3, 5, 7, 10, 14, 21];
    const ref = [4, 5, 3, 0, -3, -6, -8, -10];
    d.forEach((day, i) => within(100 * ow.hourlyRmrRel[day * 24 - 1]!, ref[i]!, 2.5));
  });
  it('hydrated protein tissue by day within ±10 % of Table A1 (lean man) and A3 (obese woman)', () => {
    const a1 = new Map([
      [1, -0.22],
      [3, -0.7],
      [7, -1.63],
      [14, -2.95],
      [21, -4.09],
    ]);
    const a3 = new Map([
      [1, -0.15],
      [3, -0.48],
      [7, -1.13],
      [14, -2.01],
      [21, -2.62],
    ]);
    for (const [d, v] of a1) expect(Math.abs(lm.days[d - 1]!.dLt / v - 1)).toBeLessThan(0.1);
    for (const [d, v] of a3) expect(Math.abs(ow.days[d - 1]!.dLt / v - 1)).toBeLessThan(0.1);
  });
});

// ================================================================== layer 2: 20 §7 study targets
describe('20 §7 V1-V10 (tolerances of 20 §7)', () => {
  // V1 Kolnes 2025: 13 adults (7 M / 6 F), 29.7 y, 79.6 kg, 23.4 % fat, BMI 25.0 (→ 178 cm); 7-d water-only
  const k1: [HarnessRun, number][] = [
    [dinnerRun({ sex: 'M', ageY: 29.7, heightCm: 178.4, bwKg: 79.6, bfPct: 23.4 }, 7), 7],
    [dinnerRun({ sex: 'F', ageY: 29.7, heightCm: 178.4, bwKg: 79.6, bfPct: 23.4 }, 7), 6],
  ];
  it('V1 Kolnes 7 d: ΔBW −5.8 ± 0.8 kg, fat −1.4 ± 0.5, DXA-lean −4.6 ± 1.0, urinary N 84 ± 15 g, RMR day 5 0 ± 6 %', () => {
    within(
      mix(k1, 168, (x) => x.bw),
      -5.8,
      0.8,
    );
    within(
      mix(k1, 168, (x) => x.fm),
      -1.4,
      0.5,
    );
    within(
      mix(k1, 168, (x) => x.dxa),
      -4.6,
      1.0,
    );
    within((7 * nSum(k1[0]![0], 0, 168) + 6 * nSum(k1[1]![0], 0, 168)) / 13, 84, 15);
    within(100 * mix(k1, 120, (x) => x.rmr), 0, 6);
  });
  it('V1 Kolnes: muscle glycogen −53 ± 15 points at day 7 (k_Mf)', () => {
    const r = k1[0]![0];
    within(100 * (r.days[7]!.muscleGlyRel - 1), -53, 15);
  });

  // V2 Pietzner 2024: 12 (5 F), 77.5 kg, BMI 25.4 (→ 175 cm), 7-d water-only then 3 d ad libitum (maintenance refeed)
  const p2: [HarnessRun, number][] = [
    [dinnerRun({ sex: 'M', ageY: 40, heightCm: 174.7, bwKg: 77.5, bfPct: 25 }, 7, 3), 7],
    [dinnerRun({ sex: 'F', ageY: 40, heightCm: 174.7, bwKg: 77.5, bfPct: 25 }, 7, 3), 5],
  ];
  it('V2 Pietzner: end of fast −5.7 ± 1 kg; +3 d refeed weight −3.1 ± 0.8 and DXA-lean −0.69 ± 0.6 kg', () => {
    within(
      mix(p2, 168, (x) => x.bw),
      -5.7,
      1.0,
    );
    within(
      mix(p2, 240, (x) => x.bw),
      -3.1,
      0.8,
    );
    within(
      mix(p2, 240, (x) => x.dxa),
      -0.69,
      0.6,
    );
    // lean recovery is water/glycogen, not protein: DXA-lean regains ≥ 2 kg in 3 d while protein tissue barely changes
    expect(mix(p2, 240, (x) => x.dxa) - mix(p2, 168, (x) => x.dxa)).toBeGreaterThan(2);
    expect(Math.abs(mix(p2, 240, (x) => x.lt) - mix(p2, 168, (x) => x.lt))).toBeLessThan(0.3);
  });
  // Stand-in energetics give −1.16 kg fat at the end of the fast (20 MODEL −1.31) and −1.23 kg after a maintenance refeed:
  // the Hall convention returns 5.3 kcal/g protein (20's closure 4.7) and fat costs 9 620 kcal/kg (20: 9 440), and the
  // "ad libitum" refeed is modelled at pre-fast maintenance (a small surplus against the adapted TEE). Integration item.
  it.fails(
    'V2 Pietzner: fat −1.85 ± 0.5 kg kept 3 d after refeeding (known miss with stand-ins; see comment)',
    () => {
      within(
        mix(p2, 240, (x) => x.fm),
        -1.85,
        0.5,
      );
    },
  );

  // V3 Dai 2024: 13 (5 F), 40.5 y, 66.3 kg, BMI 24.5 (→ 164.5 cm; BF assumed 20 % M / 30 % F), 21-d water-only
  const d3: [HarnessRun, number][] = [
    [dinnerRun({ sex: 'M', ageY: 40.5, heightCm: 164.5, bwKg: 66.3, bfPct: 20 }, 21), 8],
    [dinnerRun({ sex: 'F', ageY: 40.5, heightCm: 164.5, bwKg: 66.3, bfPct: 30 }, 21), 5],
  ];
  it('V3 Dai 2024 21 d: ΔBW −10.0 ± 1.5 kg; REE d3/d9/d15/d20 NS/−7.5/−13.7/−20.3 % ± 6 points; days 11-21 −0.31 ± 0.07 kg/d', () => {
    within(
      mix(d3, 504, (x) => x.bw),
      -10.0,
      1.5,
    );
    [
      [3, 0],
      [9, -7.5],
      [15, -13.7],
      [20, -20.3],
    ].forEach(([d, ref]) => within(100 * mix(d3, d! * 24, (x) => x.rmr), ref!, 6));
    within((mix(d3, 504, (x) => x.bw) - mix(d3, 264, (x) => x.bw)) / 10, -0.31, 0.07);
  });

  // V4 Laurens 2021: 16 men, 44 y, BMI 26.2 (178 cm, 83 kg, BF 25 % assumed), 10-d Buchinger 225 kcal/45 g CHO/0 g protein,
  // ≤ 3 h/d light activity (activity 0.5 × RMR0, 20 §7 V4 used 0.45-0.6); modified fast → overlay via the criteria
  const laurens = runHarness(
    { sex: 'M', ageY: 44, heightCm: 178, bwKg: 83, bfPct: 25, activityFrac: 0.5 },
    12,
    (h, base, out) => {
      const d = Math.floor(h / 24);
      if (d >= 1 && d < 11) {
        const soup = h % 24 === 12 || h % 24 === 18;
        out.kcal = soup ? 112.5 : 0;
        out.protein = 0;
        out.carb = soup ? 22.5 : 0;
        out.planned = 0;
        out.sodiumMg = 3000;
        out.dayCarb = 45;
      } else mealsHour(h % 24, base, out);
    },
  );
  it('V4 Laurens modified fast 10 d: ΔBW −5.9 ± 1.0, fat −2.3 ± 0.6, protein tissue −1.65 ± 0.5 kg, BMR −12 ± 5 %', () => {
    const d = laurens.days[10]!;
    expect(laurens.days.slice(1, 11).every((x) => x.active === 1)).toBe(true);
    within(d.dBw, -5.9, 1.0);
    within(d.dFm, -2.3, 0.6);
    within(d.dLt, -1.65, 0.5);
    within(100 * d.rmrRel, -12, 5);
  });

  // V5 Benedict 1915 (Levanzin): 60.6 kg lean man (FFM ≈ 52 kg → BF 14 %), 31-d water-only, laboratory life (activity 0.3)
  const lev = dinnerRun({ sex: 'M', ageY: 40, heightCm: 171, bwKg: 60.6, bfPct: 14, activityFrac: 0.3 }, 31);
  it('V5 Levanzin 31 d: ΔBW −13.25 ± 2 kg; cumulative N 277 g ± 15 %; late N 7.7 ± 1.5 g/d; resting heat d30 −31 ± 8 %', () => {
    within(at(lev, 744).bw, -13.25, 2);
    within(nSum(lev, 0, 744), 277, 0.15 * 277);
    within(nSum(lev, 480, 744) / 11, 7.7, 1.5);
    within(100 * at(lev, 720).rmr, -31, 8);
  });

  // V6 Göschke / Owen / Forbes: peak N, obese late floor, N per kg lost
  const lean21 = tableRun(LEAN_MAN, 21);
  const obeseM = tableRun(OBESE_MAN, 7);
  const obeseW28 = tableRun(OBESE_WOMAN, 28);
  it('V6: peak N 14.5 ± 2 g/d in normal-weight and obese men (days 1-3); obese women week 4 3.0 ± 1.5 g/d', () => {
    const peak = (r: HarnessRun): number => Math.max(...r.days.slice(0, 3).map((d) => d.nDay));
    within(peak(lean21), 14.5, 2);
    within(peak(obeseM), 14.5, 2);
    within(obeseW28.days.slice(21, 28).reduce((a, d) => a + d.nDay, 0) / 7, 3.0, 1.5);
  });
  it('V6: lean 21-d N lost per kg weight 23 ± 5 g/kg (Forbes ≈ 20 non-obese); obese late protein share 5-9 % of energy', () => {
    const n = lean21.days.reduce((a, d) => a + d.nDay, 0);
    within(n / -lean21.days[20]!.dBw, 23, 5);
    const d = obeseW28.days[27]!;
    within((d.protOxDay * 4.7) / d.tee, 0.07, 0.02);
  });

  // V7 Ogłodek 2021: 12 men, 50 y, 79.4 kg, 18.7 % fat (178 cm assumed), 8-d water-only
  it('V7 Ogłodek 8 d: ΔBW −5.96 ± 1.0 kg', () => {
    within(
      at(dinnerRun({ sex: 'M', ageY: 50, heightCm: 178, bwKg: 79.4, bfPct: 18.7 }, 8), 192).bw,
      -5.96,
      1.0,
    );
  });

  it("V8 (BHB is the ketones module's): the BHB_ref calibration target lies within ±30 % of the 24-72-h data", () => {
    const k = lean21.rig.k;
    const ref = (h: number): number => bhbRefMmolL(k, h, 20);
    within(ref(24), 0.37, 0.3 * 0.37); // Browning 0.33 F / 0.41 M
    within(ref(48), 1.58, 0.3 * 1.58); // Browning 1.22 F / 1.94 M
    within(ref(72), 2.3, 0.3 * 2.3); // McDougal 2.3 ± 0.5
  });

  // V9 Templeman 2021 (lean, 3 wk): 24-h fasts on alternate days with 150 % (0:150) or 200 % (0:200) on fed days vs 75 % daily
  const T: HarnessPerson = { sex: 'M', ageY: 30, heightCm: 178, bwKg: 70, bfPct: 20 };
  const adfSpans = Array.from({ length: 11 }, (_, i) => ({
    startHour: i * 48,
    endHour: i * 48 + 24,
    electrolytes: true,
  }));
  const adf =
    (feast: number): IntakeFn =>
    (h, base, out) => {
      if (Math.floor(h / 24) % 2 === 0) {
        out.kcal = 0;
        out.protein = 0;
        out.carb = 0;
        out.planned = 1;
        out.sodiumMg = 3000;
        out.dayCarb = 0;
      } else mealsHour(h % 24, base, out, feast);
    };
  const a150 = runHarness(T, 22, adf(1.5), { fastSpans: adfSpans });
  const a200 = runHarness(T, 22, adf(2.0), { fastSpans: adfSpans });
  const c75 = runHarness(T, 22, (h, base, out) => mealsHour(h % 24, base, out, 0.75));
  it('V9 Templeman: non-fat loss 0:150 > 75:75; 0:200 fat ≈ 0 ± 0.3 kg; each fast re-enters the early N peak', () => {
    const e150 = a150.days[21]!;
    const e75 = c75.days[21]!;
    expect(e150.dBw - e150.dFm).toBeLessThan(e75.dBw - e75.dFm);
    within(a200.days[21]!.dFm, 0, 0.3);
    expect(Math.max(...a150.hourlySN)).toBeLessThan(0.05);
  });
  // With composition's partition replaced by a Forbes share (lean fraction 10.4/(10.4 + FM) ≈ 0.42 here) the daily 75 %
  // arm loses as little fat as the ADF arm; 03's partition is a documented known-miss for lean adults (ruling R-FORBES,
  // Templeman). The fasting module supplies the ADF lean cost (≈ 40 g net protein per fast); the ≥ 0.5 kg fat gap must be
  // re-checked with the real composition module.
  it.fails(
    'V9 Templeman: fat loss 0:150 smaller than 75:75 by ≥ 0.5 kg (needs the real composition partition)',
    () => {
      expect(c75.days[21]!.dFm - a150.days[21]!.dFm).toBeLessThanOrEqual(-0.5);
    },
  );
});

// ================================================================== 20 §4B.3 schedule behaviours (lean man, Table A1)
describe('20 §4B.3 schedule behaviours (lean man of Table A1)', () => {
  // tolerances: module quantities ±10 % (protein) / ±2.5 points (RMR); whole-body values at 20 §4A's UI bands
  // (ΔBW ±15 %, fat ±25 %); values after refeeding ±0.3 kg
  const r = new Map([1, 2, 3, 7, 21].map((d) => [d, dinnerRun(LEAN_MAN, d, 4)]));
  const protG = (d: number): number => (-at(r.get(d)!, d * 24).lt / 2.6) * 1000;

  it('24 h: N 13-14 g/d at 24 h; protein ≈ 83 g; +3 d after within 0.3 kg of −0.2 kg', () => {
    const e = at(r.get(1)!, 24);
    within(e.n, 13.5, 0.5);
    within(protG(1), 83, 8.3);
    within(at(r.get(1)!, 96).bw, -0.2, 0.3);
  });
  // Early water and the last meal: 13's E_cna (−0.9 L max, τ 1.5 d, lagged by the 24-h carbohydrate window) replaces 20's
  // E_fast + gut (−1.3·ECF0/17 L and −0.45 kg, τ 1-1.5 d) by ruling R-WATER, and the pre-fast dinner is still being absorbed
  // in the first hours (20's reference starts at the end of absorption). Calibration item for water/intake integration.
  it.fails('24 h: ΔBW −1.6 kg ± 15 % and fat −0.17 kg ± 25 % (early water/absorption; see comment)', () => {
    const e = at(r.get(1)!, 24);
    within(e.bw, -1.6, 0.24);
    within(e.fm, -0.17, 0.0425);
  });
  it.fails(
    '48 h: ΔBW −2.7 kg ± 15 % and fat −0.35 kg ± 25 % (early water/absorption; see comment above)',
    () => {
      const e = at(r.get(2)!, 48);
      within(e.bw, -2.7, 0.405);
      within(e.fm, -0.35, 0.0875);
    },
  );
  it('48 h: RMR +4 % ± 2.5 points; protein ≈ 173 g', () => {
    within(100 * at(r.get(2)!, 48).rmr, 4, 2.5);
    within(protG(2), 173, 17.3);
  });
  it('72 h: ΔBW −3.5 kg ± 15 %; fat −0.55 ± 25 %; protein ≈ 270 g; +3 d after −1.1 ± 0.3 kg', () => {
    const e = at(r.get(3)!, 72);
    within(e.bw, -3.5, 0.525);
    within(e.fm, -0.55, 0.1375);
    within(protG(3), 270, 27);
    within(at(r.get(3)!, 144).bw, -1.1, 0.3);
  });
  it('7 d: ΔBW −5.7 ± 15 %; fat −1.3 ± 25 %; DXA-lean −4.4 ± 15 %; N 13 g/d on day 7; RMR −9 %; +3 d −2.6 kg, DXA-lean −1.2', () => {
    const e = at(r.get(7)!, 168);
    within(e.bw, -5.7, 0.855);
    within(e.fm, -1.3, 0.325);
    within(e.dxa, -4.4, 0.66);
    within(e.n, 13.1, 1.31);
    within(100 * e.rmr, -9, 2.5);
    const a = at(r.get(7)!, 240);
    within(a.bw, -2.6, 0.3);
    within(a.dxa, -1.2, 0.3);
  });
  it('21 d: ΔBW −11.0 ± 15 %; fat −3.8 ± 25 %; protein 1.57 kg ± 10 %; RMR −21 ± 2.5 %', () => {
    const e = at(r.get(21)!, 504);
    within(e.bw, -11.0, 1.65);
    within(e.fm, -3.8, 0.95);
    within(protG(21) / 1000, 1.57, 0.157);
    within(100 * e.rmr, -21, 2.5);
  });

  it('weekly dinner→dinner 24-h fast × 12 wk: S_N stays ≈ 0 and the net protein cost is 35-45 g per fast', () => {
    const spans = Array.from({ length: 12 }, (_, w) => ({
      startHour: w * 168 + 19,
      endHour: w * 168 + 43,
      electrolytes: true,
    }));
    const inFast = (h: number): boolean => spans.some((x) => h >= x.startHour && h < x.endHour);
    const wk = runHarness(
      LEAN_MAN,
      84,
      (h, base, out) => {
        if (inFast(h)) {
          out.kcal = 0;
          out.protein = 0;
          out.carb = 0;
          out.planned = 1;
          out.sodiumMg = 3000;
          out.dayCarb = 0;
        } else if (inFast(h + 1))
          mealsHour(19, base, out); // dinner moved before the span
        else mealsHour(h % 24, base, out);
      },
      { fastSpans: spans },
    );
    const s = wk.rig.s;
    expect(s.fastCount).toBe(12);
    expect(Math.max(...wk.hourlySN)).toBeLessThan(0.02);
    within((s.protOxCumG - s.repletedCumG) / 12, 40, 5);
    // every fast re-enters the early peak: day-1 N of the last fast equals the first within 3 %
    const n1 = wk.hourlyN[19 + 23]!;
    const n12 = wk.hourlyN[11 * 168 + 19 + 23]!;
    expect(Math.abs(n12 / n1 - 1)).toBeLessThan(0.03);
  });

  it('monthly 72-h fast × 6: s_AT < 0.05 before every next fast; each fast costs ≈ 270 g protein, ≈ 48 g repleted', () => {
    const spans = Array.from({ length: 6 }, (_, m) => ({
      startHour: m * 720 + 19,
      endHour: m * 720 + 19 + 72,
      electrolytes: true,
    }));
    const inFast = (h: number): boolean => spans.some((x) => h >= x.startHour && h < x.endHour);
    const mo = runHarness(
      LEAN_MAN,
      180,
      (h, base, out) => {
        if (inFast(h)) {
          out.kcal = 0;
          out.protein = 0;
          out.carb = 0;
          out.planned = 1;
          out.sodiumMg = 3000;
          out.dayCarb = 0;
        } else if (inFast(h + 1)) mealsHour(19, base, out);
        else mealsHour(h % 24, base, out);
      },
      { fastSpans: spans },
    );
    for (const sp of spans.slice(1)) expect(mo.hourlySAT[sp.startHour - 1]!).toBeLessThan(0.05);
    const s = mo.rig.s;
    within(s.protOxCumG / 6, 270, 27);
    within(s.repletedCumG / 6, 0.75 * mo.base.ffm0, 3);
  });

  it('fast broken by a 110-g carbohydrate meal on day 3: overlay ends; S_N decays with τ 3 d', () => {
    const br = runHarness(
      LEAN_MAN,
      10,
      (h, base, out) => {
        if (h < 60) {
          out.kcal = 0;
          out.protein = 0;
          out.carb = 0;
          out.planned = 1;
          out.sodiumMg = 3000;
          out.dayCarb = 0;
        } else if (h === 60) {
          out.kcal = 440;
          out.protein = 0;
          out.carb = 110;
          out.planned = 0;
          out.sodiumMg = 3000;
          out.dayCarb = 110;
        } else mealsHour(h % 24, base, out);
      },
      { fastSpans: [{ startHour: 0, endHour: 60, electrolytes: true }] },
    );
    // the clock counts from the last intake event (20 §2): the 19:00 dinner 5 h before the span → 60 + 4 h at the end
    expect(br.rig.s.lastFastDays).toBeCloseTo(64 / 24, 12);
    expect(br.days[2]!.active).toBe(0);
    const s0 = br.hourlySN[60]!;
    expect(s0).toBeGreaterThan(0);
    within(br.hourlySN[60 + 72]! / s0, Math.exp(-1), 0.03);
  });
});

// ================================================================== O-6 (zero intake 21 and 28 d, incl. a very lean user)
describe('O-6: 21- and 28-day water-only fasts stay finite, FM monotone (M9 floor for a very lean user)', () => {
  for (const [name, p, days] of [
    ['lean man 21 d', LEAN_MAN, 21],
    ['obese woman 28 d', OBESE_WOMAN, 28],
    [
      'very lean man (70 kg, 8 %) 28 d',
      { sex: 'M', ageY: 25, heightCm: 180, bwKg: 70, bfPct: 8 } as HarnessPerson,
      28,
    ],
  ] as const) {
    it(name, () => {
      const r = tableRun(p, days);
      let prevFm = Infinity;
      for (const d of r.days) {
        for (const v of [d.dBw, d.dFm, d.dLt, d.rmr, d.nDay, d.sN, d.sAT, d.dLabG])
          expect(Number.isFinite(v)).toBe(true);
        const fm = r.base.fm0 + d.dFm;
        expect(fm).toBeGreaterThan(0);
        expect(fm).toBeLessThanOrEqual(prevFm + 1e-9);
        prevFm = fm;
        expect(d.nDay).toBeGreaterThan(0);
      }
    });
  }
});
