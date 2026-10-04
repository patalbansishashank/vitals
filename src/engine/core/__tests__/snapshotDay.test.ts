// @vitest-environment node
/**
 * Living-plan engine contracts (docs/SUITE_SPEC.md §10): CR-L1 day-stamped snapshots, CR-L2 tissue-mass anchors, CR-L3
 * intake offset. Real 16-module engine; bit-for-bit comparisons where the contract promises exactness.
 */
import { runEngine } from '../loop';
import { compileSchedule } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import type { SimulationResult } from '../../types/result';
import { MAN, WOMAN, repeatSchedule } from './fixtures';

const profile = resolveProfile(MAN);
const PATTERN = [0, 1, 0, 1, 0, 1, 1];
const sched90 = compileSchedule(repeatSchedule(90, PATTERN), profile);
const sched120 = compileSchedule(repeatSchedule(120, PATTERN), profile);

/** First difference between two runs on days ≥ from (daily, hourly, safety trace), or null. */
function diffFrom(a: SimulationResult, b: SimulationResult, from: number, to = a.meta.nDays): string | null {
  for (const id of Object.keys(a.daily) as (keyof typeof a.daily)[]) {
    const x = a.daily[id]!;
    const y = b.daily[id];
    if (!y) return `daily ${id} missing`;
    for (let i = from; i < Math.min(to, x.length, y.length); i++) if (!Object.is(x[i], y[i])) return `daily ${id}[${i}] ${x[i]} vs ${y[i]}`;
  }
  for (const id of Object.keys(a.hourly) as (keyof typeof a.hourly)[]) {
    const x = a.hourly[id]!;
    const y = b.hourly[id]!;
    for (let i = from * 24; i < Math.min(to * 24, x.length, y.length); i++) if (!Object.is(x[i], y[i])) return `hourly ${id}[${i}]`;
  }
  for (const k of Object.keys(a.safety) as (keyof typeof a.safety)[]) {
    const x = a.safety[k]!;
    const y = b.safety[k]!;
    for (let i = 0; i < Math.min(to, x.length, y.length); i++) if (!Object.is(x[i], y[i])) return `safety ${k}[${i}] ${x[i]} vs ${y[i]}`;
  }
  return null;
}

describe('CR-L1 day-stamped snapshots', () => {
  const full = runEngine(profile, sched90, { record: 'full', captureSnapshotAt: [0, 30, 45, 200] });

  it('captures the requested days only (out-of-range days ignored), stamped with their day', () => {
    expect(Object.keys(full.snapshots!).map(Number).sort((a, b) => a - b)).toEqual([0, 30, 45]);
    expect(full.snapshots![30]!.day).toBe(30);
    expect(full.snapshots![30]!.tracePrefix!.tissueMassKg).toHaveLength(30);
    expect(full.snapshots![30]!.latch).toBeDefined();
  });

  it('capturing does not change the run', () => {
    expect(diffFrom(runEngine(profile, sched90, { record: 'full' }), full, 0)).toBeNull();
  });

  it('restoring day k continues bit-identically (daily, hourly, safety trace incl. the restored prefix)', () => {
    for (const k of [0, 30, 45]) {
      const cont = runEngine(profile, sched90, { record: 'full', initialSnapshot: full.snapshots![k]! });
      expect(cont.meta.startDay ?? 0).toBe(k);
      expect(diffFrom(full, cont, k)).toBeNull();
    }
  });

  it('a day-k snapshot restores into a run of another horizon (key excludes the horizon)', () => {
    const long = runEngine(profile, sched120, { record: 'daily', captureSnapshotAt: [30] });
    const short = runEngine(profile, sched90, { record: 'daily', captureSnapshotAt: [30] });
    // the 90- and 120-day schedules compile identically on days < 90 (weekly pattern, no phase averaging across them)
    const contLong = runEngine(profile, sched120, { record: 'daily', initialSnapshot: short.snapshots![30]! });
    expect(diffFrom(long, contLong, 30)).toBeNull();
    const contShort = runEngine(profile, sched90, { record: 'daily', initialSnapshot: long.snapshots![30]! });
    expect(diffFrom(short, contShort, 30)).toBeNull();
  });

  it('is a planner-mode citizen too (series subset, record daily)', () => {
    const opts = { mode: 'planner' as const, record: 'daily' as const, series: ['fatMass', 'scaleWeight'] as const };
    const a = runEngine(profile, sched90, { ...opts, captureSnapshotAt: [21] });
    const b = runEngine(profile, sched90, { ...opts, initialSnapshot: a.snapshots![21]! });
    expect(diffFrom(a, b, 21)).toBeNull();
  });

  it('rejects a snapshot from another profile, start date, mode, series mask or parameter vector, and a wrong startDay', () => {
    const snap = full.snapshots![30]!;
    const other = resolveProfile(WOMAN);
    expect(() => runEngine(other, compileSchedule(repeatSchedule(90, PATTERN), other), { initialSnapshot: snap })).toThrow(/does not match/);
    const moved = compileSchedule({ ...repeatSchedule(90, PATTERN), startDate: '2026-10-06' }, profile);
    expect(() => runEngine(profile, moved, { initialSnapshot: snap })).toThrow(/does not match/);
    expect(() => runEngine(profile, sched90, { mode: 'planner', initialSnapshot: snap })).toThrow(/does not match/);
    expect(() => runEngine(profile, sched90, { series: ['fatMass'], initialSnapshot: snap })).toThrow(/does not match/);
    expect(() => runEngine(profile, sched90, { initialSnapshot: snap, startDay: 29 })).toThrow(/startDay/);
    const short = compileSchedule(repeatSchedule(20, PATTERN), profile);
    expect(() => runEngine(profile, short, { initialSnapshot: snap })).toThrow(/outside this run's horizon/);
  });
});

describe('CR-L2 tissue-mass anchors', () => {
  const base = runEngine(profile, sched90, { record: 'full', checks: true, captureSnapshotAt: [20] });
  const tm20 = base.safety.tissueMassKg[19]!; // end of day 19 = start of day 20

  it('sets the tissue mass exactly, splits the residual by the engine partition (not all to fat), keeps the identities', () => {
    const target = tm20 - 1.0;
    const r = runEngine(profile, sched90, { record: 'full', checks: true, anchors: [{ day: 20, tissueMassKg: target }] });
    const a = r.meta.anchors![0]!;
    expect(a.day).toBe(20);
    expect(a.tissueAfterKg).toBeCloseTo(target, 9);
    expect(a.dFatKg + a.dLeanKg).toBeCloseTo(target - a.tissueBeforeKg, 9);
    expect(a.tissueBeforeKg - tm20).toBeCloseTo(0, 4); // the trace is Float32
    expect(a.leanShare).toBeGreaterThan(0.02);
    expect(a.leanShare).toBeLessThan(0.6);
    expect(a.storedEnergyKcal).toBeLessThan(0);
    // conservation on both sides of the anchor (the jump is exogenous, booked in meta.anchors)
    const c = r.meta.checks!;
    expect(c.energyMaxAbsKcal).toBeLessThanOrEqual(Math.max(1e-6, base.meta.checks!.energyMaxAbsKcal * 1.01));
    expect(c.energyDayMaxAbsKcal).toBeLessThanOrEqual(1);
    expect(c.massMaxAbsKg).toBeLessThanOrEqual(1e-9);
    // days before the anchor are untouched; the morning weight right after it is about 1 kg lower
    expect(diffFrom(base, r, 0, 20)).toBeNull();
    expect(r.daily.scaleWeight![20]! - base.daily.scaleWeight![20]!).toBeCloseTo(-1.0, 1);
    expect(r.daily.fatMass![20]!).toBeLessThan(base.daily.fatMass![20]!);
    expect(r.daily.leanTissue![20]!).toBeLessThan(base.daily.leanTissue![20]!);
  });

  it('a measured fat fraction (DXA) sets FM/TM', () => {
    const r = runEngine(profile, sched90, { record: 'daily', anchors: [{ day: 20, tissueMassKg: tm20, split: { fatFrac: 0.2 } }] });
    const a = r.meta.anchors![0]!;
    expect(a.tissueAfterKg).toBeCloseTo(tm20, 9);
    const fm = base.daily.fatMass![19]! + a.dFatKg; // daily series are Float32
    expect(fm / a.tissueAfterKg).toBeCloseTo(0.2, 6);
  });

  it('a snapshot captured on the anchor day contains the anchor and continues bit-identically', () => {
    const anchors = [{ day: 20, tissueMassKg: tm20 + 0.6 }];
    const r = runEngine(profile, sched90, { record: 'full', anchors, captureSnapshotAt: [20] });
    const cont = runEngine(profile, sched90, { record: 'full', initialSnapshot: r.snapshots![20]! });
    expect(diffFrom(r, cont, 20)).toBeNull();
  });

  it('anchoring the engine to its own value is a no-op on the trajectory (to float precision)', () => {
    const probe = runEngine(profile, sched90, { record: 'none', anchors: [{ day: 20, tissueMassKg: tm20 }] });
    const exact = probe.meta.anchors![0]!.tissueBeforeKg;
    const r = runEngine(profile, sched90, { record: 'daily', anchors: [{ day: 20, tissueMassKg: exact }] });
    expect(Math.abs(r.meta.anchors![0]!.dFatKg)).toBeLessThan(1e-12);
    expect(Math.abs(r.daily.scaleWeight![89]! - base.daily.scaleWeight![89]!)).toBeLessThan(1e-3);
  });

  it('rejects two anchors on one day', () => {
    expect(() => runEngine(profile, sched90, { anchors: [{ day: 3, tissueMassKg: 80 }, { day: 3, tissueMassKg: 79 }] })).toThrow(/two anchors/);
  });
});

describe('CR-L3 intake offset', () => {
  const base = runEngine(profile, sched90, { record: 'daily', checks: true });

  it('δ = 0 is exactly the plain run', () => {
    const r = runEngine(profile, sched90, { record: 'daily', checks: true, intakeOffsetKcal: [{ fromDay: 0, kcal: 0 }] });
    expect(diffFrom(base, r, 0)).toBeNull();
  });

  it('a positive δ adds stored energy from its start day, keeps the echo series and the identities', () => {
    const r = runEngine(profile, sched90, { record: 'daily', checks: true, intakeOffsetKcal: [{ fromDay: 10, kcal: 250 }] });
    expect(diffFrom(base, r, 0, 10)).toBeNull();
    expect(Array.from(r.daily.inEnergy!)).toEqual(Array.from(base.daily.inEnergy!));
    expect(r.daily.fatMass![89]!).toBeGreaterThan(base.daily.fatMass![89]! + 0.5);
    expect(r.meta.checks!.energyDayMaxAbsKcal).toBeLessThanOrEqual(1);
    expect(r.meta.checks!.massMaxAbsKg).toBeLessThanOrEqual(1e-9);
    // tissue gained ≈ 80 days × 250 kcal at the engine's densities (well within a factor 2 of 2.1-4 kg)
    const gained = r.safety.tissueMassKg[89]! - base.safety.tissueMassKg[89]!;
    expect(gained).toBeGreaterThan(1.0);
    expect(gained).toBeLessThan(5.0);
  });

  it('steps change the offset (later entries replace earlier ones)', () => {
    const a = runEngine(profile, sched90, { record: 'daily', intakeOffsetKcal: [{ fromDay: 0, kcal: 200 }, { fromDay: 30, kcal: 0 }] });
    const b = runEngine(profile, sched90, { record: 'daily', intakeOffsetKcal: [{ fromDay: 0, kcal: 200 }] });
    expect(diffFrom(a, b, 0, 30)).toBeNull();
    expect(a.daily.fatMass![89]!).toBeLessThan(b.daily.fatMass![89]!);
  });
});
