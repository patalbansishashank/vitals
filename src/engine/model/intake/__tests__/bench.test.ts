// @vitest-environment node
/**
 * Micro-benchmark (WP_BRIEF, MODEL_SPEC §11.3 WP-M2 budget ≤ 1.0 ms per 180-day run): the intake module's own hooks
 * over 180 × 24 hours of a realistic day (3 meals, caffeine, one drink, creatine, an evening walk), inputs precomputed
 * so only the module is timed.
 */
import { intakeModule } from '../index';
import { compileSchedule, DayHourTable, expandDayToHours, loadHour, newHourInput } from '../../../core/compileSchedule';
import { resolveProfile } from '../../../core/resolveProfile';
import { createSignalBus } from '../../../types/signals';
import type { HourInput } from '../../../types/inputs';
import type { StepClock } from '../../../types/module';
import type { Schedule } from '../../../types/schedule';
import { makeCtx, MAN_80 } from './harness';

const BUDGET_MS = 1.0;

describe('intake performance', () => {
  it(`180-day run of the intake hooks costs ≤ ${BUDGET_MS} ms (best of 25)`, () => {
    const profile = resolveProfile(MAN_80);
    const sched: Schedule = {
      schemaVersion: 1,
      startDate: '2026-10-05',
      horizonDays: 1,
      programs: [
        {
          id: 'b',
          label: 'bench',
          energy: { kind: 'pctMaintenance', pct: 90 },
          macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } },
          meals: { count: 3, window: { startH: 8, lengthH: 11 } },
          substances: { caffeine: [{ clockH: 8, mg: 120 }, { clockH: 14, mg: 80 }], alcohol: [{ clockH: 20, drinks: 1 }], creatineG: 5 },
          exercise: [{ kind: 'cardio', modality: 'walk', startH: 19.5, durationMin: 20 }],
        },
      ],
      days: [{ program: 0 }],
    };
    const day = compileSchedule(sched, profile).days[0]!;
    const table = new DayHourTable();
    expandDayToHours(day, day.sleepBedH, day.sleepHours, null, 0, table);
    const hours: HourInput[] = [];
    for (let h = 0; h < 24; h++) {
      const hi = newHourInput();
      loadHour(table, h, hi);
      // loadHour leaves inactive rows untouched once zeroed; build every row fully
      if (table.active[h] === 0) {
        hi.kcal = 0; hi.proteinG = 0; hi.carbG = 0; hi.fatG = 0; hi.fibreG = 0; hi.alcoholG = 0; hi.caffeineMg = 0; hi.exMin = 0;
      }
      hi.hourOfDay = h;
      hours.push(hi);
    }
    const ctx = makeCtx(profile);
    const k = intakeModule.prepare(ctx);
    const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
    const run = (): number => {
      const bus = createSignalBus();
      const s = intakeModule.init(k, ctx, bus);
      const t0 = performance.now();
      for (let d = 0; d < 180; d++) {
        clock.day = d;
        intakeModule.startDay(s, k, bus, day, clock);
        for (let h = 0; h < 24; h++) {
          clock.hourOfDay = h;
          clock.hourIndex = d * 24 + h;
          const hi = hours[h]!;
          hi.day = d;
          hi.hourIndex = clock.hourIndex;
          intakeModule.stepHour(s, k, bus, hi, day, clock);
          intakeModule.recordHour(s, k, bus, frame);
        }
        intakeModule.endOfDay(s, k, bus, day, clock);
      }
      const t1 = performance.now();
      expect(Number.isFinite(bus.eAbsKcalH)).toBe(true);
      return t1 - t0;
    };
    const frame = new Float64Array(256);
    for (let i = 0; i < 20; i++) run(); // warm-up (JIT)
    let best = Infinity;
    for (let i = 0; i < 25; i++) best = Math.min(best, run());
    console.info(`[intake bench] best 180-day run: ${best.toFixed(3)} ms`);
    expect(best).toBeLessThanOrEqual(BUDGET_MS);
  });
});
