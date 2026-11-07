// @vitest-environment node
/**
 * The one realised history (C2; D5-05, D5-01, D2-01): fasts resolved in absolute time across days, censoring, identity
 * dedup, occurrence vs entry time, every elapsed day kept (unknown days as named assumptions), coverage-zero actuals in the
 * replay, the reducer's determinism, and planned/actual dose identity.
 */
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, compileVersion, freezePrescription } from '../prescription';
import { buildReplanRequest } from '../replan';
import { addDays, localToInstant } from '../dates';
import { localClockOccurrence } from '../occurrence';
import { projectLiving, projectionSchedule, type LivingDocs } from '../projection';
import { historyAnchorOf, reduceRealisedHistory, type HistoryDocument } from '../realisedHistory';
import { toLoggedDay } from '../loggedDay';
import { catalogueEquivalence } from '../equivalence';
import type { ConfirmedState } from '../plannerContract';
import type { LogEntry, PlanDoc, PlanVersionDoc } from '../types';

const TZ = 'Asia/Kolkata';
const START = '2026-10-05';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: START };
const DAY: DayTemplate = {
  id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 2000 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } }, steps: 8000,
};
const FAST_DAY: DayTemplate = { ...DAY, id: 'F', label: 'fast', energy: { kind: 'zero' } };

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

/** A 48 h prescribed fast from day 0 at 20:00 (days 1-2 zero-intake), then ordinary days. */
const FAST48: Schedule = {
  schemaVersion: 1, startDate: START, horizonDays: 14, programs: [DAY, FAST_DAY],
  days: Array.from({ length: 14 }, (_, d) => ({ program: d === 1 ? 1 : 0 })),
  events: [{ kind: 'fast', startDay: 0, startH: 20, durationH: 48 }],
};
const PLAIN: Schedule = { schemaVersion: 1, startDate: START, horizonDays: 14, programs: [DAY], days: Array.from({ length: 14 }, () => ({ program: 0 })) };

const src = { by: 'user' as const, method: 'typed' as const };
function meal(id: string, date: string, clockH: number, kcal: number, over: Partial<LogEntry> = {}): LogEntry {
  return {
    id, date, tz: TZ, at: localToInstant(date, clockH, TZ), source: src, kind: 'meal', clockH, components: [],
    totals: { energyKcal: { value: kcal, sd: 0.08 * kcal }, proteinG: { value: 30, sd: 3 }, carbG: { value: 60, sd: 5 }, fatG: { value: 20, sd: 2 }, fibreG: { value: 5, sd: 1 } }, ...over,
  } as LogEntry;
}
function docsOf(schedule: Schedule, entries: LogEntry[]): LivingDocs {
  const { plan, version } = planWith(schedule);
  return { plan, versions: [version], dayStatus: [], entries, measurements: [], records: [] };
}
const project = (docs: LivingDocs, today: string, clockH = 10) => projectLiving({ docs, today, tz: TZ, now: localToInstant(today, clockH, TZ), skipAssimilation: true });

describe('fasts in absolute time (D5-05, D2-01)', () => {
  it('a 48 h prescribed fast from day 0 20:00 ends at the day-1 noon meal; the meal survives the replay', () => {
    const d1 = addDays(START, 1);
    const p = project(docsOf(FAST48, [meal('m1', d1, 12, 600)]), addDays(START, 3));
    const fasts = p.history!.fasts;
    expect(fasts).toHaveLength(1);
    expect(fasts[0]!.end).toMatchObject({ kind: 'observed', at: new Date(localToInstant(d1, 12, TZ)).toISOString(), terminatingEventId: 'm1' });
    expect(fasts[0]!.observedHours).toEqual({ min: 16, max: 16 });
    expect(fasts[0]!.intendedHours).toBe(48);
    expect(p.fastEvents).toHaveLength(1);
    expect(p.fastEvents[0]).toMatchObject({ startDay: 0, startH: 20, durationH: 16, source: 'planned' });
    // the realised schedule replays the meal at noon of day 1, outside the (cut) fast
    const realised = projectionSchedule(p, addDays(START, 3))!;
    expect(realised.realised).toMatchObject({ historyHash: p.history!.contentHash, throughDay: 3 });
    const compiled = compileVersion(MAN, realised);
    const noon = Array.from({ length: compiled.days[1]!.nMeals }, (_, k) => compiled.days[1]!.meals[k]!).find((m) => Math.abs(m.clockH - 12) < 1e-9);
    expect(noon).toBeDefined();
    expect(noon!.kcal).toBeGreaterThan(590);
    // the day-0 fast item is credited from the observed end, the same on every day the prescribed fast covers
    const d0 = p.days.find((d) => d.planDay === 0)!.result.loggedDay.items.find((i) => i.type === 'fast');
    const d1r = p.days.find((d) => d.planDay === 1)!.result.loggedDay.items.find((i) => i.type === 'fast');
    expect(d0?.status).toBe('partial');
    expect(d1r?.credit).toBe(d0?.credit);
  });

  it('a later completed fast log deduplicates the assumed interval; an edit or retraction recomputes the end', () => {
    const d0 = START;
    const open = { id: 'f1', date: d0, tz: TZ, at: localToInstant(d0, 20, TZ), source: src, kind: 'fast', lastIntakeAt: localToInstant(d0, 20, TZ), firstIntakeAt: null } as LogEntry;
    const done = { ...open, id: 'f2', at: localToInstant(addDays(d0, 2), 9, TZ), supersedes: 'f1', firstIntakeAt: localToInstant(addDays(d0, 1), 14, TZ) } as LogEntry;
    const p = project(docsOf(FAST48, [open, done]), addDays(START, 3));
    expect(p.history!.fasts).toHaveLength(1);
    expect(p.history!.fasts[0]!.id.startsWith('fast:')).toBe(true);
    expect(p.history!.fasts[0]!.observedHours).toEqual({ min: 18, max: 18 });
    expect(p.fastEvents[0]).toMatchObject({ startDay: 0, durationH: 18, source: 'observed' });
    const edited = { ...done, id: 'f3', supersedes: 'f2', firstIntakeAt: localToInstant(addDays(d0, 1), 16, TZ) } as LogEntry;
    expect(project(docsOf(FAST48, [open, done, edited]), addDays(START, 3)).fastEvents[0]!.durationH).toBeCloseTo(20, 9);
    const retracted = { id: 'r1', date: d0, tz: TZ, source: src, kind: 'retract', target: 'f3' } as LogEntry;
    const back = project(docsOf(FAST48, [open, done, edited, retracted]), addDays(START, 3));
    expect(back.history!.fasts.map((f) => f.id.split(':')[0])).toEqual(['fast']);
  });

  it('a running fast is right-censored at the start of today: its intended length is not history', () => {
    const d2 = addDays(START, 2);
    const run = { id: 'f9', date: d2, tz: TZ, at: localToInstant(d2, 20, TZ), source: src, kind: 'fast', lastIntakeAt: localToInstant(d2, 20, TZ), firstIntakeAt: null } as LogEntry;
    const p = project(docsOf(PLAIN, [run]), addDays(START, 3));
    const f = p.history!.fasts[0]!;
    expect(f.end.kind).toBe('censored');
    expect(f.end.at).toBe(new Date(localToInstant(addDays(START, 3), 4, TZ)).toISOString());
    expect(f.observedHours).toEqual({ min: 8, max: null });
    expect(p.fastEvents[0]).toMatchObject({ startDay: 2, startH: 20, durationH: 8, source: 'censored' });
  });

  it('the same 22:00 meal entered at once, the next day or two days later ends the same fast at the same occurrence', () => {
    const d0 = START;
    const at = (date: string, h: number) => localToInstant(date, h, TZ);
    const fast = { id: 'f1', date: d0, tz: TZ, at: at(d0, 18), source: src, kind: 'fast', lastIntakeAt: at(d0, 18), firstIntakeAt: null } as LogEntry;
    const variants = [at(d0, 22.1), at(addDays(d0, 1), 9), at(addDays(d0, 2), 21)].map((rec) => meal('m22', d0, 22, 400, { at: rec, recordedAt: rec }));
    const runs = variants.map((m) => project(docsOf(PLAIN, [fast, m]), addDays(START, 3)));
    for (const r of runs) {
      expect(r.history!.fasts[0]!.end).toMatchObject({ kind: 'observed', at: new Date(at(d0, 22)).toISOString() });
      expect(r.fastEvents[0]!.durationH).toBeCloseTo(4, 9);
    }
    const strip = (s: Schedule | null) => ({ ...s!, realised: undefined });
    expect(strip(projectionSchedule(runs[1]!, addDays(START, 3)))).toEqual(strip(projectionSchedule(runs[0]!, addDays(START, 3))));
    expect(strip(projectionSchedule(runs[2]!, addDays(START, 3)))).toEqual(strip(projectionSchedule(runs[0]!, addDays(START, 3))));
  });

  it('legacy wall clocks: before the rollover and inside a DST fold stay intervals; an ordinary clock is exact', () => {
    expect(localClockOccurrence('2026-10-12', 9, TZ)).toMatchObject({ precision: 'exact', at: new Date(localToInstant('2026-10-12', 9, TZ)).toISOString(), dateMeaning: 'appDay' });
    const small = localClockOccurrence('2026-10-12', 2, TZ);
    expect(small.precision).toBe('interval');
    expect(small.interval).toEqual({ start: new Date(localToInstant('2026-10-12', 2, TZ)).toISOString(), end: new Date(localToInstant('2026-10-13', 2, TZ)).toISOString() });
    const fold = localClockOccurrence('2026-10-25', 2.5, 'Europe/Berlin', 0);
    expect(fold).toMatchObject({ precision: 'interval', dstAmbiguous: true });
    expect(Date.parse(fold.interval!.end) - Date.parse(fold.interval!.start)).toBe(3_600_000);
  });
});

describe('one history for every replay (C2)', () => {
  it('every elapsed day is kept (unknown days as named assumptions) and the reducer returns the same object', () => {
    const docs = docsOf(PLAIN, [meal('m1', addDays(START, 1), 9, 500)]);
    const today = addDays(START, 4);
    const now = localToInstant(today, 10, TZ);
    const p = project(docs, today);
    const h = p.history!;
    expect(h.days.map((d) => d.planDay)).toEqual([0, 1, 2, 3]);
    const unknown = h.days.find((d) => d.planDay === 2)!;
    expect(unknown.resolution).toBe('scenario');
    expect(unknown.coverage.energy).toBe('unknown');
    expect(h.assumptions.some((a) => a.kind === 'unknownDayFrozenPrescription' && a.dates.includes(unknown.date))).toBe(true);
    expect(h.days.find((d) => d.planDay === 1)!.coverage.energy).toBe('partial');
    expect(h.days.find((d) => d.planDay === 1)!.remainders.length).toBe(1);
    expect(h.asOf).toBe(new Date(localToInstant(today, 4, TZ)).toISOString());
    // the C2 reducer over the raw documents (any order) gives the same history and hash
    const documents: HistoryDocument[] = [
      ...docs.entries.map((entry) => ({ kind: 'entry' as const, entry })),
      { kind: 'version', version: docs.versions[0]! },
      { kind: 'plan', plan: docs.plan! },
    ];
    const anchor = historyAnchorOf(docs.plan!, TZ, 4);
    const r1 = reduceRealisedHistory(anchor, documents, now, 1);
    const r2 = reduceRealisedHistory(anchor, [...documents].reverse(), now, 1);
    expect(r1.contentHash).toBe(h.contentHash);
    expect(r2.contentHash).toBe(r1.contentHash);
    // within the same day the hash does not move with the clock (the elapsed horizon is the start of today)
    expect(reduceRealisedHistory(anchor, documents, localToInstant(today, 22, TZ), 1).contentHash).toBe(r1.contentHash);
  });

  it('a coverage-zero actual session is in the replay and in the re-plan request', () => {
    const d1 = addDays(START, 1);
    const free = { id: 's-free', date: d1, tz: TZ, source: src, kind: 'session', status: 'done', itemId: 'free:1', startH: 7, durationMin: 30, performed: [], catalogueVersion: 'c', stimulus: { effectiveSetsByRegion: {}, pattern: 'gait', loadClass: 'veryLight', netKcal: 200, mem: 30, hiMinutes: 0, mobilityMinutes: {} } } as unknown as LogEntry;
    const today = addDays(START, 3);
    const p = project(docsOf(PLAIN, [free]), today);
    const day1 = p.days.find((d) => d.planDay === 1)!;
    expect(day1.result.loggedDay.coverage).toBe(0);
    expect(day1.result.loggedDay.inputs.exercise?.some((s) => s.sessionId === 's-free')).toBe(true);
    expect(p.history!.days.find((d) => d.planDay === 1)!.observedEventIds).toContain('s-free');
    const state = { anchorDate: START, snapshot: { key: 'k', moduleIds: [], states: [], bus: new Float64Array(0), prevBedH: 23, prevSleepH: 8, t0WeightErrKg: 0 }, energyBiasKcal: { mean: 0, sd: 150 }, trendWeight: { kg: 90, sd: 0.5 } } as unknown as ConfirmedState;
    const req = buildReplanRequest({ decision: { kind: 'event', trigger: 'user', reason: '' }, today, plan: p.plan!, head: p.head!, state, logs: p.days.filter((d) => d.date < today).map((d) => d.result.loggedDay), adherence: p.blocks });
    expect(req.logs.map((l) => l.date)).toEqual([START, d1, addDays(START, 2)]);
    expect(req.logs[1]!.inputs.exercise?.some((s) => s.sessionId === 's-free')).toBe(true);
  });
});

describe('planned and actual doses by identity (D5-01)', () => {
  const SUBS: DayTemplate = { ...DAY, id: 'S', substances: { caffeine: [{ clockH: 8, mg: 200 }], creatineG: 5 } };
  const SCHED: Schedule = { ...PLAIN, programs: [SUBS] };
  const { plan, version } = planWith(SCHED);
  const rx = freezePrescription({ plan, version, date: START, tz: TZ });
  const day = (entries: LogEntry[]) => toLoggedDay({ date: START, planStart: START, tz: TZ, prescription: rx, entries, expected: () => 0.75, equivalence: catalogueEquivalence, final: true });
  const sub = (id: string, substance: string, amount: number, unit: string, over: Partial<LogEntry> = {}) => ({ id, date: START, tz: TZ, source: src, kind: 'substance', substance, clockH: 9, amount, unit, ...over }) as unknown as LogEntry;

  it('a linked log replaces its planned dose, an explicit extra adds, an unlinked one is an unresolved identity', () => {
    expect(day([]).loggedDay.inputs.substances?.caffeine?.map((c) => c.mg)).toEqual([200]);
    const linked = day([sub('c1', 'caffeine', 200, 'mg', { itemId: 'substance:caffeine:0' })]);
    expect(linked.loggedDay.inputs.substances?.caffeine?.map((c) => [c.mg, c.eventId])).toEqual([[200, 'c1']]);
    const extra = day([sub('c2', 'caffeine', 100, 'mg', { extra: true })]);
    expect(extra.loggedDay.inputs.substances?.caffeine?.map((c) => c.mg)).toEqual([200, 100]);
    const unlinked = day([sub('c3', 'caffeine', 200, 'mg')]);
    expect(unlinked.loggedDay.inputs.substances?.caffeine?.map((c) => c.eventId)).toEqual(['c3']);
    expect(unlinked.alternatives).toEqual([expect.objectContaining({ memberIds: ['c3'], candidates: ['substance:caffeine:0'] })]);
  });

  it('creatine and BHB normalise g/mg; creatine logged both ways counts once; an illegal pair never becomes grams', () => {
    const mg = day([sub('k1', 'creatine', 5000, 'mg', { itemId: 'supplement:creatine' })]);
    expect(mg.loggedDay.inputs.substances?.creatineG).toBeCloseTo(5, 9);
    const both = day([sub('k2', 'creatine', 5, 'g'), { id: 'k3', date: START, tz: TZ, source: src, kind: 'supplement', supplementId: 'creatine', dose: 5, unit: 'g' } as LogEntry]);
    expect(both.loggedDay.inputs.substances?.creatineG).toBeCloseTo(5, 9);
    expect(both.alternatives.some((a) => a.memberIds.includes('k2') && a.memberIds.includes('k3'))).toBe(true);
    const bhb = day([sub('b1', 'exogenousKetones', 12000, 'mg')]);
    expect(bhb.loggedDay.inputs.substances?.exogenousKetones?.[0]?.gBhb).toBeCloseTo(12, 9);
    const bad = day([sub('x1', 'caffeine', 2, 'drinks', { itemId: 'substance:caffeine:0' })]);
    expect(bad.loggedDay.inputs.substances?.caffeine ?? []).toEqual([]);
    expect(bad.coverage.supplements).toBe('partial');
    const alcohol = day([sub('a1', 'alcohol', 28, 'g')]);
    expect(alcohol.loggedDay.inputs.substances?.alcohol?.[0]?.drinks).toBeCloseTo(2, 9);
  });
});

describe('migration, reload, import and sync idempotence (C7)', () => {
  const d0 = START;
  const d1 = addDays(START, 1);
  const today = addDays(START, 4);
  const at = (date: string, h: number) => localToInstant(date, h, TZ);
  const fast = { id: 'f1', date: d0, tz: TZ, at: at(d0, 20), source: src, kind: 'fast', lastIntakeAt: at(d0, 20), firstIntakeAt: null } as LogEntry;
  const done = { ...fast, id: 'f2', at: at(addDays(d0, 2), 9), supersedes: 'f1', firstIntakeAt: at(d1, 14) } as LogEntry;
  const lunch = meal('m1', d1, 14, 600);
  const strip = (s: Schedule | null) => ({ ...s!, realised: undefined });

  it('a reload (JSON round trip) and a sync or import echo (every document seen twice) give the same history and replay', () => {
    const docs = docsOf(FAST48, [fast, done, lunch]);
    const p = project(docs, today);
    const reloaded = JSON.parse(JSON.stringify(docs)) as LivingDocs;
    expect(project(reloaded, today).history!.contentHash).toBe(p.history!.contentHash);
    const echoed: LivingDocs = { ...docs, entries: [...docs.entries, ...docs.entries.map((e) => ({ ...e }))], versions: [...docs.versions, ...docs.versions] };
    const pe = project(echoed, today);
    expect(pe.history!.contentHash).toBe(p.history!.contentHash);
    // a document seen twice is one observation: no identity-ambiguity group, no double meal, the same fast
    expect(pe.history!.uncertaintyGroups).toEqual(p.history!.uncertaintyGroups);
    expect(pe.history!.fasts).toEqual(p.history!.fasts);
    expect(projectionSchedule(pe, today)).toEqual(projectionSchedule(p, today));
    // the C2 reducer over the raw documents, echoed in any order
    const documents: HistoryDocument[] = [...docs.entries.map((entry) => ({ kind: 'entry' as const, entry })), { kind: 'version', version: docs.versions[0]! }, { kind: 'plan', plan: docs.plan! }];
    const anchor = historyAnchorOf(docs.plan!, TZ, 4);
    const now = at(today, 10);
    const r1 = reduceRealisedHistory(anchor, documents, now, 1);
    expect(reduceRealisedHistory(anchor, [...documents, ...[...documents].reverse()], now, 1).contentHash).toBe(r1.contentHash);
    expect(r1.contentHash).toBe(p.history!.contentHash);
  });

  it('reading is additive: projecting never rewrites a stored record, and repeating it changes nothing', () => {
    const docs = docsOf(FAST48, [fast, done, lunch]);
    const before = JSON.stringify(docs);
    const a = project(docs, today);
    const b = project(docs, today);
    expect(JSON.stringify(docs)).toBe(before);
    expect(b.history!.contentHash).toBe(a.history!.contentHash);
  });

  it('a legacy record (no occurrence, recorded time or contract) replays the same exposure as its new-format twin', () => {
    // the legacy meal was typed two days later; its audit time never becomes its occurrence
    const legacy = meal('m1', d1, 14, 600, { at: at(addDays(d1, 2), 9) });
    const modern = meal('m1', d1, 14, 600, { at: at(addDays(d1, 2), 9), recordedAt: at(addDays(d1, 2), 9), contract: 1, occurrence: localClockOccurrence(d1, 14, TZ) } as Partial<LogEntry>);
    const pl = project(docsOf(FAST48, [fast, legacy]), today);
    const pm = project(docsOf(FAST48, [fast, modern]), today);
    expect(pl.history!.fasts[0]!.end).toEqual(pm.history!.fasts[0]!.end);
    expect(pl.history!.fasts[0]!.end).toMatchObject({ kind: 'observed', at: new Date(at(d1, 14)).toISOString() });
    expect(strip(projectionSchedule(pl, today))).toEqual(strip(projectionSchedule(pm, today)));
  });

  it('a legacy day with only an "as planned" mark stays an estimate: never complete food, never calibration evidence', () => {
    const docs = docsOf(PLAIN, []);
    const marked: LivingDocs = { ...docs, dayStatus: [{ date: d1, planId: 'p1', planDay: 1, marks: { all: 'asPlanned' } }] };
    const p = project(marked, today);
    const day = p.days.find((d) => d.planDay === 1)!;
    expect(day.result.calibrationEligible).toBe(false);
    expect(p.history!.days.find((d) => d.planDay === 1)!.coverage.energy).not.toBe('complete');
    expect(p.history!.days.find((d) => d.planDay === 1)!.attestation).toBeUndefined();
  });
});
