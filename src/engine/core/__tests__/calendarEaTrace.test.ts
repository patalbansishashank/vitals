// @vitest-environment node
/**
 * D4-04, the core's contribution (W2-core): the SafetyTrace is allocated with every field of its contract — the eating-day
 * EA alias, the calendar energy-availability ledger and windows with their coverage, end-of-day fat mass — the new fields
 * are valid early-abort bounds, and day-stamped snapshots carry, key and check their whole history (C7).
 *
 * Provider/consumer fixture: `ledgerProvider` stands in for the safety module's writer (W2-planner) on the placeholder
 * physics, with the reference arithmetic of the final spec — EA_d = (EI_d − EEE_net,d)/FFM_d and
 * EA_window = Σ(EI_d − EEE_net,d)/Σ FFM_d over the available calendar days, fast days included, no zero-padding of the
 * burn-in. The block at the end checks the same identities on the real safety module once it writes the ledger.
 */
import { SAFETY_TRACE_KEYS, runEngine } from '../loop';
import { compileSchedule } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { defineModule } from '../moduleKit';
import { ENGINE_VERSION } from '../defaults';
import { MODULES } from '../moduleRegistry';
import { incompatibleTracePrefix, traceLayout } from '../snapshot';
import type { AnyEngineModule } from '../../types/module';
import type { DayInput } from '../../types/inputs';
import type { EngineSnapshot, SafetyTrace, SafetyTraceKey, SimulationResult } from '../../types/result';
import type { DayTemplate } from '../../types/schedule';
import { MAN, PROGRAM_A, PROGRAM_B, repeatSchedule } from './fixtures';
import { makeStubModules } from './stubModules';

const D4_04_KEYS = [
  'eatingDayEa7', 'calendarEa7', 'calendarEa28', 'eaCoverage7', 'eaCoverage28', 'eiKcal', 'eeeNetKcal', 'ffmActKg', 'eaRawDaily',
] as const satisfies readonly SafetyTraceKey[];

/** Reference calendar EA over parallel daily ledgers: Σ(EI − EEE_net)/Σ FFM, kcal/kg FFM/d (NaN without a valid day). */
function calendarEa(ei: readonly number[], eee: readonly number[], ffm: readonly number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < ei.length; i++) {
    num += ei[i]! - eee[i]!;
    den += ffm[i]!;
  }
  return den > 0 ? num / den : Number.NaN;
}

// --------------------------------------------------------------------------------- provider fixture (placeholder physics)
const RING = 28;
/** Scripted net session cost of a training day (the placeholder activity writes no session energy), kcal. */
const EEE_TRAINING_KCAL = 250;

interface LedgerS {
  ei: Float64Array;
  eee: Float64Array;
  ffm: Float64Array;
  eating: Uint8Array;
  idx: number;
  seen: number;
  dayEi: number;
  dayEee: number;
}

function ledgerProvider(): AnyEngineModule {
  const safety = MODULES.find((m) => m.id === 'safety')!;
  return defineModule<LedgerS, { trace: SafetyTrace }>({
    id: safety.id,
    specSection: safety.specSection,
    dossiers: safety.dossiers,
    params: safety.params,
    reads: safety.reads,
    writes: safety.writes,
    records: safety.records,
    prepare: (ctx) => ({ trace: ctx.safetyTrace }),
    init: () => ({ ei: new Float64Array(RING), eee: new Float64Array(RING), ffm: new Float64Array(RING), eating: new Uint8Array(RING), idx: 0, seen: 0, dayEi: 0, dayEee: 0 }),
    startDay: (s, _k, _bus, day: DayInput) => {
      s.dayEi = day.energyKcal;
      s.dayEee = day.nSessions > 0 ? EEE_TRAINING_KCAL : 0;
    },
    endOfDay: (s, k, bus, _day, clock) => {
      const d = clock.day;
      if (d < 0) return; // the habitual burn-in is not observed history: no window is padded with it
      const i0 = s.idx;
      s.ei[i0] = s.dayEi;
      s.eee[i0] = s.dayEee;
      s.ffm[i0] = bus.ffmActKg;
      s.eating[i0] = s.dayEi > 0 ? 1 : 0;
      s.idx = (i0 + 1) % RING;
      s.seen++;
      const window = (n: number, eatingOnly: boolean): { ea: number; days: number } => {
        const ei: number[] = [];
        const eee: number[] = [];
        const ffm: number[] = [];
        for (let j = 0; j < Math.min(n, s.seen); j++) {
          const r = (i0 - j + RING) % RING;
          if (eatingOnly && s.eating[r] !== 1) continue;
          ei.push(s.ei[r]!);
          eee.push(s.eee[r]!);
          ffm.push(s.ffm[r]!);
        }
        return { ea: calendarEa(ei, eee, ffm), days: ei.length };
      };
      const t = k.trace;
      const c7 = window(7, false);
      const c28 = window(28, false);
      t.eiKcal![d] = s.dayEi;
      t.eeeNetKcal![d] = s.dayEee;
      t.ffmActKg![d] = bus.ffmActKg;
      t.eaRawDaily![d] = (s.dayEi - s.dayEee) / bus.ffmActKg;
      t.calendarEa7![d] = c7.ea;
      t.calendarEa28![d] = c28.ea;
      t.eaCoverage7![d] = c7.days;
      t.eaCoverage28![d] = c28.days;
      // the legacy eating-day statistic is written under its old name only; the core's alias must carry it
      t.ea7[d] = window(7, true).ea;
      t.fatMassKg![d] = bus.fatMassKg;
      t.tissueMassKg[d] = bus.tissueMassKg;
    },
  }) as unknown as AnyEngineModule;
}

const LEDGER_MODULES: readonly AnyEngineModule[] = makeStubModules().map((m) => (m.id === 'safety' ? ledgerProvider() : m));

const EATING: DayTemplate = { ...PROGRAM_A, id: 'E', label: 'eating', energy: { kind: 'kcal', kcal: 2700 } };
const FAST: DayTemplate = { ...PROGRAM_B, id: 'F', label: 'water only', energy: { kind: 'zero' } };
const profile = resolveProfile(MAN);
/** Four 2 700 kcal training days, then three zero-intake rest days, repeated (the D4-04 regression shape). */
const sched56 = compileSchedule(repeatSchedule(56, [0, 0, 0, 0, 1, 1, 1], [EATING, FAST]), profile);

/** First trace field/day on which two runs differ (all days < to), or null. */
function traceDiff(a: SafetyTrace, b: SafetyTrace, to: number): string | null {
  for (const k of Object.keys(a) as SafetyTraceKey[]) {
    const x = a[k]!;
    const y = b[k];
    if (!y) return `${k} missing`;
    for (let i = 0; i < to; i++) if (!Object.is(x[i], y[i])) return `${k}[${i}] ${x[i]} vs ${y[i]}`;
  }
  return null;
}

describe('D4-04 calendar EA reference arithmetic (provider fixture)', () => {
  it('60 kg FFM, four EI 2 700 / EEE 250 days and three zero-intake days: eating-day EA 40.83, calendar EA_7 23.33', () => {
    const ei = [2700, 2700, 2700, 2700, 0, 0, 0];
    const eee = [250, 250, 250, 250, 0, 0, 0];
    const ffm = Array<number>(7).fill(60);
    expect(calendarEa(ei.slice(0, 4), eee.slice(0, 4), ffm.slice(0, 4))).toBeCloseTo(40.83, 2);
    expect(calendarEa(ei, eee, ffm)).toBeCloseTo(23.33, 2);
  });

  it('changing FFM weights the window by the summed FFM (not the mean of daily EA); negative daily EA is kept', () => {
    const ei = [2400, 0, 2400];
    const eee = [300, 400, 0];
    const ffm = [60, 59, 58];
    expect(calendarEa(ei, eee, ffm)).toBeCloseTo((2100 - 400 + 2400) / (60 + 59 + 58), 10);
    expect((0 - 400) / 59).toBeLessThan(0);
    const meanOfDaily = (2100 / 60 + -400 / 59 + 2400 / 58) / 3;
    expect(Math.abs(calendarEa(ei, eee, ffm) - meanOfDaily)).toBeGreaterThan(1e-3);
  });
});

describe('D4-04 SafetyTrace allocation (W2-core)', () => {
  const real = runEngine(profile, sched56, { record: 'daily' });

  it('allocates every SafetyTrace field for the horizon, the calendar ledger and fat mass included, in one listed layout', () => {
    expect(Object.keys(real.safety)).toEqual([...SAFETY_TRACE_KEYS]);
    for (const k of [...D4_04_KEYS, 'fatMassKg'] as const) expect(SAFETY_TRACE_KEYS, k).toContain(k);
    for (const k of SAFETY_TRACE_KEYS) {
      const a = real.safety[k];
      expect(a, k).toBeInstanceOf(Float32Array);
      expect(a, k).toHaveLength(56);
    }
  });

  it('eatingDayEa7 is the legacy eating-day ea7 itself (explicit name, never a second estimand)', () => {
    expect(real.safety.eatingDayEa7).toBe(real.safety.ea7);
    const fx = runEngine(profile, sched56, { record: 'daily' }, LEDGER_MODULES);
    expect(fx.safety.eatingDayEa7).toBe(fx.safety.ea7);
    expect(Number.isFinite(fx.safety.eatingDayEa7![20]!)).toBe(true);
  });

  it('every trace field is a valid early-abort bound, read from the trace after the day', () => {
    for (const k of SAFETY_TRACE_KEYS) {
      expect(() => runEngine(profile, sched56, { mode: 'planner', record: 'none', abortOn: [{ id: k, series: k, op: '<', value: -1e9 }] }, LEDGER_MODULES), k).not.toThrow();
    }
    // the fixture's calendar EA_7 falls under 25 kcal/kg FFM/d within the first run of zero-intake days
    const fx = runEngine(profile, sched56, { record: 'daily' }, LEDGER_MODULES);
    const first = Array.from(fx.safety.calendarEa7!).findIndex((v) => v < 25);
    expect(first).toBeGreaterThanOrEqual(4);
    expect(first).toBeLessThanOrEqual(6);
    const r = runEngine(profile, sched56, { mode: 'planner', record: 'none', abortOn: [{ id: 'cal-ea', series: 'calendarEa7', op: '<', value: 25 }] }, LEDGER_MODULES);
    expect(r.meta.aborted).toMatchObject({ day: first, bound: 'cal-ea' });
  });

  it('an unwritten calendar value is unknown (NaN), never a passing or failing number for a bound', () => {
    const r = runEngine(profile, sched56, { mode: 'planner', record: 'none', abortOn: [{ id: 'x', series: 'calendarEa28', op: '<', value: 1e9 }] }, makeStubModules());
    expect(r.meta.aborted).toBeUndefined();
    expect(Number.isNaN(r.safety.calendarEa28![10]!)).toBe(true);
  });
});

describe('D4-04 provider fixture through the core: every calendar day counts', () => {
  const fx = runEngine(profile, sched56, { record: 'daily' }, LEDGER_MODULES);
  const t = fx.safety;
  const window = (d: number, n: number) => {
    const lo = Math.max(0, d - n + 1);
    const ei: number[] = [];
    const eee: number[] = [];
    const ffm: number[] = [];
    for (let j = lo; j <= d; j++) {
      ei.push(t.eiKcal![j]!);
      eee.push(t.eeeNetKcal![j]!);
      ffm.push(t.ffmActKg![j]!);
    }
    return calendarEa(ei, eee, ffm);
  };

  it('zero-intake days stay in the ledger and in EA_7/EA_28 (fast days are not dropped), with coverage = days available', () => {
    for (let d = 0; d < 56; d++) {
      expect(Number.isFinite(t.calendarEa7![d]!), `day ${d}`).toBe(true);
      expect(t.eaCoverage7![d]).toBe(Math.min(7, d + 1));
      expect(t.eaCoverage28![d]).toBe(Math.min(28, d + 1));
      expect(Math.abs(t.calendarEa7![d]! - window(d, 7))).toBeLessThan(1e-3);
      expect(Math.abs(t.calendarEa28![d]! - window(d, 28))).toBeLessThan(1e-3);
    }
    expect(t.eiKcal![5]).toBe(0);
    // calendar exposure is lower than the eating-day statistic on the same day
    expect(t.calendarEa7![6]!).toBeLessThan(t.eatingDayEa7![6]!);
  });

  it('rearranging which days are fast days keeps the calendar exposure of a full week', () => {
    const shuffled = compileSchedule(repeatSchedule(56, [1, 0, 1, 0, 0, 1, 0], [EATING, FAST]), profile);
    const fy = runEngine(profile, shuffled, { record: 'daily' }, LEDGER_MODULES);
    // the same four eating and three zero days per week, in another order: the week-end calendar EA_7 agrees (FFM is
    // constant on the placeholder physics)
    for (const d of [13, 20, 27]) expect(fy.safety.calendarEa7![d]!).toBeCloseTo(t.calendarEa7![d]!, 3);
  });
});

describe('D4-04 day-stamped snapshots carry and check the whole trace history (C7)', () => {
  const full = runEngine(profile, sched56, { record: 'daily', captureSnapshotAt: [0, 10, 30] }, LEDGER_MODULES);

  it('every trace field has its prefix; the alias shares its source copy', () => {
    const snap = full.snapshots![30]!;
    for (const k of SAFETY_TRACE_KEYS) expect(snap.tracePrefix![k], k).toHaveLength(30);
    expect(snap.tracePrefix!.eatingDayEa7).toBe(snap.tracePrefix!.ea7);
    expect(Number.isFinite(snap.tracePrefix!.calendarEa28![29]!)).toBe(true);
  });

  it('continuation from day k equals the full replay on every trace field (calendar rings in the module state)', () => {
    for (const k of [0, 10, 30]) {
      const cont = runEngine(profile, sched56, { record: 'daily', initialSnapshot: full.snapshots![k]! }, LEDGER_MODULES);
      expect(cont.meta.startDay ?? 0).toBe(k);
      expect(traceDiff(full.safety, cont.safety, 56), `from day ${k}`).toBeNull();
      expect(cont.safety.eatingDayEa7).toBe(cont.safety.ea7);
    }
  });

  it('a longer horizon continues the same history (the key has no horizon)', () => {
    const longer = compileSchedule(repeatSchedule(70, [0, 0, 0, 0, 1, 1, 1], [EATING, FAST]), profile);
    const ref = runEngine(profile, longer, { record: 'daily' }, LEDGER_MODULES);
    const cont = runEngine(profile, longer, { record: 'daily', initialSnapshot: full.snapshots![30]! }, LEDGER_MODULES);
    expect(traceDiff(ref.safety, cont.safety, 70)).toBeNull();
  });

  it('a snapshot without the history of a trace field (older core, lossy store) is rejected, never NaN-filled', () => {
    const snap = full.snapshots![30]!;
    const { calendarEa28: _drop, ...rest } = snap.tracePrefix!;
    const missing: EngineSnapshot = { ...snap, tracePrefix: rest };
    expect(() => runEngine(profile, sched56, { record: 'daily', initialSnapshot: missing }, LEDGER_MODULES)).toThrow(/lacks the safety trace history of calendarEa28/);
    const lossy: EngineSnapshot = { ...snap, tracePrefix: JSON.parse(JSON.stringify(snap.tracePrefix)) as EngineSnapshot['tracePrefix'] };
    expect(() => runEngine(profile, sched56, { record: 'daily', initialSnapshot: lossy }, LEDGER_MODULES)).toThrow(/lacks the safety trace history/);
    const short: EngineSnapshot = { ...snap, tracePrefix: { ...snap.tracePrefix, eiKcal: snap.tracePrefix!.eiKcal!.slice(0, 29) } };
    expect(incompatibleTracePrefix(full.safety, short, 30)).toEqual(['eiKcal']);
    expect(incompatibleTracePrefix(full.safety, snap, 30)).toEqual([]);
    expect(incompatibleTracePrefix(full.safety, { ...snap, tracePrefix: undefined }, 0)).toEqual([]);
  });

  it('a snapshot keyed by the previous engine version or another trace layout is rejected (old safety snapshots)', () => {
    const snap = full.snapshots![30]!;
    expect(snap.key).toContain(ENGINE_VERSION);
    expect(snap.key).toContain(`trace:${traceLayout(full.safety)}`);
    const oldVersion: EngineSnapshot = { ...snap, key: snap.key.replace(ENGINE_VERSION, '1.2.0-foundations') };
    expect(() => runEngine(profile, sched56, { record: 'daily', initialSnapshot: oldVersion }, LEDGER_MODULES)).toThrow(/does not match/);
    const legacyKeys = Object.keys(full.safety).filter((k) => !(D4_04_KEYS as readonly string[]).includes(k) && k !== 'fatMassKg');
    const oldLayout: EngineSnapshot = { ...snap, key: snap.key.replace(/trace:[^|]+/, `trace:${traceLayout(Object.fromEntries(legacyKeys.map((k) => [k, true])) as unknown as SafetyTrace)}`) };
    expect(() => runEngine(profile, sched56, { record: 'daily', initialSnapshot: oldLayout }, LEDGER_MODULES)).toThrow(/does not match/);
  });
});

// ------------------------------------------------------------------- real safety module (W2-planner provider), once present
const MIXED = compileSchedule(repeatSchedule(60, [0, 0, 1, 0, 0, 0, 0], [PROGRAM_A, FAST]), profile);
const realRun: SimulationResult = runEngine(profile, MIXED, { record: 'daily' });
const ledgerWritten = Number.isFinite(realRun.safety.eiKcal![40]!) && Number.isFinite(realRun.safety.calendarEa7![40]!);

describe.runIf(ledgerWritten)('D4-04 identities on the real safety ledger', () => {
  const t = realRun.safety;
  const sum = (d: number, n: number) => {
    let num = 0;
    let den = 0;
    for (let j = d - n + 1; j <= d; j++) {
      num += t.eiKcal![j]! - t.eeeNetKcal![j]!;
      den += t.ffmActKg![j]!;
    }
    return num / den;
  };

  it('calendar EA_7/EA_28 = Σ(EI − EEE_net)/Σ FFM_act of the trace ledger on every full window, fast days included', () => {
    for (let d = 27; d < 60; d++) {
      expect(Math.abs(t.calendarEa7![d]! - sum(d, 7)), `EA7 day ${d}`).toBeLessThan(1e-3);
      expect(Math.abs(t.calendarEa28![d]! - sum(d, 28)), `EA28 day ${d}`).toBeLessThan(1e-3);
      expect(t.eaCoverage7![d], `coverage7 day ${d}`).toBe(7);
      expect(t.eaCoverage28![d], `coverage28 day ${d}`).toBe(28);
    }
  });

  it('daily EA is unclipped (EI − EEE_net)/FFM_act and fast days keep their exposure', () => {
    for (let d = 0; d < 60; d++) {
      const raw = (t.eiKcal![d]! - t.eeeNetKcal![d]!) / t.ffmActKg![d]!;
      expect(Math.abs(t.eaRawDaily![d]! - raw), `day ${d}`).toBeLessThan(1e-3);
      if (t.fastDay![d] === 1) expect(Number.isFinite(t.calendarEa7![d]!), `fast day ${d}`).toBe(true);
    }
    expect(t.eatingDayEa7).toBe(t.ea7);
  });
});
