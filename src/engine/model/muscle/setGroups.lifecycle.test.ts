// @vitest-environment node
/**
 * D3-01 provider/consumer integration (W0 phase 0C): catalogue set groups → schedule → compiler (`rtGroups`, per-hour
 * `rtGroupSets`, carried copies with their bout's origin and flags) → muscle, and the lifecycle around it: start, snapshot
 * resume, a changed horizon, reload/import/sync (JSON round trips, re-derivation from performed records, duplicate
 * imports), the legacy merged-dose migration and the living logging → replay path. Expected doses are computed from the
 * scalar factor equations, never from `groupSetFactor`.
 */
import { describe, expect, it } from 'vitest';
import { N_REGIONS, TRAINING_REGIONS, type DayInput } from '../../types/inputs';
import type { DayTemplate, ExerciseSession, ResistanceSession, ResistanceSetGroup, Schedule, TrainingRegion } from '../../types/schedule';
import type { SimulationResult } from '../../types/result';
import { buildModelParams } from '../../core/paramsRegistry';
import { MODULES } from '../../core/moduleRegistry';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { runEngine } from '../../core/loop';
import { MAN } from '../../core/__tests__/fixtures';
import { resolveSession, sessionSetGroups, toEngineDose, type StimulusContext } from '@/catalogues/stimulus';
import type { PerformedExercise } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { freezePrescription, DEFAULT_ITEM_WEIGHTS } from '@/living/prescription';
import { toLoggedDay, type LoggedDayInput, type SessionCompiler } from '@/living/loggedDay';
import { catalogueEquivalence } from '@/living/equivalence';
import { effectiveEntries } from '@/living/logs';
import type { LogEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from '@/living/types';
import type { MuscleConstants } from './constants';
import * as M from './equations';
import { MuscleSim, compileWeek, person } from './__tests__/harness';

const RI = (r: TrainingRegion): number => TRAINING_REGIONS.indexOf(r);
/** Non-nominal draw (inside the registry ranges where the parameter has one). */
const DRAW: Record<string, number> = { 'muscle.kRir': 0.085, 'muscle.fRest60': 0.82, 'muscle.fLoad20': 0.55, 'muscle.fCwi': 0.6 };
const CTX: StimulusContext = { bodyMassKg: 82, vo2max: 40, heightM: 1.78 };

// ------------------------------------------------------------------ catalogue bouts

const MORNING: PerformedExercise[] = [
  { exerciseId: 'baithak', setCount: 3, pct1RM: 40, rir: 5, restSec: 45 },
  { exerciseId: 'goblet_squat', setCount: 3, pct1RM: 30, rir: 3, restSec: 30 },
  { exerciseId: 'kb_swing', setCount: 4, reps: 15, rpe: 8, restSec: 60 },
];
/** Starts 23:45 and runs past midnight (24 min). */
const LATE: PerformedExercise[] = [
  { exerciseId: 'db_bench_press', setCount: 4, pct1RM: 75, rir: 1, restSec: 120 },
  { exerciseId: 'plank', sets: [{ holdSec: 45 }, { holdSec: 60, nearFailure: true }, { holdSec: 45 }], restSec: 60 },
  { exerciseId: 'pull_up', sets: [{ reps: 8, rir: 1 }, { reps: 6, rir: 0 }, { reps: 8, rir: 1 }], restSec: 150 },
];
/** Two distinct bouts inside one clock hour: a failure bout and a bout followed by cold-water immersion. */
const FAIL_BOUT: PerformedExercise[] = [{ exerciseId: 'db_bench_press', setCount: 2, pct1RM: 85, rir: 0, restSec: 180 }];
const CWI_BOUT: PerformedExercise[] = [{ exerciseId: 'goblet_squat', setCount: 2, pct1RM: 60, rir: 4, restSec: 45 }];

/** Engine sessions of a performed bout, as the session compiler builds them (one call per bout). */
function bout(performed: readonly PerformedExercise[], startH: number, sessionId?: string, extra: Partial<ResistanceSession> = {}): ExerciseSession[] {
  const { doses } = resolveSession(performed, SEED_CATALOGUE, CTX);
  const eng = toEngineDose(doses, startH, sessionId !== undefined ? { sessionId } : {});
  return [...(eng.resistance ? [{ ...eng.resistance, ...extra }] : []), ...eng.cardio];
}
const groupsOf = (sessions: readonly ExerciseSession[]): readonly ResistanceSetGroup[] =>
  sessions.flatMap((s) => (s.kind === 'resistance' ? (s.groups ?? []) : []));

function template(id: string, exercise: ExerciseSession[]): DayTemplate {
  return {
    id,
    label: id,
    energy: { kind: 'pctMaintenance', pct: 90 },
    macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } },
    meals: { count: 3, window: { startH: 8, lengthH: 11 } },
    exercise,
    steps: 8000,
  };
}
const PROG_A = (): DayTemplate => template('A', [...bout(MORNING, 7, 'am'), ...bout(LATE, 23.75, 'late', { coldWaterImmersion: true })]);
const PROG_C = (): DayTemplate => template('C', [...bout(FAIL_BOUT, 17, 'fail', { toFailure: true }), ...bout(CWI_BOUT, 17.5, 'cwi', { coldWaterImmersion: true })]);
const PROG_R = (): DayTemplate => template('R', []);
const PATTERN = [0, 2, 1, 2, 0, 2, 2];

function schedule(days: number, programs: DayTemplate[] = [PROG_A(), PROG_C(), PROG_R()]): Schedule {
  return { schemaVersion: 1, startDate: '2026-10-05', horizonDays: days, programs, days: Array.from({ length: days }, (_, d) => ({ program: PATTERN[d % 7]! })) };
}

/** Parameter vector with the non-nominal draw applied (the run's drawn constants). */
function drawVector(): Float64Array {
  const base = buildModelParams(MODULES);
  const v = new Float64Array(base.values);
  for (const [id, val] of Object.entries(DRAW)) {
    const i = base.index.get(id);
    if (i === undefined) throw new Error(id);
    v[i] = val;
  }
  return v;
}

/** First difference between two runs on days [from, to), or null (bit-exact, `Object.is`). */
function diffFrom(a: SimulationResult, b: SimulationResult, from: number, to = a.meta.nDays): string | null {
  for (const id of Object.keys(a.daily) as (keyof typeof a.daily)[]) {
    const x = a.daily[id]!;
    const y = b.daily[id];
    if (!y) return `daily ${id} missing`;
    for (let i = from; i < Math.min(to, x.length, y.length); i++) if (!Object.is(x[i], y[i])) return `daily ${id}[${i}] ${x[i]} vs ${y[i]}`;
  }
  for (const id of Object.keys(a.hourly) as (keyof typeof a.hourly)[]) {
    const x = a.hourly[id]!;
    const y = b.hourly[id];
    if (!y) return `hourly ${id} missing`;
    for (let i = from * 24; i < Math.min(to * 24, x.length, y.length); i++) if (!Object.is(x[i], y[i])) return `hourly ${id}[${i}]`;
  }
  return null;
}

/** Independent per-set factor of a catalogue group (f_type from the contraction defaults unless already in the weights). */
function setFactor(K: MuscleConstants, g: ResistanceSetGroup, toFailure = false): number {
  const fType = g.typeFactorIncluded ? 1 : g.contraction === 'dynamic' ? 1 : 0.5;
  const load = g.loadPct1RM!;
  const effort = g.contraction === 'isometric' ? 1 : M.fRir(K, toFailure ? 0 : g.rir!, load) * M.fLoad(K, load);
  return fType * effort * M.fRest(K, g.restSec!);
}
function addDose(out: Float64Array, K: MuscleConstants, groups: readonly ResistanceSetGroup[], toFailure = false, share = 1): Float64Array {
  for (const g of groups) {
    const f = g.sets * setFactor(K, g, toFailure) * share;
    for (const [r, w] of Object.entries(g.regionWeights) as Array<[TrainingRegion, number]>) out[RI(r)] = out[RI(r)]! + w * f;
  }
  return out;
}
const expectClose = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 12, msg = ''): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]!, `${msg}[${i}]`).toBeCloseTo(b[i]!, digits);
};
const cwiRing = (sim: MuscleSim, r: number): number => {
  let x = 0;
  for (let j = 0; j < 7; j++) x += sim.s.cwiLossHist[r * 7 + j]!;
  return x;
};
const lastSlot = (sim: MuscleSim): number => (sim.s.histIdx + 6) % 7;

// ------------------------------------------------------------------ compiler → muscle (the provider's own fields)

describe('D3-01 compiled set groups drive the muscle dose (real compiler, catalogue bouts)', () => {
  it('two bouts inside one hour keep their own effort, rest, failure and cold-water immersion', () => {
    const sim = new MuscleSim(person({ age: 30, weightKg: 82 }), { overrides: DRAW });
    const [d] = compileWeek(sim.profile, [PROG_C()], [0]);
    expect(d!.nRtGroups).toBe(2);
    expect(d!.rtGroups!.map((g) => [g.session, g.sessionId, g.toFailure, g.coldWaterImmersion])).toEqual([
      [0, 'fail', true, false],
      [1, 'cwi', false, true],
    ]);
    sim.runDay(d!);
    const K = sim.k;
    const failG = groupsOf(bout(FAIL_BOUT, 17));
    const cwiG = groupsOf(bout(CWI_BOUT, 17.5));
    const want = addDose(addDose(new Float64Array(N_REGIONS), K, failG, true), K, cwiG);
    expectClose(sim.s.vR, want, 12, 'vR');
    // CWI only on the second bout's effective sets
    const cwiOnly = addDose(new Float64Array(N_REGIONS), K, cwiG);
    for (let r = 0; r < N_REGIONS; r++) expect(cwiRing(sim, r), TRAINING_REGIONS[r]).toBeCloseTo(cwiOnly[r]! * (1 - K.fCwi), 12);
    // failure only where the failure bout trained
    const failRegions = new Set(failG.flatMap((g) => Object.keys(g.regionWeights)));
    for (const r of TRAINING_REGIONS) expect(sim.s.lastFail[RI(r)], r).toBe(failRegions.has(r) ? 1 : 0);
    // neural practice: physical sets of both bouts
    expect(sim.s.setsTotHist[lastSlot(sim)]).toBeCloseTo(4, 12);
  });

  it('a bout running past midnight keeps its whole dose, identity and CWI on both days; every set is stepped once', () => {
    const sim = new MuscleSim(person({ age: 30, weightKg: 82 }), { overrides: DRAW });
    const days = compileWeek(sim.profile, [PROG_A(), PROG_R()], [0, 1]);
    const late = groupsOf(bout(LATE, 23.75));
    const am = groupsOf(bout(MORNING, 7));
    expect(late.some((g) => 23.75 + (g.startOffsetMin! + g.durationMin!) / 60 > 24)).toBe(true);
    expect(days[0]!.nRtGroups).toBe(am.length + late.length);
    const carried = days[1]!.rtGroups!.slice(0, days[1]!.nRtGroups);
    expect(carried.length).toBeGreaterThan(0);
    for (const g of carried) expect(g).toMatchObject({ session: -1, originDay: 0, sessionId: 'late', coldWaterImmersion: true, toFailure: false });
    sim.runDay(days[0]!);
    const dayOne = Array.from(sim.s.vR);
    sim.runDay(days[1]!);
    const K = sim.k;
    const lateDose = addDose(new Float64Array(N_REGIONS), K, late);
    const want = addDose(new Float64Array(lateDose), K, am);
    expectClose(sim.s.vR, want, 10, 'vR');
    // part of the late bout was stepped on day 2 (its pull-ups, the only upper-back work, start after midnight)
    expect(dayOne[RI('upperBack')]!).toBeLessThan(want[RI('upperBack')]! - 0.1);
    // CWI covers every late set on both days, none of the morning bout
    const amDose = addDose(new Float64Array(N_REGIONS), K, am);
    for (let r = 0; r < N_REGIONS; r++) expect(cwiRing(sim, r), TRAINING_REGIONS[r]).toBeCloseTo(lateDose[r]! * (1 - K.fCwi), 10);
    expect(amDose[RI('chest')]).toBe(0);
    // neural practice: physical sets across both days (3 + 3 + 4 morning, 4 + 3 + 3 late)
    let phys = 0;
    for (let j = 0; j < 7; j++) phys += sim.s.setsTotHist[j]!;
    expect(phys).toBeCloseTo(20, 10);
  });

  it('a legacy merged session on a grouped day contributes exactly its legacy-path dose', () => {
    const legacy: ResistanceSession = { kind: 'resistance', startH: 9, setsByRegion: { chest: 3, quads: 2, core: 1.5 }, rir: 2, loadPct1RM: 70, restSec: 90 };
    const grouped = bout(FAIL_BOUT, 17, 'g');
    const run = (exercise: ExerciseSession[]): MuscleSim => {
      const sim = new MuscleSim(person({ age: 30, weightKg: 82 }), { overrides: DRAW });
      const [d] = compileWeek(sim.profile, [template('X', exercise)], [0]);
      sim.runDay(d!);
      return sim;
    };
    const both = run([legacy, ...grouped]);
    const onlyLegacy = run([legacy]);
    const onlyGroups = run(grouped);
    const sum = Array.from(onlyLegacy.s.vR, (v, r) => v + onlyGroups.s.vR[r]!);
    expectClose(both.s.vR, sum, 12, 'vR');
    // neural practice: the legacy session counts as it always did (Σ region sets), the groups by physical sets
    expect(both.s.setsTotHist[lastSlot(both)]).toBeCloseTo(onlyLegacy.s.setsTotHist[lastSlot(onlyLegacy)]! + 2, 12);
    expect(onlyLegacy.s.setsTotHist[lastSlot(onlyLegacy)]).toBeCloseTo(6.5, 12);
  });
});

// ------------------------------------------------------------------ engine lifecycle

describe('D3-01 lifecycle: start, resume, horizon, reload/import/sync, migration (real engine, drawn constants)', () => {
  const profile = resolveProfile(MAN);
  const paramOverrides = drawVector();
  const sched28 = schedule(28);
  const full = runEngine(profile, compileSchedule(sched28, profile), { record: 'full', paramOverrides, captureSnapshotAt: [1, 5, 8] });

  it('start: every group compiles without truncation; the carried copy keeps its bout identity', () => {
    const c = compileSchedule(sched28, profile);
    expect(c.notes.filter((n) => n.code === 'setGroupsTruncated')).toEqual([]);
    const lateN = groupsOf(bout(LATE, 23.75)).length;
    const amN = groupsOf(bout(MORNING, 7)).length;
    expect(c.days[0]!.nRtGroups).toBe(amN + lateN);
    const d1 = c.days[1]!;
    expect(d1.rtGroups!.slice(0, d1.nRtGroups).every((g) => g.session === -1 && g.originDay === 0 && g.sessionId === 'late')).toBe(true);
    // days with neither own groups nor a carried group stay on the legacy path
    expect(c.days[3]!.nRtGroups).toBe(0);
    // bout identity on every part (the morning bout has a cardio part), carried past compilation
    expect(c.days[0]!.sessions.slice(0, c.days[0]!.nSessions).map((s) => s.sessionId)).toEqual(['am#0', 'am#1', 'late']);
  });

  it('a hybrid bout late in the evening carries its cardio part past midnight (stepped once, on the next day)', () => {
    const parts = bout(MORNING, 23.9, 'h');
    expect(parts.map((p) => p.kind)).toEqual(['resistance', 'cardio']);
    expect(parts[1]!.startH).toBeGreaterThan(24);
    const opts = { activityReference: false } as const;
    const two = (first: DayTemplate): SimulationResult =>
      runEngine(profile, compileSchedule({ schemaVersion: 1, startDate: '2026-10-05', horizonDays: 2, programs: [first, PROG_R()], days: [{ program: 0 }, { program: 1 }] }, profile, opts), { record: 'full', paramOverrides });
    const withBout = two(template('H', parts));
    const without = two(PROG_R());
    const a = withBout.hourly.exerciseEE!;
    const b = without.hourly.exerciseEE!;
    // nothing of the bout lands in the morning of its own day (a wrapped start would put ~10 kcal of the cardio part into
    // hour 0; the day's planned-exercise estimate shifts the baseline by < 0.001 kcal)
    for (let h = 0; h < 23; h++) expect(a[h], `hour ${h}`).toBeCloseTo(b[h]!, 2);
    expect(a[23]!).toBeGreaterThan(b[23]! + 1);
    // the cardio part (8.7 MET) is stepped in the first hours of the next day
    expect(a[24]!).toBeGreaterThan(b[24]! + 10);
  });

  it('resume: a snapshot on the day after a midnight-crossing bout continues bit-identically', () => {
    expect(Object.keys(full.snapshots!).map(Number).sort((a, b) => a - b)).toEqual([1, 5, 8]);
    for (const k of [1, 5, 8]) {
      const cont = runEngine(profile, compileSchedule(sched28, profile), { record: 'full', paramOverrides, initialSnapshot: full.snapshots![k]! });
      expect(cont.meta.startDay ?? 0).toBe(k);
      expect(diffFrom(full, cont, k), `resume at ${k}`).toBeNull();
    }
  });

  it('a changed horizon keeps the prefix, also when the last day carries a bout past the horizon', () => {
    // without the compile-time activity reference: its window mean over the day's (horizon-truncated) week is a
    // prescription reference, not part of the set-group path
    const opts = { activityReference: false } as const;
    const long = runEngine(profile, compileSchedule(sched28, profile, opts), { record: 'full', paramOverrides });
    for (const n of [21, 22]) {
      const short = runEngine(profile, compileSchedule(schedule(n), profile, opts), { record: 'full', paramOverrides });
      expect(diffFrom(long, short, 0, n), `horizon ${n}`).toBeNull();
    }
  });

  it('reload/import/sync: a JSON round trip and re-derivation from the performed records give the identical run; compiling is idempotent', () => {
    const before = JSON.stringify(sched28);
    const c1 = compileSchedule(sched28, profile);
    expect(JSON.stringify(sched28)).toBe(before); // the stored schedule is never rewritten by compilation
    const c2 = compileSchedule(sched28, profile);
    for (let d = 0; d < 9; d++) {
      expect(c2.days[d]!.nRtGroups).toBe(c1.days[d]!.nRtGroups);
      expect(c2.days[d]!.rtGroups?.slice(0, c2.days[d]!.nRtGroups)).toEqual(c1.days[d]!.rtGroups?.slice(0, c1.days[d]!.nRtGroups));
    }
    const reloaded = JSON.parse(before) as Schedule;
    expect(diffFrom(full, runEngine(profile, compileSchedule(reloaded, profile), { record: 'full', paramOverrides }), 0)).toBeNull();
    // the derived engine sessions are a deterministic function of the performed records
    const rebuilt = schedule(28, [PROG_A(), PROG_C(), PROG_R()]);
    expect(JSON.stringify(rebuilt)).toBe(before);
  });

  it('migration: legacy merged doses stay on the legacy path, the type-factor tag changes nothing there; the summary is never the dose', () => {
    const strip = (s: ExerciseSession, tag?: boolean): ExerciseSession => {
      if (s.kind !== 'resistance') return s;
      const { groups: _g, setsByRegionIncludesTypeFactor: _t, ...rest } = s;
      return tag === undefined ? rest : { ...rest, setsByRegionIncludesTypeFactor: tag };
    };
    const legacyProgs = (tag?: boolean): DayTemplate[] => [PROG_A(), PROG_C(), PROG_R()].map((p) => ({ ...p, exercise: (p.exercise ?? []).map((s) => strip(s, tag)) }));
    const untagged = compileSchedule(schedule(14, legacyProgs()), profile);
    expect(untagged.days.every((d) => (d.nRtGroups ?? 0) === 0)).toBe(true);
    const a = runEngine(profile, untagged, { record: 'full', paramOverrides });
    const b = runEngine(profile, compileSchedule(schedule(14, legacyProgs(true)), profile), { record: 'full', paramOverrides });
    expect(diffFrom(a, b, 0)).toBeNull();
    // with groups present, the legacy summary (merged region sets, averaged RIR/load/rest) is never read as the dose
    const garbled = [PROG_A(), PROG_C(), PROG_R()].map((p) => ({
      ...p,
      exercise: (p.exercise ?? []).map((s) => (s.kind === 'resistance' ? { ...s, setsByRegion: { calves: 40 }, rir: 9, loadPct1RM: 5, restSec: 1 } : s)),
    }));
    const g = runEngine(profile, compileSchedule(schedule(28, garbled), profile), { record: 'full', paramOverrides });
    expect(diffFrom(full, g, 0)).toBeNull();
    // and the grouped run is a different dose from the merged legacy one (groups are not silently dropped)
    expect(diffFrom(full, a, 0, 14)).not.toBeNull();
  });
});

// ------------------------------------------------------------------ living: logging → replay

describe('D3-01 living logging → replay keeps groups and the bout identity', () => {
  const TZ = 'Asia/Kolkata';
  const PERSON = { schemaVersion: 1 as const, body: { sex: 'male' as const, ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: '2026-10-05' };
  const TRAIN: DayTemplate = {
    id: 'A', label: 'training day', energy: { kind: 'kcal', kcal: 2000 },
    macros: { protein: { unit: 'g', value: 160 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
    meals: { count: 3, window: { startH: 9, lengthH: 10 } }, exercise: [{ kind: 'resistance', startH: 18, durationMin: 50, setsByRegion: { quads: 6, glutes: 3, chest: 6 } }],
    steps: 9000, sleep: { bedH: 23, wakeH: 7 },
  };
  const SCHED: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 14, programs: [TRAIN], days: Array.from({ length: 14 }, () => ({ program: 0 })) };
  const plan: PlanDoc & { id: string } = {
    id: 'p1', name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-01T10:00:00.000Z' },
    status: 'active', startDate: '2026-10-05', plannedEndDate: '2026-10-19', request: { profile: PERSON, goals: [], horizonDays: 14 },
    baselineProfile: PERSON, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-01T10:00:00.000Z',
  };
  const version: PlanVersionDoc = {
    planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHED, genome: null,
    sessions: {}, sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: '2026-10-01T10:00:00.000Z',
  };
  const rx = (date: string): PrescribedDaySnapshot => freezePrescription({ plan, version, date, tz: TZ });
  /** The session compiler as the app wires it (catalogue resolve + `toEngineDose`, no identity: replay adds the log id). */
  const compiler: SessionCompiler = (performed, startH) => {
    const s = bout(performed as PerformedExercise[], startH);
    return s.length > 0 ? s : null;
  };
  const d = '2026-10-05';
  const log = {
    id: 'log-7', date: d, tz: TZ, source: { by: 'user', method: 'typed' }, kind: 'session', status: 'done', itemId: 'rtSession:0:0',
    performed: LATE.slice(0, 2), stimulus: resolveSession(LATE.slice(0, 2), SEED_CATALOGUE, CTX).vector, catalogueVersion: SEED_CATALOGUE.version, startH: 18,
  } as unknown as LogEntry;
  const input = (entries: readonly LogEntry[], over: Partial<LoggedDayInput> = {}): LoggedDayInput => ({
    date: d, planStart: plan.startDate, tz: TZ, prescription: rx(d), entries, expected: () => 0.75, equivalence: catalogueEquivalence, final: true, ...over,
  });
  const exerciseOf = (i: LoggedDayInput): ExerciseSession[] => toLoggedDay(i).loggedDay.inputs.exercise ?? [];

  it('the replayed day carries every logged group with the log id as the bout identity', () => {
    const ex = exerciseOf(input([log], { sessionCompiler: compiler }));
    const rt = ex.filter((s): s is ResistanceSession => s.kind === 'resistance');
    expect(rt).toHaveLength(1);
    expect(rt[0]!.sessionId).toBe('log-7');
    expect(rt[0]!.groups).toEqual(sessionSetGroups(resolveSession(LATE.slice(0, 2), SEED_CATALOGUE, CTX).doses));
    expect(rt[0]!.setsByRegionIncludesTypeFactor).toBe(true);
    // the stored stimulus carries the same groups and the physical set count
    const stim = (log as Extract<LogEntry, { kind: 'session' }>).stimulus;
    expect(stim.setGroups).toEqual(rt[0]!.groups);
    expect(stim.physicalSets).toBe(7);
  });

  it('replay from a stored derived cache (after a JSON round trip) equals replay from the performed records', () => {
    const fresh = exerciseOf(input([log], { sessionCompiler: compiler }));
    const cached = { ...log, engine: JSON.parse(JSON.stringify(compiler((log as Extract<LogEntry, { kind: 'session' }>).performed, 18))) } as LogEntry;
    expect(exerciseOf(input([JSON.parse(JSON.stringify(cached)) as LogEntry]))).toEqual(fresh);
    // a multi-part (hybrid) bout: a cache written with the bout identity names its parts as the replay does
    const hybrid = { ...log, id: 'log-8', performed: MORNING, stimulus: resolveSession(MORNING, SEED_CATALOGUE, CTX).vector } as unknown as LogEntry;
    const replayed = exerciseOf(input([hybrid], { sessionCompiler: compiler }));
    expect(replayed.map((s) => s.sessionId)).toEqual(['log-8#0', 'log-8#1']);
    const withId = { ...hybrid, engine: JSON.parse(JSON.stringify(bout(MORNING, 18, 'log-8'))) } as LogEntry;
    expect(exerciseOf(input([withId]))).toEqual(replayed);
  });

  it('a duplicate import of the same log entry is idempotent', () => {
    const once = exerciseOf(input(effectiveEntries([log]), { sessionCompiler: compiler }));
    const twice = exerciseOf(input(effectiveEntries([log, JSON.parse(JSON.stringify(log)) as LogEntry]), { sessionCompiler: compiler }));
    expect(twice).toEqual(once);
  });

  it('the replayed day compiles to groups owned by the logged bout', () => {
    const t = toLoggedDay(input([log], { sessionCompiler: compiler })).loggedDay.inputs;
    const profile = resolveProfile(PERSON);
    const c = compileSchedule({ schemaVersion: 1, startDate: d, horizonDays: 1, programs: [{ ...t, id: 'L' }], days: [{ program: 0 }] }, profile);
    const day0: DayInput = c.days[0]!;
    const n = day0.nRtGroups ?? 0;
    expect(n).toBe(sessionSetGroups(resolveSession(LATE.slice(0, 2), SEED_CATALOGUE, CTX).doses).length);
    expect(day0.rtGroups!.slice(0, n).every((g) => g.sessionId === 'log-7' && g.originDay === 0)).toBe(true);
  });
});
