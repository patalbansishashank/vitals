// @vitest-environment node
/**
 * Micro-benchmark: cost of the wellbeing hooks over one 180-day run (4 320 stepHour + 180 endOfDay + 180 recordDay). Budget 0.5 ms.
 * The gate uses the best of 30 runs (the noise-free cost: other test workers share the CPU); the median is reported.
 * Measured under the test transformer, which adds module-namespace lookups a production bundle does not have.
 */
import { wellbeingModule } from '../index';
import { MAN, makeHarness } from './harness';
import { N_SERIES } from '../../../types/metrics';

describe('performance budget', () => {
  it('180-day run of the module hooks costs ≤ 0.5 ms (best of 30 runs after warm-up)', () => {
    const h = makeHarness(MAN);
    const { s, k, bus, hour, day, clock } = h;
    const out = new Float64Array(N_SERIES);
    const oneRun = (): number => {
      const t0 = performance.now();
      for (let d = 0; d < 180; d++) {
        clock.day = d;
        for (let hr = 0; hr < 24; hr++) {
          clock.hourOfDay = hr;
          hour.kcal = hr === 8 || hr === 13 || hr === 19 ? 900 : 0;
          hour.carbG = hour.kcal * 0.1;
          hour.fatG = hour.kcal * 0.04;
          hour.fibreG = hour.kcal * 0.008;
          hour.exMin = hr === 17 ? 60 : 0;
          hour.rtSetsTotal = hr === 17 && d % 2 === 0 ? 12 : 0;
          bus.exSessionNetKcalH = hr === 17 ? 250 : 0;
          wellbeingModule.stepHour(s, k, bus, hour, day, clock);
        }
        bus.exSessionNetKcalD = 250;
        wellbeingModule.endOfDay(s, k, bus, day, clock);
        wellbeingModule.recordDay(s, k, bus, out);
      }
      return performance.now() - t0;
    };
    for (let i = 0; i < 5; i++) oneRun();
    const times = Array.from({ length: 30 }, oneRun).sort((a, b) => a - b);
    console.info(`wellbeing 180-day hooks: best ${times[0]!.toFixed(3)} ms, median ${times[15]!.toFixed(3)} ms, max ${times[29]!.toFixed(3)} ms`);
    expect(times[0]!).toBeLessThanOrEqual(0.5);
  });
});
