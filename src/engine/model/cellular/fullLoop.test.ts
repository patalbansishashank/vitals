// @vitest-environment node
/**
 * Full-engine acceptance of the cellular module (MODEL_SPEC §1.13, §9.2 row 08): the 08 §4.10 ASI anchor table and the
 * illustrative daily-pattern table re-run with the REAL intake / fuel / ketones / muscle signals (integration item 13),
 * plus the habitual-maintenance baseline. Unlike anchors.test.ts (hand-built upstream trajectories) these runs depend on
 * every module; a failure here with anchors.test.ts green points at an upstream signal.
 *
 * Known misses, measured 2026-09-30 (kept as `it.fails`, never loosened): the fed-state rows. intake's meal insulin stays
 * far above its basal for many hours (ins − basal ≈ +30…+100 µU/mL 4 h after a 3-meal-day meal, +3 µU/mL 11 h after
 * dinner; 08 §4.4 assumes a return to basal by ≈ 2.5-4 h), so S_ins ≈ 0.9-1 through most waking hours and the daily
 * means sit 3-8 points under the dossier's placeholder-kernel table. The anchors (≥ 12 h, insulin at basal) are unaffected.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { DayTemplate, PersonProfile, Schedule } from '../../types';

/** 08 §4.10 reference person: 3 mixed meals, 1.2 g/kg protein, last meal 19:00 (habitual window 08:00-19:00). */
const REF: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 },
  habits: { habitualMealsPerDay: 3, habitualWindowStartH: 8, habitualWindowLengthH: 11, habitualProteinGPerKg: 1.2, sessionsPerWeek: 0, typicalSteps: 6000 },
  startDate: '2026-10-05',
};

const day = (id: string, hours: readonly number[], macros: DayTemplate['macros']): DayTemplate => ({
  id,
  label: id,
  energy: { kind: 'pctMaintenance', pct: 100 },
  macros,
  meals: { meals: hours.map((h) => ({ clockH: h, share: 1 })) },
});

function hourlyAsi(profile: PersonProfile, sched: Schedule): Float32Array {
  const rp = resolveProfile(profile);
  const r = runEngine(rp, compileSchedule(sched, rp), { record: 'full', series: ['autophagyIdx'] });
  return r.hourly.autophagyIdx!;
}

const mean = (a: ArrayLike<number>, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]!;
  return s / (to - from);
};
const max = (a: ArrayLike<number>, from: number, to: number): number => {
  let m = -Infinity;
  for (let i = from; i < to; i++) m = Math.max(m, a[i]!);
  return m;
};

describe('08 §4.10 anchor table through the full engine (7 d habitual meals, last meal 19:00, then water only)', () => {
  const rp = resolveProfile(REF);
  const habitual = { protein: { unit: 'g', value: rp.habitualProteinG }, carbs: { unit: 'g', value: rp.habitualCarbG }, fat: { unit: 'remainder' }, fibre: { unit: 'g', value: rp.habitualFibreG } } as const;
  const asi = hourlyAsi(REF, {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: 15,
    programs: [day('ref', [8, 13, 19], habitual)],
    days: Array.from({ length: 15 }, () => ({ program: 0 })),
    events: [{ kind: 'fast', startDay: 6, startH: 19, durationH: 190 }],
  });
  const LAST_MEAL = 6 * 24 + 19;
  const at = (hFast: number): number => asi[LAST_MEAL + hFast]!;
  // measured (h50 60 h, final fuel/ketones): 22.0, 29.1, 38.0, 53.4, 63.6, 78.1, 85.7, 90.2, 95.0 (12 h is below 25 by the intake insulin tail)
  const TABLE: readonly (readonly [number, number])[] = [[12, 25], [16, 28], [24, 36], [36, 49], [48, 60], [72, 75], [96, 84], [120, 89], [168, 94]];

  it('lands the spec-listed hours 12, 16, 24, 36, 48, 72, 96, 120, 168 within ±5 points (h50 60 h, EC50_I 5 µU/mL)', () => {
    for (const [h, target] of TABLE) expect(Math.abs(at(h) - target), `hFast ${h} h: ${at(h).toFixed(1)} vs ${target}`).toBeLessThanOrEqual(5);
  });

  it('water-only fast hours 53-77 after the last meal: mean ≈ 72, peak ≈ 78 (±5)', () => {
    expect(Math.abs(mean(asi, LAST_MEAL + 53, LAST_MEAL + 77) - 72)).toBeLessThanOrEqual(5);
    expect(Math.abs(max(asi, LAST_MEAL + 53, LAST_MEAL + 77) - 78)).toBeLessThanOrEqual(5);
  });

  it('rises monotonically through the fast and stays below 100', () => {
    for (let h = 13; h <= 168; h++) expect(at(h)).toBeGreaterThanOrEqual(at(h - 1) - 1e-6);
    expect(at(168)).toBeLessThan(100);
  });
});

describe('08 §4.10 illustrative daily patterns through the full engine (120 g protein, 220 g carbohydrate, day 4)', () => {
  const P = { protein: { unit: 'g', value: 120 }, carbs: { unit: 'g', value: 220 }, fat: { unit: 'remainder' } } as const;
  const run = (hours: readonly number[]) => {
    const a = hourlyAsi(REF, { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 6, programs: [day('p', hours, P)], days: Array.from({ length: 6 }, () => ({ program: 0 })) });
    return { mean: mean(a, 96, 120), peak: max(a, 96, 120) };
  };
  const threeMeals = run([8, 13, 19]);
  const tre16 = run([12, 16, 20]);
  const tre18 = run([13, 19]);
  const tre20 = run([16, 19.5]);
  const omad = run([18]);

  it('daily peaks within ±5 of the table (3 meals 26, 16:8 28, 18:6 30, 20:4 32, one meal 36)', () => {
    // measured 24.2, 30.0, 32.2, 35.4, 37.8
    for (const [r, target] of [[threeMeals, 26], [tre16, 28], [tre18, 30], [tre20, 32], [omad, 36]] as const) expect(Math.abs(r.peak - target)).toBeLessThanOrEqual(5);
  });

  it('the daily mean rises as the eating window shortens (12 h < 16:8 < 18:6 < 20:4 < one meal)', () => {
    expect(tre16.mean).toBeGreaterThan(threeMeals.mean);
    expect(tre18.mean).toBeGreaterThan(tre16.mean);
    expect(tre20.mean).toBeGreaterThan(tre18.mean);
    expect(omad.mean).toBeGreaterThan(tre20.mean);
  });

  // MISS (see file header): measured daily means ≈ 7 / 10 / 11.5 / 15 / 17 vs 15 / 16 / 18 / 19 / 24 — the intake insulin
  // tail keeps S_ins ≈ 1 for hours after each meal. Not tunable inside the module's ranges: EC50_I 15 (the range top) moves
  // the 4 h value only 4.7 → 6.1 (table 15-18) and the 3-meal mean 7.3 → 9.4. Reported to the intake owner (04 §4.17).
  it.fails('daily means within ±5 of the table (3 meals 15, 16:8 16, 18:6 18, 20:4 19, one meal 24)', () => {
    for (const [r, target] of [[threeMeals, 15], [tre16, 16], [tre18, 18], [tre20, 19], [omad, 24]] as const) expect(Math.abs(r.mean - target)).toBeLessThanOrEqual(5);
  });
});

describe('habitual maintenance baseline (3 meals 08:00-20:00, MODEL_SPEC §3.4)', () => {
  it('a sedentary and a habitual cardio exerciser repeating their habitual week show no ASI drift over 90 days (weekly means)', () => {
    for (const habits of [{ sessionsPerWeek: 0 }, { sessionsPerWeek: 4, lifingCardioMix: 1, trainingHistory: '1to3y' as const }]) {
      const p: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 45, heightCm: 176, weightKg: 83.6 }, habits, startDate: '2026-10-05' };
      const rp = resolveProfile(p);
      const programs: DayTemplate[] = [0, 1, 2, 3, 4, 5, 6].map((wd) => ({
        id: `w${wd}`,
        label: `w${wd}`,
        energy: { kind: 'pctMaintenance', pct: 100 },
        macros: { protein: { unit: 'g', value: rp.habitualProteinG }, carbs: { unit: 'g', value: rp.habitualCarbG }, fat: { unit: 'remainder' }, fibre: { unit: 'g', value: rp.habitualFibreG } },
        meals: { count: 3, window: { startH: 8, lengthH: 12 } },
        // the habitual week places session i on weekday ⌊7i/N⌋ at 18:00 (core/compileSchedule.habitualWeek)
        exercise: (habits.sessionsPerWeek === 4 && [0, 1, 3, 5].includes(wd) ? [{ kind: 'cardio', modality: 'other', startH: 18, durationMin: 60, met: 5 }] : []) as DayTemplate['exercise'],
      }));
      const r = runEngine(rp, compileSchedule({ schemaVersion: 1, startDate: '2026-10-05', horizonDays: 91, programs, days: Array.from({ length: 91 }, (_, d) => ({ program: d % 7 })) }, rp), { record: 'daily', series: ['autophagyIdx'] });
      const d = r.daily.autophagyIdx!;
      expect(Math.abs(mean(d, 84, 91) - mean(d, 0, 7))).toBeLessThan(0.3);
    }
  });
});
