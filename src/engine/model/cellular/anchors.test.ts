// @vitest-environment node
/**
 * WP-M11 acceptance (MODEL_SPEC §1.13, §9.2 row 08): 08 §4.10 ASI anchor table within ±5 points on the reference
 * scenario, the illustrative daily patterns, and dossier §7 targets V7-V9 — all driven with HAND-BUILT upstream
 * trajectories (testkit.ts: dossier 03/04/05/20 shapes), because the real intake/fuel/ketones modules are written in
 * parallel. The full-engine re-run (h50 60 h, EC50_I 5 confirmed) is fullLoop.test.ts.
 */
import { sampleParams } from '../../core/paramsRegistry';
import { calibrateB0 } from './index';
import { CELLULAR_REGISTRY, makeRig, mealsForHour, mean, referenceRig, runDays, stepOnce, type DayPattern, type RigOptions } from './testkit';

/** 08 §4.10 step 5 central anchors: hours since the last meal → ASI. */
const ANCHORS: readonly (readonly [number, number])[] = [
  [12, 25],
  [16, 28],
  [18, 30],
  [24, 36],
  [36, 49],
  [48, 60],
  [72, 75],
  [96, 84],
  [120, 89],
  [168, 94],
];
/** The hours MODEL_SPEC §1.13 lists for the ±5 check. */
const SPEC_HOURS = [12, 16, 24, 36, 48, 72, 96, 120, 168];

/** Reference scenario then a water-only fast from the last meal (19:00, day −1): trace index i is hFast = i + 5. */
function fastTrace(opts: RigOptions = {}, days = 8) {
  const { rig, body } = referenceRig(7, opts);
  return { rig, tr: runDays(rig, body, 0, days, () => []) };
}
const OFFSET = 5;

describe('08 §4.10 ASI anchors (7 d of 3 mixed meals, last meal 19:00, then water-only fast)', () => {
  const { tr } = fastTrace();
  const at = (hFast: number): number => tr.asi[hFast - OFFSET]!;

  it('lands every anchor of the table within ±5 points (acceptance)', () => {
    for (const [h, target] of ANCHORS) expect(Math.abs(at(h) - target), `hFast ${h} h: ${at(h).toFixed(1)} vs ${target}`).toBeLessThanOrEqual(5);
  });

  it('lands the spec-listed hours 12, 16, 24, 36, 48, 72, 96, 120, 168 within ±5', () => {
    const table = new Map(ANCHORS);
    for (const h of SPEC_HOURS) expect(Math.abs(at(h) - table.get(h)!), `hFast ${h}`).toBeLessThanOrEqual(5);
  });

  it('is 25 at 12 h post-absorptive by construction (B0 calibration)', () => {
    expect(at(12)).toBeCloseTo(25, 0);
  });

  it('rises monotonically through the fast and saturates below 100', () => {
    for (let h = 13; h <= 168; h++) expect(at(h)).toBeGreaterThanOrEqual(at(h - 1) - 1e-9);
    expect(at(168)).toBeLessThan(100);
    expect(at(168)).toBeGreaterThan(88);
  });

  it('keeps the 12 h = 25 definition and stays inside 0-100 for every parameter draw (B0 recalibrated per draw)', () => {
    const draws = sampleParams(CELLULAR_REGISTRY.defs, { count: 24, seed: 11 });
    for (const paramVector of draws) {
      const { tr: t } = fastTrace({ paramVector }, 3);
      expect(t.asi[12 - OFFSET]!).toBeGreaterThan(24.4);
      expect(t.asi[12 - OFFSET]!).toBeLessThan(25.6);
      for (const v of t.asi) expect(v >= 0 && v <= 100).toBe(true);
    }
  });

  it('draws of h50 over its 24-96 h range move the 48 h value across the dossier band (P10-P90 of 08 §4.10: 41-81)', () => {
    const lo = fastTrace({ params: { 'cellular.h50': 24 } }, 3).tr.asi[48 - OFFSET]!;
    const hi = fastTrace({ params: { 'cellular.h50': 96 } }, 3).tr.asi[48 - OFFSET]!;
    // the glycogen and ketone terms keep the index above the clock-only floor even for a very slow clock (h50 96 h)
    expect(lo).toBeGreaterThan(70);
    expect(lo).toBeLessThan(95);
    expect(hi).toBeGreaterThan(41);
    expect(hi).toBeLessThan(56);
  });
});

describe('fed-state values on the reference habitual day (08 §4.10 table rows 0-1 h and 4 h)', () => {
  it('is suppressed to 2-8 in the first hours after a meal and stays below the post-absorptive 25', () => {
    const { rig, body } = referenceRig(7);
    const tr = runDays(rig, body, 0, 2, (t) => mealsForHour({ name: 'ref', hours: [8, 13, 19], proteinG: 32, carbG: 90 }, t));
    // 08:00 meal: hours 8..12 of day 0 (hFast 0..4)
    expect(tr.asi[8]!).toBeGreaterThanOrEqual(2);
    expect(tr.asi[8]!).toBeLessThanOrEqual(8);
    expect(tr.asi[9]!).toBeLessThanOrEqual(8);
    // dossier row "4 h: 15-18" comes from placeholder kernels that end suppression by ~2.5 h; with the 04 §4.17 insulin tail
    // (dI ≈ 9 µU/mL at 4 h) the index is 8 — recorded as a discrepancy, not tuned away (the spec's checked hours start at 12 h)
    expect(tr.asi[12]!).toBeLessThan(18);
  });
});

/** Daily patterns of 08 §4.10: 120 g protein / 220 g carbohydrate per day, steady state on day 4 (after the reference burn-in). */
const P_DAY = 120;
const C_DAY = 220;
const pattern = (name: string, hours: number[]): DayPattern => ({ name, hours, proteinG: P_DAY / hours.length, carbG: C_DAY / hours.length });
/** [pattern, dossier daily mean, dossier peak, dossier hours ≥ 30]. */
const DAILY: readonly (readonly [DayPattern, number, number, number])[] = [
  [pattern('4 meals 08:00-19:00', [8, 12, 15, 19]), 13, 26, 0],
  [pattern('3 meals 08/13/19', [8, 13, 19]), 15, 26, 0],
  [pattern('16:8 (12/16/20)', [12, 16, 20]), 16, 28, 0],
  [pattern('early TRE 08:00/13:30', [8, 13]), 18, 30, 0.5],
  [pattern('18:6 (13/19)', [13, 19]), 18, 30, 0],
  [pattern('20:4 (16/19:30)', [16, 19]), 19, 32, 2.5],
];
const OMAD: readonly [DayPattern, number, number, number] = [pattern('one meal/day (18:00)', [18]), 24, 36, 6];

function dailyStats(p: DayPattern) {
  const { rig, body } = referenceRig(7);
  const tr = runDays(rig, body, 0, 5, (t) => mealsForHour(p, t));
  const d = tr.asi.slice(24 * 4, 24 * 5);
  let peak = 0;
  let h30 = 0;
  for (const v of d) {
    if (v > peak) peak = v;
    if (v >= 30) h30++;
  }
  return { mean: mean(d), peak, h30 };
}

describe('08 §4.10 illustrative daily patterns (hand-built 03/04 kernels; the full-engine version is in fullLoop.test.ts)', () => {
  it.each(DAILY)('%o: peak within ±3 and hours ≥ 30 within ±3; daily mean within ±5 (fed-state suppression tail differs from the placeholder kernels)', (p, mDoc, peakDoc, h30Doc) => {
    const st = dailyStats(p);
    expect(Math.abs(st.peak - peakDoc), `${p.name} peak ${st.peak.toFixed(1)} vs ${peakDoc}`).toBeLessThanOrEqual(3);
    expect(Math.abs(st.h30 - h30Doc), `${p.name} h≥30 ${st.h30} vs ${h30Doc}`).toBeLessThanOrEqual(3);
    expect(Math.abs(st.mean - mDoc), `${p.name} mean ${st.mean.toFixed(1)} vs ${mDoc}`).toBeLessThanOrEqual(5);
  });

  it('one meal a day: peak and hours ≥ 30 match', () => {
    const st = dailyStats(OMAD[0]);
    expect(Math.abs(st.peak - OMAD[2])).toBeLessThanOrEqual(3);
    expect(Math.abs(st.h30 - OMAD[3])).toBeLessThanOrEqual(3);
  });

  // KNOWN MISS (reported): the dossier's daily mean 24 for one meal/day comes from placeholder kernels; with the 04 §4.17
  // insulin tail after a 220 g carbohydrate / 120 g protein meal the fed-state suppression lasts longer and the mean is ≈ 18.4
  // (≈ 17 with the real intake curves in the full engine, fullLoop.test.ts).
  it.fails('one meal a day: daily mean within ±5 of 24 (measured ≈ 18.4, −5.6)', () => {
    const st = dailyStats(OMAD[0]);
    expect(Math.abs(st.mean - OMAD[1])).toBeLessThanOrEqual(5);
  });

  it('orders the patterns by eating-window length (meal timing moves the mean by only a few points)', () => {
    const means = [...DAILY.map(([p]) => p), OMAD[0]].map((p) => dailyStats(p).mean);
    // 4 meals ≈ 3 meals < 16:8 < 18:6 ≈ early TRE < 20:4 < OMAD
    expect(means[2]!).toBeGreaterThan(means[1]!);
    expect(means[5]!).toBeGreaterThan(means[4]!);
    expect(means[6]!).toBeGreaterThan(means[5]!);
    expect(means[6]! - means[0]!).toBeLessThan(15);
  });

  it('skip-a-day 36 h fast: daily mean ≈ 30, peak ≈ 41, ≈ 50 just before the next breakfast', () => {
    const p = pattern('3 meals', [8, 13, 19]);
    const { rig, body } = referenceRig(7);
    const tr = runDays(rig, body, 0, 6, (t) => (Math.floor(t / 24) === 3 ? [] : mealsForHour(p, t)));
    const d = tr.asi.slice(72, 96);
    expect(Math.abs(mean(d) - 30)).toBeLessThanOrEqual(5);
    expect(Math.abs(Math.max(...d) - 41)).toBeLessThanOrEqual(5);
    expect(Math.abs(tr.asi[96 + 7]! - 50)).toBeLessThanOrEqual(5);
  });

  it('water-only fast hours 53-77 after the last meal: mean ≈ 72, peak ≈ 78', () => {
    const { tr } = fastTrace({}, 5);
    const seg = tr.asi.slice(53 - OFFSET, 78 - OFFSET);
    expect(Math.abs(mean(seg) - 72)).toBeLessThanOrEqual(5);
    expect(Math.abs(Math.max(...seg) - 78)).toBeLessThanOrEqual(5);
  });
});

describe('08 §7 validation targets', () => {
  const mk = (hours: number[], P: number, C: number): DayPattern => ({ name: 'x', hours, proteinG: P / hours.length, carbG: C / hours.length });

  it('V7 (Singh 2026): 10 % vs 20 % protein, same meal times, energy balance → |Δ weekly mean ASI| ≤ 3', () => {
    const weekly = (P: number, C: number): number => {
      const { rig, body } = referenceRig(7);
      const p = mk([8, 13, 19], P, C);
      const tr = runDays(rig, body, 0, 10, (t) => mealsForHour(p, t));
      return mean(tr.asi, 72, 72 + 168);
    };
    // 2 400 kcal: 10 % = 60 g protein, 20 % = 120 g; carbohydrate balances energy
    expect(Math.abs(weekly(60, 330) - weekly(120, 240))).toBeLessThanOrEqual(3);
  });

  it('V8 (Jamshed 2019): eTRF 08-14 vs 08-20 → pre-breakfast ASI ≈ 30 vs ≈ 25 and a higher daily mean', () => {
    const run = (hours: number[]) => {
      const { rig, body } = referenceRig(7);
      const tr = runDays(rig, body, 0, 5, (t) => mealsForHour(mk(hours, 90, 250), t));
      const d = tr.asi.slice(72, 96);
      return { pre: d[7]!, mean: mean(d) };
    };
    const etrf = run([8, 11, 13]);
    const control = run([8, 14, 19]);
    expect(Math.abs(etrf.pre - 30)).toBeLessThanOrEqual(5);
    expect(Math.abs(control.pre - 25)).toBeLessThanOrEqual(5);
    expect(etrf.pre).toBeGreaterThan(control.pre + 3);
    expect(etrf.mean).toBeGreaterThan(control.mean + 2);
  });

  it('V9 (Bensalem 2025): iTRE > CR ≥ SC; iTRE − SC ≥ 4; CR − SC ≤ 5 (CR-only arm within 4-5 points)', () => {
    type Day = { hours: number[]; P: number; C: number; u: number };
    const arm = (day: (d: number) => Day): number => {
      const { rig, body } = referenceRig(7);
      const tr = runDays(
        rig,
        body,
        0,
        56,
        (t) => {
          const x = day(Math.floor(t / 24));
          return mealsForHour(mk(x.hours, x.P, x.C), t);
        },
        (t, r) => {
          r.bus.energyBalanceFrac = day(Math.floor(t / 24)).u;
        },
      );
      return mean(tr.asi, 24 * 35, 24 * 56);
    };
    const normal: Day = { hours: [8, 13, 19], P: 96, C: 260, u: 0 };
    const sc = arm(() => normal);
    const cr = arm(() => ({ hours: [8, 13, 19], P: 96, C: 130, u: -0.3 }));
    const itre = arm((d) => (d % 7 < 3 ? { hours: [8], P: 40, C: 60, u: -0.7 } : normal));
    expect(itre).toBeGreaterThan(cr);
    expect(cr).toBeGreaterThanOrEqual(sc);
    expect(itre - sc).toBeGreaterThanOrEqual(4);
    expect(cr - sc).toBeLessThanOrEqual(5);
  });

  it('V1 (Vendelbo 2014): mTORC1 baseline at 72 h = 0.50-0.65 × its 12 h value; muscle ASI at 72 h ≥ 60', () => {
    const { tr } = fastTrace({}, 5);
    const m12 = tr.mtor[12 - OFFSET]!;
    const m72 = tr.mtor[72 - OFFSET]!;
    expect(m72 / m12).toBeGreaterThanOrEqual(0.5);
    expect(m72 / m12).toBeLessThanOrEqual(0.65);
    expect(tr.asiMuscle[72 - OFFSET]!).toBeGreaterThanOrEqual(60);
  });

  it('V3 (Wijngaarden 2013): AMPK index at 48 h of fasting does not exceed its rest value (no increase)', () => {
    const { tr } = fastTrace({}, 4);
    expect(tr.ampk[48 - OFFSET]!).toBeLessThanOrEqual(tr.ampk[12 - OFFSET]! + 1e-9);
    for (let h = 12; h <= 96; h++) expect(tr.ampk[h - OFFSET]!).toBeLessThanOrEqual(tr.ampk[12 - OFFSET]! + 1e-9);
  });
});

describe('the reference rig itself', () => {
  it('samples the person\'s own 12-h references on the burn-in days and latches them with B0 in endBurnIn', () => {
    const { rig } = referenceRig(7);
    // the references are the hand-built body's values at the 12 h crossing (07:00 after the 19:00 meal); the first
    // burn-in day starts at hFast 12 h without a previous hour, so 6 crossings of the 7 days count
    expect(rig.s.refN).toBe(6);
    expect(rig.s.liverRef12G).toBeGreaterThan(55);
    expect(rig.s.liverRef12G).toBeLessThan(90);
    expect(rig.s.bhbRef12MmolL).toBeGreaterThan(0.1);
    expect(rig.s.bhbRef12MmolL).toBeLessThan(0.2);
    expect(rig.s.calibrated).toBe(1);
    expect(rig.s.b0).toBeCloseTo(calibrateB0(rig.k, rig.s.bhbRef12MmolL), 12);
    // the basal insulin is intake's (here the body's basal at full liver glycogen ≈ 7 µU/mL)
    expect(rig.s.insBasalUuMl).toBeGreaterThan(5);
    expect(rig.s.insBasalUuMl).toBeLessThan(9);
  });

  it('without a burn-in the priors stand (B0 nominal) until endBurnIn or day 0 latches them', () => {
    const rig = makeRig();
    expect(rig.s.b0).toBeCloseTo(rig.k.b0Nominal, 12);
    expect(rig.s.calibrated).toBe(0);
    stepOnce(rig, 0);
    expect(rig.s.calibrated).toBe(1);
    expect(rig.s.b0).toBeCloseTo(rig.k.b0Nominal, 12);
  });
});
