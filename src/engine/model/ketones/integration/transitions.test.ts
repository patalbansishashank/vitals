/**
 * Integration (integrator A2, goal 3): diet transitions the owner asked for, run through the real input schema in the
 * FULL engine (`runEngine` over every module). Targets and tolerances from the dossiers:
 *  - 05 §4.7 (time to ketosis; steady-state dose-response surface for an 80-kg / 62-kg-FFM adult, protein ≈ 1.3 g/kg,
 *    3 meals, week-4 07:00 and 24-h mean values; tolerance 05 §7: ±30 % or ±0.15 mM), 05 §4.8 (protein), 05 §4.9 (exit
 *    and re-entry), 05 §4.11.1 / 13 §4.9 + §4A T9-T10 (fat adaptation build and wash-out), 13 §4A T4-T5 and T8 (glycogen
 *    refill, scale rebound, re-entry 2-5 d), 07 §4.4.1 Table A and §7 #3 (eating windows on a mixed diet: no ketosis).
 * The 05 surface is the dossier model's own output (PROPOSED); rows it misses stay as `it.fails` with the numbers.
 */
import { describe, expect, it } from 'vitest';
import { gramsCP, kitPerson, kitSchedule, neutral, pctCP, program, runKit, type KitRun } from './engineKit';
import { bhbTol, runBurke } from './targets';
import type { DayTemplate } from '../../../types/schedule';

/** 05 §4.7 reference adult: 80 kg, 62 kg FFM (22 % fat), protein ≈ 1.3 g/kg (104 g/d). */
const MAN80 = kitPerson({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 80, bodyFatPct: 22 });
const SWITCH = 7;
const WEEK4 = SWITCH + 27;
const morning = (r: KitRun, d: number): number => r.probe.bhb[24 * d + 7]!;
const dayMean = (r: KitRun, d: number): number => {
  let s = 0;
  for (let h = 24 * d; h < 24 * d + 24; h++) s += r.probe.bhb[h]!;
  return s / 24;
};
const within = (v: number, target: number, tol = bhbTol(target)): boolean => Math.abs(v - target) <= tol;

const cache = new Map<string, KitRun>();
function switchRun(carbG: number, pct: number, proteinG = 104): KitRun {
  const key = `${carbG}/${pct}/${proteinG}`;
  let r = cache.get(key);
  if (!r) {
    r = runKit(MAN80, kitSchedule(SWITCH + 28, [program('mixed', 100, neutral('male')), program('vlc', pct, gramsCP(proteinG, carbG))], (d) => (d < SWITCH ? 0 : 1)));
    cache.set(key, r);
  }
  return r;
}
/** First morning after the switch day with BHB ≥ 0.5 mM (1 = the morning after the switch day). */
function firstKetoticMorning(r: KitRun): number {
  for (let d = SWITCH + 1; d < r.result.meta.nDays; d++) if (morning(r, d) >= 0.5) return d - SWITCH;
  return Number.NaN;
}

describe('mixed diet → < 30 g/d carbohydrate (05 §4.7)', () => {
  it('25 % deficit: first morning ≥ 0.5 mM within 1-3 days (05 surface: day 2)', () => {
    const d = firstKetoticMorning(switchRun(30, 75));
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(3);
  });
  it('0 g/d at maintenance: within 1-4 days (05 surface: day 2; Harvey 2018: cohort mean ≥ 0.5 on day 4)', () => {
    expect(firstKetoticMorning(switchRun(0, 100))).toBeLessThanOrEqual(4);
  });
  it('20 g/d and 30 g/d at maintenance: within 1-4 days (05 §4.7: day 2-3; Harvey 2018: cohort mean ≥ 0.5 on day 4)', () => {
    expect(firstKetoticMorning(switchRun(20, 100))).toBeLessThanOrEqual(4);
    expect(firstKetoticMorning(switchRun(30, 100))).toBeLessThanOrEqual(4);
  });
  it('20 g/d and 50 g/d in a 25 % deficit: within 1-3 days (05 §4.7 table: day 2)', () => {
    expect(firstKetoticMorning(switchRun(20, 75))).toBeLessThanOrEqual(3);
    expect(firstKetoticMorning(switchRun(50, 75))).toBeLessThanOrEqual(3);
  });
  // KNOWN MISS: 50 g/d at maintenance first reaches 0.5 mM on day 6 (05 surface: day 3; Harvey 2019's 15 %E arm reached
  // ≥ 0.5 only "sporadically"). The engine's liver keeps ≈ 10 g above its 5-g floor on 50 g/d, so basal insulin stays higher.
  it.fails('50 g/d at maintenance: within 1-4 days (05 §4.7 surface: day 3)', () => {
    expect(firstKetoticMorning(switchRun(50, 100))).toBeLessThanOrEqual(4);
  });
  it('week-4 dose-response by carbohydrate at maintenance: 07:00 BHB within 05 tolerance of the surface (0 → 175 g/d)', () => {
    const surface: [number, number][] = [[0, 0.71], [30, 0.64], [50, 0.59], [75, 0.51], [100, 0.43], [130, 0.33], [175, 0.1]];
    const bad = surface.filter(([c, t]) => !within(morning(switchRun(c, 100), WEEK4), t)).map(([c, t]) => `${c} g: ${morning(switchRun(c, 100), WEEK4).toFixed(2)} vs ${t}`);
    expect(bad).toEqual([]);
  });
  it('… and it falls monotonically with carbohydrate (soft threshold 50-100 g/d)', () => {
    const v = [0, 30, 50, 75, 100, 130, 175].map((c) => morning(switchRun(c, 100), WEEK4));
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThan(v[i - 1]!);
    expect(v[4]!).toBeLessThan(0.5); // 100 g/d does not keep a 0.5-mM morning at maintenance (05 table: "never")
  });
  it('a 25 % deficit raises week-4 BHB (05: ×1.6-1.8); 30 g/d morning 1.04 mM within tolerance', () => {
    const eu = morning(switchRun(30, 100), WEEK4);
    const def = morning(switchRun(30, 75), WEEK4);
    expect(def / eu).toBeGreaterThan(1.3);
    expect({ def, ok: within(def, 1.04) }).toMatchObject({ ok: true });
  });
  it('week-4 24-h mean BHB: 30 g/d 0.43 (maintenance) and 0.68 (25 % deficit) within 05 tolerance', () => {
    expect({ v: dayMean(switchRun(30, 100), WEEK4), ok: within(dayMean(switchRun(30, 100), WEEK4), 0.43) }).toMatchObject({ ok: true });
    expect({ v: dayMean(switchRun(30, 75), WEEK4), ok: within(dayMean(switchRun(30, 75), WEEK4), 0.68) }).toMatchObject({ ok: true });
  });
  it('hourly shape of a very-low-carbohydrate day (week 4, 30 g/d): dips after each meal and recovers overnight (05 §4.5: trough 2-3 h after meals, peak at the end of the overnight fast; Urbain: ≈ 2.3-fold swing)', () => {
    const r = switchRun(30, 100);
    const d0 = 24 * WEEK4;
    const v = Array.from({ length: 24 }, (_, h) => r.probe.bhb[d0 + h]!);
    const max = Math.max(...v);
    const min = Math.min(...v);
    const hMax = v.indexOf(max);
    const hMin = v.indexOf(min);
    expect(hMax).toBeLessThanOrEqual(8); // overnight / pre-breakfast peak (meals 08-20 h)
    expect(hMin).toBeGreaterThan(8);
    expect(max / min).toBeGreaterThan(1.3);
    expect(max / min).toBeLessThan(4);
    // after each meal BHB falls within 3 h and has recovered by the next morning
    expect(v[10]!).toBeLessThan(v[7]!);
    let yMin = Infinity;
    for (let h = d0 - 12; h < d0; h++) yMin = Math.min(yMin, r.probe.bhb[h]!);
    expect(v[7]!).toBeGreaterThan(1.2 * yMin); // the previous evening's post-meal dip has recovered by 07:00
    expect(min).toBeGreaterThan(0.2); // stays in light ketosis all day (not 0.1-0.2 mM)
  });
  it('the 5 %E carbohydrate / 15 %E protein diet (Hall 2016 V5 arm, 90 % of maintenance): week-4 07:00 0.77 ± 0.23 and a 24-h mean ≥ 0.4 mM', () => {
    const hall = runKit(kitPerson({ sex: 'male', ageYears: 34, heightCm: 178, weightKg: 95, bodyFatPct: 30 }), kitSchedule(56, [program('bd', 90, pctCP(15, 48.4)), program('kd', 90, pctCP(15, 5))], (d) => (d < 28 ? 0 : 1)));
    let m = 0;
    for (let d = 42; d < 56; d++) m += morning(hall, d) / 14;
    expect({ m, ok: within(m, 0.77) }).toMatchObject({ ok: true });
    expect(dayMean(hall, 55)).toBeGreaterThan(0.4);
  });
  it('carbohydrate dose-response over 3 weeks (Harvey 2019 V6: +0.62 / +0.41 / +0.27 mM at 5 / 15 / 25 %E, protein 15 %E)', () => {
    const men70 = kitPerson({ sex: 'male', ageYears: 21, heightCm: 178, weightKg: 70, bodyFatPct: 13 });
    const got = ([[5, 0.62], [15, 0.41], [25, 0.27]] as const).map(([c, t]) => {
      const r = runKit(men70, kitSchedule(21, [program(`c${c}`, 100, pctCP(15, c))], () => 0));
      let x = 0;
      for (let d = 17; d < 21; d++) x += morning(r, d) / 4;
      return { c, d: Number((x - r.initial('bhb')).toFixed(3)), ok: within(x - r.initial('bhb'), t) };
    });
    expect(got.filter((g) => !g.ok)).toEqual([]);
    expect(got[0]!.d).toBeGreaterThan(got[1]!.d);
    expect(got[1]!.d).toBeGreaterThan(got[2]!.d);
  });
  it('high protein keeps nutritional ketosis: 30 %E protein at 30 g/d still ≥ 0.5 mM in the morning; with 2.2 g/kg protein and daily training (Burke) ≥ 0.84 mM', () => {
    expect(morning(switchRun(30, 100, 0.3 * 2500 / 4), SWITCH + 20)).toBeGreaterThan(0.5);
    const bu = runBurke();
    expect(bu.probe.bhb[24 * 5 + 6]!).toBeGreaterThan(0.84);
  });
  // 05 §4.8: no RCT isolates protein at fixed carbohydrate (open question); 05's model gives −25 % from 60 to 180 g/d,
  // diet data fit a weak effect. Coupled calibration: k_prot 0 → the effect is protein-stimulated insulin only (≈ −5 %).
  it('protein at 30 g/d carbohydrate: 60 → 180 g/d does not raise BHB (≤ +3 %) and lowers it by at most 35 % (05 §4.8, grade C)', () => {
    const v = [60, 104, 140, 180].map((p) => morning(switchRun(30, 100, p), WEEK4));
    expect(v[3]! / v[0]!).toBeLessThanOrEqual(1.03);
    expect(v[3]! / v[0]!).toBeGreaterThan(0.65);
  });
  it('fast fat adaptation builds in ≈ 5-6 days (A_f ≥ 0.9; 05 V13: 0.85 at day 6; 13 T9 plateau 5-6 d)', () => {
    const r = switchRun(30, 100);
    let t = Number.NaN;
    for (let h = 24 * SWITCH; h < r.probe.aF.length; h++) {
      if (r.probe.aF[h]! >= 0.9) {
        t = (h - 24 * SWITCH) / 24;
        break;
      }
    }
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThan(7);
  });
});

describe('high-carbohydrate meals, days and weekends inside a very-low-carbohydrate period (05 §4.9, 13 T8)', () => {
  const vlc = program('vlc', 100, gramsCP(104, 30));
  const lunch: DayTemplate = { ...program('lunch', 100, gramsCP(104, 130)), meals: { meals: [{ clockH: 8, share: 0.25, macros: { carbG: 10 } }, { clockH: 13, share: 0.45, macros: { carbG: 110 } }, { clockH: 19, share: 0.3, macros: { carbG: 10 } }] } };
  const run = (tmpl: DayTemplate, nDays: number): KitRun =>
    runKit(MAN80, kitSchedule(40, [program('mixed', 100, neutral('male')), vlc, tmpl], (d) => (d < SWITCH ? 0 : d >= 28 && d < 28 + nDays ? 2 : 1)));
  const reentry = (r: KitRun, nDays: number): number => {
    const pre = morning(r, 27);
    for (let d = 28 + nDays; d < 40; d++) if (morning(r, d) >= 0.9 * pre) return d - (28 + nDays) + 1;
    return Number.NaN;
  };
  const rl = run(lunch, 1);
  const rd = run(program('hcday', 100, gramsCP(104, 300)), 1);
  const rw = run(program('wk', 100, gramsCP(104, 350)), 2);
  // 05 §4.9 / V7: a ≈ 110-g carbohydrate load halves BHB in ≈ 1 h and leaves ≈ 1/3 at 4 h. Hour means here: the hour
  // before the 13:00 lunch vs the 2nd and 4th hour after it (the V7 exit rows pass within ±0.15 mM in targets.ts).
  it('BHB falls within hours of a 110-g carbohydrate lunch (≤ 70 % in the 2nd hour, ≤ 50 % by the 4th; 05 §4.9)', () => {
    const pre = rl.probe.bhb[24 * 28 + 12]!;
    expect(rl.probe.bhb[24 * 28 + 14]! / pre).toBeLessThan(0.7);
    expect(rl.probe.bhb[24 * 28 + 16]! / pre).toBeLessThan(0.5);
  });
  it('re-entry to ≥ 90 % of the pre-refeed morning BHB: single meal ≤ 3 mornings, one 300-g day within 2-5 (13 T8: 2-5 d; 05 model day 3)', () => {
    expect(reentry(rl, 1)).toBeLessThanOrEqual(3);
    expect(reentry(rd, 1)).toBeGreaterThanOrEqual(2);
    expect(reentry(rd, 1)).toBeLessThanOrEqual(5);
  });
  // KNOWN MISS: after a 2 × 350-g weekend re-entry takes 6 mornings (13 T8: 2-5 d): 04's liver refills to ≈ 90 g and drains
  // with τ_L 20 h under meal suppression, and 05's basal insulin factor follows it.
  it.fails('re-entry after a 2-day high-carbohydrate weekend within 5 mornings (13 T8)', () => {
    expect(reentry(rw, 2)).toBeLessThanOrEqual(5);
  });
  it('re-entry takes longer the more glycogen was refilled (lunch < day < weekend)', () => {
    expect(reentry(rl, 1)).toBeLessThanOrEqual(reentry(rd, 1));
    expect(reentry(rd, 1)).toBeLessThan(reentry(rw, 2));
  });
  it('fat adaptation persists partly after one high-carbohydrate day (05 V13: ≈ 55 % left after 24 h; 13 T10) and washes out over 5-6 d', () => {
    const a0 = rd.probe.aF[24 * 28]!;
    const a1 = rd.probe.aF[24 * 29]!;
    expect(a1 / a0).toBeGreaterThan(0.5);
    expect(a1 / a0).toBeLessThan(0.85);
    // wash-out on a sustained high-carbohydrate diet (τ 40 h): < 10 % left after 5.5 days
    const hc = runKit(MAN80, kitSchedule(SWITCH + 21, [program('mixed', 100, neutral('male')), vlc, program('hc', 100, gramsCP(104, 400))], (d) => (d < SWITCH ? 0 : d < SWITCH + 14 ? 1 : 2)));
    const start = hc.probe.aF[24 * (SWITCH + 14)]!;
    expect(start).toBeGreaterThan(0.9);
    expect(hc.probe.aF[24 * (SWITCH + 14) + 132]!).toBeLessThan(0.1);
  });
});

describe('very-low → high carbohydrate: glycogen refill, supercompensation and scale rebound (13 T4-T5)', () => {
  const r = runKit(MAN80, kitSchedule(35, [program('mixed', 100, neutral('male')), program('vlc', 100, gramsCP(104, 30)), program('hc', 100, gramsCP(104, 450))], (d) => (d < SWITCH ? 0 : d < 28 ? 1 : 2)));
  it('liver glycogen refills within a day and muscle glycogen rises above the mixed-diet level within 2-3 days', () => {
    expect(r.probe.liverG[24 * 28 + 23]!).toBeGreaterThan(0.6 * r.initial('liverGlycogen'));
    expect(r.probe.muscleG[24 * 30 + 23]!).toBeGreaterThan(1.2 * r.initial('muscleGlycogen'));
  });
  it('the scale rebounds by 1-3 kg within 1-5 days (13 T4)', () => {
    const up = r.hour('scaleWeight', 24 * 31 + 7) - r.hour('scaleWeight', 24 * 28 + 7);
    expect(up).toBeGreaterThan(0.8);
    expect(up).toBeLessThan(3);
  });
});

describe('eating windows on a mixed diet do not produce ketosis (07 §4.4.1 Table A, §7 #3)', () => {
  const win = (meals: [number, number][]): KitRun => {
    const t: DayTemplate = { ...program('w', 100, neutral('male')), meals: { meals: meals.map(([c, s]) => ({ clockH: c, share: s })) } };
    return runKit(MAN80, kitSchedule(14, [t], () => 0));
  };
  it('BHB at the end of the daily fast: 16:8 ≈ 0.17, 18:6 0.15 ± 0.1 (eTRF), 20:4 ≈ 0.22, OMAD ≈ 0.3 — all < 0.5 mM', () => {
    const cases: [string, [number, number][], number][] = [
      ['16:8', [[12, 0.4], [19, 0.6]], 0.17],
      ['18:6', [[8, 0.4], [13, 0.6]], 0.15],
      ['20:4', [[15, 0.5], [18, 0.5]], 0.22],
      ['OMAD', [[18, 1]], 0.3],
    ];
    const got = cases.map(([name, meals, t]) => {
      const r = win(meals);
      const v = r.probe.bhb[24 * 13 + meals[0]![0] - 1]!;
      let mx = 0;
      for (let h = 24 * 13; h < 24 * 14; h++) mx = Math.max(mx, r.probe.bhb[h]!);
      return { name, v: Number(v.toFixed(3)), ok: Math.abs(v - t) <= 0.1 && mx < 0.5 };
    });
    expect(got.filter((g) => !g.ok)).toEqual([]);
  });
});
