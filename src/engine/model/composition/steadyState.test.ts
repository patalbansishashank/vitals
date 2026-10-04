// @vitest-environment node
/**
 * Maintenance steady state of the whole 16-module engine (invariant O-12, MODEL_SPEC §9.1; review B3; integration A1).
 *
 * A weight-stable person who keeps doing exactly their habitual week at 100 % of baseline maintenance must not drift:
 * the burn-in runs that week, energy calibrates NEAT0 on it (mass-dependent TEE removed), composition and water re-anchor
 * at `endBurnIn`, and the partition uses the weekly boxcar EB7 with the m20 blend so training/rest days do not ratchet lean
 * against fat. Matrix: both sexes × age 22/45/70 × BMI 20/27/38 × sedentary / 3 RT sessions/wk / 4 cardio sessions/wk at the
 * habitual diet (45 %E carbohydrate, 3 meals, 12-h window), plus the diet factors (carbohydrate 20/45/65 %E × 2/3 meals ×
 * 8/12-h window) on a sedentary and a cardio person. 90 days each.
 *
 * Checks per cell: |ΔFM| and |ΔLT| (day 90 vs t = 0), wake-to-wake scale drift over 12 weeks (day 84 vs day 0, same
 * weekday), the literal O-12 "day-90 wake-hour scale vs t = 0" (morning anchor, orchestrator ruling 2026-09-30: the t = 0
 * value of the scale series is day 0's wake-hour value, which equals the entered weight — O-5), t = 0 scale = entered
 * weight at the day-0 wake hour, no glycogen / labile-water trend (same weekday, day 83 vs day 6).
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { PersonProfile } from '../../types';
import { habitualWeekSchedule } from '../../validation/fixtures/programs';

vi.setConfig({ testTimeout: 120_000 });

const TOL = { fatKg: 0.15, leanKg: 0.15, scaleDriftKg: 0.3, t0Kg: 0.05, glycogenRel: 0.05, waterKg: 0.15 } as const;
const DAYS = 90;

interface Cell {
  sex: 'male' | 'female';
  age: number;
  bmi: number;
  ex: 'sedentary' | 'rt' | 'cardio';
  carbPct: number;
  meals: number;
  windowH: number;
}

function profileOf(c: Cell): PersonProfile {
  const h = c.sex === 'male' ? 178 : 164;
  return {
    schemaVersion: 1,
    body: { sex: c.sex, ageYears: c.age, heightCm: h, weightKg: c.bmi * (h / 100) ** 2 },
    habits: {
      typicalSteps: 7000,
      sessionsPerWeek: c.ex === 'sedentary' ? 0 : c.ex === 'rt' ? 3 : 4,
      lifingCardioMix: c.ex === 'cardio' ? 1 : 0,
      trainingHistory: c.ex === 'rt' ? '1to3y' : 'none',
      habitualCarbPctEnergy: c.carbPct,
      habitualMealsPerDay: c.meals,
      habitualWindowStartH: 8,
      habitualWindowLengthH: c.windowH,
    },
    startDate: '2026-10-05',
  };
}

interface Drift {
  cell: string;
  dFm: number;
  dLt: number;
  wakeDrift: number;
  wakeVsT0: number;
  t0: number;
  glyRel: number;
  water: number;
}

function drift(c: Cell): Drift {
  const p = profileOf(c);
  const rp = resolveProfile(p);
  const r = runEngine(rp, compileSchedule(habitualWeekSchedule(p, DAYS), rp), {
    record: 'daily',
    checks: true,
    series: ['fatMass', 'leanTissue', 'scaleWeight', 'glycogenTotal', 'waterWeight'],
  });
  const d = r.daily;
  const last = DAYS - 1;
  const g6 = d.glycogenTotal![6]!;
  return {
    cell: `${c.sex[0]}${c.age}/BMI${c.bmi}/${c.ex}/c${c.carbPct}/m${c.meals}/w${c.windowH}`,
    dFm: d.fatMass![last]! - r.initial.fatMass!,
    dLt: d.leanTissue![last]! - r.initial.leanTissue!,
    wakeDrift: d.scaleWeight![84]! - d.scaleWeight![0]!,
    wakeVsT0: d.scaleWeight![last]! - r.initial.scaleWeight!,
    t0: r.meta.checks!.t0WeightErrKg!,
    glyRel: (d.glycogenTotal![83]! - g6) / g6,
    water: d.waterWeight![83]! - d.waterWeight![6]!,
  };
}

function violations(rows: Drift[]): string[] {
  const bad: string[] = [];
  for (const x of rows) {
    const f: string[] = [];
    if (!(Math.abs(x.dFm) <= TOL.fatKg)) f.push(`ΔFM ${x.dFm.toFixed(3)}`);
    if (!(Math.abs(x.dLt) <= TOL.leanKg)) f.push(`ΔLT ${x.dLt.toFixed(3)}`);
    if (!(Math.abs(x.wakeDrift) <= TOL.scaleDriftKg)) f.push(`scale drift ${x.wakeDrift.toFixed(3)}`);
    if (!(Math.abs(x.wakeVsT0) <= TOL.scaleDriftKg)) f.push(`day-90 wake vs t = 0 ${x.wakeVsT0.toFixed(3)}`);
    if (!(Math.abs(x.t0) <= TOL.t0Kg)) f.push(`t0 ${x.t0.toFixed(3)}`);
    if (!(Math.abs(x.glyRel) <= TOL.glycogenRel)) f.push(`glycogen ${(100 * x.glyRel).toFixed(1)} %`);
    if (!(Math.abs(x.water) <= TOL.waterKg)) f.push(`water ${x.water.toFixed(3)}`);
    if (f.length) bad.push(`${x.cell}: ${f.join(', ')}`);
  }
  return bad;
}

function report(label: string, rows: Drift[]): void {
  const worst = (k: keyof Omit<Drift, 'cell'>): string => {
    const x = rows.reduce((a, b) => (Math.abs(b[k]) > Math.abs(a[k]) ? b : a));
    return `${k} ${x[k].toFixed(3)} (${x.cell})`;
  };
  console.log(`[O-12 matrix] ${label}, ${rows.length} cells, worst: ${(['dFm', 'dLt', 'wakeDrift', 'wakeVsT0', 't0', 'glyRel', 'water'] as const).map(worst).join(' · ')}`);
}

const SEXES = ['male', 'female'] as const;
const AGES = [22, 45, 70];
const BMIS = [20, 27, 38];
const base = (sex: Cell['sex'], age: number, bmi: number, ex: Cell['ex']): Cell => ({ sex, age, bmi, ex, carbPct: 45, meals: 3, windowH: 12 });

describe('O-12 maintenance steady state, full engine, 90 d', () => {
  it('sedentary and habitual-cardio people (both sexes, ages 22-70, BMI 20-38) do not drift', () => {
    const rows: Drift[] = [];
    for (const sex of SEXES) for (const age of AGES) for (const bmi of BMIS) for (const ex of ['sedentary', 'cardio'] as const) rows.push(drift(base(sex, age, bmi, ex)));
    report('sedentary + cardio', rows);
    expect(violations(rows)).toEqual([]);
  });

  it('habitual diet variants (carbohydrate 20/45/65 %E × 2/3 meals × 8/12-h window) do not drift', () => {
    const rows: Drift[] = [];
    for (const who of [base('female', 45, 27, 'sedentary'), base('male', 22, 38, 'cardio')])
      for (const carbPct of [20, 45, 65]) for (const meals of [2, 3]) for (const windowH of [8, 12]) rows.push(drift({ ...who, carbPct, meals, windowH }));
    report('diet variants', rows);
    expect(violations(rows)).toEqual([]);
  });

  // Formerly a known fail (muscle accreted from day 0 on the habitual RT week); passing since Integrator B's habitual-volume
  // equilibrium in muscle (2026-09-30 evening).
  it('habitual resistance trainers (3 RT sessions/wk, both sexes, ages 22-70, BMI 20-38) do not drift', () => {
    const rows: Drift[] = [];
    for (const sex of SEXES) for (const age of AGES) for (const bmi of BMIS) rows.push(drift(base(sex, age, bmi, 'rt')));
    report('habitual RT', rows);
    expect(violations(rows)).toEqual([]);
  });
});
