/**
 * D2-01 (water contribution, C2): planned fast metadata never enters the water terms, and the daily-native declaration
 * matches what the module reads.
 *  - fastMetadataInvariant: identical realised inputs and fast routing flag, only the planned label/length varied
 *    (none / 23 / 24 / 48 h, hour-level `plannedFast`) → identical labile water and scale weight, hour by hour.
 *  - Dietary sodium and the beverage shortfall are spread from whole-day totals, so a later salty meal changes the
 *    morning's water and a smaller drink total the context-only hydration deficit (D1-06: never the water mass; declared
 *    `daily`), while completed days stay unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { DayInput } from '../../types/inputs';
import { WATER_CAUSAL_RESOLUTION, waterModule } from './index';
import { makeRig, type Rig } from './testKit';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type FastLabel = { durationH: number } | null;

function label(r: Rig, l: FastLabel): void {
  const d = r.day as Mutable<DayInput>;
  if (l === null) {
    delete d.fastPolicy;
    d.fastHours = 0;
    d.fastStartDay = -1;
  } else {
    d.fastPolicy = { plannedDurationH: l.durationH, startDay: 0, source: 'planned' };
    d.fastHours = Math.min(24, l.durationH);
    d.fastStartDay = 0;
  }
}

/** Hourly scale and labile water over `days`, with a realised fast overlay in the first 30 h (fasting module's flag). */
function trace(l: FastLabel, days = 3): number[] {
  const r = makeRig({ burnInDays: 1 });
  label(r, l);
  const out: number[] = [];
  r.step(24 * (days + 1), (hi, rig) => {
    const fasting = hi >= 0 && hi < 30;
    rig.bus.fastActive = fasting ? 1 : 0;
    rig.hour.plannedFast = l !== null && hi >= 0 && hi < l.durationH ? 1 : 0;
    rig.bus.carbAbs24G = fasting ? 0 : rig.profile.habitualCarbG;
    if (hi > -24) out.push(rig.s.scaleKg, rig.s.labileKg);
  });
  return out;
}

describe('water D2-01 — fastMetadataInvariant', () => {
  it('none / 23 / 24 / 48 h planned labels with identical realised inputs give identical hourly water', () => {
    const base = trace(null);
    for (const durationH of [23, 24, 48]) expect(trace({ durationH })).toEqual(base);
  });

  it('declares no plan-metadata reads', () => {
    expect(WATER_CAUSAL_RESOLUTION.planMetadataReads).toEqual([]);
  });
});

describe('water D2-01 — eventPrefixInvariant is not claimed: daily-native sodium and fluid terms, declared', () => {
  /** Labile water at 09:00 of day 1 (and at the end of day 0) for a given day-1 mutation of the whole-day inputs. */
  function morningOfDay1(mut: (d: Mutable<DayInput>) => void): { day0End: number; day1Morning: number; day1Deficit: number } {
    const r = makeRig();
    let day0End = Number.NaN;
    let day1Morning = Number.NaN;
    let day1Deficit = Number.NaN;
    r.step(48, (hi, rig) => {
      // whole-day sodium/fluid are read only at startDay: mutating before hour 23 of day 0 first affects day 1
      if (hi === 23) mut(rig.day as Mutable<DayInput>);
      if (hi === 24) day0End = rig.s.labileKg; // state after hour 23 of day 0
      if (hi === 24 + 9) {
        day1Morning = rig.s.labileKg;
        day1Deficit = rig.bus.hydrationDeficitKg;
      }
    });
    return { day0End, day1Morning, day1Deficit };
  }

  it('an evening salty meal changes the same day’s morning water but not the completed day', () => {
    const a = morningOfDay1(() => {});
    const b = morningOfDay1((d) => {
      d.sodiumMg += 4000;
    });
    expect(b.day0End).toBe(a.day0End);
    expect(b.day1Morning).not.toBe(a.day1Morning);
    expect(WATER_CAUSAL_RESOLUTION.dailyInputs).toContain('sodiumMg');
  });

  it('a smaller day beverage total changes the context-only hydration deficit, never the labile water mass (D1-06; declared daily input)', () => {
    const a = morningOfDay1((d) => {
      d.fluidL = 3;
    });
    const b = morningOfDay1((d) => {
      d.fluidL = 0.5;
    });
    expect(b.day1Deficit).not.toBe(a.day1Deficit);
    expect(b.day1Morning).toBe(a.day1Morning);
    expect(WATER_CAUSAL_RESOLUTION.dailyInputs).toContain('fluidL');
  });

  it('day inputs outside the declaration leave the water unchanged', () => {
    const run = (mut: (d: Mutable<DayInput>) => void): number => {
      const r = makeRig();
      mut(r.day as Mutable<DayInput>);
      r.days(2);
      return r.s.scaleKg;
    };
    const base = run(() => {});
    expect(run((d) => { d.energyKcal += 900; d.proteinG += 80; d.caffeineMg = 600; d.zeroIntake = true; d.resolution = 'daily'; })).toBe(base);
  });

  it('the declaration matches the module wiring (glycogen water inherits fuel’s resolution)', () => {
    const d = WATER_CAUSAL_RESOLUTION;
    expect(d.module).toBe(waterModule.id);
    expect(d.nativeResolution).toBe('daily');
    expect([...d.series, 'glycogenWater'].sort()).toEqual([...waterModule.records].sort());
    expect([...d.signals].sort()).toEqual([...waterModule.writes].sort());
    for (const sig of d.dayStartSignals) expect(waterModule.reads).toContain(sig);
  });
});
