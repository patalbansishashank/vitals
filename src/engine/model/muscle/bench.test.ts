// @vitest-environment node
/**
 * Micro-benchmark (WP_BRIEF / MODEL_SPEC §11.3, budget 0.5 ms per 180-day run): cost of the muscle module's hooks over
 * 180 days with RT 3×/wk (all 9 regions), three protein meals a day and the MPS display layer on (the most expensive
 * configuration). Hour inputs are expanded before timing; the same loop driving a no-op module is subtracted (harness
 * and dispatch overhead, which the core accounts for separately), best of N as in the peer modules' benches.
 * Measured on the dev machine (integration pass 2026-09-30): best ≈ 0.31 ms, median ≈ 0.32 ms (harness subtracted); with the
 * MPS display layer off (planner mode, `seriesEnabled[mps] = 0`) ≈ 0.24 ms. Full loop (real engine, 180 d + 14-d burn-in,
 * muscle vs a no-op stub): ≈ 0.3 ms in planner mode, 0.6-0.9 ms with every series recorded (noisy; includes knock-on work of
 * the modules that read muscle's signals).
 * CI guards at 2× the budget (shared runners, parallel files) unless MUSCLE_STRICT_BENCH=1.
 */
import { expect, it } from 'vitest';
import { DayHourTable, expandDayToHours, loadHour, newHourInput } from '../../core/compileSchedule';
import { defineModule } from '../../core/moduleKit';
import type { HourInput } from '../../types/inputs';
import { muscleModule, type MuscleK, type MuscleState } from './index';
import { MuscleSim, person, rtWeek } from './__tests__/harness';
import { measureUnderLoad } from '../../testing/benchLoad';

const noop = defineModule<MuscleState, MuscleK>({
  id: 'muscle', specSection: '', dossiers: '', params: [], reads: [], writes: [], records: [],
  init: () => ({}) as MuscleState,
});

it('180-day run of the muscle module stays within 0.5 ms (harness subtracted)', () => {
  const sim = new MuscleSim(person({ age: 30, sex: 'male', heightCm: 180, weightKg: 82, trainingYears: 2, trainingHistory: '1to3y' }));
  const week = rtWeek(sim, 4, 3, 1.8);
  const table = new DayHourTable();
  const hours: HourInput[][] = week.map((d) => {
    expandDayToHours(d, 23, 8, null, 0, table);
    return Array.from({ length: 24 }, (_, h) => {
      const hi = newHourInput();
      loadHour(table, h, hi);
      return hi;
    });
  });
  const aa = Float64Array.from({ length: 24 }, (_, h) => (h === 8 || h === 13 || h === 19 ? 6 : h === 9 || h === 14 || h === 20 ? 3 : 0));
  const { s, k, bus, clock, out } = sim;
  const run = (m: typeof muscleModule): number => {
    const t0 = performance.now();
    for (let d = 0; d < 180; d++) {
      const day = week[d % 7]!;
      const hs = hours[d % 7]!;
      clock.day = d;
      m.startDay(s, k, bus, day, clock);
      for (let h = 0; h < 24; h++) {
        clock.hourOfDay = h;
        clock.hourIndex = d * 24 + h;
        bus.raAaQGH = aa[h]!;
        m.stepHour(s, k, bus, hs[h]!, day, clock);
        m.recordHour(s, k, bus, out);
      }
      m.endOfDay(s, k, bus, day, clock);
      m.recordDay(s, k, bus, out);
    }
    return performance.now() - t0;
  };
  const { result, factor } = measureUnderLoad(() => {
    for (let i = 0; i < 200; i++) {
      run(muscleModule);
      run(noop);
    }
    const tm: number[] = [];
    const tn: number[] = [];
    for (let i = 0; i < 40; i++) {
      tm.push(run(muscleModule));
      tn.push(run(noop));
    }
    tm.sort((a, b) => a - b);
    tn.sort((a, b) => a - b);
    return { best: tm[0]! - tn[0]!, median: tm[20]! - tn[20]!, harness: tn[0]! };
  });
  const { best, median, harness } = result;
  console.info(`muscle 180-day run (harness subtracted): best ${best.toFixed(3)} ms, median ${median.toFixed(3)} ms; harness ${harness.toFixed(3)} ms; budget 0.5 ms (load factor ${factor.toFixed(2)})`);
  expect(Number.isFinite(s.ts)).toBe(true);
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const strict = env?.MUSCLE_STRICT_BENCH === '1';
  // limit scales with the machine load (benchLoad.ts)
  expect(best).toBeLessThan((strict ? 0.5 : 1.0) * factor);
});
