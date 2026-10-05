// @vitest-environment node
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { StimulusVector } from '@/catalogues';
import { freezePrescription, DEFAULT_ITEM_WEIGHTS } from '../prescription';
import { toLoggedDay, scaleSession, stimulusToEngineSessions, type LoggedDayInput } from '../loggedDay';
import { catalogueEquivalence } from '../equivalence';
import { createFakeObservationAdapter, matchWorkouts, observationsFromBioRecords, type BioRecordLike } from '../observations';
import { effectiveEntries, aiEnergyShare, burdenMonitor, lapseState, tierOfEntry } from '../logs';
import { localToInstant } from '../dates';
import type { LogEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from '../types';

const TZ = 'Asia/Kolkata';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: '2026-10-05' };
const TRAIN: DayTemplate = {
  id: 'A', label: 'training day', energy: { kind: 'kcal', kcal: 2000 },
  macros: { protein: { unit: 'g', value: 160 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 9, lengthH: 10 } }, exercise: [{ kind: 'resistance', startH: 18, durationMin: 50, setsByRegion: { quads: 6, glutes: 3, chest: 6 } }],
  steps: 9000, sleep: { bedH: 23, wakeH: 7 },
};
const FAST: DayTemplate = { ...TRAIN, id: 'F', label: 'fast day', exercise: [] };
const SCHED: Schedule = {
  schemaVersion: 1, startDate: '2026-10-05', horizonDays: 14, programs: [TRAIN, FAST],
  days: Array.from({ length: 14 }, (_, d) => ({ program: d === 4 ? 1 : 0 })),
  events: [{ kind: 'fast', startDay: 4, startH: 20, durationH: 24 }],
};
const PRESCRIBED_STIM: StimulusVector = {
  effectiveSetsByRegion: { quads: 6, glutes: 3, chest: 6 }, pattern: 'squat', loadClass: 'moderate', netKcal: 150, mem: 0, hiMinutes: 0, mobilityMinutes: {},
};

const plan: PlanDoc & { id: string } = {
  id: 'p1', name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-01T10:00:00.000Z' },
  status: 'active', startDate: '2026-10-05', plannedEndDate: '2026-10-19', request: { profile: MAN, goals: [], horizonDays: 14 },
  baselineProfile: MAN, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-01T10:00:00.000Z',
};
const version: PlanVersionDoc = {
  planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHED, genome: null,
  sessions: {}, sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
  forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
  provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: '2026-10-01T10:00:00.000Z',
};

function rx(date: string): PrescribedDaySnapshot {
  const r = freezePrescription({ plan, version, date, tz: TZ });
  // the composed session's stimulus (E8 would fill it from `version.sessions`)
  return { ...r, sessions: r.sessions.map((s) => ({ ...s, stimulus: PRESCRIBED_STIM })) };
}

let seq = 0;
const src = { by: 'user' as const, method: 'typed' as const };
function meal(date: string, clockH: number, kcal: number, protein: number, over: Partial<LogEntry> = {}): LogEntry {
  const e = (v: number, f = 0.08) => ({ value: v, sd: v * f });
  return {
    id: `m${++seq}`, date, tz: TZ, at: localToInstant(date, clockH, TZ), source: src, kind: 'meal', clockH, components: [],
    totals: { energyKcal: e(kcal), proteinG: e(protein), carbG: e((kcal - 4 * protein) * 0.5 / 4), fatG: e((kcal - 4 * protein) * 0.5 / 9), fibreG: e(8) }, ...over,
  } as LogEntry;
}
const base = (date: string, over: Partial<LoggedDayInput> = {}): LoggedDayInput => ({
  date, planStart: plan.startDate, tz: TZ, prescription: rx(date), entries: [], expected: () => 0.75, equivalence: catalogueEquivalence, final: true, ...over,
});

describe('prescription snapshot (§3.3)', () => {
  it('freezes energy, macros, meals, window, sessions, steps, sleep and weighted items (weights sum to 1)', () => {
    const r = rx('2026-10-05');
    expect(r.planDay).toBe(0);
    expect(r.energyKcal).toBeCloseTo(2000, 6);
    expect(r.macros.proteinG).toBeCloseTo(160, 6);
    expect(r.meals).toHaveLength(3);
    expect(r.window).toEqual({ startH: 9, endH: 19 });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]!.slotKey).toBe('0:0');
    expect(r.items.map((i) => i.type).sort()).toEqual(['energy', 'protein', 'rtSession', 'sleep', 'steps', 'window']);
    expect(r.items.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 12);
    expect(new Set(r.items.map((i) => i.weight)).size).toBeGreaterThan(1); // not equal weights
  });

  it('a fast day carries the fast as instants and an item; a paused day is habitual with zero weights', () => {
    const f = rx('2026-10-09');
    expect(f.fast).toMatchObject({ hours: 24, lastIntakeAt: localToInstant('2026-10-09', 20, TZ) });
    expect(f.items.some((i) => i.type === 'fast')).toBe(true);
    const p = freezePrescription({ plan, version, date: '2026-10-07', tz: TZ, paused: true });
    expect(p.paused).toBe(true);
    expect(p.dayType).toBe('habitual day');
    expect(p.items.every((i) => i.weight === 0)).toBe(true);
  });
});

describe('toLoggedDay (§3.4)', () => {
  it('logged meals become absolute energy and macro grams with explicit meals; energy and protein are credited', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [meal(d, 9, 600, 50), meal(d, 13, 700, 55, { complete: true } as Partial<LogEntry>), meal(d, 18.5, 700, 55)] }));
    expect(r.loggedDay.inputs.energy).toEqual({ kind: 'kcal', kcal: 2000 });
    expect(r.loggedDay.inputs.meals?.meals).toHaveLength(3);
    expect(r.loggedDay.items.find((i) => i.itemId === 'energy')).toMatchObject({ status: 'done', credit: 1 });
    expect(r.loggedDay.items.find((i) => i.itemId === 'protein')!.credit).toBeCloseTo(1, 9);
    expect(r.loggedDay.items.find((i) => i.itemId === 'window')!.credit).toBe(1);
    expect(r.intakeLogged).toBe(true);
  });

  it('nothing logged: every item unknown, no score, and the replay uses the expected credit', () => {
    const r = toLoggedDay(base('2026-10-06', { expected: () => 0.5 }));
    expect(r.score.score).toBeNull();
    expect(r.score.coverage).toBe(0);
    expect(r.loggedDay.items.every((i) => i.status === 'unknown' && i.credit === null)).toBe(true);
    const e = r.loggedDay.inputs.energy;
    expect(e.kind).toBe('kcal');
    // halfway between maintenance and the prescription
    expect(e.kind === 'kcal' && e.kcal).toBeGreaterThan(2000);
    const sets = r.loggedDay.inputs.exercise![0]!;
    expect(sets.kind === 'resistance' && sets.setsByRegion!.quads).toBeCloseTo(3, 9);
    expect(r.assumedItems).toContain('rtSession:1:0');
    expect(r.intakeLogged).toBe(false);
  });

  it('T0 marks: "as planned" scores 100 with the prescription as inputs; "not" on food simulates maintenance', () => {
    const all = toLoggedDay(base('2026-10-06', { status: { date: '2026-10-06', marks: { all: 'asPlanned' } } }));
    expect(all.score.score).toBe(100);
    expect(all.loggedDay.inputs.energy).toEqual(TRAIN.energy);
    const not = toLoggedDay(base('2026-10-06', { status: { date: '2026-10-06', marks: { food: 'not', train: 'asPlanned' } } }));
    expect(not.loggedDay.inputs.energy).toEqual({ kind: 'pctMaintenance', pct: 100, reference: 'current' });
    expect(not.loggedDay.items.find((i) => i.itemId === 'energy')!.credit).toBe(0);
  });

  it('an equivalent session swap counts in full; a skipped session is 0; the engine simulates what was logged', () => {
    const d = '2026-10-05';
    const same: StimulusVector = { ...PRESCRIBED_STIM, pattern: 'lunge' };
    const swap = toLoggedDay(base(d, { entries: [{ id: 's1', date: d, tz: TZ, source: src, kind: 'session', status: 'done', itemId: 'rtSession:0:0', performed: [], stimulus: same, catalogueVersion: 'c1', startH: 18 } as LogEntry] }));
    expect(swap.loggedDay.items.find((i) => i.type === 'rtSession')).toMatchObject({ status: 'done', credit: 1 });
    const skip = toLoggedDay(base(d, { entries: [{ id: 's2', date: d, tz: TZ, source: src, kind: 'session', status: 'skipped', itemId: 'rtSession:0:0', performed: [], stimulus: same, catalogueVersion: 'c1' } as LogEntry] }));
    expect(skip.loggedDay.items.find((i) => i.type === 'rtSession')).toMatchObject({ status: 'skipped', credit: 0 });
    expect(skip.loggedDay.inputs.exercise).toEqual([]);
    const cardio: StimulusVector = { effectiveSetsByRegion: {}, pattern: 'gait', loadClass: 'veryLight', netKcal: 300, mem: 40, hiMinutes: 0, mobilityMinutes: {} } as unknown as StimulusVector;
    const other = toLoggedDay(base(d, { entries: [{ id: 's3', date: d, tz: TZ, source: src, kind: 'session', status: 'done', itemId: 'rtSession:0:0', performed: [], stimulus: cardio, catalogueVersion: 'c1', startH: 7 } as LogEntry] }));
    const c = other.loggedDay.items.find((i) => i.type === 'rtSession')!.credit!;
    expect(c).toBeLessThan(0.6);
    expect(other.loggedDay.inputs.exercise![0]).toMatchObject({ kind: 'cardio', durationMin: 40 });
  });

  it('a fast broken at 18 of 24 h earns half; a meal inside the prescribed fast ends it there', () => {
    const d = '2026-10-09';
    const last = localToInstant(d, 20, TZ);
    const first = new Date(Date.parse(last) + 18 * 3_600_000).toISOString();
    const r = toLoggedDay(base(d, { entries: [{ id: 'f1', date: d, tz: TZ, source: src, kind: 'fast', lastIntakeAt: last, firstIntakeAt: first, broken: true } as LogEntry] }));
    expect(r.loggedDay.items.find((i) => i.type === 'fast')).toMatchObject({ status: 'partial', credit: 0.5 });
    expect(r.fast).toMatchObject({ startDay: 4, startH: 20, durationH: 18 });
    const d2 = '2026-10-10';
    const r2 = toLoggedDay(base(d, { prescription: rx(d), entries: [meal(d2, 8, 500, 30, { date: d } as Partial<LogEntry>)].map((m) => ({ ...m, at: localToInstant(d2, 8, TZ) })) as LogEntry[] }));
    expect(r2.loggedDay.items.find((i) => i.type === 'fast')!.credit).toBeCloseTo((12 - 12) / 12, 9);
    expect(r2.fast!.durationH).toBeCloseTo(12, 9);
  });

  it('unknown fast: kept for the replay only when E[c] ≥ 0.5', () => {
    expect(toLoggedDay(base('2026-10-09', { expected: () => 0.8 })).fast).not.toBeNull();
    expect(toLoggedDay(base('2026-10-09', { expected: () => 0.3 })).fast).toBeNull();
  });

  it('device steps beat manual steps; device sleep sets the night ending on the day; workouts mark sessions', () => {
    const d = '2026-10-05';
    const obs = { date: d, steps: { value: 4500, source: 'ring' }, sleep: { bedH: 23.5, wakeH: 6.5, hours: 6.8, source: 'ring' }, workouts: [{ recordId: 'w1', startH: 18.2, durationMin: 46, exerciseType: 'strength_training', kind: 'resistance' as const, source: 'watch' }] };
    const r = toLoggedDay(base(d, { observations: obs, entries: [{ id: 'st', date: d, tz: TZ, source: src, kind: 'steps', steps: 12000 } as LogEntry] }));
    expect(r.loggedDay.inputs.steps).toBe(4500);
    expect(r.loggedDay.items.find((i) => i.itemId === 'steps')!.credit).toBeCloseTo(0.5, 9);
    expect(r.loggedDay.inputs.sleep).toMatchObject({ bedH: 23.5, wakeH: 6.5, hours: 6.8 });
    expect(r.loggedDay.items.find((i) => i.type === 'rtSession')).toMatchObject({ status: 'done' });
  });

  // L-REV2 R1-7: the ring fold re-ids a Lumen workout; the device entry logged under its old id is that workout, not another
  it('a device-logged session whose workout was re-id’d is the observed workout, not a second one', () => {
    const d = '2026-10-05';
    const w = { startH: 18.2, durationMin: 46, exerciseType: 'strength_training', kind: 'resistance' as const, source: 'ring' };
    const stimulus = { effectiveSetsByRegion: {}, pattern: 'complex', loadClass: 'moderate', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} };
    const logged = {
      id: 'dev', date: d, tz: TZ, source: { by: 'device', method: 'biometrics', bioRecordId: 'w-lumen', deviceKey: `${d}:workouts:w-lumen` },
      kind: 'session', status: 'done', startH: 18.2, durationMin: 46, performed: [], bioWorkoutId: 'w-lumen', stimulus, catalogueVersion: 'device',
      workout: { exerciseType: 'strength_training', kind: 'resistance' },
    } as unknown as LogEntry;
    const alone = toLoggedDay(base(d, { observations: { date: d, workouts: [{ recordId: 'w-ring', ...w }] } })).loggedDay.inputs.exercise;
    const r = toLoggedDay(base(d, { observations: { date: d, workouts: [{ recordId: 'w-ring', aliases: ['w-lumen'], ...w }] }, entries: [logged] }));
    expect(r.loggedDay.inputs.exercise).toEqual(alone);
    expect(r.loggedDay.items.find((i) => i.type === 'rtSession')).toMatchObject({ status: 'done' });
  });

  it('a backfilled ("assumed") day replays as planned but is never scored nor counted as logged intake', () => {
    const r = toLoggedDay(base('2026-10-06', { status: { date: '2026-10-06', marks: { all: 'asPlanned' }, assumed: true } }));
    expect(r.assumedDay).toBe(true);
    expect(r.score.score).toBeNull();
    expect(r.intakeLogged).toBe(false);
    expect(r.loggedDay.inputs.energy).toEqual(TRAIN.energy);
  });

  it('illness and stress become engine modifiers; substances become engine inputs', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [
      { id: 'e1', date: d, tz: TZ, source: src, kind: 'event', event: 'illness' } as LogEntry,
      { id: 'e2', date: d, tz: TZ, source: src, kind: 'subjective', stress: 'high' } as LogEntry,
      { id: 'e3', date: d, tz: TZ, source: src, kind: 'substance', substance: 'caffeine', clockH: 8, amount: 200, unit: 'mg' } as LogEntry,
    ] }));
    expect(r.loggedDay.inputs.modifiers).toMatchObject({ illness: true, stress: 'high' });
    expect(r.loggedDay.inputs.substances?.caffeine).toEqual([{ clockH: 8, mg: 200 }]);
  });
});

describe('session helpers', () => {
  it('scales doses by credit and derives engine sessions from a stimulus', () => {
    expect(scaleSession({ kind: 'cardio', modality: 'run', startH: 7, durationMin: 40 }, 0.5)).toMatchObject({ durationMin: 20 });
    expect(scaleSession({ kind: 'resistance', startH: 7, volume: 'moderate' }, 0.5)).toMatchObject({ volume: 'minimal' });
    expect(scaleSession({ kind: 'resistance', startH: 7, volume: 'moderate' }, 0)).toBeNull();
    const s = stimulusToEngineSessions(PRESCRIBED_STIM, 18);
    expect(s[0]).toMatchObject({ kind: 'resistance', setsByRegion: { quads: 6 }, loadPct1RM: 70 });
  });
});

describe('logs, provenance and burden', () => {
  it('edits supersede and retracts hide; tiers; AI-estimated energy share', () => {
    const d = '2026-10-05';
    const a = meal(d, 9, 500, 30);
    const b = { ...meal(d, 9, 450, 30), supersedes: a.id } as LogEntry;
    const c = { ...meal(d, 13, 800, 40), source: { by: 'ai' as const, method: 'aiPhoto' as const } } as LogEntry;
    const r = { id: 'r1', date: d, tz: TZ, source: src, kind: 'retract', target: c.id } as LogEntry;
    expect(effectiveEntries([a, b, c, r]).map((e) => e.id)).toEqual([b.id]);
    expect(aiEnergyShare([b, c])).toBeCloseTo(800 / 1250, 9);
    expect(tierOfEntry(b)).toBe('T2');
  });

  it('minimal mode after two weeks of < 3 T1+ days; welcome back after ≥ 2 missed days', () => {
    expect(burdenMonitor([], [], '2026-10-25', '2026-10-05').minimalMode).toBe(true);
    expect(burdenMonitor([], [], '2026-10-12', '2026-10-05').minimalMode).toBe(false);
    expect(lapseState('2026-10-10', '2026-10-13', '2026-10-05')).toEqual({ welcomeBack: true, gap: ['2026-10-11', '2026-10-12'] });
    expect(lapseState('2026-10-11', '2026-10-13', '2026-10-05').welcomeBack).toBe(false);
  });
});

describe('observation adapter', () => {
  it('maps canonical biometrics records to day observations (vendor VO2max estimates never enter)', () => {
    const recs: BioRecordLike[] = [
      { kind: 'daily', record_id: 'd1', time: { tz_offset_s: 19800, local_date: '2026-10-05' }, provenance: { channel: 'file:apple_health', source_app: 'Health' }, steps: 8123, vo2max: { ml_kg_min: 44, method: 'vendor_estimate' } },
      { kind: 'daily', record_id: 'd2', time: { tz_offset_s: 19800, local_date: '2026-10-06' }, provenance: { channel: 'manual' }, vo2max: { ml_kg_min: 41, method: 'field_test' } },
      { kind: 'sleep', record_id: 's1', is_main: true, asleep_s: 25200, time: { start: '2026-10-04T17:30:00.000Z', end: '2026-10-05T01:00:00.000Z', tz_offset_s: 19800, local_date: '2026-10-05' }, provenance: { channel: 'ble:2301' } },
      { kind: 'workout', record_id: 'w1', exercise_type: 'running', active_duration_s: 1800, time: { start: '2026-10-05T12:30:00.000Z', tz_offset_s: 19800, local_date: '2026-10-05' }, provenance: { channel: 'file:health_connect' } },
      { kind: 'spot', record_id: 'x1', metric: 'weight_kg', value: 89.4, context: 'morning', time: { at: '2026-10-05T01:30:00.000Z', tz_offset_s: 19800, local_date: '2026-10-05' }, provenance: { channel: 'ble:scale', device: { type: 'scale', tier: 'B' } } },
    ];
    const obs = observationsFromBioRecords(recs, TZ);
    const d5 = obs.find((o) => o.date === '2026-10-05')!;
    expect(d5.steps!.value).toBe(8123);
    expect(d5.vo2max).toBeUndefined();
    expect(d5.sleep).toMatchObject({ bedH: 23, wakeH: 6.5, hours: 7 });
    expect(d5.workouts![0]).toMatchObject({ kind: 'cardio', durationMin: 30, startH: 18 });
    expect(d5.weights![0]).toMatchObject({ kg: 89.4, context: 'morning' });
    expect(obs.find((o) => o.date === '2026-10-06')!.vo2max).toMatchObject({ mlKgMin: 41, method: 'field_test' });
    const fake = createFakeObservationAdapter(obs);
    expect(fake.observations('2026-10-05', '2026-10-05')).toHaveLength(1);
  });

  it('matches workouts by kind and duration (≥ 0.8 done, ≥ 0.3 partial, else none)', () => {
    const s = rx('2026-10-05').sessions;
    expect(matchWorkouts(s, [{ recordId: 'a', startH: 18, durationMin: 45, exerciseType: 'strength', kind: 'resistance', source: 'w' }])[0]).toMatchObject({ status: 'done' });
    expect(matchWorkouts(s, [{ recordId: 'a', startH: 18, durationMin: 20, exerciseType: 'strength', kind: 'resistance', source: 'w' }])[0]).toMatchObject({ status: 'partial', ratio: 0.4 });
    expect(matchWorkouts(s, [{ recordId: 'a', startH: 18, durationMin: 10, exerciseType: 'strength', kind: 'resistance', source: 'w' }])).toEqual([]);
    expect(matchWorkouts(s, [{ recordId: 'a', startH: 18, durationMin: 50, exerciseType: 'run', kind: 'cardio', source: 'w' }])).toEqual([]);
  });
});
