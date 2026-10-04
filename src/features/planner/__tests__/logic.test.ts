import { beforeEach, describe, expect, it } from 'vitest';
import type { TargetReach } from '@/engine/planner/domain/types';
import { compileRequest } from '@/engine/planner/domain/context';
import type { ScreeningOutcome } from '@/features/onboarding';
import { EMPTY_RUN, MAX_PLANNER_GOALS, PLANNER_KEY, isPlannerResultStale, pickPlannerValues, provisionalScore, usePlannerStore } from '@/state/plannerStore';
import { GOAL_METRICS, GRADE_D_HELP, goalMetric, gradeDHelp, groupedMetrics, matchesGoalQuery, newGoal, stripDossierRefs } from '../catalogue';
import { fmtChange, fmtDate, fmtMetric, fmtSignedRange, todayISO } from '../format';
import { preflightHints } from '../preflight';
import { buildPrescription } from '../prescription';
import { goalRelations } from '../relations';
import { buildPlannerRequest, defaultConstraints, effectiveConstraints, mergeLocks, requestHash, toRankedGoal, type SafetySnapshot } from '../request';
import { GOALS, PROFILE, START, fixtureResult, fixtureSchedule, fixtureSimulation } from './fixtures';
import { withSystemWrite } from '@/state/scope';

const outcome = {
  plannerAccess: 'full',
  mode: 'M0',
  restrictions: [],
  plannerLocks: [
    { id: 'deficit-cap', value: 25, reasons: [{ rule: 'HC-E3', source: 'default' }] },
    { id: 'max-fast', value: 24, reasons: [{ rule: 'HC-F1', source: 'default' }] },
    { id: 'protein-floor', value: 1.2, reasons: [{ rule: 'HC-M1', source: 'default' }] },
  ],
  fasting: { maxEligibleTier: 'T3', eligibleMaxHours: 24, maxFastHours: 24, effectiveTier: 'T1', optInTiers: ['T2', 'T3'], bindingReasons: [], shortWindowAvailable: true },
  flags: [],
} as unknown as SafetySnapshot['outcome'] & Pick<ScreeningOutcome, 'fasting'>;

const safety: SafetySnapshot = { outcome, plannerAccess: 'full', optedTier: null, shortWindowOn: false };

beforeEach(() => {
  localStorage.clear();
  withSystemWrite(() => usePlannerStore.setState({ ...pickPlannerValues({}), run: EMPTY_RUN }));
});

describe('planner store', () => {
  it('ranks at most six goals and refuses duplicates', () => {
    const s = usePlannerStore.getState();
    const ids = ['fatMass', 'leanTissue', 'hunger', 'vo2max', 'strength', 'ldl', 'sbp'] as const;
    const outcomes = ids.map((id) => s.addGoal(newGoal(goalMetric(id)!)));
    expect(outcomes).toEqual(['added', 'added', 'added', 'added', 'added', 'added', 'full']);
    expect(usePlannerStore.getState().goals).toHaveLength(MAX_PLANNER_GOALS);
    s.removeGoal(usePlannerStore.getState().goals[5]!.key);
    expect(s.addGoal(newGoal(goalMetric('fatMass')!))).toBe('duplicate');
  });

  it('moves goals and keeps rank order', () => {
    const s = usePlannerStore.getState();
    for (const g of GOALS) s.addGoal(g);
    s.moveGoal(2, 0);
    expect(usePlannerStore.getState().goals.map((g) => g.metric)).toEqual(['autophagyIdx', 'fatMass', 'leanTissue']);
    s.moveGoal(0, 99);
    expect(usePlannerStore.getState().goals.map((g) => g.metric)).toEqual(['fatMass', 'leanTissue', 'autophagyIdx']);
  });

  it('persists goals and limits, never the run or its result', () => {
    const s = usePlannerStore.getState();
    for (const g of GOALS) s.addGoal(g);
    s.setConstraints({ longestFastH: 16 });
    s.runStarted('h1', {} as never, 0);
    s.runFinished(fixtureResult(), 1);
    const raw = JSON.parse(localStorage.getItem(PLANNER_KEY)!);
    expect(raw.version).toBe(1);
    expect(raw.state.goals).toHaveLength(3);
    expect(raw.state.constraints).toEqual({ longestFastH: 16 });
    expect(raw.state.lastRequestHash).toBe('h1');
    expect(raw.state.run).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain('Steady deficit');
  });

  it('sanitises damaged persisted state', () => {
    const v = pickPlannerValues({ goals: [{ key: 'x', metric: 'fatMass', mode: 'fly' }, GOALS[0], GOALS[0]], horizonDays: 999 });
    expect(v.goals).toHaveLength(1);
    expect(v.horizonDays).toBe(183);
  });

  it('marks results stale when the request hash changes', () => {
    const s = usePlannerStore.getState();
    s.runStarted('h1', {} as never, 0);
    s.runFinished(fixtureResult(), 1);
    const run = usePlannerStore.getState().run;
    expect(isPlannerResultStale(run, 'h1')).toBe(false);
    expect(isPlannerResultStale(run, 'h2')).toBe(true);
  });

  it('builds convergence traces from provisional options (late slots start level)', () => {
    const s = usePlannerStore.getState();
    s.runStarted('h', {} as never, 0);
    const p = (list: number[][]) => ({ stage: 'S3.1', fraction: 0.3, euUsed: 1, euBudget: 10, provisional: list.map((x) => ({ structureId: 's', name: 'n', percentOfAchievable: x, schedule: fixtureSchedule() })) });
    s.runProgress(p([[50, 40]]));
    s.runProgress(p([[80, 40]]));
    s.runProgress(p([[90, 50], [70, 70]]));
    const t = usePlannerStore.getState().run.traces;
    expect(t.A).toHaveLength(3);
    expect(t.B).toHaveLength(3);
    expect(t.B[0]).toBeCloseTo(t.B[2]!);
    expect(provisionalScore([100, 0])).toBeCloseTo(100 / 1.5 / 100);
  });

  it('traces the engine score and keeps each found plan as soon as an event carries it', () => {
    const s = usePlannerStore.getState();
    s.runStarted('h', {} as never, 0);
    const opt = (name: string, pct: number[]) => ({ structureId: 's', name, percentOfAchievable: pct, schedule: fixtureSchedule() });
    s.runProgress({ stage: 'S2', fraction: 0.1, euUsed: 1, euBudget: 10, provisional: [], score: null });
    s.runProgress({ stage: 'S3.1', fraction: 0.3, euUsed: 3, euBudget: 10, provisional: [opt('Steady deficit', [80])], score: 0.61 });
    s.runProgress({ stage: 'S4', fraction: 0.6, euUsed: 6, euBudget: 10, provisional: [opt('Steady deficit', [90]), opt('Weekly fast', [85]), opt('Recomp', [70])], score: 0.7 });
    s.runProgress({ stage: 'S5', fraction: 0.8, euUsed: 8, euBudget: 10, provisional: [opt('Steady deficit', [92])], score: 0.72 });
    const run = usePlannerStore.getState().run;
    expect(run.traces.best).toEqual([0.61, 0.7, 0.72]);
    expect(run.found.map((f) => f?.name)).toEqual(['Steady deficit', 'Weekly fast', 'Recomp']);
    expect(run.found[0]!.percentOfAchievable).toEqual([92]);
  });
});

describe('goal catalogue', () => {
  it('offers every outcome metric grouped by the 8 categories, with reasons for ineligible ones', () => {
    const groups = groupedMetrics();
    expect(groups.map((g) => g.category)).toEqual(['body', 'fuel', 'energy', 'cellular', 'performance', 'recovery', 'cardio', 'hormones']);
    const lean = goalMetric('leanMass')!;
    expect(lean.eligible).toBe(false);
    expect(lean.reason).toMatch(/lean tissue \(protein-based\)/i);
    expect(goalMetric('t3')!.reason).toMatch(/never pushes it/);
    for (const m of GOAL_METRICS) if (!m.eligible) expect(m.reason).toBeTruthy();
  });

  it('carries the mandatory autophagy caveat and grade D', () => {
    const a = goalMetric('autophagyIdx')!;
    expect(a.grade).toBe('D');
    expect(a.caveat).toMatch(/cannot be measured in your organs/);
    expect(a.modes.map((m) => m.direction)).toEqual(['maximise']);
  });

  it('searches plain words and aliases, never diet brands', () => {
    expect(matchesGoalQuery(goalMetric('bhb')!, 'ketones')).toBe(true);
    expect(matchesGoalQuery(goalMetric('vo2max')!, 'vo2')).toBe(true);
    expect(GOAL_METRICS.some((m) => matchesGoalQuery(m, 'keto diet'))).toBe(false);
  });
});

describe('target editor units', () => {
  it('stores metric values and formats mass and length in the user units', () => {
    expect(fmtMetric('fatMass', -10, 'metric', { signed: true })).toBe('−10.0\u2009kg');
    expect(fmtMetric('fatMass', -10, 'imperial', { signed: true })).toBe('−22.0\u2009lb');
    expect(fmtMetric('waist', 5, 'imperial')).toBe('2.0\u2009in');
    expect(fmtChange('igf1', 1, 0.9, 'metric')).toBe('−10\u2009%');
  });

  it('maps goal phrasing to engine directions and signed change targets', () => {
    expect(toRankedGoal({ ...GOALS[0]!, amount: 10 }, 0)).toEqual({ metric: 'fatMass', direction: 'target', target: -10, targetKind: 'change' });
    expect(toRankedGoal(GOALS[1]!, 1)).toEqual({ metric: 'leanTissue', direction: 'maximise', target: 0, targetKind: 'change' });
    expect(toRankedGoal({ key: 'k', metric: 'bhb', mode: 'reach', amount: 1.2, strength: 'must', functional: 'mean' }, 0)).toEqual({
      metric: 'bhb',
      direction: 'target',
      target: 1.2,
      targetKind: 'absolute',
      functional: 'mean',
      tolerance: 0.013,
    });
    expect(toRankedGoal(GOALS[2]!, 2).tolerance).toBeCloseTo(0.45);
  });
});

describe('constraint form → PlannerRequest', () => {
  it('builds a request the engine accepts (compileRequest problems empty)', () => {
    const c = effectiveConstraints({ longestFastH: 16, excluded: ['L7', 'refeedDay'], proteinFloor: 1.8, carbFloorG: 100, trainingDays: [2, 3], trainingWeekdays: [0, 2, 4] }, PROFILE.habits);
    const req = buildPlannerRequest({ goals: GOALS, horizonDays: 84, startDate: START, constraints: c, strictness: 'balanced', profile: PROFILE, safety });
    expect(req.constraints).toMatchObject({
      trainingDaysPerWeek: { min: 2, max: 3 },
      allowedTrainingWeekdays: [0, 2, 4],
      fasting: 'none',
      excludedLevers: ['L5', 'L7', 'fastDay24', 'refeedDay', 'waterFast', 'zeroDay'],
    });
    // the user's own limits are first-class request fields, not 'user'-tagged locks
    expect(req.constraints).toMatchObject({ maxFastHours: 16, proteinFloorGPerKg: 1.8, carbFloorGPerDay: 100 });
    expect(req.safety!.plannerLocks!.some((l) => l.reasons?.some((r) => r.rule === 'user'))).toBe(false);
    expect(req.profile.safety).toEqual({ mode: 'M0', flags: { fastingOptIn: 'none' } });
    const ctx = compileRequest(req);
    expect(ctx.problems).toEqual([]);
    expect(ctx.caps.maxFastH).toBe(16);
    expect(ctx.caps.proteinFloorRw).toBeGreaterThanOrEqual(1.8);
    expect(ctx.practical.fastingRefused).toBe(true);
    expect(ctx.practical.rtDays).toEqual({ min: 2, max: 3 });
  });

  it('keeps the stricter value when screening and user limits overlap', () => {
    const merged = mergeLocks([{ id: 'max-fast', value: 24 }, { id: 'protein-floor', value: 1.2 }], [{ id: 'max-fast', value: 48 }, { id: 'protein-floor', value: 1.6 }]);
    expect(merged).toEqual([
      { id: 'max-fast', value: 24, reasons: [] },
      { id: 'protein-floor', value: 1.6, reasons: [] },
    ]);
  });

  it('prefills limits from Habits', () => {
    const c = defaultConstraints({ trainingHistory: 'none', typicalSteps: 4000, sessionsPerWeek: 0 });
    expect(c.cardioModality).toBe('walk');
    expect(c.steps[0]).toBe(3000);
    expect(c.trainingDays[1]).toBeLessThanOrEqual(3);
  });

  it('hashes deterministically', () => {
    const c = defaultConstraints(PROFILE.habits);
    const make = () => buildPlannerRequest({ goals: GOALS, horizonDays: 84, startDate: START, constraints: c, strictness: 'balanced', profile: PROFILE, safety });
    expect(requestHash(make())).toBe(requestHash(make()));
    const other = buildPlannerRequest({ goals: GOALS.slice(0, 2), horizonDays: 84, startDate: START, constraints: c, strictness: 'balanced', profile: PROFILE, safety });
    expect(requestHash(other)).not.toBe(requestHash(make()));
  });
});

/** A planner fastest-safe-rate answer (R-TTT) for goal 0: 10 kg of fat, 5 kg reachable in the horizon, 22 weeks. */
const reachOf = (over: Partial<TargetReach> = {}): TargetReach => ({
  goal: 0,
  metric: 'fatMass',
  supported: true,
  kind: 'loss',
  start: 20,
  target: 10,
  valueAtHorizon: 15,
  changeAtHorizon: -5,
  reachableInHorizon: false,
  weeks: 22,
  beyondTwoYears: false,
  beyondSafetyLimits: false,
  ratePerWeek: 0.45,
  text: 'At the fastest safe rate it takes about 22 weeks (about 0.45 kg a week at first).',
  ...over,
});

describe('pre-flight hints', () => {
  const body = { weightKg: 92, bmi: 28.4, bodyFatPct: 26, sex: 'male' as const, trainingHistory: '1to3y' as const };
  const fat = { ...GOALS[0]!, metric: 'fatMass' as const, mode: 'lose' as const, amount: 10 };
  const hintsWith = (reach: TargetReach[] | null, horizonDays = 112, units?: 'metric' | 'imperial') =>
    preflightHints({ goals: [fat], horizonDays, constraints: defaultConstraints(PROFILE.habits), body, reach, units }).filter((h) =>
      h.id.startsWith('rate-'),
    );

  it('flags a target the planner’s safe-rate search does not reach, with its horizon value and weeks', () => {
    const [rate] = hintsWith([reachOf()]);
    expect(rate!.severity).toBe('caution');
    expect(rate!.title).toBe('Losing 10.0\u2009kg of fat mass in 16 weeks is faster than Vitals’ safe rate.');
    // "expect about X" is the search's changeAtHorizon; the extend action its weeks; the sentence its own text
    expect(rate!.body).toBe(
      'Expect goal 1 to reach about 5.0\u2009kg in this horizon. At the fastest safe rate it takes about 22 weeks (about 0.45 kg a week at first).',
    );
    expect(rate!.action).toEqual({ kind: 'extend', weeks: 22, label: 'Extend to 22 weeks' });
  });

  it('offers no extension past the longest horizon or beyond two years, and says why', () => {
    expect(hintsWith([reachOf({ weeks: 40, text: 'At the fastest safe rate it takes about 40 weeks.' })])[0]!.action).toBeUndefined();
    const far = hintsWith([reachOf({ weeks: null, beyondTwoYears: true, text: 'At the fastest safe rate it takes more than two years.' })])[0]!;
    expect(far.action).toBeUndefined();
    expect(far.body).toMatch(/more than two years\.$/);
    const floor = hintsWith([reachOf({ weeks: null, beyondSafetyLimits: true, text: '' })])[0]!;
    expect(floor.title).toMatch(/goes past a safety floor/);
    expect(floor.action).toBeUndefined();
  });

  it('stays quiet while the estimate is pending and when the target is reachable', () => {
    expect(hintsWith(null)).toEqual([]);
    expect(hintsWith([reachOf({ reachableInHorizon: true, weeks: 10, changeAtHorizon: -10 })])).toEqual([]);
    // at the edge: reachable, but only in the last weeks of the horizon
    const [edge] = hintsWith([reachOf({ reachableInHorizon: true, weeks: 15, text: 'At the fastest safe rate it is reachable in about 15 weeks.' })]);
    expect(edge!.id).toMatch(/^rate-edge-/);
    expect(edge!.body).toMatch(/Plans may land a little short\.$/);
  });

  it('follows the unit setting', () => {
    const [lb] = hintsWith([reachOf()], 112, 'imperial');
    expect(lb!.title).toMatch(/Losing 22\.0\u2009lb of fat mass/);
    expect(lb!.body).toMatch(/reach about 11\.0\u2009lb in this horizon/);
  });

  it('names catalogue conflicts and contradictory limits', () => {
    const c = { ...defaultConstraints(PROFILE.habits), trainingDays: [2, 5] as [number, number], trainingWeekdays: [0, 2, 4] as (0 | 2 | 4)[], longestFastH: 16 as const };
    const goals = [newGoal(goalMetric('leanTissue')!, 'gain'), newGoal(goalMetric('autophagyIdx')!)];
    const hints = preflightHints({ goals, horizonDays: 84, constraints: c, body });
    expect(hints.map((h) => h.id)).toEqual(expect.arrayContaining(['train-days', 'transient-no-fast']));
    expect(hints.some((h) => /pull apart/.test(h.title))).toBe(true);
    expect(goalRelations(goals)[0]).toMatchObject({ kind: 'conflict', tag: 'fasting vs muscle' });
  });
});

describe('QA regressions (planner copy)', () => {
  const body = { weightKg: 88, bmi: 27.8, bodyFatPct: 21.5, sex: 'male' as const, trainingHistory: '1to3y' as const };

  it('has no rate formula of its own: without the planner’s estimate there is no rate hint', () => {
    // (the old UI formula printed "0.84 % a week vs the 0.75 % cap" and could disagree with the run's feasibility)
    const goal = { ...GOALS[0]!, metric: 'fatMass' as const, mode: 'lose' as const, amount: 10 };
    const hints = preflightHints({ goals: [goal], horizonDays: 112, constraints: defaultConstraints(PROFILE.habits), body });
    expect(hints.filter((h) => h.id.startsWith('rate-'))).toEqual([]);
  });

  it('keeps research cross-references out of reasons and tells the truth about grade D', () => {
    for (const m of GOAL_METRICS) {
      expect(m.reason ?? '').not.toMatch(/§/);
      expect(m.note ?? '').not.toMatch(/§/);
    }
    expect(stripDossierRefs('Fat balance, not oxidation, sets fat loss (04 §4.15).')).toBe('Fat balance, not oxidation, sets fat loss.');
    expect(gradeDHelp('autophagyIdx')).toBe(GRADE_D_HELP);
    expect(gradeDHelp('micronutrientScore')).not.toMatch(/animal/);
  });

  it('formats signed ranges and dates in the design voice', () => {
    expect(fmtSignedRange('leanTissue', -1.1, -0.3, 'metric')).toBe('\u22121.1 to \u22120.3\u2009kg');
    expect(fmtSignedRange('leanTissue', 0.1, 0.6, 'metric')).toMatch(/^0\.1.0\.6\u2009kg$/);
    expect(fmtSignedRange('skeletalMuscle', -0.01, 0.2, 'metric')).toBe('0.0 to +0.2\u2009kg');
    expect(fmtDate('2026-09-30')).toBe('30 Sep');
    expect(todayISO(new Date(2026, 9, 1, 0, 30))).toBe('2026-10-01');
  });
});

describe('prescription', () => {
  const rx = buildPrescription(fixtureSchedule(), PROFILE, fixtureSimulation(20));
  it('prescribes a training day with grams, window, meals and the session', () => {
    const mon = rx.days[0]!;
    expect(mon.zero).toBe(false);
    expect(mon.energyKcal).toBeCloseTo(2300, -1);
    expect(mon.proteinG).toBeCloseTo(180, 0);
    expect(mon.carbG).toBeCloseTo(220, 0);
    expect(mon.meals).toHaveLength(3);
    expect(mon.windowStartH).toBe(9);
    expect(mon.sessions[0]).toMatchObject({ kind: 'resistance', startH: 18, durationMin: 60 });
  });

  it('prescribes a water-only day and a 24 h fast with electrolytes', () => {
    const thu = rx.days[3]!;
    expect(thu.zero).toBe(true);
    expect(thu.energyKcal).toBe(0);
    expect(thu.extras.join(' ')).toMatch(/electrolytes/);
    expect(thu.fast).toMatchObject({ part: 'all-day' });
    expect(thu.fast!.totalH).toBeGreaterThan(24); // last meal Wednesday → first meal Friday
    // The fixture's 24 h fast starts Tue 19:00 and ends Wed 19:00, after Wednesday's last meal (18:00), so the next meal
    // is Thursday 11:00: the prescription reports the meal-to-meal gap the person lives (40 h), not the event length.
    const fastStart = rx.days[15]!;
    expect(fastStart.fast).toMatchObject({ part: 'start', totalH: 40 });
    expect(rx.days[16]!.fast).toMatchObject({ totalH: 40 });
    expect(rx.types.map((t) => t.label)).toEqual(['eating day · resistance training', 'eating day', 'zero-energy day']);
  });
});

describe('safety items and bands (enriched planner API)', () => {
  it('orders safety items by the engine severity, not by keywords, and drops the generic disclaimer', async () => {
    const { safetyItemsOf, safetyCounts } = await import('../components/PlanParts');
    const items = safetyItemsOf({
      safetyNotes: [],
      safetyItems: [
        { text: 'Drink water with salt on fast days.', severity: 'info' },
        { text: 'These are model projections, not medical advice.', severity: 'info' },
        { text: 'Energy availability falls near the floor in week 3.', severity: 'caution' },
        { text: 'Stop and eat if you feel faint.', severity: 'info' },
        { text: 'A 72 h fast with this medicine needs a clinician.', severity: 'danger' },
      ],
    });
    expect(items.map((i) => i.severity)).toEqual(['danger', 'caution', 'info', 'info']);
    // "Stop … faint" has risk words but the engine calls it info: it stays info
    expect(items[3]!.text).toMatch(/faint/);
    expect(safetyCounts(items)).toEqual({ danger: 1, caution: 1, info: 2 });
  });

  it('draws the ensemble band (index 0 = start) and fills scorecards from it, never the catalogue range', async () => {
    const { ensembleBand } = await import('../planFacts');
    const { withBand } = await import('../components/PlanParts');
    const values = Float32Array.from([10, 9, 8]);
    const band = { p10: Float32Array.from([10, 9.5, 8.5, 7.5]), p50: Float32Array.from([10, 9, 8, 7]), p90: Float32Array.from([10, 9.8, 8.8, 8.2]) };
    const option = { bands: { draws: 24, series: { fatMass: band } } } as never;
    const b = ensembleBand(option, 'fatMass', values, 1)!;
    // day d reads index d + 1; the nominal 10 on day 0 lies above that day's P90 (9.8), so the band widens to hold it
    expect(Array.from(b.lo)).toEqual([9.5, 8.5, 7.5]);
    expect(b.hi[0]).toBe(10);
    expect(b.hi[2]).toBeCloseTo(8.2, 5);
    const sc = withBand({ metric: 'fatMass', value: 8, band: null } as never, option, null);
    expect(sc.band!.p10).toBe(7.5);
    expect(sc.band!.p90).toBeCloseTo(8.2, 5);
    expect(sc.band!.pTargetMet).toBeNull();
    expect(withBand({ metric: 'fatMass', value: 8, band: null } as never, option, 'mean').band).toBeNull();
  });
});
