/**
 * D2-01 (composition contribution, C2): planned fast metadata never enters the tissue partition, and the daily-native
 * declaration matches what the module actually reads.
 *  - fastMetadataInvariant: identical realised day inputs and bus fluxes, only the planned fast label/length varied
 *    (none / 23 / 24 / 48 h) → identical state, hour by hour.
 *  - The day plan reads whole-day intake totals, so a later meal of the same day changes the earlier hours' partition
 *    (declared `daily`, not claimed event-prefix causal), while completed days stay unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { DayInput } from '../../types/inputs';
import type { SignalBus } from '../../types/signals';
import { COMPOSITION_CAUSAL_RESOLUTION, compositionModule, type CompositionState } from './index';
import { makeRig, runDay, setIntake, type Rig } from './testHarness';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const SNAP_KEYS = ['fmKg', 'ltKg', 'smKg', 'vatKg', 'waistCm', 'pE', 'regime', 'eb7', 'u', 'nBalanceG', 'fastProteinLostKg', 'leanExtraKgD'] as const;
const snap = (s: CompositionState): number[] => SNAP_KEYS.map((k) => s[k]);

/** Hourly fluxes standing in for the other modules: a meal-shaped day with a fast overlay in hours 0–9 (fasting module). */
function flux(eiKcalD: number, teeKcalD: number, fastHours: number) {
  return (h: number, bus: SignalBus): void => {
    bus.eAbsKcalH = h >= 10 && h < 20 ? eiKcalD / 10 : 0;
    bus.teePreKcalH = teeKcalD / 24;
    bus.dnlHeatKcalH = 0;
    bus.ketoneLossKcalH = 0;
    bus.glycogenChangeKcalH = 0;
    const fasting = h < fastHours;
    bus.fastActive = fasting ? 1 : 0;
    bus.fastProtOxGH = fasting ? 2.5 : 0;
    bus.fastRepletionGH = 0;
  };
}

type FastLabel = { durationH: number } | null;

function withLabel(r: Rig, label: FastLabel): void {
  const d = r.day as Mutable<DayInput>;
  if (label === null) {
    delete d.fastPolicy;
    d.fastHours = 0;
    d.fastStartDay = -1;
  } else {
    d.fastPolicy = { plannedDurationH: label.durationH, startDay: 0, source: 'planned' };
    d.fastHours = Math.min(24, label.durationH);
    d.fastStartDay = 0;
  }
}

/** Run `days` days, recording the state after every hour. */
function trace(label: FastLabel, days = 3): number[][] {
  const r = makeRig(undefined, { regional: false });
  const out: number[][] = [];
  for (let d = 0; d < days; d++) {
    setIntake(r, d === 0 ? 900 : 2100, d === 0 ? 60 : 130);
    withLabel(r, label);
    const f = flux(r.day.energyKcal, 2500, d === 0 ? 10 : 0);
    runDay(r, (h, bus) => {
      f(h, bus);
      if (h > 0) out.push(snap(r.s));
    });
    out.push(snap(r.s));
  }
  return out;
}

describe('composition D2-01 — fastMetadataInvariant', () => {
  it('none / 23 / 24 / 48 h planned labels with identical realised inputs give identical hourly states', () => {
    const base = trace(null);
    for (const durationH of [23, 24, 48]) expect(trace({ durationH })).toEqual(base);
  });

  it('declares no plan-metadata reads', () => {
    expect(COMPOSITION_CAUSAL_RESOLUTION.planMetadataReads).toEqual([]);
  });
});

describe('composition D2-01 — eventPrefixInvariant is not claimed: daily-native day plan, declared', () => {
  /** State after hour 9 of day 1 (before any of day 1's intake appears), for a given whole-day energy/protein of day 1. */
  function earlyDay1(day1: { kcal: number; proteinG: number }): { day0End: number[]; day1Early: number[] } {
    const r = makeRig(undefined, { regional: false });
    setIntake(r, 2000, 120);
    runDay(r, flux(2000, 2500, 0));
    const day0End = snap(r.s);
    setIntake(r, day1.kcal, day1.proteinG);
    let day1Early: number[] = [];
    // identical hourly fluxes for both variants; only the whole-day totals differ (a later meal added or not)
    const f = flux(1500, 2500, 0);
    runDay(r, (h, bus) => {
      f(h, bus);
      if (h === 9) day1Early = snap(r.s);
    });
    return { day0End, day1Early };
  }

  it('a later meal on day 1 changes day 1’s earlier hours but never the completed day 0', () => {
    const a = earlyDay1({ kcal: 1500, proteinG: 90 });
    const b = earlyDay1({ kcal: 2600, proteinG: 90 });
    expect(b.day0End).toEqual(a.day0End);
    expect(b.day1Early).not.toEqual(a.day1Early);
    expect(COMPOSITION_CAUSAL_RESOLUTION.dailyInputs).toContain('energyKcal');
  });

  it('whole-day protein also enters the early hours (declared daily input)', () => {
    const a = earlyDay1({ kcal: 1500, proteinG: 60 });
    const b = earlyDay1({ kcal: 1500, proteinG: 180 });
    expect(b.day1Early).not.toEqual(a.day1Early);
    expect(COMPOSITION_CAUSAL_RESOLUTION.dailyInputs).toContain('proteinG');
  });

  it('day inputs outside the declaration leave the state unchanged', () => {
    const run = (mut: (d: Mutable<DayInput>) => void): number[] => {
      const r = makeRig(undefined, { regional: false });
      setIntake(r, 1800, 110);
      mut(r.day as Mutable<DayInput>);
      runDay(r, flux(1800, 2500, 4));
      return snap(r.s);
    };
    const base = run(() => {});
    expect(run((d) => { d.sodiumMg = 9000; d.caffeineMg = 600; d.fluidL = 0.5; d.zeroIntake = true; d.resolution = 'daily'; })).toEqual(base);
  });

  it('the declaration matches the module wiring', () => {
    const d = COMPOSITION_CAUSAL_RESOLUTION;
    expect(d.module).toBe(compositionModule.id);
    expect(d.nativeResolution).toBe('daily');
    expect([...d.series].sort()).toEqual([...compositionModule.records].sort());
    expect([...d.signals].sort()).toEqual([...compositionModule.writes].sort());
    for (const sig of d.dayStartSignals) expect(compositionModule.reads).toContain(sig);
  });
});
