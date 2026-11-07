// @vitest-environment node
/**
 * Phase 0C provider → consumer lifecycle checks for energy, composition and water (D6-02, D2-01, D5-02; C1/C2/C4/C7), on
 * the real 16-module engine fed by the living layer:
 *  - a logged 600 kcal / 30 g protein meal travels log → realised history → realised schedule → compile → engine with all
 *    600 kcal (480 kcal unallocated) and its realised protein coverage, which energy's protein-turnover term and TEF prior
 *    consume (exact protein on an attested day, lower bound otherwise);
 *  - the replay is idempotent across reload (JSON round trip), sync duplicates and import order;
 *  - a resumed run (day-stamped snapshot) continues bit-identically, also from a snapshot captured before the D6-02 state
 *    fields existed (additive state, rewritten every startDay);
 *  - a future planned fast length never reaches the replayed prefix of energy, composition or water, and an observed
 *    day's `zeroIntake` (energy's one plan-derived read) comes from realised intake;
 *  - the assimilation replay's wake tissue equals the water provider's same-path water-adjusted wake operator.
 */
import { describe, expect, it } from 'vitest';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import { runReplay } from '../../assimilation/replay';
import type { CompiledSchedule } from '../../types/inputs';
import type { SeriesId } from '../../types/metrics';
import type { EngineSnapshot, SimulationResult } from '../../types/result';
import { compositionModule } from '../composition';
import { waterModule } from '../water';
import { waterAdjustedWakeKg } from '../water/operators';
import { energyModule, proteinIsLowerBound } from './index';
import { DEFAULT_ITEM_WEIGHTS, compileVersion } from '@/living/prescription';
import { addDays, localToInstant } from '@/living/dates';
import { projectLiving, projectionSchedule, type LivingDocs } from '@/living/projection';
import type { DayStatusDoc, LogEntry, NutrientEstimate, PlanDoc, PlanVersionDoc } from '@/living/types';

const TZ = 'Asia/Kolkata';
const START = '2026-10-05';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: START };
const DAY: DayTemplate = {
  id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 2000 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } }, steps: 8000,
};
const HORIZON = 10;
const plain = (events: Schedule['events'] = []): Schedule => ({
  schemaVersion: 1, startDate: START, horizonDays: HORIZON, programs: [DAY], days: Array.from({ length: HORIZON }, () => ({ program: 0 })), ...(events.length > 0 ? { events } : {}),
});

/** Series owned by the three modules of this package (the outputs compared in prefix/resume/idempotence checks). */
const OWN_SERIES: readonly SeriesId[] = [...new Set([...energyModule.records, ...compositionModule.records, ...waterModule.records])];

function planWith(schedule: Schedule): { plan: PlanDoc & { id: string }; version: PlanVersionDoc } {
  const plan: PlanDoc & { id: string } = {
    id: 'p1', name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-01T10:00:00.000Z' }, status: 'active',
    startDate: START, plannedEndDate: addDays(START, schedule.horizonDays), request: { profile: MAN, goals: [], horizonDays: schedule.horizonDays },
    baselineProfile: MAN, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-01T10:00:00.000Z',
  };
  const version: PlanVersionDoc = {
    planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule, genome: null, sessions: {},
    sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: '2026-10-01T10:00:00.000Z',
  };
  return { plan, version };
}

const src = { by: 'user' as const, method: 'typed' as const };
/** A typed meal: reported energy and protein; carbohydrate, fat and fibre unknown unless given (stored as 0 placeholders). */
function typedMeal(id: string, date: string, clockH: number, label: { energyKcal: number; proteinG: number; carbG?: number; fatG?: number }): LogEntry {
  const z = { value: 0, sd: 0 };
  const unknown: NonNullable<NutrientEstimate['unknown']> = [
    ...(label.carbG === undefined ? (['carbG'] as const) : []),
    ...(label.fatG === undefined ? (['fatG'] as const) : []),
    'fibreG',
  ];
  const totals: NutrientEstimate = {
    energyKcal: { value: label.energyKcal, sd: 0 }, proteinG: { value: label.proteinG, sd: 0 },
    carbG: label.carbG === undefined ? z : { value: label.carbG, sd: 0 }, fatG: label.fatG === undefined ? z : { value: label.fatG, sd: 0 }, fibreG: z, unknown,
  };
  return { id, date, tz: TZ, at: localToInstant(date, clockH, TZ), source: src, kind: 'meal', clockH, components: [], totals } as LogEntry;
}
const attested = (date: string, planDay: number): DayStatusDoc => ({ date, planId: 'p1', planDay, intake: 'complete' });

function docsOf(schedule: Schedule, entries: LogEntry[], dayStatus: DayStatusDoc[] = []): LivingDocs {
  const { plan, version } = planWith(schedule);
  return { plan, versions: [version], dayStatus, entries, measurements: [], records: [] };
}

interface Replayed {
  hash: string | null;
  compiled: CompiledSchedule;
  schedule: Schedule;
}
/** Today's realised schedule (logged past + prescribed future) and its compile, as the living layer builds them. */
function replayed(docs: LivingDocs, today: string, clockH = 10): Replayed {
  const p = projectLiving({ docs, today, tz: TZ, now: localToInstant(today, clockH, TZ), skipAssimilation: true });
  const schedule = projectionSchedule(p, today)!;
  return { hash: p.history?.contentHash ?? null, compiled: compileVersion(MAN, schedule), schedule };
}

const profileOf = (s: Schedule) => resolveProfile({ ...MAN, startDate: s.startDate });
function run(r: Replayed, extra: Parameters<typeof runEngine>[2] = { record: 'full' }): SimulationResult {
  return runEngine(profileOf(r.schedule), r.compiled, { series: OWN_SERIES, ...extra });
}

/** First difference in this package's series on days [from, to) (daily and hourly), or null. */
function diffOwn(a: SimulationResult, b: SimulationResult, from: number, to: number): string | null {
  for (const id of OWN_SERIES) {
    const x = a.daily[id];
    const y = b.daily[id];
    if (!x || !y) return `daily ${id} missing`;
    for (let i = from; i < Math.min(to, x.length, y.length); i++) if (!Object.is(x[i], y[i])) return `daily ${id}[${i}] ${x[i]} vs ${y[i]}`;
    const hx = a.hourly[id];
    const hy = b.hourly[id];
    if (!hx !== !hy) return `hourly ${id} missing`;
    if (hx && hy) for (let i = from * 24; i < Math.min(to * 24, hx.length, hy.length); i++) if (!Object.is(hx[i], hy[i])) return `hourly ${id}[${i}] ${hx[i]} vs ${hy[i]}`;
  }
  return null;
}

const D1 = addDays(START, 1);
const D3 = addDays(START, 3);

describe('D6-02 provider → energy: a logged energy-only meal through the realised history', () => {
  const meal = typedMeal('m1', D1, 12, { energyKcal: 600, proteinG: 30 });
  const att = replayed(docsOf(plain(), [meal], [attested(D1, 1)]), D3);

  it('an attested day reaches the compiled day with 600 kcal, 480 kcal unallocated and exact (complete) protein', () => {
    const d = att.compiled.days[1]!;
    expect(d.energyKcal).toBeCloseTo(600, 6);
    expect(d.unallocatedKcal).toBeCloseTo(480, 6);
    expect(d.energyStatus).toBe('energyOnly');
    expect(d.proteinG).toBeCloseTo(30, 9);
    expect(d.carbG).toBe(0);
    expect(d.coverage).toMatchObject({ energy: 'complete', protein: 'complete', carbohydrate: 'partial', fat: 'partial' });
    // at best daily (daily-native whole-day reads); 'scenario' here because the unlogged steps replay at expected credit
    expect(d.resolution).toBe('scenario');
    expect(proteinIsLowerBound(d)).toBe(false);
  });

  it('without the day attestation protein is a lower bound (partial coverage); the observed meal keeps its energy', () => {
    const r = replayed(docsOf(plain(), [meal]), D3);
    const d = r.compiled.days[1]!;
    expect(d.coverage?.protein).toBe('partial');
    expect(proteinIsLowerBound(d)).toBe(true);
    const logged = Array.from({ length: d.nMeals }, (_, k) => d.meals[k]!).find((m) => m.eventId === 'm1');
    expect(logged).toMatchObject({ reportedKcal: 600, energyStatus: 'energyOnly' });
    expect(logged!.kcal).toBeCloseTo(600, 9);
    expect(logged!.unallocatedKcal).toBeCloseTo(480, 6);
  });

  it('a legacy kcal-only entry (stored zeros, no unknown list, no ledger) replays as energy with protein a lower bound', () => {
    const z = { value: 0, sd: 0 };
    const legacy = { id: 'old1', date: D1, tz: TZ, source: src, kind: 'meal', clockH: 12, components: [], totals: { energyKcal: { value: 600, sd: 0 }, proteinG: z, carbG: z, fatG: z, fibreG: z } } as unknown as LogEntry;
    const docs = docsOf(plain(), [legacy]);
    const stored = JSON.stringify(docs);
    const r = replayed(docs, D3);
    expect(JSON.stringify(docs)).toBe(stored); // read adapter: the stored record is never rewritten
    const d = r.compiled.days[1]!;
    const m = Array.from({ length: d.nMeals }, (_, k) => d.meals[k]!).find((x) => x.eventId === 'old1')!;
    expect(m.kcal).toBeCloseTo(600, 9);
    expect(m.unallocatedKcal).toBeCloseTo(600, 9);
    expect(d.coverage?.protein).toBe('partial');
    expect(proteinIsLowerBound(d)).toBe(true);
    expect(replayed(JSON.parse(stored) as LivingDocs, D3).hash).toBe(r.hash);
  });

  it('the engine books all 600 kcal: same run intake as the fully specified meal of equal energy, ledger closed', () => {
    const full = replayed(docsOf(plain(), [typedMeal('m1', D1, 12, { energyKcal: 600, proteinG: 30, carbG: 60, fatG: 80 / 3 })], [attested(D1, 1)]), D3);
    expect(full.compiled.days[1]!.energyStatus).toBe('consistent');
    const a = run(att, { record: 'daily', checks: true });
    const b = run(full, { record: 'daily', checks: true });
    expect(a.meta.checks!.eiTotalKcal!).toBeCloseTo(b.meta.checks!.eiTotalKcal!, 3);
    expect(a.meta.checks!.energyDayMaxAbsKcal).toBeLessThan(0.5);
    // TEF follows every appearing kcal once: the energy-only day is not a 120 kcal day
    expect(a.daily.tef![1]!).toBeGreaterThan(0.04 * 600);
  });

  it('energy consumes the realised protein coverage: exact protein moves P_eff and the TEF prior; a lower bound holds them', () => {
    const lb: Replayed = { ...att, compiled: compileVersion(MAN, att.schedule) };
    lb.compiled.days[1]!.coverage = { ...lb.compiled.days[1]!.coverage!, protein: 'partial' };
    expect(proteinIsLowerBound(lb.compiled.days[1]!)).toBe(true);
    const exact = run(att, { record: 'daily' });
    const bound = run(lb, { record: 'daily' });
    // identical before the day, different from it (whole-day reads at startDay)
    expect(diffOwn(exact, bound, 0, 1)).toBeNull();
    // P_eff relaxes toward 30 g only when protein is exact: lower protein turnover cost, lower RMR
    expect(exact.daily.rmr![1]!).toBeLessThan(bound.daily.rmr![1]!);
    // the 480 kcal take the carbohydrate/fat habitual prior when protein is known, the P/C/F prior otherwise
    expect(exact.daily.tef![1]!).toBeLessThan(bound.daily.tef![1]!);
  });
});

describe('C2/C7 replay idempotence: reload, sync duplicates and import order', () => {
  const entries = [typedMeal('m1', D1, 12, { energyKcal: 600, proteinG: 30 }), typedMeal('m2', addDays(START, 2), 9, { energyKcal: 450, proteinG: 25, carbG: 50 })];
  const status = [attested(D1, 1)];
  const base = replayed(docsOf(plain(), entries, status), D3);
  const baseRun = run(base);

  const dayInputs = (r: Replayed) => r.compiled.days.slice(0, 3).map((d) => [d.energyKcal, d.unallocatedKcal, d.energyStatus, d.proteinG, d.coverage, d.resolution]);

  it('the same documents reloaded or imported in another order give the same history hash and physiology', () => {
    const reloaded = JSON.parse(JSON.stringify(docsOf(plain(), entries, status))) as LivingDocs;
    const imported = docsOf(plain(), [...entries].reverse(), status);
    for (const docs of [reloaded, imported]) {
      const r = replayed(docs, D3);
      expect(r.hash).toBe(base.hash);
      expect(dayInputs(r)).toEqual(dayInputs(base));
      expect(diffOwn(baseRun, run(r), 0, HORIZON)).toBeNull();
    }
  });

  it('a record delivered twice by sync (same id, same content) is counted once by energy, composition and water', () => {
    const synced = replayed(docsOf(plain(), [...entries, ...entries.map((e) => JSON.parse(JSON.stringify(e)) as LogEntry)], [...status, ...status]), D3);
    expect(dayInputs(synced)).toEqual(dayInputs(base));
    expect(synced.compiled.days[1]!.energyKcal).toBeCloseTo(600, 6);
    expect(diffOwn(baseRun, run(synced), 0, HORIZON)).toBeNull();
  });

  it('replaying reads the stored entries without rewriting them', () => {
    const docs = docsOf(plain(), entries, status);
    const before = JSON.stringify(docs);
    replayed(docs, D3);
    expect(JSON.stringify(docs)).toBe(before);
  });
});

describe('C2/C7 resume: a day-stamped snapshot continues bit-identically', () => {
  const r = replayed(docsOf(plain(), [typedMeal('m1', D1, 12, { energyKcal: 600, proteinG: 30 })], [attested(D1, 1)]), D3);
  const full = run(r, { record: 'full', captureSnapshotAt: [1, 2] });

  it('restoring at the energy-only day or after it reproduces energy, composition and water', () => {
    for (const k of [1, 2]) {
      const cont = run(r, { record: 'full', initialSnapshot: full.snapshots![k]! });
      expect(cont.meta.startDay).toBe(k);
      expect(diffOwn(full, cont, k, HORIZON)).toBeNull();
    }
  });

  it('a snapshot written before the D6-02 energy state fields existed restores to the same run (additive state)', () => {
    const snap = full.snapshots![1]!;
    const ei = snap.moduleIds.indexOf(energyModule.id);
    expect(ei).toBeGreaterThanOrEqual(0);
    const legacyState = { ...(snap.states[ei] as Record<string, unknown>) };
    for (const f of ['unallocKcal', 'alphaUnalloc', 'proteinLowerBound']) {
      expect(f in legacyState).toBe(true);
      delete legacyState[f];
    }
    const legacy: EngineSnapshot = { ...snap, states: snap.states.map((s, i) => (i === ei ? legacyState : s)) };
    const cont = run(r, { record: 'full', initialSnapshot: legacy });
    expect(diffOwn(full, cont, 1, HORIZON)).toBeNull();
  });
});

describe('C2 adopt: a version adopted from today never rewrites the replayed past', () => {
  it('days 0-2 replay from the version in force then; energy, composition and water agree through day 2', () => {
    const entries = [typedMeal('m1', D1, 12, { energyKcal: 600, proteinG: 30 })];
    const docs1 = docsOf(plain(), entries, [attested(D1, 1)]);
    const lower: Schedule = { ...plain(), programs: [{ ...DAY, energy: { kind: 'kcal', kcal: 1700 } }] };
    const v2: PlanVersionDoc = { ...docs1.versions[0]!, version: 2, parent: 1, reason: 'weekly', effectiveFromDay: 3, schedule: lower };
    const docs2: LivingDocs = { ...docs1, plan: { ...docs1.plan!, headVersion: 2 }, versions: [docs1.versions[0]!, v2] };
    const a = replayed(docs1, D3);
    const b = replayed(docs2, D3);
    expect(b.hash).toBe(a.hash);
    expect(b.compiled.days[3]!.energyKcal).toBeLessThan(a.compiled.days[3]!.energyKcal);
    const ra = run(a);
    const rb = run(b);
    expect(diffOwn(ra, rb, 0, 3)).toBeNull();
    expect(diffOwn(ra, rb, 0, HORIZON)).not.toBeNull();
  });
});

describe('D2-01 lifecycle: future planned fast length never reaches the replayed prefix', () => {
  const D2 = addDays(START, 2);
  const fastFrom = (h: number): Schedule => plain([{ kind: 'fast', startDay: 2, startH: 20, durationH: h }]);
  const running: LogEntry = { id: 'f1', date: D2, tz: TZ, at: localToInstant(D2, 20, TZ), source: src, kind: 'fast', lastIntakeAt: localToInstant(D2, 20, TZ), firstIntakeAt: null } as LogEntry;
  const meals = [typedMeal('m1', D1, 12, { energyKcal: 600, proteinG: 30 })];

  for (const [label, entries] of [['planned only', meals], ['with a running fast log', [...meals, running]]] as const) {
    it(`${label}: 24 / 36 / 48 / 72 h planned lengths give identical energy, composition and water on days 0-2`, () => {
      const reps = [24, 36, 48, 72].map((h) => replayed(docsOf(fastFrom(h), [...entries], [attested(D1, 1)]), D3));
      const runs = reps.map((r) => run(r));
      for (const other of runs.slice(1)) expect(diffOwn(runs[0]!, other, 0, 3)).toBeNull();
      // the planned prescription's continuation differs (non-trivial prefix check)
      if (label === 'planned only') {
        expect(reps.map((r) => r.compiled.days[2]!.fastPolicy?.plannedDurationH)).toEqual([37, 37, 61, 85]);
        expect(diffOwn(runs[0]!, runs[3]!, 0, HORIZON)).not.toBeNull();
      }
    });
  }

  it('an observed day inside a planned 48 h fast that was broken by a meal is not a zero-intake day (energy reads realised intake)', () => {
    const fast48 = plain([{ kind: 'fast', startDay: 0, startH: 20, durationH: 48 }]);
    const broken = replayed(docsOf(fast48, [typedMeal('m1', D1, 12, { energyKcal: 600, proteinG: 30 })]), D3);
    expect(broken.compiled.days[1]!.zeroIntake).toBe(false);
    expect(broken.compiled.days[1]!.energyKcal).toBeGreaterThan(590);
    // the planned length stays policy metadata on the day; physiology sees the observed intake
    expect(broken.compiled.days[1]!.fastPolicy).toBeDefined();
  });
});

describe('D5-02 provider/consumer agreement: water-adjusted wake mass', () => {
  it('the assimilation replay’s wake tissue (scale − water) equals the water operator applied to the same run', () => {
    const r = replayed(docsOf(plain(), [typedMeal('m1', D1, 12, { energyKcal: 600, proteinG: 30 })], [attested(D1, 1)]), D3);
    const rep = runReplay({ profile: MAN, schedule: r.schedule });
    const n = r.compiled.nDays;
    const op = waterAdjustedWakeKg({ scaleWeight: rep.result.daily.scaleWeight, waterWeight: rep.result.daily.waterWeight }, n);
    for (let d = 0; d < n; d++) expect(op[d]).toBe(rep.tissueWakeKg[d]);
  });
});
