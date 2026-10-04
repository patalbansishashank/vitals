// @vitest-environment node
/**
 * Micro-benchmark (WP_BRIEF; MODEL_SPEC §11.3 budget ≤ 0.5 ms per module per 180-day run): the hooks of hormones and
 * appetite are called exactly as the loop calls them (startDay, 24 × stepHour, endOfDay, recordDay) on a varying diet.
 * Reports the median over repeated runs; asserts the budget on the median.
 */
import type { EngineModule } from '../../types/module';
import type { PersonProfile } from '../../types/profile';
import { MI, N_SERIES } from '../../types/metrics';
import { DayDriver, makeProfile, type ContextOpts } from './testHarness';
import { hormonesModule, type HormonesK, type HormonesState } from './index';
import { appetiteModule, type AppetiteK, type AppetiteState } from '../appetite/index';

const WOMAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 70 },
  cycle: { tracking: true, contraception: 'none' },
  menopause: 'pre',
};
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90 } };

/** Planner mode recording only one goal metric (MODEL_SPEC §10: display-only hormone work skipped). */
const PLANNER_SE = new Uint8Array(N_SERIES);
PLANNER_SE[MI.leptin] = 1;
const PLANNER: ContextOpts = { mode: 'planner', seriesEnabled: PLANNER_SE };

function bench<S extends object, K extends object>(mod: EngineModule<S, K>, person: PersonProfile, reps: number, opts: ContextOpts = {}): number {
  const times: number[] = [];
  const out = new Float64Array(N_SERIES);
  for (let r = 0; r < reps; r++) {
    const dr = new DayDriver(makeProfile(person), opts);
    const k = mod.prepare(dr.ctx);
    const s = mod.init(k, dr.ctx, dr.bus);
    const { bus, day, hour, clock } = dr;
    const t0 = performance.now();
    for (let d = 0; d < 180; d++) {
      clock.day = d;
      bus.energyBalanceFrac = d % 7 === 6 ? -1 : -0.25;
      bus.tdeeEstKcalD = d % 7 === 2 ? 2600 : 2200;
      day.energyKcal = d % 7 === 6 ? 0 : 1600;
      day.carbG = d % 7 === 6 ? 0 : 150;
      bus.fatMassKg = 25 - 0.03 * d;
      bus.scaleWeightKg = 90 - 0.05 * d;
      bus.lutealWeight = d % 28 > 14 ? 1 : 0;
      mod.startDay(s, k, bus, day, clock);
      for (let h = 0; h < 24; h++) {
        clock.hourOfDay = h;
        bus.hoursSinceMealH = d % 7 === 6 ? 24 + h : h % 6;
        bus.bhbMmolL = 0.1 + 0.01 * h;
        mod.stepHour(s, k, bus, hour, day, clock);
      }
      mod.endOfDay(s, k, bus, day, clock);
      mod.recordDay(s, k, bus, out);
    }
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

describe('performance (180-day run, MODEL_SPEC §11.3 budget 0.5 ms per module)', () => {
  it('hormones and appetite each stay within 0.5 ms per 180-day run (median)', () => {
    const h = hormonesModule as EngineModule<HormonesState, HormonesK>;
    const a = appetiteModule as EngineModule<AppetiteState, AppetiteK>;
    // warm-up (JIT)
    bench(h, WOMAN, 30);
    bench(a, WOMAN, 30);
    bench(h, MAN, 30, PLANNER);
    const hw = bench(h, WOMAN, 60);
    const hm = bench(h, MAN, 60);
    const hp = bench(h, MAN, 60, PLANNER);
    const aw = bench(a, WOMAN, 60);
    console.info(
      `[bench] ms per 180-day run: hormones ${hw.toFixed(3)} (woman) / ${hm.toFixed(3)} (man) / ${hp.toFixed(3)} (man, planner) · appetite ${aw.toFixed(3)}`,
    );
    expect(Math.max(hw, hm)).toBeLessThan(0.5);
    expect(hp).toBeLessThan(0.5);
    expect(aw).toBeLessThan(0.5);
  });
});
