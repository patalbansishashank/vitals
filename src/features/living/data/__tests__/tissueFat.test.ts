/**
 * A1-050 (D4-05/C6) — Progress › Body's tissue fat fraction is 100·FM/TM with TM = FM + FFM_act read from the replay's own
 * same-time end-of-day trace (`result.safety.tissueMassKg`), never FM + lean tissue (lean tissue omits the reference
 * glycogen and its water that FFM_act keeps) and never a reconstruction of LT0 from a profile or the replay's initial frame
 * (a resumed replay starts from a later frame). An unavailable denominator or a status that forbids reading the masses
 * withholds the derived percentage; the model's fat and lean rows and the raw measurements stay.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as LivingModule from '@/living';

// a switch that blanks the replay's tissue-mass trace at every day (an unavailable denominator), read through the real source
const trace = vi.hoisted(() => ({ broken: false }));
vi.mock('@/living', async (importOriginal) => {
  const real = await importOriginal<typeof LivingModule>();
  return {
    ...real,
    projectLiving: (i: Parameters<typeof real.projectLiving>[0]) => {
      const p = real.projectLiving(i);
      if (trace.broken && p.assimilation) p.assimilation.replay.result.safety.tissueMassKg.fill(Number.NaN);
      return p;
    },
  };
});
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { runReplay } from '@/engine/assimilation';
import { sessionCompiler } from '@/commands/livingWiring';
import {
  activateIfDue,
  addDays,
  confirmedStateFromRecord,
  dailyAssimilation,
  localToInstant,
  projectLiving,
  realisedSchedule,
  startFromScenario,
  weeklyCheckIn,
  weighInsFor,
  type DayStatusDoc,
  type LivingDocs,
  type MeasurementEntry,
} from '@/living';
import type { DocumentStore } from '@/store';
import { currentDay, fixedClock } from '../../clock';
import { createDocumentLivingSource, tissueFatPctAt } from '../documents';

const START = '2026-10-05';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 92 }, habits: { typicalSteps: 7000, sessionsPerWeek: 2 }, startDate: START };
const DAY: DayTemplate = {
  id: 'A',
  label: 'day',
  energy: { kind: 'pctMaintenance', pct: 80 },
  macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } },
  steps: 8000,
};
const SCENARIO: Schedule = { schemaVersion: 1, startDate: START, horizonDays: 42, programs: [DAY], days: Array.from({ length: 42 }, () => ({ program: 0 })) };

function livingFixture() {
  const started = startFromScenario(
    { planId: 'plan-tf', now: '2026-10-01T09:00:00.000Z', today: '2026-10-01', createdBy: { kind: 'user' }, versions: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' } },
    { id: 'sc-tf', rev: '1', name: 'Tissue fat', schedule: SCENARIO },
    MAN,
    [{ metric: 'scaleWeight', direction: 'target', target: -5, targetKind: 'change' }],
    { startDate: START, startValues: new Map([[0, 92]]) },
  );
  if (!started.ok) throw new Error(started.reason);
  const activated = activateIfDue(started.plan, START);
  if (!activated.ok) throw new Error(activated.reason);
  const plan = { ...activated.plan, id: started.plan.id };
  const version = started.version;
  // the person loses a little more than the plan: daily morning weigh-ins from a replay with a hidden −250 kcal/d
  const truth = runReplay({ profile: MAN, schedule: SCENARIO, intakeOffsets: [{ fromDay: 0, kcal: -250 }] });
  const measurements: MeasurementEntry[] = Array.from({ length: 15 }, (_, d) => ({
    id: `w${d}`,
    date: addDays(START, d),
    metric: 'weightKg' as const,
    value: Math.round(truth.scaleWakeKg[d]! * 10) / 10,
    context: 'morningFasted' as const,
    source: { by: 'user' as const, method: 'typed' as const },
  }));
  measurements.push({ id: 'g0', date: addDays(START, 13), metric: 'waistCm', value: 96, source: { by: 'user', method: 'typed' } } as MeasurementEntry);
  const dayStatus: DayStatusDoc[] = Array.from({ length: 14 }, (_, d) => ({ date: addDays(START, d), marks: { all: 'asPlanned' as const } }));
  const anchorDate = addDays(START, 14);
  const schedule = realisedSchedule(plan, version, [], anchorDate);
  const ci = weeklyCheckIn({ plan, schedule, records: [], weighIns: weighInsFor(plan, measurements, []), today: anchorDate, intakeDays: [] });
  if (!ci.record) throw new Error('no check-in record');
  return { plan, version, measurements, dayStatus, record: ci.record };
}

const fx = livingFixture();
const idle = { subscribe: () => () => {}, ready: Promise.resolve() } as unknown as DocumentStore;

function sourceAt(today: string, docs: LivingDocs) {
  const clock = fixedClock(`${today}T10:00:00`);
  return { clock, source: createDocumentLivingSource({ clock, read: () => docs, getStore: () => idle, onSwitch: () => () => {} }) };
}

describe('tissue fat fraction (A1-050, D4-05/C6)', () => {
  const today = addDays(START, 16);
  const docs: LivingDocs = { plan: fx.plan, versions: [fx.version], dayStatus: fx.dayStatus, entries: [], measurements: fx.measurements, records: [fx.record] };

  it('the real document source shows 100·FM/tissueMass at the anchor day (engine trace, not FM + lean tissue)', () => {
    const { clock, source } = sourceAt(today, docs);
    expect(currentDay(clock)).toBe(today);
    const comp = source.composition()!;
    const row = comp.rows.find((r) => r.label === 'tissue fat')!;
    const p = projectLiving({ docs, today, tz: clock.tz, now: localToInstant(today, 10, clock.tz), sessionCompiler });
    const replay = p.assimilation!.replay;
    const d = fx.record.anchorDay;
    expect(d).toBe(14);
    const fat = replay.fatKg[d]!;
    const lean = replay.leanKg[d]!;
    const tm = replay.result.safety.tissueMassKg[d]!;
    // kg over kg at the same end-of-day sample; Float32 trace tolerance
    expect(row.value).toBeCloseTo((100 * fat) / tm, 3);
    expect(row.lo).toBe(row.value);
    expect(row.hi).toBe(row.value);
    // the denominator holds the reference glycogen and its water: FM/(FM + LT) is a different (larger) number
    expect(tm).toBeGreaterThan(fat + lean);
    expect((100 * fat) / (fat + lean) - row.value).toBeGreaterThan(0.3);
    // the real masses stay as their own rows; raw measurements stay as entered
    expect(comp.rows.find((r) => r.label === 'fat mass')!.value).toBeCloseTo(fat, 6);
    expect(comp.rows.find((r) => r.label === 'lean tissue')!.value).toBeCloseTo(lean, 6);
    expect(comp.girths).toEqual([expect.objectContaining({ label: 'waist', value: 96 })]);
  }, 30_000);

  it('a resumed replay (cached anchor snapshot) gives the same operator: its own same-time trace, not its initial frame', () => {
    const later = addDays(START, 20);
    const schedule = realisedSchedule(fx.plan, fx.version, [], later);
    const weighIns = weighInsFor(fx.plan, fx.measurements, []);
    const state = confirmedStateFromRecord(fx.plan, schedule, [fx.record], fx.record);
    const cached = dailyAssimilation({ plan: fx.plan, schedule, records: [fx.record], weighIns, today: later, cached: { anchorDay: 14, inputsHash: fx.record.inputsHash, snapshot: state.snapshot } });
    const full = dailyAssimilation({ plan: fx.plan, schedule, records: [fx.record], weighIns, today: later });
    expect(cached.usedCache).toBe(true);
    expect(cached.replay.startDay).toBe(14);
    for (const d of [14, 17, 19]) {
      const c = tissueFatPctAt(cached.replay, d)!;
      expect(c).toBeCloseTo((100 * cached.replay.fatKg[d]!) / cached.replay.result.safety.tissueMassKg[d]!, 9);
      expect(c).toBeCloseTo(tissueFatPctAt(full.replay, d)!, 3);
    }
    // before the resumed replay's first day there is no fat-mass sample: no percentage
    expect(tissueFatPctAt(cached.replay, 10)).toBeNull();
  }, 30_000);

  it('before and after an anchor the value is the trace ratio of that day', () => {
    const p = projectLiving({ docs, today, tz: 'UTC', now: localToInstant(today, 10, 'UTC'), sessionCompiler });
    const replay = p.assimilation!.replay;
    for (const d of [3, 13, 14, 15]) expect(tissueFatPctAt(replay, d)!).toBeCloseTo((100 * replay.fatKg[d]!) / replay.result.safety.tissueMassKg[d]!, 9);
  }, 30_000);

  it('an unavailable, zero or non-finite denominator, or a forbidding status, gives no derived percentage', () => {
    const base = { fatKg: Float64Array.from([20, 20, 20]), result: { meta: {}, safety: { tissueMassKg: Float32Array.from([80, Number.NaN, 0]) } } } as unknown as Parameters<typeof tissueFatPctAt>[0];
    expect(tissueFatPctAt(base, 0)).toBeCloseTo(25, 9);
    expect(tissueFatPctAt(base, 1)).toBeNull();
    expect(tissueFatPctAt(base, 2)).toBeNull();
    expect(tissueFatPctAt(base, 3)).toBeNull();
    const noTrace = { ...base, result: { meta: {}, safety: {} } } as unknown as Parameters<typeof tissueFatPctAt>[0];
    expect(tissueFatPctAt(noTrace, 0)).toBeNull();
    const limited = { ...base, result: { ...base.result, meta: { outputStatus: { fatMass: { status: 'modelLimit', fromDay: 1 } } } } } as unknown as Parameters<typeof tissueFatPctAt>[0];
    // before the status's first day the sample is still readable; from it on it is not
    expect(tissueFatPctAt({ ...limited, result: { ...limited.result, safety: { tissueMassKg: Float32Array.from([80, 80, 80]) } } } as typeof limited, 0)).toBeCloseTo(25, 9);
    expect(tissueFatPctAt({ ...limited, result: { ...limited.result, safety: { tissueMassKg: Float32Array.from([80, 80, 80]) } } } as typeof limited, 1)).toBeNull();
  });

  it('the document source withholds the row (and keeps the masses and measurements) when the trace is unavailable', () => {
    trace.broken = true;
    try {
      const { source } = sourceAt(today, docs);
      const comp = source.composition()!;
      expect(comp.rows.map((r) => r.label)).toEqual(['fat mass', 'lean tissue']);
      expect(comp.girths).toEqual([expect.objectContaining({ label: 'waist', value: 96 })]);
    } finally {
      trace.broken = false;
    }
  }, 30_000);
});
