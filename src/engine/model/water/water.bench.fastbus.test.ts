// @vitest-environment node
/**
 * Same micro-benchmark with a fast-properties signal bus (`Object.fromEntries(SIGNAL_DEFS.map(...))` instead of the
 * keyed-store loop in `createSignalBus`, which leaves the 114-signal object in dictionary mode: measured %HasFastProperties
 * = false). This is the shape the engine should hand to modules (CONTRACT REQUEST in the WP-M9 report); the budget of
 * 0.5 ms (MODEL_SPEC §11.3) is asserted here. Separate file = separate JIT feedback from the dictionary-bus benchmark.
 */
import { MI, N_SERIES } from '../../types/metrics';
import { SIGNAL_DEFS, type SignalBus } from '../../types/signals';
import { waterModule } from './index';
import { makeRig } from './testKit';

describe('performance', () => {
  it('costs ≤ 0.5 ms per 180-day run with a fast-properties signal bus (stepHour + day hooks + hourly and daily records), best of 25', () => {
    const r = makeRig({ checks: false });
    const { s, k, day, hour, clock } = r;
    const bus = Object.fromEntries(SIGNAL_DEFS.map((d) => [d.name, d.init])) as unknown as SignalBus;
    for (const key of Object.keys(r.bus)) (bus as unknown as Record<string, number>)[key] = (r.bus as unknown as Record<string, number>)[key]!;
    const N_DAYS = 180;
    // scripted neighbour outputs so the module sees changing values (precomputed: not part of the measured cost)
    const gly = new Float64Array(N_DAYS * 24);
    const carb = new Float64Array(N_DAYS * 24);
    const fast = new Float64Array(N_DAYS * 24);
    const hard = new Float64Array(N_DAYS * 24);
    for (let i = 0; i < gly.length; i++) {
      gly[i] = 450 + 80 * Math.sin(i / 30);
      carb[i] = 150 + 120 * Math.sin(i / 71);
      fast[i] = Math.floor(i / 24) % 30 === 29 ? 1 : 0;
      hard[i] = i % 72 === 18 ? 1 : 0;
    }
    const out = new Float64Array(N_SERIES);
    let sink = 0;
    const run = (withModule: boolean): void => {
      for (let d = 0; d < N_DAYS; d++) {
        clock.day = d;
        if (withModule) waterModule.startDay(s, k, bus, day, clock);
        for (let h = 0; h < 24; h++) {
          const i = d * 24 + h;
          clock.hourOfDay = h;
          clock.hourIndex = i;
          hour.hourOfDay = h;
          hour.asleep = h >= 23 || h < 7 ? 1 : 0;
          bus.muscleGlycogenG = gly[i]!;
          bus.carbAbs24G = carb[i]!;
          bus.fastActive = fast[i]!;
          bus.exHardSession = hard[i]!;
          if (withModule) {
            waterModule.stepHour(s, k, bus, hour, day, clock);
            waterModule.recordHour(s, k, bus, out);
          } else sink += bus.muscleGlycogenG;
        }
        if (withModule) {
          waterModule.endOfDay(s, k, bus, day, clock);
          waterModule.recordDay(s, k, bus, out);
        }
      }
    };
    for (let i = 0; i < 4; i++) run(true); // warm-up (JIT)
    const time = (withModule: boolean): number => {
      let best = Infinity;
      for (let i = 0; i < 25; i++) {
        const t0 = performance.now();
        run(withModule);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const control = time(false);
    const total = time(true);
    const cost = total - control;
    console.info(`[water bench] 180 d: total ${total.toFixed(3)} ms, driver ${control.toFixed(3)} ms, water ≈ ${cost.toFixed(3)} ms`);
    expect(Number.isFinite(out[MI.scaleWeight]!)).toBe(true);
    expect(sink).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(0.5);
  });
});
