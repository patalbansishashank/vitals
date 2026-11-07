// @vitest-environment node
/**
 * W1-history: the living package's contribution to D1-06, D2-06, D2-08, D3-02, D3-06, D3-07, D3-09, D5-03, D5-04, D5-07,
 * D6-03, D6-06, D6-07, D7-04, D8-02, D8-04, D8-06 and D8-09 — observation semantics of the day reduction (sleep at the wake
 * date, steps/session overlap, logged-session energy, dose provenance, actives, nutrients, amount methods), the check-in's
 * correction ledger and estimator identity, composition observations, band semantics of drift/start/re-plan and the
 * observed-wellbeing readers. Engine-free except where a pure engine helper is the subject.
 */
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { StimulusVector } from '@/catalogues';
import { ASSIMILATION_DEFAULTS, assimilationParams } from '@/engine/assimilation';
import { ketoneSamples, observationSampleTime } from '@/engine/assimilation/realised';
import { bandMetaFor, type ExposureQuantity, type SupplementProduct } from '@/lib/bodyContracts';
import { freezePrescription, DEFAULT_ITEM_WEIGHTS } from '../prescription';
import { observedSleep, toLoggedDay, type LoggedDayInput } from '../loggedDay';
import { catalogueEquivalence, stimulusHasWork, withCreditInvariants, type EquivalenceFn } from '../equivalence';
import { ADHERENCE_SCORING_VERSION, BETA_PRIOR, BEHAVIOUR_PRIOR_SEMANTICS, scoreDay } from '../adherence';
import { amountMethodOf, LOG_BAND_META, mealTotals, summarise } from '../logs';
import {
  appliedCorrectionLedger,
  checkInCorrection,
  COMPOSITION_ASSIMILATION_ENABLED,
  compositionObservations,
  estimatorIdentity,
  compositionReadingsFor,
  intakeEvidenceOf,
  linearCorrectionDiagnostic,
  realisedSchedule,
  weighInIds,
} from '../assimilate';
import { bandIsReadable, driftGoal } from '../drift';
import { evaluateTriggers, missedInARow, versionFromReplan, type TriggerInputs } from '../replan';
import { calibrateHunger, rawEnergyAvailability, wellbeingSummary } from '../wellbeing';
import { localToInstant } from '../dates';
import { templateOfDay } from '../prescription';
import type { ItemOutcome, ReplanResult } from '../plannerContract';
import type { ConfirmedStateRecord, LogEntry, MeasurementEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from '../types';

const TZ = 'Asia/Kolkata';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: '2026-10-05' };
const TRAIN: DayTemplate = {
  id: 'A', label: 'training day', energy: { kind: 'kcal', kcal: 2000 },
  macros: { protein: { unit: 'g', value: 160 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 9, lengthH: 10 } }, exercise: [{ kind: 'resistance', startH: 18, durationMin: 50, setsByRegion: { quads: 6, glutes: 3, chest: 6 } }],
  steps: 9000, sleep: { bedH: 23, wakeH: 7, quality: 'good' },
};
const REST: DayTemplate = { ...TRAIN, id: 'R', label: 'rest day', exercise: [] };
const SCHED: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 14, programs: [TRAIN, REST], days: Array.from({ length: 14 }, (_, d) => ({ program: d % 2 })) };
const STIM: StimulusVector = { effectiveSetsByRegion: { quads: 6, glutes: 3, chest: 6 }, pattern: 'squat', loadClass: 'moderate', netKcal: 150, mem: 0, hiMinutes: 0, mobilityMinutes: {} };
const EMPTY: StimulusVector = { effectiveSetsByRegion: {}, pattern: 'squat', loadClass: 'moderate', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} };

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
  return { ...r, sessions: r.sessions.map((s) => ({ ...s, stimulus: STIM })) };
}

let seq = 0;
const src = { by: 'user' as const, method: 'typed' as const };
const est = (v: number, f = 0.08) => ({ value: v, sd: v * f });
function meal(date: string, clockH: number, kcal: number, protein: number, over: Partial<Extract<LogEntry, { kind: 'meal' }>> = {}): LogEntry {
  return {
    id: `m${++seq}`, date, tz: TZ, at: localToInstant(date, clockH, TZ), source: src, kind: 'meal', clockH, components: [],
    totals: { energyKcal: est(kcal), proteinG: est(protein), carbG: est(((kcal - 4 * protein) * 0.5) / 4), fatG: est(((kcal - 4 * protein) * 0.5) / 9), fibreG: est(8) },
    ...over,
  } as LogEntry;
}
const base = (date: string, over: Partial<LoggedDayInput> = {}): LoggedDayInput => ({
  date, planStart: plan.startDate, tz: TZ, prescription: rx(date), entries: [], expected: () => 0.75, equivalence: catalogueEquivalence, final: true, ...over,
});
const sleep = (date: string, bedAt: string, wakeAt: string, over: Partial<Extract<LogEntry, { kind: 'sleep' }>> = {}): LogEntry =>
  ({ id: `s${++seq}`, date, tz: TZ, source: src, kind: 'sleep', bedAt, wakeAt, ...over }) as LogEntry;

// ------------------------------------------------------------------------------------------- D8-06 sleep
describe('D8-06: observed sleep maps to its wake date', () => {
  it('a short night ending Tuesday sets Tuesday (its episode, its hours); a planned quality never stands in for an unrated night', () => {
    const tue = '2026-10-06';
    const r = toLoggedDay(base(tue, { entries: [sleep(tue, '2026-10-06T00:30:00+05:30', '2026-10-06T04:30:00+05:30')] }));
    const s = r.loggedDay.inputs.sleep!;
    expect(s.hours).toBeCloseTo(4, 9);
    expect(s.observed).toMatchObject({ bedAt: '2026-10-06T00:30:00+05:30', wakeAt: '2026-10-06T04:30:00+05:30', kind: 'main' });
    expect(s.quality).toBeUndefined();
    expect(s.observed!.quality).toBeUndefined();
    expect(r.coverage.sleep).toBe('complete');
    expect(r.sleep?.hours).toBeCloseTo(4, 9);
    // the next day (no log) keeps its planned night with the starting-date convention
    const wed = toLoggedDay(base('2026-10-07'));
    expect(wed.loggedDay.inputs.sleep).toEqual(TRAIN.sleep);
    expect(wed.coverage.sleep).toBe('unknown');
  });

  it('overlapping or duplicated episodes count once; a nap adds asleep time without moving the main episode', () => {
    const d = '2026-10-06';
    const main = sleep(d, '2026-10-05T23:00:00+05:30', '2026-10-06T07:00:00+05:30', { quality: 'fair', restfulness: 6 });
    const dup = sleep(d, '2026-10-06T01:00:00+05:30', '2026-10-06T06:00:00+05:30');
    const nap = sleep(d, '2026-10-06T14:00:00+05:30', '2026-10-06T14:30:00+05:30', { episodeKind: 'nap' });
    const o = observedSleep([main, dup, nap] as Array<Extract<LogEntry, { kind: 'sleep' }>>)!;
    expect(o.hours).toBeCloseTo(8.5, 9);
    expect(o.main).toMatchObject({ entryId: main.id, quality: 'fair', restfulness: 6 });
    expect(o.episodes).toBe(3);
    const r = toLoggedDay(base(d, { entries: [main, dup, nap] }));
    expect(r.loggedDay.inputs.sleep!.hours).toBeCloseTo(8.5, 9);
    expect(r.loggedDay.inputs.sleep!.quality).toBe('fair');
    // the logged duration is never decremented by a modelled caffeine effect
    const caf = { id: 'caf', date: d, tz: TZ, source: src, kind: 'substance', substance: 'caffeine', clockH: 21, amount: 300, unit: 'mg' } as LogEntry;
    expect(toLoggedDay(base(d, { entries: [main, caf] })).loggedDay.inputs.sleep!.hours).toBeCloseTo(8, 9);
  });

  it('a nap alone is partial: the night stays the prescription (a named scenario), the nap travels as logged, nothing is invented', () => {
    const d = '2026-10-06';
    const r = toLoggedDay(base(d, { entries: [sleep(d, '2026-10-06T14:00:00+05:30', '2026-10-06T15:00:00+05:30', { episodeKind: 'nap' })] }));
    expect(r.coverage.sleep).toBe('partial');
    // (A1-053) the planned night's timing stays; the known nap dose is carried, partial, never a full night
    expect(r.loggedDay.inputs.sleep).toMatchObject({ ...TRAIN.sleep, observedCoverage: 'partial', observedTotalHours: 1 });
    expect(r.loggedDay.inputs.sleep?.observedEpisodes).toHaveLength(1);
    expect(r.assumptions).toContainEqual({ kind: 'prescriptionReplay', reasonCode: 'sleepMainUnknown' });
  });

  it("today's observed night initialises today in the realised schedule; the rest of today and the future stay prescribed", () => {
    const today = '2026-10-07';
    const past = ['2026-10-05', '2026-10-06'].map((d) => toLoggedDay(base(d)));
    const cur = toLoggedDay(base(today, { entries: [sleep(today, '2026-10-07T01:00:00+05:30', '2026-10-07T06:00:00+05:30')] }));
    const s = realisedSchedule(plan, version, past, today, undefined, { current: cur });
    const t2 = templateOfDay(s, 2);
    expect(t2.sleep?.hours).toBeCloseTo(5, 9);
    expect(t2.sleep?.observed?.wakeAt).toBe('2026-10-07T06:00:00+05:30');
    expect(t2.energy).toEqual(TRAIN.energy);
    expect(templateOfDay(s, 3).sleep).toEqual(REST.sleep);
    // no observed night today: today stays exactly the head's day
    const plain = realisedSchedule(plan, version, past, today, undefined, { current: toLoggedDay(base(today)) });
    expect(templateOfDay(plain, 2)).toEqual(templateOfDay(SCHED, 2));
  });
});

// ------------------------------------------------------------------------------------------- D3-07 steps overlap, D8-04 net energy
describe('D3-07/D8-04: one exercise ledger on observed days', () => {
  const session = (date: string, over: Partial<Extract<LogEntry, { kind: 'session' }>> = {}): LogEntry =>
    ({ id: `x${++seq}`, date, tz: TZ, source: src, kind: 'session', status: 'done', startH: 18, durationMin: 40, performed: [], stimulus: STIM, catalogueVersion: 'c', itemId: 'rtSession:0:0', ...over }) as LogEntry;
  const steps = (date: string, n: number, scope?: 'totalDay' | 'excludesTraining' | 'unknown'): LogEntry => ({ id: `st${++seq}`, date, tz: TZ, source: src, kind: 'steps', steps: n, ...(scope ? { scope } : {}) }) as LogEntry;

  it('total-day steps lose the logged sessions’ included steps from the step ledger only; an excludes-training count is never reduced', () => {
    const d = '2026-10-05';
    const total = toLoggedDay(base(d, { entries: [session(d, { stepsIncluded: 3000 }), steps(d, 12000, 'totalDay')] }));
    expect(total.loggedDay.inputs.steps).toBe(12000);
    expect(total.loggedDay.inputs.stepsScope).toBe('totalDay');
    expect(total.loggedDay.inputs.sessionIncludedSteps).toBe(3000);
    const excl = toLoggedDay(base(d, { entries: [session(d, { stepsIncluded: 3000 }), steps(d, 9000, 'excludesTraining')] }));
    expect(excl.loggedDay.inputs.steps).toBe(9000);
    expect(excl.loggedDay.inputs.sessionIncludedSteps).toBeUndefined();
  });

  it('an unknown scope with a logged session is one named overlap assumption, never a guessed overlap', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [session(d), steps(d, 11000)] }));
    expect(r.loggedDay.inputs.sessionIncludedSteps).toBeUndefined();
    expect(r.assumptions.filter((a) => a.reasonCode === 'stepsSessionOverlapUnknown')).toHaveLength(1);
    expect(r.resolution).toBe('scenario');
  });

  it('net-above-rest session energy is known only when every logged session states it; a missing cost is unknown, not zero', () => {
    const d = '2026-10-05';
    const cost = { grossKcal: 400, ownRestKcal: 60, netAboveRestKcal: 340, displacedLifestyleKcal: null, incrementalKcal: null, method: 'compendiumMet' as const, source: 'estimated' as const };
    expect(toLoggedDay(base(d, { entries: [session(d, { cost })] })).exercise).toEqual({ netAboveRestKcal: 340, logged: 1, withCost: 1, knownNetKcal: 340, coverage: 'complete', plannedItemsResolved: true, sensorCoverage: 'unknown', attestation: null });
    const mixed = toLoggedDay(base(d, { entries: [session(d, { cost }), session(d, { itemId: undefined, startH: 7 })] }));
    expect(mixed.exercise.netAboveRestKcal).toBeNull();
    expect(mixed.exercise.withCost).toBe(1);
    // (A1-057) the known sum of the logged finite costs stays apart from the day's complete expenditure
    expect(mixed.exercise.knownNetKcal).toBe(340);
  });
});

// ------------------------------------------------------------------------------------------- D3-09 dose provenance
describe('D3-09: inferred or unknown doses are named assumptions', () => {
  it('a minutes-only or inferred session dose makes the day a scenario with the dose status named', () => {
    const d = '2026-10-05';
    const log = { id: 'flow', date: d, tz: TZ, source: src, kind: 'session', status: 'done', startH: 7, durationMin: 30, performed: [], stimulus: { ...EMPTY, mem: 20, netKcal: 90 }, catalogueVersion: 'c', doseStatus: 'unknown' } as LogEntry;
    const r = toLoggedDay(base(d, { entries: [log] }));
    expect(r.assumptions.some((a) => a.reasonCode === 'sessionDose:unknown')).toBe(true);
    expect(r.resolution).toBe('scenario');
    // reported doses add no assumption of their own
    const rep = toLoggedDay(base(d, { entries: [{ ...log, id: 'rep', doseStatus: 'reported', engine: [{ kind: 'cardio', modality: 'run', startH: 7, durationMin: 30 }] } as LogEntry] }));
    expect(rep.assumptions.some((a) => a.reasonCode.startsWith('sessionDose:'))).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------- D3-02 equivalence port
describe('D3-02: practice completion through the equivalence port', () => {
  it('zero performed work against a prescription with work is credit 0, never parity; credits stay finite in [0, 1]', () => {
    expect(stimulusHasWork(EMPTY)).toBe(false);
    expect(stimulusHasWork(STIM)).toBe(true);
    expect(catalogueEquivalence(STIM, EMPTY)).toMatchObject({ credit: 0, parity: false });
    const wild: EquivalenceFn = () => ({ credit: Number.NaN, parity: true, shortfall: [] });
    expect(withCreditInvariants(wild)(STIM, STIM)).toMatchObject({ credit: 0, parity: false });
    const over: EquivalenceFn = () => ({ credit: 1.7, parity: true, shortfall: [] });
    expect(withCreditInvariants(over)(STIM, STIM).credit).toBe(1);
    expect(catalogueEquivalence(STIM, STIM).credit).toBeCloseTo(1, 9);
  });

  it('scores carry their scoring version (recomputed history is told apart from stored scores)', () => {
    const s = scoreDay([{ itemId: 'energy', type: 'energy', weight: 1, target: {} }], [{ itemId: 'energy', credit: 1, why: '' }], { final: true });
    expect(s.scoringVersion).toBe(ADHERENCE_SCORING_VERSION);
  });
});

// ------------------------------------------------------------------------------------------- D2-06, D8-09, D8-04 wellbeing
describe('D2-06/D8-04/D8-09: observed ratings and concern flags', () => {
  const subj = (date: string, over: Partial<Extract<LogEntry, { kind: 'subjective' }>>): LogEntry => ({ id: `w${++seq}`, date, tz: TZ, source: src, kind: 'subjective', at: `${date}T10:00:00Z`, ...over }) as LogEntry;

  it('ratings are kept as entered, apart from completion; an unrated day is null (never zero hunger or "fine")', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [subj(d, { hunger: 7, fullness: 2, craving: 5, ratedAtClockH: 11, fatigue: 8, concerns: ['persistentFatigue'] })] }));
    expect(r.observedWellbeing).toMatchObject({ hunger: 7, fullness: 2, craving: 5, ratedAtClockH: 11, fatigue: 8, concerns: ['persistentFatigue'] });
    // completion is untouched by a hunger rating
    expect(r.score.items.find((i) => i.itemId === 'energy')?.credit).toBeNull();
    expect(toLoggedDay(base(d)).observedWellbeing).toBeNull();
  });

  it('a flagged concern reads Review whatever the model says; ratings without a flag read no flag; nothing logged is unknown', () => {
    const days = [
      { date: '2026-10-05', observed: { concerns: ['injury' as const], entryIds: ['a'], fatigue: 3 } },
      { date: '2026-10-07', observed: { concerns: ['injury' as const], entryIds: ['b'] } },
      { date: '2026-10-08', observed: { concerns: [], entryIds: ['c'], mood: 6 } },
    ];
    const s = wellbeingSummary(days, '2026-10-08');
    expect(s.status).toBe('review');
    expect(s.concerns).toEqual([{ concern: 'injury', days: 2, lastDate: '2026-10-07', persistent: true }]);
    expect(s.latest.mood).toEqual({ value: 6, date: '2026-10-08' });
    expect(wellbeingSummary([days[2]!], '2026-10-08').status).toBe('noFlag');
    expect(wellbeingSummary([], '2026-10-08').status).toBe('unknown');
    // outside the window it no longer shows
    expect(wellbeingSummary(days, '2026-11-08').status).toBe('unknown');
  });

  it('hunger calibration: fitted on earlier days, scored on later ones in rating points; ratings at other hours are not pooled', () => {
    const pairs = Array.from({ length: 12 }, (_, k) => ({ day: k, index: 20 + 5 * k, rating: Math.min(10, 1 + 0.5 * k), ratedAtClockH: 11 }));
    const noise = [{ day: 3, index: 90, rating: 0, ratedAtClockH: 20 }, { day: 5, index: 10, rating: 10, ratedAtClockH: 20 }];
    const c = calibrateHunger([...pairs, ...noise]);
    expect(c.status).toBe('calibrated');
    expect(c.ratedAtHour).toBe(11);
    expect(c.train + c.heldOut).toBe(12);
    expect(c.heldOut).toBeGreaterThanOrEqual(2);
    expect(c.b!).toBeGreaterThan(0);
    expect(c.heldOutMae!).toBeLessThan(c.baselineMae!);
    expect(calibrateHunger(pairs.slice(0, 4)).status).toBe('insufficient');
  });

  it('there is no probability of sticking with the plan: the behaviour posterior is a labelled decision prior', () => {
    expect(BEHAVIOUR_PRIOR_SEMANTICS).toEqual({ kind: 'decisionPrior', calibration: 'heuristic', observable: 'itemCompletion' });
    expect(BETA_PRIOR.a / (BETA_PRIOR.a + BETA_PRIOR.b)).toBeCloseTo(0.75, 9);
  });

  it('raw energy availability is unclipped, needs every input, and says what it is', () => {
    const extreme = rawEnergyAvailability({ intakeKcal: 0, intakeCoverage: 'confirmedZero', netSessionKcal: 900, ffmKg: 60, ffmBasis: 'measured' });
    expect(extreme.ea).toMatchObject({ status: 'estimated', value: -15, unit: 'kcal/kg FFM/day' });
    const high = rawEnergyAvailability({ intakeKcal: 5000, intakeCoverage: 'complete', netSessionKcal: 0, ffmKg: 60, ffmBasis: 'model' });
    expect(high.ea.value).toBeCloseTo(83.333, 2);
    expect(high.ea.status).toBe('scenario');
    expect(rawEnergyAvailability({ intakeKcal: null, intakeCoverage: 'unknown', netSessionKcal: 0, ffmKg: 60, ffmBasis: 'measured' }).ea.status).toBe('unknown');
    const partial = rawEnergyAvailability({ intakeKcal: 1200, intakeCoverage: 'partial', netSessionKcal: 300, ffmKg: 60, ffmBasis: 'measured' });
    expect(partial.ea.status).toBe('partial');
    expect(partial.ea.value).toBeUndefined();
    expect(partial.lowerBound).toBeCloseTo(15, 9);
    expect(rawEnergyAvailability({ intakeKcal: 2000, intakeCoverage: 'complete', netSessionKcal: null, ffmKg: 60, ffmBasis: 'measured' }).ea.status).toBe('unknown');
    expect(rawEnergyAvailability({ intakeKcal: 2000, intakeCoverage: 'complete', netSessionKcal: 0, ffmKg: 0, ffmBasis: 'measured' }).ea.status).toBe('unavailable');
  });
});

// ------------------------------------------------------------------------------------------- D7-04 actives
describe('D7-04: active-ingredient exposure from label arithmetic', () => {
  const fishOil: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'epaDha', amount: 500, unit: 'mg', basis: 'epaDha' }] };
  const unknownD: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitD', amount: null, unit: 'ug', basis: 'asLabelled' }] };
  const weeklyD: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitD', amount: 1250, unit: 'ug', basis: 'asLabelled' }] };
  const supp = (date: string, supplementId: string, product: SupplementProduct, servings: number, over: Partial<Extract<LogEntry, { kind: 'supplement' }>> = {}): LogEntry =>
    ({ id: `sp${++seq}`, date, tz: TZ, source: src, kind: 'supplement', supplementId, dose: servings, unit: 'capsule', servings, product, clockH: 9, ...over }) as LogEntry;

  it('2 capsules × 500 mg EPA+DHA = 1 g, replayed as an observed active dose', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [supp(d, 'fishOil', fishOil, 2)] }));
    expect(r.actives.epaDha).toMatchObject({ unit: 'g', knownDaily: 1, peakBolus: 1, events: 1, unknownEvents: 0 });
    expect(r.loggedDay.inputs.substances?.actives).toEqual([expect.objectContaining({ ingredient: 'epaDha', amount: 1, unit: 'g', origin: 'observed' })]);
  });

  it('unknown potency is a valid log with no number (supplements coverage partial), never zero or passed', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [supp(d, 'vitD', unknownD, 10)] }));
    expect(r.actives.vitD).toMatchObject({ knownDaily: 0, events: 1, unknownEvents: 1 });
    expect(r.loggedDay.inputs.substances?.actives ?? []).toEqual([]);
    expect(r.coverage.supplements).toBe('partial');
  });

  it('a weekly bolus keeps its peak (never divided by seven); two products of one ingredient aggregate', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [supp(d, 'weeklyD', weeklyD, 1), supp(d, 'dailyD', { ...weeklyD, actives: [{ ingredient: 'vitD', amount: 25, unit: 'ug', basis: 'asLabelled' }] }, 1)] }));
    expect(r.actives.vitD).toMatchObject({ unit: 'ug', knownDaily: 1275, peakBolus: 1250, events: 2 });
  });

  it('a planned active stays unless its item is replaced by a linked log; an unlinked log of that ingredient is unresolved', () => {
    const d = '2026-10-05';
    const p = rx(d);
    const withPlan = { ...p, template: { ...p.template, substances: { actives: [{ ingredient: 'epaDha', amount: 1, unit: 'g' as const, clockH: 9, eventId: 'supplement:fishOil', origin: 'planned' as const }] } } };
    const none = toLoggedDay(base(d, { prescription: withPlan }));
    expect(none.loggedDay.inputs.substances?.actives).toEqual([expect.objectContaining({ origin: 'planned' })]);
    const linked = toLoggedDay(base(d, { prescription: withPlan, entries: [supp(d, 'fishOil', fishOil, 1, { itemId: 'fishOil' })] }));
    expect(linked.loggedDay.inputs.substances?.actives?.map((a) => a.origin)).toEqual(['observed']);
    const loose = toLoggedDay(base(d, { prescription: withPlan, entries: [supp(d, 'fishOil2', fishOil, 1)] }));
    expect(loose.loggedDay.inputs.substances?.actives?.map((a) => a.origin)).toEqual(['observed']);
    expect(loose.alternatives.some((x) => x.id.endsWith(':epaDha'))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------- D6-03 nutrients, D6-06 methods/groups, D6-07 kinetics metadata
describe('D6-03/D6-06/D6-07: nutrients, amount methods and intake metadata travel', () => {
  const xq = (id: ExposureQuantity['id'], value: number | null, unit: ExposureQuantity['unit'], originEventId: string): ExposureQuantity => ({ id, value, unit, provenance: 'reported', coverage: value === null ? 'unknown' : 'complete', originEventId });

  it('equal macros with different known sodium and saturated fat replay differently on a complete day; unknown stays unknown', () => {
    const d = '2026-10-05';
    const mk = (na: number | null) => {
      const m = meal(d, 12, 2000, 150) as Extract<LogEntry, { kind: 'meal' }>;
      const id = m.id;
      return { ...m, exposures: [xq('energy', 2000, 'kcal', id), xq('protein', 150, 'g', id), xq('fat', 50, 'g', id), xq('satFat', 20, 'g', id), xq('sodium', na, 'mg', id)] } as LogEntry;
    };
    const lo = toLoggedDay(base(d, { entries: [mk(1000)], status: { date: d, intake: 'complete' } }));
    const hi = toLoggedDay(base(d, { entries: [mk(3000)], status: { date: d, intake: 'complete' } }));
    expect(lo.loggedDay.inputs.hydration?.sodiumG).toBeCloseTo(1, 9);
    expect(hi.loggedDay.inputs.hydration?.sodiumG).toBeCloseTo(3, 9);
    expect(lo.loggedDay.inputs.macros.fatTypes?.satShare).toBeCloseTo(0.4, 9);
    expect(lo.coverage.sodium).toBe('complete');
    const unk = toLoggedDay(base(d, { entries: [mk(null)], status: { date: d, intake: 'complete' } }));
    expect(unk.loggedDay.inputs.hydration?.sodiumG).toBeUndefined();
    // A1-023: no known sodium contribution at all is unknown (partial needs at least one known amount)
    expect(unk.coverage.sodium).toBe('unknown');
    // a partially logged day never overrides the prescription's composition (its sums are lower bounds)
    const part = toLoggedDay(base(d, { entries: [mk(1000)] }));
    expect(part.loggedDay.inputs.hydration?.sodiumG).toBeUndefined();
    expect(part.nutrients.sodium?.coverage).toBe('partial');
  });

  it('food caffeine counts once with a caffeine log linked to that meal, twice with an independent one', () => {
    const d = '2026-10-05';
    const coffee = meal(d, 8, 5, 0) as Extract<LogEntry, { kind: 'meal' }>;
    const withCaf = { ...coffee, exposures: [xq('energy', 5, 'kcal', coffee.id), xq('caffeine', 95, 'mg', coffee.id)] } as LogEntry;
    const log = (over: Partial<Extract<LogEntry, { kind: 'substance' }>>) => ({ id: `c${++seq}`, date: d, tz: TZ, source: src, kind: 'substance', substance: 'caffeine', clockH: 8, amount: 95, unit: 'mg', ...over }) as LogEntry;
    const once = toLoggedDay(base(d, { entries: [withCaf, log({ itemId: coffee.id })] }));
    expect(once.loggedDay.inputs.substances?.caffeine).toHaveLength(1);
    expect(once.actives.caffeine?.knownDaily).toBe(95);
    const twice = toLoggedDay(base(d, { entries: [withCaf, log({})] }));
    expect(twice.loggedDay.inputs.substances?.caffeine).toHaveLength(2);
    expect(twice.actives.caffeine?.knownDaily).toBe(190);
  });

  it('numbers are never assumed weighed; shared recipe errors add linearly across repeated logs', () => {
    expect(amountMethodOf({})).toBe('unknown');
    expect(amountMethodOf({ amountMethod: 'photoEstimated' })).toBe('photoEstimated');
    const d = '2026-10-05';
    const comp = (id: string, k: number) => ({ name: 'dal', grams: est(200), nutrients: { energyKcal: est(300), proteinG: est(15), carbG: est(40), fatG: est(8) }, nutrientSource: 'table' as const, uncertaintyGroupIds: [`portionMass:${id}:${k}`, 'sourceComposition:recipe:dal@1'] });
    const a = { ...meal(d, 12, 300, 15), id: 'ra' } as Extract<LogEntry, { kind: 'meal' }>;
    const b = { ...meal(d, 19, 300, 15), id: 'rb' } as Extract<LogEntry, { kind: 'meal' }>;
    const shared = mealTotals([{ ...a, components: [comp('ra', 0)] }, { ...b, components: [comp('rb', 0)] }] as LogEntry[]);
    const indep = mealTotals([a, b] as LogEntry[]);
    expect(shared.energyKcal.value).toBeCloseTo(indep.energyKcal.value, 9);
    expect(shared.energyKcal.sd).toBeCloseTo(2 * a.totals.energyKcal.sd, 9);
    expect(indep.energyKcal.sd).toBeCloseTo(Math.SQRT2 * a.totals.energyKcal.sd, 9);
    expect(LOG_BAND_META).toMatchObject({ method: 'fallback', uncertaintyKind: 'heuristic', coverage: 'unvalidated' });
    const r = toLoggedDay(base(d, { entries: [{ ...a, components: [comp('ra', 0)] }, { ...b, components: [{ ...comp('rb', 0), amountMethod: 'weighed' as const }] }] as LogEntry[] }));
    expect(r.amountMethods).toEqual({ unknown: 1, weighed: 1 });
    expect(r.uncertaintyGroups.find((g) => g.id === 'sourceComposition:recipe:dal@1')).toMatchObject({ kind: 'sourceComposition', memberIds: ['ra#0', 'rb#0'] });
  });

  it('a meal’s carbohydrate mixture, duration and form reach the replay unchanged (never forced to glucose)', () => {
    const d = '2026-10-05';
    const m = meal(d, 10, 240, 0, { intakeDurationH: 1.5, form: 'liquid', carbComposition: { glucoseEqG: 40, fructoseG: 20 } });
    const spec = toLoggedDay(base(d, { entries: [m] })).loggedDay.inputs.meals!.meals!.find((x) => x.eventId === m.id)!;
    expect(spec).toMatchObject({ intakeDurationH: 1.5, form: 'liquid', carbComposition: { glucoseEqG: 40, fructoseG: 20 } });
  });

  it('D1-06: no fluid log means fluids unknown (never "hydrated")', () => {
    expect(toLoggedDay(base('2026-10-05')).coverage.fluids).toBe('unknown');
  });
});

// ------------------------------------------------------------------------------------------- D5-03 correction ledger
describe('D5-03: the balance correction against its actual application', () => {
  const rec = (anchorDay: number, kcal: number): ConfirmedStateRecord => ({
    planId: 'p1', anchorDate: `d${anchorDay}`, anchorDay, trendWeight: { kg: 88, sd: 0.2 }, energyBiasKcal: { mean: kcal, sd: 120 },
    residualSplit: { tissueMassKg: 70, residualKg: 0, fatKg: 0, leanKg: 0, source: 'engine' }, inputsHash: 'h', engine: { engineVersion: 'e', registryHash: 'r' }, trigger: 'weekly',
  });

  it('true δ = 0 is recovered when the applied offset changes 0 → 100 mid-window (the latest-offset rule is biased)', () => {
    const rho = 7000;
    const applied = (d: number) => (d >= 10 ? 100 : 0);
    let A = 0;
    const points: Array<{ day: number; y: number; engineKg: number }> = [];
    for (let d = 0; d < 20; d++) {
      points.push({ day: d, y: 80 - A / rho, engineKg: 80 });
      A += applied(d);
    }
    const diag = linearCorrectionDiagnostic({ points, appliedKcalByDay: applied, rhoKcalPerKg: rho })!;
    expect(diag.deltaKcal).toBeCloseTo(0, 6);
    // the old latest-offset rule: ρ·slope(y − E) + δ_latest
    const t = points.map((p) => p.day);
    const mt = t.reduce((a, x) => a + x, 0) / t.length;
    const r = points.map((p) => p.y - p.engineKg);
    const mr = r.reduce((a, x) => a + x, 0) / r.length;
    const slope = t.reduce((a, x, k) => a + (x - mt) * (r[k]! - mr), 0) / t.reduce((a, x) => a + (x - mt) ** 2, 0);
    expect(Math.abs(rho * slope + 100)).toBeGreaterThan(20);
  });

  it('zero-intake days apply no correction and say why', () => {
    const s: Schedule = { ...SCHED, programs: [TRAIN, { ...REST, energy: { kind: 'zero' } }] };
    const ledger = appliedCorrectionLedger([rec(0, 120)], s, 0, 3);
    expect(ledger.map((x) => [x.requestedKcal, x.appliedKcal, x.skipped ?? null])).toEqual([[120, 120, null], [120, 0, 'zeroIntakeDay'], [120, 120, null], [120, 0, 'zeroIntakeDay']]);
  });

  it('one controller step per weekly decision: a second check-in inside the week earns no extra step; ±300 saturates', () => {
    // the engine's bias estimate as this package reads it (structural: older and newer estimate shapes both fit)
    type Bias = Parameters<typeof checkInCorrection>[2];
    const bias = (mean: number, value: number, reason?: 'clampedStep' | 'clampedValue'): Bias => ({ mean, sd: 100, updated: true, measurement: { value, se: 50, n: 14, method: 'linearAppliedHistory' }, ...(reason ? { reason } : {}) }) as unknown as Bias;
    // weekly cadence: from 100 a week ago, request 250 → +100 step to 200
    const weekly = checkInCorrection([rec(0, 100)], 7, bias(200, 300, 'clampedStep'));
    expect(weekly).toMatchObject({ appliedKcal: 200, stepLimited: true, saturated: false, mechanism: 'absorbedMacroImputation' });
    expect(weekly.requestedKcal).toBeGreaterThan(200);
    // a retried check-in three days after a +100 move: the week's step is spent, the δ stays
    const retry = checkInCorrection([rec(0, 0), rec(7, 100)], 10, bias(200, 300, 'clampedStep'));
    expect(retry.appliedKcal).toBe(100);
    expect(retry.stepLimited).toBe(true);
    // the absolute bound
    const sat = checkInCorrection([rec(0, 250)], 7, bias(300, 900, 'clampedValue'));
    expect(sat).toMatchObject({ appliedKcal: 300, saturated: true });
    // not updated: the request is the value in force
    expect(checkInCorrection([rec(0, 80)], 7, { mean: 80, sd: 150, updated: false, reason: 'fewIntakeDays' } as Bias)).toMatchObject({ requestedKcal: 80, appliedKcal: 80, saturated: false, stepLimited: false });
  });
});

// ------------------------------------------------------------------------------------------- D5-04 estimator identity, D5-07 composition
describe('D5-04/D5-07: estimator identity, consumed observations, composition operators', () => {
  const m = (id: string, date: string, over: Partial<MeasurementEntry> = {}): MeasurementEntry => ({ id, date, metric: 'weightKg', value: 88, source: src, ...over });

  it('the estimator identity changes with any assimilation parameter; consumed ids carry the revision', () => {
    const a = estimatorIdentity();
    expect(['legacySequential', 'fixedPriorRefit']).toContain(a.strategy);
    expect(a.windowDays).toBe(ASSIMILATION_DEFAULTS.biasWindowDays);
    expect(estimatorIdentity(assimilationParams({ sigmaRel: 0.006 })).paramsHash).not.toBe(a.paramsHash);
    expect(estimatorIdentity().paramsHash).toBe(a.paramsHash);
    const ids = weighInIds(plan, [m('w1', '2026-10-06'), m('w2', '2026-10-07', { revision: 2 }), m('w3', '2026-10-08', { assumed: true }), m('w4', '2026-10-15')], 0, 5);
    expect(ids).toEqual(['w1', 'w2@2']);
  });

  it('percent 30 at scan mass 80 kg is 24 kg fat; explicit scan fat agrees; no scan mass stays a percent operator; legacy method stays unknown', () => {
    const bf = (id: string, over: Partial<MeasurementEntry>): MeasurementEntry => ({ id, date: '2026-10-06', metric: 'bodyFatPct', value: 30, source: src, ...over });
    const obs = compositionObservations(plan, [
      bf('dxa1', { method: 'dxa', scanMassKg: 80 }),
      bf('dxa2', { method: 'dxa', scanFatMassKg: 24 }),
      bf('bia1', { method: 'bia', device: 'scale-x' }),
      bf('old', {}),
    ]);
    const byId = new Map(obs.map((o) => [o.observationId, o] as const));
    expect(byId.get('dxa1')!.fatMass).toMatchObject({ kind: 'fatMassKg', valueKg: 24, operator: 'dxaFatMass' });
    expect(byId.get('dxa2')!.fatMass).toMatchObject({ kind: 'fatMassKg', valueKg: 24 });
    expect(byId.get('bia1')!.fatMass).toMatchObject({ kind: 'percentOnly', operator: 'biaBodyFat' });
    expect(byId.get('bia1')!.device).toBe('scale-x');
    expect(byId.get('old')!.method).toBe('unknown');
    expect(byId.get('old')!.occurrence).toMatchObject({ precision: 'dateOnly', date: '2026-10-06' });
  });

  it('the check-in input: readings at their own plan day with their own scan metadata, waist as an observed outcome with its revision', () => {
    expect(COMPOSITION_ASSIMILATION_ENABLED).toBe(true);
    const c = compositionReadingsFor(plan, [
      { id: 'pre', date: '2026-10-01', metric: 'bodyFatPct', value: 31, method: 'bia', source: src },
      { id: 'b1', date: '2026-10-08', metric: 'bodyFatPct', value: 30, method: 'bia', device: 'scale-x', source: src },
      { id: 'd1', date: '2026-10-09', metric: 'bodyFatPct', value: 28, method: 'dxa', scanMassKg: 88.2, scanFatMassKg: 24.7, revision: 2, source: src },
      { id: 'wa', date: '2026-10-07', metric: 'waistCm', value: 96.5, revision: 1, source: src },
      { id: 'wb', date: '2026-10-07', metric: 'weightKg', value: 88, source: src },
    ])!;
    // a reading before the plan start is not a plan-day observation; a percent-only reading never borrows a scale weight
    expect(c.readings).toEqual([
      { observationId: 'b1', day: 3, method: 'bia', bodyFatPct: 30, device: 'scale-x' },
      { observationId: 'd1', revision: 2, day: 4, method: 'dxa', bodyFatPct: 28, scanFatMassKg: 24.7, scanMassKg: 88.2 },
    ]);
    expect(c.waist).toEqual([{ day: 2, cm: 96.5, observationId: 'wa@1' }]);
    expect(compositionReadingsFor(plan, [m('w1', '2026-10-06')])).toBeUndefined();
  });

  it('the check-in intake evidence is the day reduction’s own coverage, eligibility, amount methods and groups', () => {
    const d = '2026-10-05';
    const r = toLoggedDay(base(d, { entries: [meal(d, 9, 600, 40, { components: [{ name: 'oats', grams: est(80, 0), amountMethod: 'weighed', uncertaintyGroupIds: ['sourceComposition:oats@3'], nutrients: { energyKcal: est(600), proteinG: est(40) }, nutrientSource: 'table' }] } as never)] }));
    const ev = intakeEvidenceOf([{ planDay: 0, result: r }, { planDay: -1, result: r }]);
    expect(ev).toEqual([{ day: 0, coverage: r.coverage.energy, calibrationEligible: r.calibrationEligible, amountMethods: { weighed: 1 }, uncertaintyGroups: [{ id: 'sourceComposition:oats@3', kind: 'sourceComposition' }] }]);
  });

  it('a retracted reading leaves no observation', () => {
    const reading: MeasurementEntry = { id: 'r1', date: '2026-10-06', metric: 'bodyFatPct', value: 25, method: 'bia', source: src };
    const retract = { id: 'x1', date: '2026-10-06', metric: 'bodyFatPct', value: 25, kind: 'retract', target: 'r1', source: src } as unknown as MeasurementEntry;
    expect(compositionObservations(plan, [reading, retract])).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------- D8-02 band semantics
describe('D8-02: a sensitivity range is not a calibrated interval', () => {
  const band = { p10: 84, p50: 85, p90: 86 };
  const goal = { goal: 0, metric: 'scaleWeight' as const, target: 80, better: 'down' as const, trend: { value: 86.8, sd: 0.1 } };

  it('a nominal-only forecast (no stochastic members) or a zero-width band is never read as ahead/behind', () => {
    expect(bandIsReadable(band, bandMetaFor('draws', 16))).toBe(true);
    expect(bandIsReadable(band, bandMetaFor('none', 0))).toBe(false);
    expect(bandIsReadable({ p10: 85, p90: 85 })).toBe(false);
    const none = driftGoal({ ...goal, band, bandMeta: bandMetaFor('none', 0), decisions: [{ id: 'a', read: 'behind' }, { id: 'b', read: 'behind' }] });
    expect(none).toMatchObject({ state: 'onTrack', certainty: 'unclear', text: 'Unclear', action: 'keepGoing' });
    const ranged = driftGoal({ ...goal, band, bandMeta: bandMetaFor('draws', 16), decisions: [{ id: 'a', read: 'behind' }, { id: 'b', read: 'behind' }] });
    expect(ranged.state).toBe('behind');
  });

  it('no goal-date SD is derived from the range', () => {
    const g = driftGoal({ ...goal, band, decisions: [{ id: 'a', read: 'behind' }, { id: 'b', read: 'behind' }], goalDate: { before: '2026-12-20', after: '2026-12-29', range: ['2026-12-22', '2027-01-05'] } });
    expect(g.goalDate.shiftDays).toBe(9);
    expect(g.goalDate.shiftSd).toBeNull();
  });

  it('a re-plan without stochastic bands stores band method none, not the legacy draws meaning', () => {
    const res = { status: 'proposal', plan: { planId: 'p1', version: 1, kind: 'medium', request: plan.request, startDate: plan.startDate, endDate: plan.plannedEndDate, structureId: '', genome: [], schedule: SCHED, provenance: { seed: '', tier: 'S', budgetEU: 0, euUsed: 0, registryHash: 'r', engineVersion: 'e', libraryVersion: 0, structures: 0 } }, diff: [], forecast: { asPrescribed: [], realistic: [], bands: {} }, goalDates: [], proposals: [], explanation: [], euUsed: 0 } as unknown as ReplanResult;
    const v = versionFromReplan({ result: res, plan, head: version, today: '2026-10-07', reason: 'event', adoption: 'propose', createdBy: { kind: 'system' }, createdAt: '2026-10-07T08:00:00.000Z' });
    expect(v.forecast.bandMeta).toMatchObject({ method: 'none', coverage: 'notApplicable', draws: 0 });
  });
});

// ------------------------------------------------------------------------------------------- D3-06 breaks
describe('D3-06: a logged break earns no catch-up', () => {
  const skipped = (date: string): { date: string; items: ItemOutcome[] } => ({ date, items: [{ itemId: 'rtSession:x', type: 'rtSession', status: 'skipped', credit: 0 }] });
  const inputs = (over: Partial<TriggerInputs>): TriggerInputs => ({ today: '2026-10-12', closedDay: null, checkInConfirmed: false, declared: [], recent: [skipped('2026-10-07'), skipped('2026-10-09'), skipped('2026-10-11')], a7: null, scored7: 0, outOfBandDays: 0, requestChanged: false, safetyBindsInDays: null, ...over });

  it('misses inside a declared break are not a run of misses and fire no re-plan', () => {
    expect(missedInARow(inputs({}).recent, 'rtSession')).toBe(3);
    expect(evaluateTriggers(inputs({})).some((t) => t.trigger === 'missedBlocks')).toBe(true);
    const onBreak = inputs({ absences: [{ from: '2026-10-06', to: '2026-10-11' }] });
    expect(missedInARow(onBreak.recent, 'rtSession', onBreak.absences)).toBe(0);
    expect(evaluateTriggers(onBreak).some((t) => t.trigger === 'missedBlocks')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------- D2-08 ketone observation times
describe('D2-08: ketone readings keep their observation semantics', () => {
  it('a timed blood reading compares with the endpoint at its instant; an untimed one only with its day; urine is never blood BHB', () => {
    const s = ketoneSamples('2026-10-05', [
      { id: 'b1', date: '2026-10-06', value: 1.2, specimen: 'capillaryBlood', occurrence: { precision: 'exact', at: '2026-10-06T07:30:00+05:30' } },
      { id: 'b2', date: '2026-10-07', value: 0.9, specimen: 'capillaryBlood' },
      { id: 'u1', date: '2026-10-07', value: 1.5, specimen: 'urine', occurrence: { precision: 'exact', at: '2026-10-07T08:00:00+05:30' } },
    ], TZ);
    const by = new Map(s.map((x) => [x.id, x] as const));
    expect(by.get('b1')).toMatchObject({ operator: 'bhbEndpoint', comparable: 'point', sample: { day: 1, precision: 'instant' } });
    expect(by.get('b1')!.sample.hour).toBeCloseTo(7.5, 9);
    expect(by.get('b2')).toMatchObject({ operator: 'bhbEndpoint', comparable: 'day', sample: { day: 2, precision: 'dateOnly' } });
    expect(by.get('b2')!.sample.hour).toBeUndefined();
    expect(by.get('u1')).toMatchObject({ operator: null, comparable: 'none' });
    expect(observationSampleTime('2026-10-05', '2026-10-06', { precision: 'interval', interval: { start: '2026-10-06T22:00:00+05:30', end: '2026-10-07T06:00:00+05:30' } }, TZ)).toMatchObject({ day: 1, precision: 'interval', hourSpan: [22, 30] });
  });
});

// ------------------------------------------------------------------------------------------- entry summaries
describe('D8-06/D7-04: entry summaries say what was logged, nothing derived', () => {
  it('a night reads its logged duration and the quality only when rated; a nap is named; unknown potency reads dose unknown', () => {
    const night = sleep('2026-10-06', '2026-10-05T17:30:00.000Z', '2026-10-06T00:45:00.000Z', { quality: 'fair' });
    expect(summarise(night as never).label).toBe('sleep 7 h 15 · fair');
    expect(summarise(sleep('2026-10-06', '2026-10-06T08:00:00.000Z', '2026-10-06T08:40:00.000Z', { episodeKind: 'nap' }) as never).label).toBe('nap 40 min');
    const unknown = { id: 'su1', date: '2026-10-06', tz: TZ, source: src, kind: 'supplement', supplementId: 'vitD', dose: 10, unit: 'capsule', exposures: [{ id: 'vitD', value: null, unit: 'ug' }] } as unknown as LogEntry;
    expect(summarise(unknown as never).label).toBe('vitD · dose unknown');
    const known = { ...unknown, exposures: [{ id: 'magnesium', value: 200, unit: 'mg' }] } as unknown as LogEntry;
    expect(summarise(known as never).label).toBe('vitD');
  });
});
