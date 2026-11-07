// @vitest-environment node
/**
 * Living-plan engine contracts (docs/SUITE_SPEC.md §10): CR-L1 day-stamped snapshots, CR-L2 tissue-mass anchors, CR-L3
 * intake offset. Real 16-module engine; bit-for-bit comparisons where the contract promises exactness.
 */
import { runEngine } from '../loop';
import { compileSchedule } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { buildModelParams } from '../paramsRegistry';
import { MODULES } from '../moduleRegistry';
import type { SimulationResult } from '../../types/result';
import { CONTRACT_FINGERPRINT } from '@/lib/bodyContracts';
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

// =====================================================================================================================
// D7-02 / C6 / C7 (2026-10-18, W0-core): measured t = 0 anchors, status sidecars and contract-stamped snapshots.
// =====================================================================================================================

describe('D7-02 measured lab values are exact t = 0 values; an unsupported projection carries a status', () => {
  // LDL 8.02 mmol/L ≈ 310 mg/dL (outside the cardiometabolic model's calibrated baseline range); HDL 1.3 mmol/L inside it
  const labs = { ldlMmolL: 8.02, hdlMmolL: 1.3 };
  const series = ['ldl', 'apoB', 'hdl', 'fatMass'] as const;
  const flagged = resolveProfile({ ...MAN, labs, labMeta: { ldlMmolL: { source: 'marker', outOfDomain: true, measuredOn: '2026-09-30', sampleId: 'lab-1' } } });
  const s30 = compileSchedule(repeatSchedule(30, PATTERN), flagged);

  it('keeps the measured values exactly at t = 0, flags the out-of-domain projection and closes the status over its dependants', () => {
    const r = runEngine(flagged, s30, { record: 'daily', series: [...series] });
    expect(r.initial.ldl).toBe(8.02);
    expect(r.initial.hdl).toBe(1.3);
    const anchors = r.meta.observedAnchors!;
    expect(anchors.find((a) => a.series === 'ldl')).toEqual({ series: 'ldl', value: 8.02, unit: 'mmol/L', observationId: 'lab-1', outOfDomain: true });
    expect(anchors.find((a) => a.series === 'hdl')).toEqual({ series: 'hdl', value: 1.3, unit: 'mmol/L', outOfDomain: false });
    const st = r.meta.outputStatus!;
    // the cardiometabolic module's calibration domain decides (provider `cardiometabolicObservedAnchors`); only `initial` is
    // the observation, so every modelled daily sample is unsupported from index 0 (A1-052)
    expect(st.ldl).toMatchObject({ status: 'outOfDomain', reasonCode: 'observedBaselineOutsideCalibration', fromDay: 0 });
    expect(st.apoB).toMatchObject({ status: 'outOfDomain', reasonCode: 'dependsOnOutOfDomainBaseline', fromDay: 0 }); // ApoB moves with the LDL response
    expect(st.hdl).toBeUndefined();
    expect(st.fatMass).toBeUndefined();
    // numbers and statuses travel separately: the buffers stay finite, never a NaN/zero sentinel
    expect(Array.from(r.daily.ldl!).every(Number.isFinite)).toBe(true);
  });

  it('any measured value the model cannot start from stays visible and is flagged (anchor and status agree)', () => {
    const rp = resolveProfile({ ...MAN, labs: { ldlMmolL: 15, tgMmolL: 13.5, fastingGlucoseMmolL: 16.6 } });
    const r = runEngine(rp, compileSchedule(repeatSchedule(14, PATTERN), rp), { record: 'daily', series: ['ldl', 'triglycerides', 'fastingGlucose'] });
    expect(r.initial.ldl).toBe(15);
    expect(r.initial.triglycerides).toBe(13.5);
    expect(r.initial.fastingGlucose).toBe(16.6);
    for (const a of r.meta.observedAnchors!) expect(a.outOfDomain).toBe(r.meta.outputStatus?.[a.series]?.status === 'outOfDomain');
    // no provenance flag needed: values outside the calibration domain are caught even though the module now reproduces
    // them exactly at t = 0 (no clamp left to detect)
    expect(r.meta.observedAnchors!.map((a) => [a.series, a.outOfDomain])).toEqual([
      ['ldl', true],
      ['triglycerides', true],
      ['fastingGlucose', true],
    ]);
  });

  it('a value inside the calibration domain is an exact anchor with no status; the domain follows the run parameters', () => {
    const rp = resolveProfile({ ...MAN, labs: { ldlMmolL: 3.2, liverFatPct: 12 } });
    const cs = compileSchedule(repeatSchedule(7, PATTERN), rp);
    const r = runEngine(rp, cs, { record: 'daily', series: ['ldl', 'liverFat'] });
    expect(r.initial.ldl).toBe(3.2);
    expect(r.meta.observedAnchors!.every((a) => !a.outOfDomain)).toBe(true);
    expect(r.meta.outputStatus).toBeUndefined();
    // a run whose liver store ceiling is below the measurement judges it out of domain (liver.max is a run parameter)
    const params = buildModelParams(MODULES);
    const v = Float64Array.from(params.values);
    v[params.index.get('cardiometabolic.liver.max')!] = 10;
    const low = runEngine(rp, cs, { record: 'daily', series: ['ldl', 'liverFat'], paramOverrides: v });
    expect(low.initial.liverFat).toBe(12);
    expect(low.meta.outputStatus?.liverFat).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
  });

  it('a generated baseline is not an observation; runs without labs carry no anchors or measured-baseline statuses', () => {
    const gen = resolveProfile({ ...MAN, labs: { ldlMmolL: 3 }, labMeta: { ldlMmolL: { source: 'generated' } } });
    const r = runEngine(gen, compileSchedule(repeatSchedule(7, PATTERN), gen), { record: 'daily', series: ['ldl'] });
    expect(r.meta.observedAnchors).toBeUndefined();
    const plain = runEngine(profile, sched90, { record: 'daily', series: ['ldl', 'fatMass'] });
    expect(plain.meta.observedAnchors).toBeUndefined();
    // W1: the modules' own response-validity statuses may apply; nothing claims an out-of-domain measured baseline
    for (const st of Object.values(plain.meta.outputStatus ?? {})) expect(st!.status).not.toBe('outOfDomain');
    expect(plain.meta.outputStatus?.fatMass).toBeUndefined();
  });

  it('a restored snapshot (day-stamped or post-burn-in) keeps the observation and status semantics of the uninterrupted run', () => {
    const opts = { record: 'daily' as const, series: [...series] };
    const full = runEngine(flagged, s30, { ...opts, captureSnapshotAt: [10] });
    const cont = runEngine(flagged, s30, { ...opts, initialSnapshot: full.snapshots![10]! });
    expect(cont.initial.ldl).toBe(8.02);
    expect(cont.meta.observedAnchors).toEqual(full.meta.observedAnchors);
    expect(cont.meta.outputStatus).toEqual(full.meta.outputStatus);
    expect(diffFrom(full, cont, 10)).toBeNull();
    const snap = runEngine(flagged, s30, { ...opts, captureSnapshot: true }).snapshot!;
    const resumed = runEngine(flagged, s30, { ...opts, initialSnapshot: snap });
    expect(resumed.initial.ldl).toBe(8.02);
    expect(resumed.meta.outputStatus).toEqual(full.meta.outputStatus);
  });
});

describe('C7 contract-stamped snapshots', () => {
  const r = runEngine(profile, sched90, { record: 'daily', captureSnapshotAt: [15], captureSnapshot: true });

  it('every snapshot and run carries the contract fingerprint', () => {
    expect(r.snapshots![15]!.contracts).toBe(CONTRACT_FINGERPRINT);
    expect(r.snapshot!.contracts).toBe(CONTRACT_FINGERPRINT);
    expect(r.meta.contracts).toBe(CONTRACT_FINGERPRINT);
  });

  it('a snapshot captured under other contract versions is never restored', () => {
    expect(() => runEngine(profile, sched90, { record: 'daily', initialSnapshot: { ...r.snapshots![15]!, contracts: 'other' } })).toThrow(/contract/);
    expect(() => runEngine(profile, sched90, { record: 'daily', initialSnapshot: { ...r.snapshot!, contracts: 'other' } })).toThrow(/contract/);
  });
});

// ---------------------------------------------------------------- W1-core contributions (2026-10-18)

describe('history-dependent state continues across checkpoints (D3-06, D5-03, D8-06)', () => {
  // three weeks of training, then a break: detraining clocks, peaks and dose history run through the checkpoint
  const train = { ...repeatSchedule(1, [0]).programs[0]!, id: 'T' };
  const rest = { ...repeatSchedule(1, [1]).programs[1]!, id: 'R', exercise: [] };
  const breakSched = compileSchedule(repeatSchedule(70, [...Array(21).fill(0), ...Array(49).fill(1)], [train, rest]), profile);

  it('a split run (checkpoint during the break) equals the uninterrupted run, so a pause before or after a replan loses the same', () => {
    const series = ['muscleLegs', 'leanMass', 'fatMass', 'scaleWeight'] as const;
    const full = runEngine(profile, breakSched, { record: 'daily', series, captureSnapshotAt: [21, 35] });
    for (const k of [21, 35]) {
      const cont = runEngine(profile, breakSched, { record: 'daily', series, initialSnapshot: full.snapshots![k]! });
      for (const id of series) {
        const a = full.daily[id]!;
        const b = cont.daily[id]!;
        for (let d = k; d < 70; d++) expect(Object.is(a[d], b[d]), `${id}[${d}] after a checkpoint at ${k}`).toBe(true);
      }
    }
  });

  it('applied intake corrections are reported identically by a resumed run for its own days', () => {
    const offsets = [{ fromDay: 5, kcal: 120 }];
    const full = runEngine(profile, sched90, { record: 'daily', intakeOffsetKcal: offsets, captureSnapshotAt: [40] });
    const cont = runEngine(profile, sched90, { record: 'daily', intakeOffsetKcal: offsets, initialSnapshot: full.snapshots![40]! });
    expect(cont.meta.offsetsApplied![0]!.day).toBe(40);
    expect(cont.meta.offsetsApplied).toEqual(full.meta.offsetsApplied!.filter((o) => o.day >= 40));
  });

  it('a day-stamped continuation keeps day k − 1’s night (observed initial sleep only shapes day 0)', () => {
    const withObs = compileSchedule(
      {
        ...repeatSchedule(20, PATTERN),
        programs: repeatSchedule(20, PATTERN).programs.map((t, i) =>
          i === 0 ? { ...t, sleep: { observed: { bedAt: '2026-10-05T02:00:00+02:00', wakeAt: '2026-10-05T06:30:00+02:00', tz: 'Europe/Berlin' } } } : t,
        ),
      },
      profile,
    );
    expect(withObs.initialSleep).toBeDefined();
    const full = runEngine(profile, withObs, { record: 'daily', series: ['scaleWeight'], captureSnapshotAt: [10] });
    const cont = runEngine(profile, withObs, { record: 'daily', series: ['scaleWeight'], initialSnapshot: full.snapshots![10]! });
    for (let d = 10; d < 20; d++) expect(Object.is(cont.daily.scaleWeight![d], full.daily.scaleWeight![d])).toBe(true);
  });
});
