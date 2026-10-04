// @vitest-environment node
/**
 * Micro-benchmark of the fasting module (WP brief: module cost per 180-day run ≤ 0.5 ms, §11.3). Separate file so the
 * JIT sees one bus shape first (monomorphic, as inside one engine run).
 */
import { fastingModule } from './index';
import { makeRig, mealAt, type FastPerson } from './testkit';
import { measureUnderLoad } from '../../testing/benchLoad';

const LEAN_MAN: FastPerson = {
  ffm0Kg: 63.8,
  fm0Kg: 11.3,
  tdee0Kcal: 2633,
  habitualProteinG: 100,
  habitualCarbG: 330,
};

describe('fasting — performance (micro-benchmark, reported)', () => {
  it('180-day run with monthly 72-h fasts costs < 0.5 ms (budget §11.3)', () => {
    const spans = Array.from({ length: 6 }, (_, i) => ({
      startHour: i * 30 * 24 + 20,
      endHour: i * 30 * 24 + 20 + 72,
      electrolytes: true,
    }));
    const intake = new Float64Array(180 * 24 * 3);
    const plan = new Uint8Array(180 * 24);
    for (const sp of spans) for (let h = sp.startHour; h < sp.endHour; h++) plan[h] = 1;
    for (let h = 0; h < 180 * 24; h++) {
      if (plan[h]) continue;
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      intake[3 * h] = kc;
      intake[3 * h + 1] = p;
      intake[3 * h + 2] = c;
    }
    // `fastBus`: the core's createSignalBus builds the bus with computed-key stores, which leaves the 114-property object
    // in V8 dictionary mode (%HasFastProperties false; reported to WP-C). Both variants are measured and reported.
    const once = (fastBus: boolean): number => {
      const rig = makeRig(LEAN_MAN, { nDays: 180, fastSpans: spans, checks: false, fastBus });
      const { s, k, bus, hour, day, clock } = rig;
      // the loop's call pattern: HourInput row overwritten in place, clock advanced, then stepHour (BHB hand-built)
      const t0 = performance.now();
      for (let h = 0; h < 180 * 24; h++) {
        hour.kcal = intake[3 * h]!;
        hour.proteinG = intake[3 * h + 1]!;
        hour.carbG = intake[3 * h + 2]!;
        hour.plannedFast = plan[h]!;
        clock.hourIndex = h;
        bus.bhbMmolL = plan[h] ? 2 : 0.1;
        fastingModule.stepHour(s, k, bus, hour, day, clock);
      }
      return performance.now() - t0;
    };
    const n = 80;
    const { result, factor } = measureUnderLoad(() => {
      for (let i = 0; i < 60; i++) once(true);
      let fast = 0;
      for (let i = 0; i < n; i++) fast += once(true);
      for (let i = 0; i < 60; i++) once(false);
      let dict = 0;
      for (let i = 0; i < n; i++) dict += once(false);
      return { fast, dict };
    });
    const ms = result.fast / n;
    console.info(
      `[bench] fasting module: ${ms.toFixed(3)} ms per 180-day run (fast-mode bus), ${(result.dict / n).toFixed(3)} ms with the core's dictionary-mode bus (load factor ${factor.toFixed(2)})`,
    );
    // limit scales with the machine load (benchLoad.ts)
    expect(ms).toBeLessThan(0.5 * factor);
  });
});
