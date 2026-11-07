// @vitest-environment node
/**
 * SPEC V1.1-V1.5 engine contract (2026-10-27):
 *  - the new hourly series `exerciseEnergy` and `stepsEnergy` are the activity module's own booked values (exEEKcalH and
 *    stepsExtraKcalH), recorded hourly and summed daily — new outputs only, no equation change;
 *  - `realisedGrossKcal` and the inert `hr` summary pass through the compiler; `hr` never changes any output;
 *  - WHO guideline minutes are unchanged by the new fields (HealthClassSource not extended, notes C07).
 */
import { describe, expect, it } from 'vitest';
import { compileSchedule } from '../../core/compileSchedule';
import { simulate } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import { MAN, PROGRAM_B } from '../../core/__tests__/fixtures';
import { MI, SERIES } from '../../types/metrics';
import type { CardioSession, DayTemplate, ExerciseSession, Schedule } from '../../types/schedule';
import type { AnyEngineModule, MetricFrame } from '../../types/module';
import { makeCtx, makeDay, miniRun, person, withSessions, cardio } from '../moderators/testkit';
import { activityModule, dayHealthMinutes } from './index';

const p = resolveProfile(MAN);

function day(exercise: ExerciseSession[], steps = 9000): DayTemplate {
  return {
    id: 'T',
    label: 'training day',
    energy: { kind: 'pctMaintenance', pct: 90 },
    macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'remainder' }, fat: { unit: 'gPerKgBw', value: 0.9 } },
    meals: { count: 3, window: { startH: 8, lengthH: 11 } },
    exercise,
    steps,
  };
}
const sched = (t: DayTemplate, days = 7): Schedule => ({
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: days,
  programs: [t, PROGRAM_B],
  days: Array.from({ length: days }, (_, d) => ({ program: d % 3 === 2 ? 1 : 0 })),
});

const WALK: CardioSession = { kind: 'cardio', modality: 'walk', startH: 7, durationMin: 45, speedKmh: 5.5, healthIntensityClass: 'moderate', healthClassSource: 'stated' };
const RT: ExerciseSession = { kind: 'resistance', startH: 18, durationMin: 50, volume: 'moderate' };

describe('SPEC V1.1 hourly energy series', () => {
  it('are registered as hourly detail series (kcal/d, agg sum, lane line, grade B, owner activity)', () => {
    for (const id of ['exerciseEnergy', 'stepsEnergy'] as const) {
      const d = SERIES.find((s) => s.id === id)!;
      expect(d, id).toBeDefined();
      expect(d).toMatchObject({ kind: 'detail', unit: 'kcal/d', resolution: 'hourly', agg: 'sum', lane: 'line', grade: 'B', owner: 'activity' });
    }
  });

  it('exerciseEnergy equals the booked exEEKcalH every hour; daily values are the hourly sums', () => {
    const r = simulate(p, sched(day([WALK, RT])), { record: 'full' });
    const h = r.hourly.exerciseEnergy!;
    const ee = r.hourly.exerciseEE!;
    expect(h.length).toBe(7 * 24);
    expect(Array.from(h)).toEqual(Array.from(ee));
    const sumOf = (a: Float32Array, d: number) => a.slice(d * 24, d * 24 + 24).reduce((x, y) => x + y, 0);
    for (let d = 0; d < 7; d++) {
      expect(r.daily.exerciseEnergy![d]).toBeCloseTo(sumOf(h, d), 2);
      expect(r.daily.stepsEnergy![d]).toBeCloseTo(sumOf(r.hourly.stepsEnergy!, d), 2);
    }
    expect(sumOf(h, 0)).toBeGreaterThan(0);
  });

  it('the module records exactly its bus values (exEEKcalH, stepsExtraKcalH) hour by hour', () => {
    const mods = [activityModule] as unknown as readonly AnyEngineModule[];
    const ctx = makeCtx(mods, person({ labs: { measuredRmrKcal: 1800, vo2maxMlKgMin: 40 } }));
    const out = new Float64Array(SERIES.length);
    const seen: Array<[number, number, number, number]> = [];
    let s0: object | null = null;
    let k0: object | null = null;
    miniRun(mods, ctx, [{ clockDay: 0, day: withSessions(makeDay(ctx.profile, { steps: 11000 }), [cardio(9, 60, 0.6)]) }], {
      afterInit: (s, k) => {
        s0 = s[0]!;
        k0 = k[0]!;
      },
      afterHour: (_d, _h, bus) => {
        (activityModule as unknown as AnyEngineModule).recordHour(s0!, k0!, bus, out as MetricFrame);
        seen.push([bus.exEEKcalH, out[MI.exerciseEnergy]!, bus.stepsExtraKcalH, out[MI.stepsEnergy]!]);
      },
    });
    for (const [a, b, c, d] of seen) {
      expect(b).toBeCloseTo(a, 9);
      expect(d).toBeCloseTo(c, 9);
    }
    expect(seen.some(([a]) => a > 0)).toBe(true);
    expect(seen.some(([, , c]) => c !== 0)).toBe(true);
  });

  it('stepsEnergy sits inside neat (it is the step part of non-exercise movement, never an extra term)', () => {
    const r = simulate(p, sched(day([WALK], 14000)), { record: 'daily' });
    for (let d = 0; d < 7; d++) expect(r.daily.neat![d]! + 1e-3).toBeGreaterThanOrEqual(r.daily.stepsEnergy![d]!);
  });
});

describe('SPEC V1.3/V1.5 session fields through the compiler', () => {
  it('realisedGrossKcal reaches the compiled session (cardio and resistance); invalid values are dropped', () => {
    const c = compileSchedule(sched(day([{ ...WALK, realisedGrossKcal: 333 }, { ...RT, realisedGrossKcal: 210 } as ExerciseSession])), p).days[0]!;
    expect(c.sessions[0]!.realisedGrossKcal).toBe(333);
    expect(c.sessions[1]!.realisedGrossKcal).toBe(210);
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(compileSchedule(sched(day([{ ...WALK, realisedGrossKcal: bad }])), p).days[0]!.sessions[0]!.realisedGrossKcal).toBeUndefined();
    }
    expect(compileSchedule(sched(day([WALK])), p).days[0]!.sessions[0]!.realisedGrossKcal).toBeUndefined();
    // (0.6.3) an explicit 0 ("the machine showed 0") is kept, never dropped to an estimate
    expect(compileSchedule(sched(day([{ ...WALK, realisedGrossKcal: 0 }])), p).days[0]!.sessions[0]!.realisedGrossKcal).toBe(0);
  });

  it('(0.6.3) a realised gross of 0 books no exercise energy above rest in a full run (the walk is not estimated)', () => {
    const base = simulate(p, sched(day([WALK]), 3), { record: 'daily' });
    const zero = simulate(p, sched(day([{ ...WALK, realisedGrossKcal: 0 }]), 3), { record: 'daily' });
    expect(base.daily.exerciseEnergy![0]!).toBeGreaterThan(50);
    expect(zero.daily.exerciseEnergy![0]!).toBeLessThanOrEqual(1e-6);
  });

  it('a realised gross books that energy in a full run (day exercise energy follows G, not the speed equation)', () => {
    const base = simulate(p, sched(day([WALK]), 3), { record: 'daily' });
    const rich = simulate(p, sched(day([{ ...WALK, realisedGrossKcal: 600 }]), 3), { record: 'daily' });
    expect(rich.daily.exerciseEnergy![0]!).toBeGreaterThan(base.daily.exerciseEnergy![0]! + 200);
  });

  it('the hr summary is inert: identical outputs with and without it', () => {
    const hr = { avgBpm: 128, maxBpm: 151, supportedS: 2400, method: 'hr-support/1' as const };
    const a = simulate(p, sched(day([WALK, RT])), { record: 'daily' });
    const b = simulate(p, sched(day([{ ...WALK, hr }, { ...RT, hr } as ExerciseSession])), { record: 'daily' });
    for (const id of ['tdee', 'exerciseEE', 'exerciseEnergy', 'fatMass', 'skeletalMuscle', 'vo2max'] as const) {
      const x = a.daily[id];
      if (!x) continue;
      expect(Array.from(b.daily[id]!), id).toEqual(Array.from(x));
    }
  });

  it('WHO guideline minutes are unchanged by realisedGrossKcal and hr (stated class only)', () => {
    const k = activityModule.prepare(makeCtx([activityModule] as unknown as readonly AnyEngineModule[]));
    const plain = compileSchedule(sched(day([WALK])), p).days[0]!;
    const rich = compileSchedule(sched(day([{ ...WALK, realisedGrossKcal: 700, hr: { avgBpm: 150, maxBpm: 170, supportedS: 2700, method: 'hr-support/1' } }])), p).days[0]!;
    const o1 = new Float64Array(4);
    const o2 = new Float64Array(4);
    dayHealthMinutes(k, plain, o1);
    dayHealthMinutes(k, rich, o2);
    expect(Array.from(o2)).toEqual(Array.from(o1));
    expect(o1[0]).toBe(45);
    // an HR-only bout without a stated class stays unknown minutes (no class from HR or calories)
    const hrOnly = compileSchedule(sched(day([{ kind: 'cardio', modality: 'other', startH: 7, durationMin: 30, realisedGrossKcal: 400, hr: { avgBpm: 160, maxBpm: 180, supportedS: 1800, method: 'hr-support/1' } }])), p).days[0]!;
    const o3 = new Float64Array(4);
    dayHealthMinutes(k, hrOnly, o3);
    expect(Array.from(o3)).toEqual([0, 0, 30, 0]);
  });
});
