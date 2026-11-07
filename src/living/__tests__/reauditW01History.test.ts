// @vitest-environment node
/**
 * Re-audit W0/W1 regressions of the living package (F03-history): the observed fast stays censored at asOf whatever the
 * intent (A1-015); a known positive BHB dose ends a zero-calorie fast (A1-037); creatine from the canonical label active
 * (A1-032); per-scale rating identity and the shared calibration provider (A1-054/A1-055); energy availability with the
 * exercise channel's coverage (A1-057); total sleep apart from main-episode timing (A1-053); polyol identities (A1-031);
 * food ethanol beside a standalone drink (A1-029); unknown resistance dose (A1-022); the current exercise-eligibility
 * overlay (A1-005).
 */
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { StimulusVector } from '@/catalogues';
import type { ClinicianExerciseEnvelope, SupplementProduct, SymptomReport } from '@/lib/bodyContracts';
import { DEFAULT_ITEM_WEIGHTS, compileVersion, freezePrescription } from '../prescription';
import { runReplay } from '@/engine/assimilation';
import { compositionReadingsFor, weeklyCheckIn, weighInsFor } from '../assimilate';
import { resolveFasts } from '../fastIntervals';
import { observedWellbeingOf, toLoggedDay, type LoggedDayInput } from '../loggedDay';
import { catalogueEquivalence } from '../equivalence';
import { addDays, localToInstant } from '../dates';
import { projectLiving, projectionSchedule, type LivingDocs } from '../projection';
import { calibrateHunger, rawEnergyAvailability } from '../wellbeing';
import { buildTodayView, currentExerciseEligibility, overlayPrescription } from '../today';
import { adherenceTrend } from '../adherence';
import type { LogEntry, MeasurementEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from '../types';
import { MAN as ENGINE_MAN, makeHarness } from '@/engine/model/wellbeing/__tests__/harness';
import { EA_STATUS, eaStatusToOutput } from '@/engine/model/wellbeing/outputs';

const TZ = 'Asia/Kolkata';
const START = '2026-10-05';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: START };
const DAY: DayTemplate = {
  id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 2000 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } }, steps: 9000, sleep: { bedH: 23, wakeH: 7, quality: 'poor' },
};
const TRAIN: DayTemplate = { ...DAY, id: 'T', label: 'training', exercise: [{ kind: 'resistance', startH: 18, durationMin: 50, setsByRegion: { quads: 6, glutes: 3, chest: 6 } }] };
const STIM: StimulusVector = { effectiveSetsByRegion: { quads: 6, glutes: 3, chest: 6 }, pattern: 'squat', loadClass: 'moderate', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} };

const src = { by: 'user' as const, method: 'typed' as const };
let seq = 0;

function planWith(schedule: Schedule, profile: PersonProfile = MAN): { plan: PlanDoc & { id: string }; version: PlanVersionDoc } {
  const plan: PlanDoc & { id: string } = {
    id: 'p1', name: 'Plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-01T10:00:00.000Z' }, status: 'active',
    startDate: START, plannedEndDate: addDays(START, schedule.horizonDays), request: { profile, goals: [], horizonDays: schedule.horizonDays },
    baselineProfile: profile, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-01T10:00:00.000Z',
  };
  const version: PlanVersionDoc = {
    planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule, genome: null, sessions: {},
    sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: '2026-10-01T10:00:00.000Z',
  };
  return { plan, version };
}
const schedOf = (programs: DayTemplate[], days: number[], events: Schedule['events'] = []): Schedule => ({ schemaVersion: 1, startDate: START, horizonDays: days.length, programs, days: days.map((program) => ({ program })), events });
const at = (date: string, clockH: number) => new Date(localToInstant(date, clockH, TZ)).toISOString();

// ------------------------------------------------------------------------------------------- A1-015
describe('A1-015: a running fast is censored at asOf whatever its intended length', () => {
  const D0 = START;
  const D1 = addDays(START, 1);
  const fastLog = { id: 'f1', date: D0, tz: TZ, source: src, kind: 'fast', lastIntakeAt: at(D0, 20), firstIntakeAt: null } as LogEntry;
  const variants: Array<[string, Schedule]> = [
    ['no prescribed fast', schedOf([DAY], Array(14).fill(0))],
    ['24 h intended', schedOf([DAY], Array(14).fill(0), [{ kind: 'fast', startDay: 0, startH: 20, durationH: 24 }])],
    ['48 h intended', schedOf([DAY], Array(14).fill(0), [{ kind: 'fast', startDay: 0, startH: 20, durationH: 48 }])],
  ];
  it.each(variants)('%s: 32 h elapsed is a 32 h observed event and a 32 h replay event', (_name, schedule) => {
    const { plan, version } = planWith(schedule);
    const asOf = at(D1, 28); // day 0 20:00 + 32 h
    const days = [0, 1, 2].map((d) => ({ date: addDays(START, d), planDay: d, prescription: freezePrescription({ plan, version, date: addDays(START, d), tz: TZ }), status: null }));
    const r = resolveFasts({ planStart: START, tz: TZ, asOf, entries: [fastLog], days });
    const logged = r.find((x) => x.basis === 'log')!;
    expect(logged.interval.end.kind).toBe('censored');
    expect(logged.interval.observedHours).toEqual({ min: 32, max: null });
    expect(logged.event!.durationH).toBeCloseTo(32, 9);
    expect(logged.assumption).toBeUndefined();
    // the intent stays metadata; a stale timer is only a separately named continuation scenario
    if (schedule.events?.[0]?.durationH === 24) expect(logged.staleTimer).toEqual({ kind: 'endedAtIntendedLength', durationH: 24 });
    else expect(logged.staleTimer).toBeUndefined();
  });

  it('the same observed event reaches the realised schedule of the projection under every intent', () => {
    // the elapsed history runs to the start of today (day 2, 04:00): 32 h after the day-0 20:00 last intake
    const D2 = addDays(START, 2);
    const durations = variants.map(([, schedule]) => {
      const { plan, version } = planWith(schedule);
      const docs: LivingDocs = { plan, versions: [version], dayStatus: [], entries: [fastLog], measurements: [], records: [] };
      const p = projectLiving({ docs, today: D2, tz: TZ, now: at(D2, 10), skipAssimilation: true });
      const realised = projectionSchedule(p, D2)!;
      return [p.fastEvents.find((e) => e.source === 'censored')?.durationH, realised.events?.find((e) => e.kind === 'fast' && e.startDay === 0)?.durationH];
    });
    for (const [ev] of durations) expect(ev).toBeCloseTo(32, 6);
    expect(new Set(durations.map((d) => d[1]?.toFixed(6))).size).toBe(1);
  });

  it('a logged end and a verified caloric interruption still bound the observed duration', () => {
    const { plan, version } = planWith(variants[1]![1]);
    const days = [0, 1].map((d) => ({ date: addDays(START, d), planDay: d, prescription: freezePrescription({ plan, version, date: addDays(START, d), tz: TZ }), status: null }));
    const ended = resolveFasts({ planStart: START, tz: TZ, asOf: at(D1, 30), entries: [{ ...fastLog, firstIntakeAt: at(D1, 22) } as LogEntry], days });
    expect(ended.find((x) => x.basis === 'log')!.event!.durationH).toBeCloseTo(26, 9);
    const meal = { id: 'm1', date: D1, tz: TZ, source: src, kind: 'meal', clockH: 12, components: [], totals: { energyKcal: { value: 500, sd: 40 }, proteinG: { value: 30, sd: 3 }, carbG: { value: 50, sd: 4 }, fatG: { value: 15, sd: 2 } }, occurrence: { precision: 'exact', at: at(D1, 12), dateMeaning: 'appDay', source: 'user' } } as LogEntry;
    const broken = resolveFasts({ planStart: START, tz: TZ, asOf: at(D1, 28), entries: [fastLog, meal], days });
    expect(broken.find((x) => x.basis === 'log')!.event!.durationH).toBeCloseTo(16, 9);
  });
});

// ------------------------------------------------------------------------------------------- A1-037
describe('A1-037: a known positive exogenous BHB dose ends the literal zero-calorie fast', () => {
  const D0 = START;
  const D1 = addDays(START, 1);
  const { plan, version } = planWith(schedOf([DAY], Array(14).fill(0)));
  const days = [0, 1].map((d) => ({ date: addDays(START, d), planDay: d, prescription: freezePrescription({ plan, version, date: addDays(START, d), tz: TZ }), status: null }));
  const fast = { id: 'f1', date: D0, tz: TZ, source: src, kind: 'fast', lastIntakeAt: at(D0, 20), firstIntakeAt: at(D1, 18) } as LogEntry;
  const bhb = (amount: number, unit: 'g' | 'mg', occurrence?: unknown): LogEntry =>
    ({ id: 'bhb', date: D1, tz: TZ, source: src, kind: 'substance', substance: 'exogenousKetones', clockH: 10, amount, unit, occurrence: occurrence ?? { precision: 'exact', at: at(D1, 10), dateMeaning: 'appDay', source: 'user' } }) as LogEntry;
  const dinner = { id: 'dinner', date: D1, tz: TZ, source: src, kind: 'meal', clockH: 18, components: [], totals: { energyKcal: { value: 1500, sd: 100 }, proteinG: { value: 80, sd: 5 }, carbG: { value: 150, sd: 10 }, fatG: { value: 60, sd: 5 } }, occurrence: { precision: 'exact', at: at(D1, 18), dateMeaning: 'appDay', source: 'user' } } as LogEntry;
  const logged = (entries: LogEntry[]) => resolveFasts({ planStart: START, tz: TZ, asOf: at(D1, 23), entries, days }).find((x) => x.basis === 'log')!;

  it.each([[12, 'g'], [12000, 'mg']] as const)('%s %s at an exact 10:00 ends the fast at 10:00 after 14 h; a later dinner cannot move it', (amount, unit) => {
    const r = logged([fast, bhb(amount, unit), dinner]);
    expect(r.interval.end).toMatchObject({ kind: 'observed', at: at(D1, 10), terminatingEventId: 'bhb' });
    expect(r.interval.observedHours).toEqual({ min: 14, max: 14 });
    expect(r.event!.durationH).toBeCloseTo(14, 9);
  });

  it('a zero dose is not an intake; an interval time only bounds the end; no kcal number is invented', () => {
    expect(logged([fast, bhb(0, 'g'), dinner]).interval.end).toMatchObject({ kind: 'observed', at: at(D1, 18) });
    const window = { precision: 'interval', interval: { start: at(D1, 9), end: at(D1, 11) }, dateMeaning: 'appDay', source: 'user' };
    const r = logged([fast, bhb(12, 'g', window), dinner]);
    expect(r.interval.end.kind).toBe('interval');
    expect(r.interval.observedHours?.min).toBeCloseTo(13, 9);
    expect(r.interval.observedHours?.max).toBeCloseTo(15, 9);
  });
});

// ------------------------------------------------------------------------------------------- loggedDay fixtures
const SCHED = schedOf([TRAIN, DAY], Array.from({ length: 14 }, (_, d) => d % 2));
const P = planWith(SCHED);
function rxOf(date: string): PrescribedDaySnapshot {
  const r = freezePrescription({ plan: P.plan, version: P.version, date, tz: TZ });
  return { ...r, sessions: r.sessions.map((s) => ({ ...s, stimulus: STIM })) };
}
const dayInput = (date: string, over: Partial<LoggedDayInput> = {}): LoggedDayInput => ({ date, planStart: START, tz: TZ, prescription: rxOf(date), entries: [], expected: () => 0.75, equivalence: catalogueEquivalence, final: true, ...over });
const supplement = (date: string, over: Partial<Extract<LogEntry, { kind: 'supplement' }>>): LogEntry => ({ id: `sup${++seq}`, date, tz: TZ, source: src, kind: 'supplement', supplementId: 'creatine', dose: 10, unit: 'g', clockH: 8, ...over }) as LogEntry;

// ------------------------------------------------------------------------------------------- A1-032
describe('A1-032: creatine from the canonical label active, never the product mass', () => {
  const D = addDays(START, 1);
  const label = (amount: number | null, extra: SupplementProduct['actives'] = []): SupplementProduct => ({ servingAmount: 10, servingUnit: 'g', actives: [{ ingredient: 'creatine', amount, unit: 'g', basis: 'asLabelled' } as SupplementProduct['actives'][number], ...extra] });

  it.each(['creatine', 'creatine_monohydrate'])('a 10 g serving labelled 3 g creatine replays 3 g (%s)', (supplementId) => {
    const r = toLoggedDay(dayInput(D, { entries: [supplement(D, { supplementId, product: label(3) })] }));
    expect(r.loggedDay.inputs.substances?.creatineG).toBeCloseTo(3, 9);
    expect(r.actives.creatine).toMatchObject({ unit: 'g', knownDaily: 3, events: 1, unknownEvents: 0 });
    // routed once: never also as an active dose next to the creatine scalar
    expect(r.loggedDay.inputs.substances?.actives?.some((a) => a.ingredient === 'creatine') ?? false).toBe(false);
  });

  it('a capsule label (2 capsules × 1.5 g) is the same 3 g; unknown potency stays unknown with its event counted', () => {
    const caps = toLoggedDay(dayInput(D, { entries: [supplement(D, { dose: 2, unit: 'capsule', product: { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'creatine', amount: 1.5, unit: 'g', basis: 'asLabelled' } as SupplementProduct['actives'][number]] } })] }));
    expect(caps.loggedDay.inputs.substances?.creatineG).toBeCloseTo(3, 9);
    const unknown = toLoggedDay(dayInput(D, { entries: [supplement(D, { product: label(null) })] }));
    expect(unknown.loggedDay.inputs.substances?.creatineG).toBeUndefined();
    expect(unknown.actives.creatine).toMatchObject({ events: 1, unknownEvents: 1, knownDaily: 0 });
    expect(unknown.coverage.supplements).toBe('partial');
  });

  it('a blend replays its other labelled active; a legacy unlabelled 3 g record keeps its documented reading', () => {
    const blend = toLoggedDay(dayInput(D, { entries: [supplement(D, { supplementId: 'preworkout', product: label(3, [{ ingredient: 'caffeine', amount: 200, unit: 'mg', basis: 'asLabelled' } as SupplementProduct['actives'][number]]) })] }));
    expect(blend.loggedDay.inputs.substances?.creatineG).toBeCloseTo(3, 9);
    expect(blend.loggedDay.inputs.substances?.actives).toEqual([expect.objectContaining({ ingredient: 'caffeine', amount: 200, unit: 'mg', origin: 'observed' })]);
    const legacy = toLoggedDay(dayInput(D, { entries: [supplement(D, { dose: 3 })] }));
    expect(legacy.loggedDay.inputs.substances?.creatineG).toBeCloseTo(3, 9);
  });

  it('the source documents are unchanged by repeated replays', () => {
    const e = supplement(D, { product: label(3) });
    const frozen = JSON.stringify(e);
    toLoggedDay(dayInput(D, { entries: [e] }));
    toLoggedDay(dayInput(D, { entries: [JSON.parse(frozen) as LogEntry] }));
    expect(JSON.stringify(e)).toBe(frozen);
  });
});

// ------------------------------------------------------------------------------------------- A1-055 / A1-054
describe('A1-055/A1-054: each rating keeps its own clock; one shared calibration provider', () => {
  const subj = (id: string, recordedAt: string, over: Record<string, unknown>): LogEntry => ({ id, date: START, tz: TZ, source: src, kind: 'subjective', recordedAt, ...over }) as LogEntry;

  it('hunger 3 at 09:00 then fullness 8 at 20:00 leaves the hunger at 09:00; both stay separate observations', () => {
    const w = observedWellbeingOf([subj('a', '2026-10-05T03:30:00Z', { hunger: 3, ratedAtClockH: 9 }), subj('b', '2026-10-05T14:30:00Z', { fullness: 8, ratedAtClockH: 20 })])!;
    expect(w.ratedAtClockH).toBe(9);
    expect(w.observations).toEqual([{ scale: 'hunger', value: 3, clockH: 9, entryId: 'a' }, { scale: 'fullness', value: 8, clockH: 20, entryId: 'b' }]);
  });

  it('a later untimed hunger is untimed (no borrowed clock); two timed hunger ratings stay two', () => {
    const w = observedWellbeingOf([subj('a', '2026-10-05T03:30:00Z', { hunger: 3, ratedAtClockH: 9 }), subj('b', '2026-10-05T14:30:00Z', { hunger: 6 })])!;
    expect(w.hunger).toBe(6);
    expect(w.ratedAtClockH).toBeUndefined();
    const two = observedWellbeingOf([subj('a', '2026-10-05T03:30:00Z', { hunger: 3, ratedAtClockH: 9 }), subj('b', '2026-10-05T14:30:00Z', { hunger: 6, ratedAtClockH: 20 })])!;
    expect(two.observations!.filter((o) => o.scale === 'hunger').map((o) => o.clockH)).toEqual([9, 20]);
  });

  it('ten untimed ratings never form a bucket; a held-out fit worse than the personal mean is notInformative', () => {
    const untimed = Array.from({ length: 10 }, (_, k) => ({ day: k, rating: 5, index: 20 + 5 * k }));
    const u = calibrateHunger(untimed);
    expect(u.status).toBe('insufficient');
    expect(u.ratedAtHour).toBeNull();
    const pairs = [
      ...Array.from({ length: 7 }, (_, k) => ({ day: k, rating: 2 + 0.5 * k, index: 10 + 5 * k, ratedAtClockH: 9 })),
      ...[7, 8, 9].map((k) => ({ day: k, rating: 3.5, index: 10 + 5 * k, ratedAtClockH: 9 })),
    ];
    const c = calibrateHunger(pairs, { heldOutFromDay: 7 });
    expect(c.status).toBe('notInformative');
    expect(c.heldOutMae!).toBeGreaterThan(c.baselineMae!);
    expect(c.baselineMean).toBeDefined();
  });
});

// ------------------------------------------------------------------------------------------- A1-057
describe('A1-057: raw energy availability reads the exercise channel’s coverage', () => {
  const D = addDays(START, 0); // a training day (prescribed session)
  const cost = { grossKcal: 520, ownRestKcal: 70, netAboveRestKcal: 450, displacedLifestyleKcal: null, incrementalKcal: null, method: 'compendiumMet' as const, source: 'estimated' as const };
  const session = (over: Record<string, unknown> = {}): LogEntry => ({ id: `ses${++seq}`, date: D, tz: TZ, source: src, kind: 'session', status: 'done', startH: 18, durationMin: 50, performed: [], stimulus: STIM, catalogueVersion: 'c', itemId: 'rtSession:0:0', ...over }) as LogEntry;

  it('a prescribed session without a log is unknown exercise: no scalar, no zero', () => {
    const r = toLoggedDay(dayInput(D));
    expect(r.exercise).toMatchObject({ netAboveRestKcal: null, knownNetKcal: 0, coverage: 'unknown' });
    const read = rawEnergyAvailability({ intakeKcal: 2100, intakeCoverage: 'complete', netSessionKcal: r.exercise.netAboveRestKcal, exerciseCoverage: r.exercise.coverage, knownSessionKcal: r.exercise.knownNetKcal, ffmKg: 45, ffmBasis: 'model' });
    expect(read.ea.status).toBe('unknown');
    expect(read.ea.value).toBeUndefined();
    expect(read.upperBound).toBeCloseTo(2100 / 45, 9);
  });

  it('complete finite-cost exercise gives the formula; a known zero is explicit only; partial channels claim no false bound', () => {
    const done = toLoggedDay(dayInput(D, { entries: [session({ cost })] }));
    const full = rawEnergyAvailability({ intakeKcal: 2100, intakeCoverage: 'complete', netSessionKcal: done.exercise.netAboveRestKcal, exerciseCoverage: done.exercise.coverage, knownSessionKcal: done.exercise.knownNetKcal, ffmKg: 45, ffmBasis: 'measured' });
    expect(full.ea.value).toBeCloseTo((2100 - 450) / 45, 9);
    expect(rawEnergyAvailability({ intakeKcal: 2000, intakeCoverage: 'complete', netSessionKcal: 0, exerciseCoverage: 'confirmedZero', ffmKg: 50, ffmBasis: 'measured' }).ea.value).toBeCloseTo(40, 9);
    expect(rawEnergyAvailability({ intakeKcal: 1200, intakeCoverage: 'partial', netSessionKcal: 450, exerciseCoverage: 'complete', ffmKg: 45, ffmBasis: 'model' }).lowerBound).toBeCloseTo(750 / 45, 9);
    const both = rawEnergyAvailability({ intakeKcal: 1200, intakeCoverage: 'partial', netSessionKcal: null, exerciseCoverage: 'partial', knownSessionKcal: 450, ffmKg: 45, ffmBasis: 'model' });
    expect(both.lowerBound).toBeUndefined();
    expect(both.upperBound).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------- A1-057 (live ↔ core)
describe('A1-057: the living read and the engine EA coverage sidecar agree for the same realised day', () => {
  const D = addDays(START, 0); // a training day (prescribed session)
  const cost = { grossKcal: 520, ownRestKcal: 70, netAboveRestKcal: 450, displacedLifestyleKcal: null, incrementalKcal: null, method: 'compendiumMet' as const, source: 'estimated' as const };
  const session = (over: Record<string, unknown> = {}): LogEntry => ({ id: `ses${++seq}`, date: D, tz: TZ, source: src, kind: 'session', status: 'done', startH: 18, durationMin: 50, performed: [], stimulus: STIM, catalogueVersion: 'c', itemId: 'rtSession:0:0', ...over }) as LogEntry;
  const cases: Array<[string, LogEntry[], 'complete' | 'partial']> = [
    ['complete intake, prescribed session not logged', [], 'complete'],
    ['complete intake, session logged with its cost', [session({ cost })], 'complete'],
    ['partial intake, session logged with its cost', [session({ cost })], 'partial'],
    ['partial intake, prescribed session not logged', [], 'partial'],
  ];
  it.each(cases)('%s', (_name, entries, intake) => {
    const r = toLoggedDay(dayInput(D, { entries }));
    const live = rawEnergyAvailability({ intakeKcal: intake === 'complete' ? 2100 : 1200, intakeCoverage: intake, netSessionKcal: r.exercise.netAboveRestKcal, exerciseCoverage: r.exercise.coverage, knownSessionKcal: r.exercise.knownNetKcal, ffmKg: 45, ffmBasis: 'model' });
    // the engine reads the same realised day's channel coverage (the replay's DayInput.coverage)
    const h = makeHarness(ENGINE_MAN);
    h.day.coverage = { ...r.coverage, energy: intake };
    if (intake === 'partial') h.day.exposure = { energy: { knownSum: 1200, unit: 'kcal', coverage: 'partial' } };
    h.run({ ei: 2100, eee: 450, exMin: 50 }, 1);
    // a single EA value only where both say the exposure is covered; a known-intake lower bound only where both claim it
    expect(live.ea.value !== undefined).toBe(h.s.eaRawStatus === EA_STATUS.logged);
    expect(live.lowerBound !== undefined).toBe(h.s.eaRawKnownIsLowerBound === 1);
    if (r.exercise.coverage === 'unknown') expect(eaStatusToOutput(h.s.eaRawStatus)).not.toBe('estimated');
  });
});

// ------------------------------------------------------------------------------------------- A1-053
describe('A1-053: total asleep hours apart from the main episode’s timing; observed quality only as entered', () => {
  const D = addDays(START, 1);
  const sleep = (bed: string, wake: string, over: Record<string, unknown> = {}): LogEntry => ({ id: `sl${++seq}`, date: D, tz: TZ, source: src, kind: 'sleep', bedAt: bed, wakeAt: wake, ...over }) as LogEntry;

  it('5 h main + 1 h nap: known total 6 h, main timing 01:00–06:00, both episodes carried', () => {
    const r = toLoggedDay(dayInput(D, { entries: [sleep(at(D, 1), at(D, 6)), sleep(at(D, 14), at(D, 15), { episodeKind: 'nap' })] }));
    const s = r.loggedDay.inputs.sleep!;
    expect(s.bedH).toBeCloseTo(1, 9);
    expect(s.wakeH).toBeCloseTo(6, 9);
    expect(s.observedTotalHours).toBeCloseTo(6, 9);
    expect(s.observedEpisodes).toHaveLength(2);
    expect(s.observedEpisodes!.map((e) => e.kind)).toEqual(['main', 'nap']);
    expect(s.observedCoverage).toBe('complete');
  });

  it('a rated night carries its quality; an unrated observed night never inherits the planned poor quality', () => {
    const rated = toLoggedDay(dayInput(D, { entries: [sleep(at(addDays(D, -1), 23), at(D, 6), { quality: 'good' })] })).loggedDay.inputs.sleep!;
    expect(rated.quality).toBe('good');
    expect(rated.observed?.quality).toBe('good');
    const unrated = toLoggedDay(dayInput(D, { entries: [sleep(at(addDays(D, -1), 23), at(D, 6))] })).loggedDay.inputs.sleep!;
    expect(unrated.quality).toBeUndefined();
    expect(unrated.observed?.quality).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------- A1-031 / A1-029
describe('A1-031/A1-029: polyol identities and food ethanol travel with the observed meal', () => {
  const D = addDays(START, 1);
  const meal = (over: Record<string, unknown>): LogEntry => ({ id: `ml${++seq}`, date: D, tz: TZ, source: src, kind: 'meal', clockH: 12, components: [], totals: { energyKcal: { value: 240, sd: 10 }, proteinG: { value: 0, sd: 0 }, carbG: { value: 0, sd: 0 }, fatG: { value: 0, sd: 0 } }, ...over }) as LogEntry;

  it('maltitol and an identity-unknown polyol total keep their identities beside the reported energy', () => {
    const comp = (per100g: Record<string, number>) => ({ name: 'sweet', grams: { value: 100, sd: 0 }, nutrients: { energyKcal: { value: 240, sd: 0 }, proteinG: { value: 0, sd: 0 }, carbG: { value: 0, sd: 0 }, fatG: { value: 0, sd: 0 } }, nutrientSource: 'label', snapshot: { source: 'label', per100g } });
    const named = toLoggedDay(dayInput(D, { entries: [meal({ components: [comp({ energyKcal: 240, carbG: 0, polyolsG: 100, 'polyolG:maltitol': 100 })] })] }));
    const spec = named.loggedDay.inputs.meals!.meals!.find((m) => m.eventId !== undefined)!;
    expect(spec.polyolsG).toEqual({ maltitol: 100 });
    expect(spec.energyKcal).toBe(240);
    const anon = toLoggedDay(dayInput(D, { entries: [meal({ components: [comp({ energyKcal: 240, carbG: 0, polyolsG: 60 })] })] }));
    expect(anon.loggedDay.inputs.meals!.meals!.find((m) => m.eventId !== undefined)!.polyolsG).toEqual({ unidentified: 60 });
  });

  it('a food drink with 14 g ethanol at 12:00 and an explicit extra 14 g drink at 16:00 both reach the replay at their own times', () => {
    const drink = meal({ totals: { energyKcal: { value: 98, sd: 0 }, proteinG: { value: 0, sd: 0 }, carbG: { value: 0, sd: 0 }, fatG: { value: 0, sd: 0 }, alcoholG: { value: 14, sd: 0 } } });
    const extra = { id: 'beer', date: D, tz: TZ, source: src, kind: 'substance', substance: 'alcohol', clockH: 16, amount: 14, unit: 'g', extra: true } as LogEntry;
    const t = toLoggedDay(dayInput(D, { entries: [drink, extra] })).loggedDay.inputs;
    expect(t.meals!.meals!.find((m) => m.eventId === drink.id)!.macros?.alcoholG).toBe(14);
    expect(t.substances?.alcohol).toEqual([expect.objectContaining({ clockH: 16, drinks: 1, eventId: 'beer' })]);
  });
});

// ------------------------------------------------------------------------------------------- end to end through the compiler
describe('A1-029/A1-053: the realised day reaches the compiled day intact', () => {
  const D1 = addDays(START, 1);
  const D3 = addDays(START, 3);
  const compiledDay = (entries: LogEntry[], day: number) => {
    const { plan, version } = planWith(schedOf([DAY], Array(14).fill(0)));
    const docs: LivingDocs = { plan, versions: [version], dayStatus: [{ date: D1, intake: 'complete' }], entries, measurements: [], records: [] };
    const p = projectLiving({ docs, today: D3, tz: TZ, now: at(D3, 10), skipAssimilation: true });
    return compileVersion(MAN, projectionSchedule(p, D3)!).days[day]!;
  };

  it('food ethanol 14 g at 12:00 plus an explicit extra 14 g drink at 16:00 compile to 28 g', () => {
    const drink = { id: 'wine', date: D1, tz: TZ, source: src, kind: 'meal', clockH: 12, components: [], totals: { energyKcal: { value: 98, sd: 0 }, proteinG: { value: 0, sd: 0 }, carbG: { value: 0, sd: 0 }, fatG: { value: 0, sd: 0 }, alcoholG: { value: 14, sd: 0 } } } as LogEntry;
    const extra = { id: 'beer', date: D1, tz: TZ, source: src, kind: 'substance', substance: 'alcohol', clockH: 16, amount: 14, unit: 'g', extra: true } as LogEntry;
    const d = compiledDay([drink, extra], 1);
    expect(d.alcoholG).toBeCloseTo(28, 6);
  });

  it('5 h main + 1 h nap compile to a 6 h known total with the main episode’s 5 h timing', () => {
    const sl = (id: string, bed: string, wake: string, over: Record<string, unknown> = {}) => ({ id, date: D1, tz: TZ, source: src, kind: 'sleep', bedAt: bed, wakeAt: wake, ...over }) as LogEntry;
    const d = compiledDay([sl('main', at(D1, 1), at(D1, 6)), sl('nap', at(D1, 14), at(D1, 15), { episodeKind: 'nap' })], 1);
    expect(d.sleepEndingToday?.hours).toBeCloseTo(5, 6);
    expect(d.sleepEndingToday?.totalAsleepHours).toBeCloseTo(6, 6);
  });
});

// ------------------------------------------------------------------------------------------- A1-022
describe('A1-022: an unknown hard-set count is never full parity or a reported dose', () => {
  const D = addDays(START, 0);
  const minutesOnly: StimulusVector = { ...STIM, doseStatus: 'unknown', outcomeDoseStatus: { hypertrophy: 'unknown', strength: 'unknown', energy: 'reported' }, unknownDoseScenario: 'legacyMinuteConversion' };
  const log = (stimulus: StimulusVector, performed: unknown[] = [{ exerciseId: 'surya_namaskar', minutes: 30 }]): LogEntry =>
    ({ id: `ses${++seq}`, date: D, tz: TZ, source: src, kind: 'session', status: 'done', startH: 18, durationMin: 30, performed, stimulus, catalogueVersion: 'c', itemId: 'rtSession:0:0' }) as LogEntry;

  it('minutes-only resistance work leaves muscle completion unknown and replays a named unknown-dose scenario', () => {
    const r = toLoggedDay(dayInput(D, { entries: [log(minutesOnly)] }));
    const item = r.loggedDay.items.find((x) => x.type === 'rtSession')!;
    expect(item.status).not.toBe('done');
    expect(item.credit).toBeNull();
    expect(r.assumptions).toContainEqual({ kind: 'prescriptionReplay', reasonCode: 'sessionDose:unknown' });
    const rt = r.loggedDay.inputs.exercise!.find((e) => e.kind === 'resistance')!;
    expect(rt).toMatchObject({ doseStatus: 'unknown', unknownDoseScenario: 'legacyMinuteConversion' });
  });

  it('reported hard bouts restore a quantitative completion', () => {
    const r = toLoggedDay(dayInput(D, { entries: [log({ ...STIM, doseStatus: 'reported' }, [{ exerciseId: 'goblet_squat', setCount: 5 }])] }));
    const item = r.loggedDay.items.find((x) => x.type === 'rtSession')!;
    expect(item.credit).not.toBeNull();
    expect(item.status).toBe('done');
  });
});

// ------------------------------------------------------------------------------------------- A1-005
describe('A1-005: the current exercise eligibility overlays unperformed recommendations', () => {
  const symptom = (status: SymptomReport['status'], id = 'sym1'): LogEntry => ({ id, date: START, tz: TZ, source: src, kind: 'subjective', recordedAt: `${START}T08:00:00.000Z`, symptom: { category: 'exertionalChestDiscomfort', status, context: 'exertional' } }) as LogEntry;
  const withBaseline = (steps: number | null, envelopes: ClinicianExerciseEnvelope[] = []): PersonProfile => ({
    ...MAN, ...(steps !== null ? { habits: { ...MAN.habits, typicalSteps: steps } } : { habits: { sessionsPerWeek: 3 } }), safety: { mode: 'M0', flags: { exerciseEnvelopes: envelopes } },
  });

  it('an unresolved exertional symptom caps the 9000 step target at the documented 6000 and holds new sessions', () => {
    const e = currentExerciseEligibility({ profile: withBaseline(6000), entries: [symptom('new')], asOf: START, prescribedSteps: 9000 });
    expect(e).toMatchObject({ status: 'suspended', allowsNewExercise: false, steps: { status: 'capped', target: 6000, prescribed: 9000, ceilingSource: 'documentedBaseline' } });
    expect(e.held).toEqual(expect.arrayContaining(['resistance', 'cardio', 'steps']));
  });

  it('no documented baseline: no numeric step target is invented', () => {
    const e = currentExerciseEligibility({ profile: withBaseline(null), entries: [symptom('new')], asOf: START, prescribedSteps: 9000 });
    expect(e.steps).toMatchObject({ status: 'noNumericTarget', target: null, ceiling: null });
  });

  it('a covering current envelope restores exactly what it permits; a resolution restores everything; revocation holds again', () => {
    const env: ClinicianExerciseEnvelope = { id: 'env1', assessedAt: START, reviewBy: addDays(START, 7), permitted: ['walking', 'steps'], progressionAllowed: true, coversSymptomIds: ['sym1'], source: 'selfEnteredClinician' };
    const covered = currentExerciseEligibility({ profile: withBaseline(6000, [env]), entries: [symptom('new')], asOf: START, prescribedSteps: 9000 });
    expect(covered).toMatchObject({ status: 'envelope', envelopeId: 'env1', steps: { status: 'unchanged', target: 9000 } });
    expect(covered.held).toEqual(expect.arrayContaining(['resistance', 'cardio']));
    expect(covered.permitted).toEqual(expect.arrayContaining(['walking', 'steps']));
    const resolved = currentExerciseEligibility({ profile: withBaseline(6000), entries: [symptom('new'), { ...symptom('resolved', 'sym2'), recordedAt: `${START}T09:00:00.000Z` } as LogEntry], asOf: START, prescribedSteps: 9000 });
    expect(resolved).toMatchObject({ status: 'clear', held: [], steps: { status: 'unchanged', target: 9000 } });
    const overdue = currentExerciseEligibility({ profile: withBaseline(6000, [env]), entries: [symptom('new')], asOf: addDays(START, 9), prescribedSteps: 9000 });
    expect(overdue).toMatchObject({ status: 'suspended', reasonCode: 'envelopeNeedsReview', steps: { status: 'capped', target: 6000 } });
  });

  it('Today shows the overlaid steps with a Review status on a steps-only day; the adopted snapshot is unchanged', () => {
    const { plan, version } = planWith(schedOf([DAY], Array(14).fill(0)), withBaseline(6000));
    const rx = freezePrescription({ plan, version, date: START, tz: TZ });
    const e = currentExerciseEligibility({ profile: withBaseline(6000), entries: [symptom('new')], asOf: START, prescribedSteps: rx.steps ?? null });
    expect(overlayPrescription(rx, e).steps).toBe(6000);
    expect(rx.steps).toBe(9000);
    const view = buildTodayView({
      date: START, tz: TZ, rolloverH: 4, quietMode: false, minimalMode: false, now: at(START, 10), plan, version, prescription: rx, entries: [], measurements: [], status: null, logged: null,
      trend: adherenceTrend([], START), drift: null, trendWeight: null, forecastToday: null, checkIn: { due: false, lastAt: null }, lapse: { welcomeBack: false, gap: [] }, exerciseEligibility: e,
    });
    expect(view.prescription?.steps).toBe(6000);
    expect(view.exerciseEligibility?.steps.prescribed).toBe(9000);
    expect(view.notices).toContainEqual(expect.objectContaining({ id: 'stepsHold', kind: 'safety', text: 'Review: steps up to 6000/day.' }));
    expect(view.checklist.some((c) => c.kind === 'steps')).toBe(true);
  });

  it('the projection applies it at once after a logged symptom, and on the day a scheduled plan becomes due', () => {
    const profile = withBaseline(6000);
    const { plan, version } = planWith(schedOf([DAY], Array(14).fill(0)), profile);
    const docs: LivingDocs = { plan, versions: [version], dayStatus: [], entries: [symptom('new')], measurements: [], records: [] };
    const p = projectLiving({ docs, today: START, tz: TZ, now: at(START, 10), skipAssimilation: true });
    expect(p.today.prescription?.steps).toBe(6000);
    expect(p.today.notices.some((n) => n.id === 'stepsHold')).toBe(true);
    // the realised history keeps the adopted prescription: the overlay never rewrites what a day asked for
    expect(p.days.find((d) => d.date === START)!.prescription.steps).toBe(9000);
    const free = projectLiving({ docs: { ...docs, entries: [] }, today: START, tz: TZ, now: at(START, 10), skipAssimilation: true });
    expect(free.today.prescription?.steps).toBe(9000);
    expect(free.today.notices.some((n) => n.id === 'stepsHold')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------- A1-017
describe('A1-017: the living projection replays the CURRENT anchors after a retracted composition reading', () => {
  const ME: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 92 }, habits: { typicalSteps: 7000, sessionsPerWeek: 3 }, startDate: START };
  const T: DayTemplate = { id: 'A', label: 'day', energy: { kind: 'pctMaintenance', pct: 80 }, macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'g', value: 180 }, fat: { unit: 'remainder' } }, meals: { count: 3, window: { startH: 8, lengthH: 12 } }, steps: 9000 };
  const S = schedOf([T], Array(42).fill(0));
  const { plan, version } = planWith(S, ME);
  const dateOf = (d: number) => addDays(START, d);
  const truth = runReplay({ profile: ME, schedule: S, intakeOffsets: [{ fromDay: 0, kcal: -200 }] });
  const weights: MeasurementEntry[] = Array.from({ length: 28 }, (_, d) => ({ id: `w${d}`, date: dateOf(d), metric: 'weightKg', value: Math.round(truth.scaleWakeKg[d]! * 10) / 10, context: 'morningFasted', source: src }) as MeasurementEntry);
  const dxa = { id: 'dxa1', date: dateOf(13), metric: 'bodyFatPct', value: 16, method: 'dxa', scanMassKg: 92, source: src } as MeasurementEntry;
  const retract = { id: 'r1', date: dateOf(13), metric: 'bodyFatPct', value: 16, kind: 'retract', target: 'dxa1', source: src } as unknown as MeasurementEntry;
  const record = (ms: MeasurementEntry[]) => {
    const composition = compositionReadingsFor(plan, ms);
    return weeklyCheckIn({ plan, schedule: S, records: [], weighIns: weighInsFor(plan, ms, []).filter((w) => w.day <= 14), today: dateOf(14), intakeDays: Array.from({ length: 14 }, (_, d) => d), ...(composition ? { composition } : {}), decisionId: 'd14' }).record!;
  };

  it('a retraction after the confirmation refits the anchor in the daily replay; the original record stays as it was', () => {
    const r14 = record([...weights, dxa]);
    const clean14 = record(weights);
    expect(r14.residualSplit.source).toBe('dxa');
    const frozen = JSON.stringify(r14);
    const today = dateOf(21);
    const live = projectLiving({ docs: { plan, versions: [version], dayStatus: [], entries: [], measurements: [...weights, dxa, retract], records: [r14] }, today, tz: TZ, now: at(today, 10) });
    const clean = projectLiving({ docs: { plan, versions: [version], dayStatus: [], entries: [], measurements: weights, records: [clean14] }, today, tz: TZ, now: at(today, 10) });
    expect(live.assimilation!.current.invalidFrom).toBe(14);
    expect(live.assimilation!.replay.fatKg[20]!).toBeCloseTo(clean.assimilation!.replay.fatKg[20]!, 3);
    expect(JSON.stringify(r14)).toBe(frozen);
  });
});

