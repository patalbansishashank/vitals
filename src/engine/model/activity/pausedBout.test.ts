// @vitest-environment node
/**
 * (r063 S10/A15) A paused bout replays as one engine session per moving interval with one bout identity and ONE recovery
 * booking: `boutDurationMin` (the whole bout's moving minutes) feeds EPOC's duration factor, so the parts book φ(bout) × Σ
 * their net, the same recovery as the unpaused bout of the same moving minutes. Without it each part took the φ of its own
 * shorter duration (a smaller recovery for the same work).
 */
import { describe, expect, it } from 'vitest';
import { createSignalBus, type SignalBus } from '../../types/signals';
import type { AnyEngineModule } from '../../types/module';
import type { DayInput, SessionResolved } from '../../types/inputs';
import { makeCtx, makeDay, miniRun, person, withSessions } from '../moderators/testkit';
import { activityModule, type ActivityState } from './index';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import type { Schedule } from '../../types/schedule';

const mods = [activityModule] as unknown as readonly AnyEngineModule[];
const RMR = 1800;

const cardio = (startH: number, durationMin: number, G: number, boutDurationMin?: number): Partial<SessionResolved> => ({
  kind: 'cardio', startH, durationMin, modality: 7, intensityFrac: Number.NaN, met: 9, speedKmh: Number.NaN, powerW: Number.NaN, rpe: Number.NaN,
  setsByRegion: new Float64Array(9), realisedGrossKcal: G, boutKey: 'bout:b1', ...(boutDurationMin !== undefined ? { boutDurationMin } : {}),
});

/** Exercise energy and the recovery part (exEE − incremental) over a 3-day run with `sessions` on day 0. */
function run(sessions: Partial<SessionResolved>[]): { ex: number; recovery: number } {
  const ctx = makeCtx(mods, person({ body: { weightKg: 80, heightCm: 178 }, labs: { measuredRmrKcal: RMR, vo2maxMlKgMin: 40 } }), {});
  const bus: SignalBus = createSignalBus();
  bus.scaleWeightKg = 80;
  bus.tissueMassKg = 80;
  bus.rmrKcalH = RMR / 24;
  let S: ActivityState | null = null;
  let ex = 0;
  let inc = 0;
  const days: { clockDay: number; day: DayInput }[] = [0, 1, 2].map((d) => ({ clockDay: d, day: d === 0 ? withSessions(makeDay(ctx.profile), sessions) : makeDay(ctx.profile) }));
  miniRun(mods, ctx, days, {
    bus,
    withPrevDay: true,
    afterInit: (s) => {
      S = s[0] as ActivityState;
    },
    afterHour: (_d, _h, b) => {
      ex += b.exEEKcalH;
      if (b.exMinutesH > 0) inc += S!.hInc;
    },
  });
  return { ex, recovery: ex - inc };
}

describe('S10/A15: a paused bout books one recovery', () => {
  it('two 10-minute moving parts with the bout minutes book the recovery of one 20-minute bout', () => {
    const whole = run([cardio(10, 20, 240)]);
    const parts = run([cardio(10, 10, 120, 20), cardio(10 + 50 / 60, 10, 120, 20)]);
    const separate = run([cardio(10, 10, 120), cardio(10 + 50 / 60, 10, 120)]);
    expect(whole.recovery).toBeGreaterThan(1);
    expect(parts.recovery).toBeCloseTo(whole.recovery, 1);
    expect(parts.ex).toBeCloseTo(whole.ex, 1);
    // the probe: each part on its own duration booked less recovery for the same work
    expect(separate.recovery).toBeLessThan(whole.recovery - 0.5);
  });
});

describe('the compiler carries the bout minutes', () => {
  it('boutDurationMin reaches the resolved session (absent stays absent)', () => {
    const rp = resolveProfile(person({ body: { weightKg: 80, heightCm: 178 } }));
    const sched: Schedule = {
      schemaVersion: 1, startDate: '2026-10-19', horizonDays: 1,
      programs: [{ label: 'd', energy: { kind: 'kcal', kcal: 2200 }, macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 220 }, fat: { unit: 'remainder' } }, exercise: [
        { kind: 'cardio', modality: 'walk', startH: 10, durationMin: 10, met: 4, boutId: 'b', sessionId: 'b#m0', boutDurationMin: 20 },
        { kind: 'cardio', modality: 'walk', startH: 10.5, durationMin: 10, met: 4, boutId: 'b', sessionId: 'b#m1', boutDurationMin: 20 },
        { kind: 'cardio', modality: 'run', startH: 18, durationMin: 30, met: 8 },
      ] }],
      days: [{ program: 0 }],
    } as Schedule;
    const day = compileSchedule(sched, rp).days[0]!;
    expect(day.sessions.slice(0, day.nSessions).map((x) => [x.boutKey, x.boutDurationMin])).toEqual([['bout:b', 20], ['bout:b', 20], [expect.any(String), undefined]]);
  });
});
