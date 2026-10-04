/**
 * Micro-benchmark (WP_BRIEF): composition hooks over a 180-day run (4 320 hours) with a meal-shaped flux and a diet →
 * surplus switch. Budget (MODEL_SPEC §11.3): ≤ 0.5 ms per 180-d run for the hourly physics. The daily regional update
 * (`allocateRegional` + `circumferencesFor`, the documented allocation exception of §0.3) is reported separately.
 */
import { describe, expect, it } from 'vitest';
import { compositionModule } from './index';
import { makeRig, setIntake } from './testHarness';

function run180(regional: boolean, callModule = true): number {
  const r = makeRig(undefined, { regional });
  const m = compositionModule;
  const t0 = performance.now();
  for (let d = 0; d < 180; d++) {
    const ei = d < 120 ? 1900 : 2900;
    setIntake(r, ei, 140);
    r.bus.tdeeEstKcalD = 2600;
    r.clock.day = d;
    if (callModule) m.startDay(r.s, r.k, r.bus, r.day, r.clock);
    for (let h = 0; h < 24; h++) {
      r.clock.hourOfDay = h;
      r.clock.hourIndex = d * 24 + h;
      r.bus.eAbsKcalH = h >= 8 && h < 20 ? ei / 12 : 0;
      r.bus.teePreKcalH = 2600 / 24;
      r.bus.glycogenChangeKcalH = h >= 8 && h < 20 ? 3 : -3;
      if (callModule) m.stepHour(r.s, r.k, r.bus, undefined as never, r.day, r.clock);
    }
    if (callModule) m.endOfDay(r.s, r.k, r.bus, r.day, r.clock);
  }
  return performance.now() - t0;
}

/** Minimum over repeats (robust to load from parallel test workers), minus the harness loop's own cost. */
function best(regional: boolean, n: number): number {
  for (let i = 0; i < 20; i++) run180(regional);
  let mod = Infinity;
  let base = Infinity;
  for (let i = 0; i < n; i++) {
    mod = Math.min(mod, run180(regional));
    base = Math.min(base, run180(regional, false));
  }
  return mod - base;
}

describe('performance', () => {
  it('180-day run: hourly physics ≤ 0.5 ms (regional off); regional/waist daily update reported', () => {
    const off = best(false, 60);
    const on = best(true, 20);
    console.log(`composition 180-d run: ${off.toFixed(3)} ms (regional off), ${on.toFixed(3)} ms (regional + waist on)`);
    expect(off).toBeLessThan(0.5);
    expect(on).toBeLessThan(20);
  });
});
