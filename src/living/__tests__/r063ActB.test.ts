/**
 * r063 package ACT-B: energy allocation, pauses, daily Heart Points, covered-awake steps, the exercise-departure trigger,
 * the sleep wake-date contract (audit gpt-6.1-sol S#, gpt-6-astra F##). Each block first reproduces the audit's probe.
 */
import { describe, expect, it } from 'vitest';
import { GAUGE_SLEEP_SETTLE_MS, planGaugeImport, sleepCompleted } from '../gaugeImport';
import { localToInstant } from '../dates';
import { energyBoutsOf, prescribedBouts, todayActual } from '../todayReplay';
import { estimateFor, sessionEntryOf } from '../activityCandidates';
import { movingSpans, splitBoutSessions } from '../boutParts';
import { energyDay, type EnergyHour } from '../sensors/energyDay';
import { todayEnergyStepsModel } from '../todayModel';
import { dayBouts, dayHeartPoints } from '@/features/living/progress/data/actuals';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { LogEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from '../types';
import { DEFAULT_ITEM_WEIGHTS } from '../prescription';
import { projectLiving, projectionSchedule } from '../projection';
import { plannedEatKcal } from '../dayClose';

const TZ = 'Asia/Kolkata';

describe('S29: a completed night that ends before the rollover is imported', () => {
  const night = { wakingDate: '2026-10-20', start: '2026-10-19T20:00:00+05:30', end: '2026-10-20T03:00:00+05:30', asleepMinutes: 400 };
  it('the probe: a 20:00-03:00 night with 400 min asleep, processed the next day, lands on the app day of its wake', () => {
    const p = planGaugeImport({ entries: [], steps: [], sleep: [night], tz: TZ, today: '2026-10-20', now: '2026-10-20T06:00:00.000Z' });
    expect(p.create).toHaveLength(1);
    // 03:00 is before the 04:00 rollover: the app day of the wake is the evening the night began (log.sleep's rule)
    expect(p.create[0]!.entry).toMatchObject({ kind: 'sleep', date: '2026-10-19', asleepMin: 400, episodeKind: 'main' });
    expect((p.create[0]!.entry as Extract<LogEntry, { kind: 'sleep' }>).occurrence).toMatchObject({ dateMeaning: 'wakeDate' });
  });
  it('completion comes from the timestamps: settled, or a later episode began after it', () => {
    const wake = Date.parse(night.end);
    expect(sleepCompleted(wake, wake + 10 * 60_000)).toBe(false);
    expect(sleepCompleted(wake, wake + GAUGE_SLEEP_SETTLE_MS)).toBe(true);
    expect(sleepCompleted(wake, wake + 10 * 60_000, [wake + 5 * 60_000])).toBe(true);
    expect(sleepCompleted(wake, wake - 1)).toBe(false);
  });
  it('a night imported early that later went on is replaced: the early entry is retracted', () => {
    const early = planGaugeImport({ entries: [], steps: [], sleep: [night], tz: TZ, today: '2026-10-20', now: '2026-10-20T06:00:00.000Z' });
    const entries = early.create.map((c) => ({ ...c.entry, id: c.id }) as LogEntry);
    const longer = { ...night, end: '2026-10-20T07:00:00+05:30', asleepMinutes: 600 };
    const later = planGaugeImport({ entries, steps: [], sleep: [longer], tz: TZ, today: '2026-10-20', now: '2026-10-20T06:00:00.000Z' });
    expect(later.create.map((c) => [c.entry.kind, c.entry.date])).toEqual([['sleep', '2026-10-20'], ['retract', '2026-10-19']]);
    expect(later.create[1]!.entry).toMatchObject({ target: entries[0]!.id });
  });
});

describe('A12: covered awake time comes from the real coverage intervals', () => {
  const date = '2026-10-21';
  const at = (h: number) => localToInstant(date, h, TZ);
  const head: DayTemplate = { label: 'd', energy: { kind: 'kcal', kcal: 2200 }, steps: 12_000, sleep: { bedH: 23, wakeH: 7 } } as unknown as DayTemplate;
  const prescription = { planId: 'p', version: 1, planDay: 2, dayType: 'd', energyKcal: 2200, macros: { proteinG: 0, carbG: 0, fatG: 0, fibreG: 0 }, meals: [], sessions: [], supplements: [], items: [], template: head, maintenanceKcal: 2200, steps: 12_000, sleep: { bedH: 23, wakeH: 7 } } as unknown as PrescribedDaySnapshot;
  // the night's sleep recorded 00:00-07:00, the steps covered only 07:00-12:00 (300 min, all of the elapsed awake time)
  const sleepEntry = { id: 'Z', date, tz: TZ, kind: 'sleep', bedAt: at(0), wakeAt: at(7), source: { by: 'device', method: 'biometrics', app: 'gauge' } } as LogEntry;
  const steps = (spans: boolean) =>
    ({ id: 'S', date, tz: TZ, kind: 'steps', steps: 5000, scope: 'totalDay', source: { by: 'device', method: 'biometrics', app: 'gauge', deviceKey: `gauge:steps:${date}` }, occurrence: { precision: 'date', date, dateMeaning: 'appDay', rolloverH: 4 }, fusion: { version: 'steps-fuse/1', located: 5000, headlinePolicy: 'located', coverage: { ringMin: 300, phoneMin: 0, eitherMin: 300, unknownMin: 0 }, ...(spans ? { spans: [{ start: at(7), end: at(12) }] } : {}) } }) as unknown as LogEntry;
  const run = (spans: boolean) => todayActual({ date, prescription, headTemplate: head, entries: [sleepEntry, steps(spans)], nowMs: Date.parse(at(12)), tz: TZ, rolloverH: 4 });
  it('the probe: without the spans the sleep entry ate the morning coverage (a false uncovered-morning prior)', () => {
    const old = run(false);
    expect(old.steps.uncoveredAwakeFrac).toBeGreaterThan(0);
    expect(old.steps.total!).toBeGreaterThan(5000 + 12_000 * (11 / 16) + 1);
  });
  it('with the spans the whole elapsed awake time is covered: fused so far + the plan share of the rest', () => {
    const t = run(true);
    expect(t.steps.uncoveredAwakeFrac).toBe(0);
    expect(t.steps.total).toBe(Math.round(5000 + 12_000 * (11 / 16)));
  });
  it('a gap in the spans gets the prior (07:00-09:00 uncovered)', () => {
    const e = steps(true) as unknown as { fusion: { spans: Array<{ start: string; end: string }> } };
    e.fusion.spans = [{ start: at(9), end: at(12) }];
    const t = todayActual({ date, prescription, headTemplate: head, entries: [sleepEntry, e as unknown as LogEntry], nowMs: Date.parse(at(12)), tz: TZ, rolloverH: 4 });
    expect(t.steps.uncoveredAwakeFrac).toBeCloseTo(120 / 960, 9);
  });
});

// ---------------------------------------------------------------------------------------------------------- S10/A15
const STIM = { effectiveSetsByRegion: {}, pattern: 'gait', loadClass: 'light', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} } as unknown as Extract<LogEntry, { kind: 'session' }>['stimulus'];
const PERSON = { massKg: 80, ageY: 40, sex: 'male' as const, rmrKcalPerDay: 1800 };
type Session = Extract<LogEntry, { kind: 'session' }>;

describe('S10/A15: a paused bout keeps its moving intervals', () => {
  const date = '2026-10-21';
  const at = (h: number) => Date.parse(localToInstant(date, h, TZ));
  const window = { start: at(10), end: at(11) };
  const pauses = [{ start: at(10 + 10 / 60), end: at(10 + 50 / 60) }];
  const estimate = estimateFor({ exerciseId: 'walk_brisk', window, person: PERSON, keytelEnabled: false, pauses })!;
  const candidate = { key: 'gauge:w1', sourceRevision: 'r1', estimateRevision: 'e1', measures: { steps: null }, refs: ['gauge:w1'], pauses, window } as unknown as Parameters<typeof sessionEntryOf>[0]['candidate'];
  const entry = sessionEntryOf({ candidate, decision: { exerciseId: 'walk_brisk', startAt: new Date(window.start).toISOString(), endAt: new Date(window.end).toISOString() }, estimate: estimate as never, decidedRevision: 'r1', stimulus: STIM, catalogueVersion: 'c', edited: false, tz: TZ, now: '2026-10-21T08:00:00.000Z' }).entry as Session;

  it('the probe: 10:00-11:00 paused 10:10-10:50 books 20 minutes at 10:00-10:10 and 10:50-11:00, not 10:00-10:20', () => {
    expect(entry.durationMin).toBeCloseTo(20, 9);
    expect(entry.moving).toEqual([
      { start: new Date(at(10)).toISOString(), end: new Date(at(10 + 10 / 60)).toISOString() },
      { start: new Date(at(10 + 50 / 60)).toISOString(), end: new Date(at(11)).toISOString() },
    ]);
    // the replay: one engine session per moving interval, one bout identity, the bout's minutes for its one recovery
    expect(entry.engine!.map((x) => [x.startH, x.durationMin, x.boutId, x.boutDurationMin])).toEqual([
      [10, 10, 'gauge:w1', 20],
      [expect.closeTo(10 + 50 / 60, 9), 10, 'gauge:w1', 20],
    ]);
    const g = entry.engine!.reduce((a, x) => a + (x.realisedGrossKcal ?? 0), 0);
    expect(g).toBeCloseTo(estimate.engineDose!.realisedGrossKcal!, 6);
    // Progress places the minutes where they were moved
    const b = dayBouts([entry], date, TZ)[0]!;
    expect(b.parts).toEqual([{ start: at(10), end: at(10 + 10 / 60) }, { start: at(10 + 50 / 60), end: at(11) }]);
  });
  it('the energy display counts only the moving minutes as exercise', () => {
    const t = todayActual({ date, prescription: { sessions: [], template: {} } as unknown as PrescribedDaySnapshot, headTemplate: { label: 'd' } as DayTemplate, entries: [{ ...entry, id: 'E' } as LogEntry], nowMs: at(12), tz: TZ });
    const bouts = energyBoutsOf(t.bouts, date, TZ);
    expect(bouts).toHaveLength(1);
    expect(bouts[0]!.parts).toEqual([{ start: at(10), end: at(10 + 10 / 60) }, { start: at(10 + 50 / 60), end: at(11) }]);
    const hours: EnergyHour[] = Array.from({ length: 24 }, (_, h) => ({ start: at(h), rmr: 60, tef: 10, neat: 20, stepsEnergy: 0, exerciseEnergy: h === 10 ? 100 : 0, tdee: 90 + (h === 10 ? 100 : 0) }));
    const d = energyDay({ hours, minutes: [], bouts });
    expect(d.byState.exercise.minutes).toBe(20);
    expect(d.minuteStates.slice(10 * 60, 11 * 60).filter((x) => x === 'exercise')).toHaveLength(20);
  });
  it('splitting keeps the gross, the steps and the phases of the whole bout', () => {
    const parts = splitBoutSessions([{ kind: 'cardio', modality: 'walk', startH: 8, durationMin: 30, met: 4, realisedGrossKcal: 150, stepsIncluded: 3001, sessionId: 'x', phases: [{ kind: 'steady', durationMin: 10, met: 3 }, { kind: 'steady', durationMin: 20, met: 5 }] }], [{ startH: 8, durationMin: 15 }, { startH: 9, durationMin: 15 }]);
    expect(parts.map((p) => p.durationMin)).toEqual([15, 15]);
    expect(parts.reduce((a, p) => a + (p.realisedGrossKcal ?? 0), 0)).toBeCloseTo(150, 9);
    expect(parts.reduce((a, p) => a + (p.kind === 'cardio' ? (p.stepsIncluded ?? 0) : 0), 0)).toBe(3001);
    expect(parts.map((p) => (p.kind === 'cardio' ? p.phases?.map((x) => x.durationMin) : null))).toEqual([[10, 5], [15]]);
    expect(movingSpans({ start: 0, end: 100 }, [{ start: 20, end: 30 }, { start: 25, end: 40 }])).toEqual([{ start: 0, end: 20 }, { start: 40, end: 100 }]);
  });
});

// ---------------------------------------------------------------------------------------------------------- S11/A25
describe('S11/A25: daily Heart Points agree with the bout points', () => {
  const t0 = Date.parse('2026-10-21T04:30:00.000Z');
  const none = () => undefined;
  const session = (over: Partial<Session>): Session => ({ id: 's', date: '2026-10-21', tz: TZ, kind: 'session', status: 'done', performed: [], stimulus: STIM, catalogueVersion: 'c', source: { by: 'user', method: 'typed' }, ...over }) as Session;
  it('the probes: resistance MET, a 30-second bout, an untimed half minute', () => {
    // a 30-minute 5-MET resistance activity without HR: 30 points (it was 0: resistance doses were skipped)
    const rt = session({ startH: 10, durationMin: 30, engine: [{ kind: 'resistance', startH: 10, durationMin: 30, met: 5, doseStatus: 'unknown' }] });
    const b = dayBouts([rt], '2026-10-21', TZ);
    expect(dayHeartPoints({ start: b[0]!.window.start - 3_600_000, end: b[0]!.window.end + 3_600_000, minuteAt: none, bouts: b, ageY: 40 })).toBeCloseTo(30, 9);
    // a 30-second moderate bout: 0.5 (it was 1)
    const half = [{ id: 'h', window: { start: t0, end: t0 + 30_000 }, met: 4, gait: null, incrementalKcalPerMin: null, envelope: null }];
    expect(dayHeartPoints({ start: t0 - 120_000, end: t0 + 120_000, minuteAt: none, bouts: half, ageY: 40 })).toBeCloseTo(0.5, 9);
    // an untimed 0.5-minute moderate activity: 0.5 (it was 1)
    const untimed = session({ durationMin: 0.5, engine: [{ kind: 'cardio', modality: 'other', startH: 18, durationMin: 0.5, met: 4 }] });
    expect(dayHeartPoints({ start: t0, end: t0 + 60_000, minuteAt: none, bouts: [], unplaced: [{ durationMin: 0.5, met: 4, gait: null }], ageY: 40 })).toBeCloseTo(0.5, 9);
    void untimed;
  });
  it('a bout and its day give the same points (the shared eligible-second rule, pauses left out)', () => {
    const w = { start: t0, end: t0 + 10 * 60_000 + 20_000 };
    const pauses = [{ start: t0 + 2 * 60_000 + 15_000, end: t0 + 4 * 60_000 }];
    const est = estimateFor({ exerciseId: 'walk_brisk', window: w, person: PERSON, keytelEnabled: false, pauses })!;
    const parts = movingSpans(w, pauses);
    const met = est.engineDose!.met;
    const day = dayHeartPoints({ start: t0 - 600_000, end: t0 + 3_600_000, minuteAt: none, bouts: [{ id: 'b', window: w, parts, met, gait: 'walk', incrementalKcalPerMin: null, envelope: null }], ageY: 40 });
    expect(day).toBeCloseTo(est.heartPoints!, 9);
  });
  it('a minute split between a bout and walking counts each second once (disjoint budget); §V2.3 stays', () => {
    // 30 s of a 4-MET bout, then 30 s of brisk supported walking (cadence 110): 0.5 + 0.5, never 1 + 1
    const walking = () => ({ sleep: 'none' as const, steps: 110, support: 'minute' as const, hr: null });
    const bouts = [{ id: 'h', window: { start: t0, end: t0 + 30_000 }, met: 4, gait: null, incrementalKcalPerMin: null, envelope: null }];
    expect(dayHeartPoints({ start: t0, end: t0 + 60_000, minuteAt: walking, bouts, ageY: 40 })).toBeCloseTo(1, 9);
    // supported locomotion alone still earns (cadence ≥ 100 = 1 point/min), a still minute does not
    expect(dayHeartPoints({ start: t0, end: t0 + 60_000, minuteAt: walking, bouts: [], ageY: 40 })).toBeCloseTo(1, 9);
    expect(dayHeartPoints({ start: t0, end: t0 + 60_000, minuteAt: () => ({ sleep: 'none', steps: 0, support: 'minute', hr: { bpm: 150, supportedS: 60 } }), bouts: [], ageY: 40 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- A16/S23
describe('A16/S23: exercise energy goes to every session the run books, never to recovery', () => {
  const date = '2026-10-21';
  const at = (h: number) => Date.parse(localToInstant(date, h, TZ));
  const hours = (exH: number, ex: number): EnergyHour[] => Array.from({ length: 24 }, (_, h) => ({ start: at(h), rmr: 60, tef: 10, neat: 20, stepsEnergy: 0, exerciseEnergy: h === exH ? ex : 0, tdee: 90 + (h === exH ? ex : 0) }));
  const head = { label: 'd', steps: 8000, sleep: { bedH: 23, wakeH: 7 } } as unknown as DayTemplate;
  it('the probe: a 200 kcal exercise hour without its bout read as recovery (Active 20); with it, as exercise', () => {
    const h = hours(17, 200);
    expect(energyDay({ hours: h, minutes: [], bouts: [] }).recovery).toBeCloseTo(200, 6);
    // an ordinary Train log (no candidate) at 17:00 for 60 min: its window comes from the replay
    const log = { id: 'L', date, tz: TZ, kind: 'session', status: 'done', startH: 17, durationMin: 60, performed: [], stimulus: STIM, catalogueVersion: 'c', source: { by: 'user', method: 'typed' }, engine: [{ kind: 'cardio', modality: 'run', startH: 17, durationMin: 60, met: 8 }] } as unknown as LogEntry;
    const t = todayActual({ date, prescription: { sessions: [], template: head } as unknown as PrescribedDaySnapshot, headTemplate: head, entries: [log], nowMs: at(19), tz: TZ });
    const d = energyDay({ hours: h, minutes: [], bouts: energyBoutsOf(t.bouts, date, TZ) });
    expect(d.recovery).toBeCloseTo(0, 6);
    expect(d.components.exercise).toBeCloseTo(200, 6);
  });
  it('the plan remainder: a planned 18:00 session still ahead is a bout of the realised run', () => {
    const rx = { sessions: [{ slotKey: '2:s0', startH: 18, kind: 'cardio', durationMin: 45, concrete: null, stimulus: null, engine: [{ kind: 'cardio', modality: 'cycle', startH: 18, durationMin: 45, met: 7 }] }], template: head, steps: 8000 } as unknown as PrescribedDaySnapshot;
    const t = todayActual({ date, prescription: rx, headTemplate: head, entries: [], nowMs: at(12), tz: TZ });
    const bouts = energyBoutsOf(t.bouts, date, TZ);
    expect(bouts.map((b) => [b.id, b.source, b.window])).toEqual([['2:s0', 'planned', { start: at(18), end: at(18.75) }]]);
    const d = energyDay({ hours: hours(18, 150), minutes: [], bouts });
    expect(d.components.exercise).toBeCloseTo(150, 6);
    expect(d.recovery).toBeCloseTo(0, 6);
  });
  it("S23: the plan's active energy counts its planned bouts (it read the bout hour as recovery)", () => {
    const rx = { sessions: [{ slotKey: '2:s0', startH: 9, kind: 'cardio', durationMin: 60, concrete: null, stimulus: null, engine: [{ kind: 'cardio', modality: 'run', startH: 9, durationMin: 60, met: 8 }] }], template: head } as unknown as PrescribedDaySnapshot;
    const actual = todayActual({ date, prescription: rx, headTemplate: head, entries: [], nowMs: at(8), tz: TZ });
    const planRun = hours(9, 100);
    const without = todayEnergyStepsModel({ actual, run: planRun, planRun, nowMs: at(8), quiet: false });
    const withBouts = todayEnergyStepsModel({ actual, run: planRun, planRun, nowMs: at(8), quiet: false, planBouts: energyBoutsOf(prescribedBouts(rx), date, TZ), bouts: energyBoutsOf(actual.bouts, date, TZ) });
    expect(withBouts.energy!.planActive! - without.energy!.planActive!).toBeCloseTo(100, 6);
    expect(withBouts.bouts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------- A34
describe('A34: the exercise-departure trigger runs at the day close (forecast only)', () => {
  const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 80 }, startDate: '2026-10-19' };
  const WALK: DayTemplate = {
    id: 'W', label: 'walk day', energy: { kind: 'kcal', kcal: 2200 },
    macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 220 }, fat: { unit: 'remainder' } },
    exercise: [{ kind: 'cardio', modality: 'walk', startH: 7, durationMin: 30, met: 3.5 }], steps: 10000, sleep: { bedH: 23, wakeH: 7 },
  };
  const SCHED: Schedule = { schemaVersion: 1, startDate: '2026-10-19', horizonDays: 14, programs: [WALK], days: Array.from({ length: 14 }, () => ({ program: 0 })) };
  const plan = { id: 'p1', name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-18T10:00:00.000Z' }, status: 'active', startDate: '2026-10-19', plannedEndDate: '2026-11-02', request: { profile: MAN, goals: [], horizonDays: 14 }, baselineProfile: MAN, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-18T10:00:00.000Z' } as unknown as PlanDoc & { id: string };
  const version = { planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHED, genome: null, sessions: {}, sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [], provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: '2026-10-18T10:00:00.000Z' } as unknown as PlanVersionDoc;
  const run = (inc: number) => {
    // an extra 60-minute run approved yesterday (2026-10-20), its booked incremental energy `inc`
    const log = { id: 'R', date: '2026-10-20', tz: TZ, kind: 'session', status: 'done', startH: 17, durationMin: 60, performed: [], stimulus: STIM, catalogueVersion: 'c', source: { by: 'user', method: 'typed' }, cost: { grossKcal: inc + 100, ownRestKcal: 75, netAboveRestKcal: inc + 25, displacedLifestyleKcal: 15, incrementalKcal: inc, method: 'modelled', source: 'estimated' }, engine: [{ kind: 'cardio', modality: 'run', startH: 17, durationMin: 60, met: 9, realisedGrossKcal: inc + 100 }] } as unknown as LogEntry;
    return projectLiving({ docs: { plan, versions: [version], dayStatus: [], entries: [log], measurements: [], records: [] }, today: '2026-10-21', tz: TZ, now: '2026-10-21T06:30:00.000Z', skipAssimilation: true });
  };
  it("planned EAT comes from the plan's own sessions", () => {
    // 30 min at 3.5 MET, 80 kg: gross 147, standard rest 42, displaced 8.4 → 96.6 kcal
    expect(plannedEatKcal({ sessions: [{ slotKey: 'x', startH: 7, kind: 'cardio', durationMin: 30, concrete: null, stimulus: null, engine: WALK.exercise! }] }, 80)).toBeCloseTo(96.6, 6);
  });
  it('training far beyond the plan: forecast only; the forecast carries it and food stays as planned', () => {
    const p = run(400);
    expect(p.dayClose?.closedDay.exercise).toMatchObject({ incrementalKcal: 400, plannedEatKcal: expect.closeTo(96.6, 6) });
    expect(p.dayClose?.decision).toMatchObject({ kind: 'light', trigger: 'nudge', forecastOnly: true });
    const n = p.today.notices.find((x) => x.id === 'dayClose:2026-10-20')!;
    expect(n.command).toBeUndefined();
    // the forecast's schedule replays yesterday's approved run; from today on the food stays the head's (no intake change)
    const sch = projectionSchedule(p, '2026-10-21')!;
    const progs = sch.days.map((d) => sch.programs[d.program]!);
    expect(progs[1]!.exercise?.some((x) => x.kind === 'cardio' && x.modality === 'run' && x.startH === 17)).toBe(true);
    for (const t of progs.slice(2)) expect(t.energy).toEqual({ kind: 'kcal', kcal: 2200 });
    expect(progs.length).toBeGreaterThan(2);
  });
  it('within 15 % of the plan nothing fires; a plan change is never applied from the day close', () => {
    const p = run(100);
    expect(p.dayClose?.decision).toBeNull();
    expect(p.today.notices.some((x) => x.id.startsWith('dayClose:'))).toBe(false);
  });
});
