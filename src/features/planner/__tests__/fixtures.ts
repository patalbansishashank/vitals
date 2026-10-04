/**
 * Planner test fixtures: a hand-built 4-week engine `Schedule` (training days, rest days, one water-only day and a
 * 24 h fast event), a minimal nominal simulation, a three-option v1 `PlannerResult` whose scorecards cover the
 * reached / partial / not-reachable / directional cases, and the plan ladder built to the v2 types
 * (`fixtureLadder()`: Hard · Medium · Easy ‖ Ideal with summaries, burdens, outcomes, limit costs).
 */
import type { PersonProfile, Schedule, SimulationResult } from '@/engine';
import {
  DIFFICULTY_COMPONENTS,
  type ConvergencePoint,
  type DifficultyBreakdown,
  type FastingVerdict,
  type GoalOutcome,
  type GoalScore,
  type IdealPlanV2,
  type LimitCost,
  type PlanKind,
  type PlanOption,
  type PlannerRequest,
  type PlannerResult,
  type PlannerResultV2,
  type RungId,
  type RungPlan,
  type RungSummary,
} from '@/engine/planner/domain/types';
import type { GoalDraft } from '@/state/plannerStore';

export const START = '2026-10-05'; // a Monday
export const DAYS = 28;

export const PROFILE: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 38, heightCm: 180, weightKg: 92 },
  habits: { trainingHistory: '1to3y', sessionsPerWeek: 3, typicalSteps: 7500 },
  startDate: START,
};

export function fixtureSchedule(variant = 0): Schedule {
  const train = {
    id: 'A',
    label: 'Moderate continuous deficit · day · resistance training',
    energy: { kind: 'kcal' as const, kcal: 2300 - variant * 100 },
    macros: { protein: { unit: 'g' as const, value: 180 }, carbs: { unit: 'g' as const, value: 220 }, fat: { unit: 'remainder' as const } },
    meals: { count: 3, window: { startH: 9, lengthH: 9 } },
    exercise: [{ kind: 'resistance' as const, startH: 18, durationMin: 60, volume: 'moderate' as const }],
    steps: 9000,
  };
  const rest = {
    id: 'B',
    label: 'Moderate continuous deficit · day',
    energy: { kind: 'kcal' as const, kcal: 2000 },
    macros: { protein: { unit: 'g' as const, value: 170 }, carbs: { unit: 'g' as const, value: 160 }, fat: { unit: 'remainder' as const } },
    meals: { count: 2, window: { startH: 11, lengthH: 8 } },
    steps: 8000,
  };
  const zero = {
    id: 'C',
    label: 'Moderate continuous deficit · zero-energy day',
    energy: { kind: 'zero' as const },
    macros: { protein: { unit: 'g' as const, value: 0 }, carbs: { unit: 'g' as const, value: 0 }, fat: { unit: 'g' as const, value: 0 } },
    hydration: { electrolytes: true, fluidL: 2.5, sodiumG: 2 },
    steps: 6000,
  };
  // Mon train · Tue rest · Wed train · Thu zero (first week only) · Fri train · Sat rest · Sun rest
  const pattern = [0, 1, 0, 1, 0, 1, 1];
  const days = Array.from({ length: DAYS }, (_, d) => ({ program: d === 3 ? 2 : pattern[d % 7]! }));
  return {
    schemaVersion: 1,
    startDate: START,
    horizonDays: DAYS,
    programs: [train, rest, zero],
    days,
    blocks: [{ name: 'Moderate continuous deficit (days 1-28)', startDay: 0, endDay: DAYS, buildingBlockId: 'B1' }],
    events: [{ kind: 'fast', startDay: 15, startH: 19, durationH: 24, electrolytes: true, refeed: 'none' }],
  };
}

const ramp = (a: number, b: number) => Float32Array.from({ length: DAYS }, (_, i) => a + ((b - a) * (i + 1)) / DAYS);

export function fixtureSimulation(fatEnd: number): SimulationResult {
  const daily = {
    fatMass: ramp(25, fatEnd),
    leanTissue: ramp(62, 61.9),
    scaleWeight: ramp(92, 92 - (25 - fatEnd) - 1),
    hunger: ramp(30, 42),
    autophagyIdx: ramp(20, 34),
  };
  const empty = new Float32Array(DAYS);
  return {
    meta: { engineVersion: 'test', registryHash: 'x', nDays: DAYS, startDate: START, startWeekday: 0, record: 'daily', series: Object.keys(daily) as never, runtimeMs: 1, compileNotes: [] },
    initial: { fatMass: 25, leanTissue: 62, scaleWeight: 92, hunger: 30, autophagyIdx: 20 },
    daily,
    hourly: {},
    final: {},
    safety: new Proxy({}, { get: () => empty }) as SimulationResult['safety'],
    events: [],
    warnings: [],
  };
}

function score(goal: number, metric: GoalScore['metric'], label: string, over: Partial<GoalScore>): GoalScore {
  return {
    goal,
    metric,
    label,
    unit: 'kg',
    direction: 'target',
    start: 0,
    value: 0,
    change: 0,
    target: null,
    percentOfAchievable: 100,
    percentOfTarget: null,
    met: null,
    costVsA: 0,
    band: null,
    grade: 'A',
    ...over,
  };
}

function option(id: 'A' | 'B' | 'C', name: string, fatEnd: number, met: boolean, autophagyPct: number, safetyNotes: string[] = []): PlanOption {
  return {
    id,
    name,
    schedule: fixtureSchedule(id === 'A' ? 0 : id === 'B' ? 1 : 2),
    simulation: fixtureSimulation(fatEnd),
    scorecard: [
      score(0, 'fatMass', 'Fat mass', {
        start: 25,
        value: fatEnd,
        change: fatEnd - 25,
        target: 20,
        met,
        percentOfAchievable: met ? 100 : 70,
        percentOfTarget: met ? 104 : 70,
        band: { p10: fatEnd - 0.6, p50: fatEnd, p90: fatEnd + 0.6, pTargetMet: met ? 0.78 : 0.12 },
      }),
      score(1, 'leanTissue', 'Lean tissue (protein-based)', { direction: 'maximise', start: 62, value: 61.9, change: -0.1, target: 62, met: true, grade: 'B' }),
      score(2, 'autophagyIdx', 'Autophagy signal', { direction: 'maximise', unit: 'index', start: 20, value: 34, change: 14, percentOfAchievable: autophagyPct, grade: 'D' }),
    ],
    utility: 1,
    hunger: { meanIdx: 36, peak7Idx: 42, daysAboveTolerance: 0, adherencePct: 80, rating: 'moderate', text: 'hunger moderate' },
    complexity: { score: 1, dayTypes: 3, phases: 1, events: 1 },
    phases: [{ name: 'Moderate continuous deficit', blockId: 'B1', startDay: 0, endDay: DAYS, weeks: 4, summary: 'energy 80 % of maintenance; protein 2.0 g/kg', why: 'A steady deficit with high protein.' }],
    explanation: [`${name} keeps fat loss near its best.`],
    notes: [],
    safetyNotes,
    safetyItems: safetyNotes.map((text) => ({ text, severity: 'caution' as const })),
    fasting: id === 'B' ? { used: true, text: 'A weekly 24 h fast raises the autophagy signal, which ranks third.' } : { used: false, text: 'No fast: goal 1 does as well without one.' },
    bindingConstraints: [{ rule: 'HC-E5', share: 0.4, text: 'The weekly rate-of-loss limit.' }],
    confidence: id === 'A' ? 'D' : 'C',
    aBeatsThisShare: id === 'A' ? null : 0.8,
    contributions: [{ label: 'without the diet breaks', deltaGoal1: -4 }],
  };
}

export const GOALS: GoalDraft[] = [
  { key: 'g1', metric: 'fatMass', mode: 'lose', amount: 5, strength: 'should', functional: null },
  { key: 'g2', metric: 'leanTissue', mode: 'keep', amount: null, strength: 'should', functional: null },
  { key: 'g3', metric: 'autophagyIdx', mode: 'raise', amount: null, strength: 'nice', functional: null },
];

export function fixtureResult(over: Partial<PlannerResult> = {}): PlannerResult {
  return {
    status: 'ok',
    complete: true,
    stoppedAt: null,
    options: [
      option('A', 'Steady deficit, lifting 3×', 19.8, true, 62),
      option('B', 'Weekly 24 h fast, high protein', 20.9, false, 91, ['Stop the fast and eat if you feel dizzy or faint.']),
      option('C', 'Recomposition at maintenance', 22.5, false, 20),
    ],
    feasibility: [
      { goal: 0, metric: 'fatMass', label: 'Fat mass', status: 'attainable', baseline: 25, bestAchievable: 19.8, target: 20, nearestAttainableTarget: null, requiredWeeks: null, requiredHorizonDays: null, text: '' },
      { goal: 1, metric: 'leanTissue', label: 'Lean tissue', status: 'metAtBaseline', baseline: 62, bestAchievable: 62.2, target: 62, nearestAttainableTarget: null, requiredWeeks: null, requiredHorizonDays: null, text: '' },
      { goal: 2, metric: 'autophagyIdx', label: 'Autophagy signal', status: 'directional', baseline: 20, bestAchievable: 40, target: null, nearestAttainableTarget: null, requiredWeeks: null, requiredHorizonDays: null, text: '' },
    ],
    relations: ['Goal 3 (Autophagy signal) trades off against goal 1 (Fat mass).'],
    fasting: { offered: true, reason: 'Fasting was considered because the autophagy signal is one of your goals.' },
    noSafePlanReasons: [],
    message: null,
    stubModules: [],
    provenance: { seed: 'abc', tier: 'S', budgetEU: 3000, euUsed: 3000, registryHash: 'x', engineVersion: 'test', libraryVersion: 1, structures: 12 },
    ...over,
  };
}

export function fixtureRequest(): PlannerRequest {
  return {
    profile: PROFILE,
    goals: [
      { metric: 'fatMass', direction: 'target', target: -5, targetKind: 'change' },
      { metric: 'leanTissue', direction: 'maximise', target: 0, targetKind: 'change' },
      { metric: 'autophagyIdx', direction: 'maximise', tolerance: 0.45 },
    ],
    horizonDays: DAYS,
    startDate: START,
    constraints: { excludedLevers: ['L7'], fasting: 'allowed' },
  };
}

/* ------------------------------------------------------------------------------------------- plan ladder (v2) */

const BURDEN_TEXT: Record<string, string> = {
  deficit: '18 % below maintenance, your limit 25 %',
  hunger: 'peaks 74 of 100 in week 3',
  trainingTime: '4 h a week, 2 h more than now',
  fastingLoad: 'one 24-h fast a week',
  windowTightness: '8 h, 3 h shorter than now',
  decisions: '2 kinds of day, 1 new supplement',
  habitDistance: 'moderate',
};

export function fixtureDifficulty(D: number, opts: { inactive?: string[]; over?: number } = {}): DifficultyBreakdown {
  const components = DIFFICULTY_COMPONENTS.map((id) => {
    const active = !opts.inactive?.includes(id);
    const value = active ? Math.min(1, D * (id === 'hunger' ? 1.3 : 1)) : 0;
    return { id, value, raw: active ? (opts.over ?? value) * 10 : 0, habit: 0, limit: active ? 10 : 0, unit: 'u', active, label: id, text: BURDEN_TEXT[id]! };
  });
  return { D, Dmax: Math.max(...components.map((c) => c.value)), components, hardest: D > 0 ? 'hunger' : null };
}

function outcome(goal: number, metric: GoalOutcome['metric'], over: Partial<GoalOutcome>): GoalOutcome {
  return {
    goal,
    metric,
    label: metric,
    unit: 'kg',
    p50: 0,
    band: null,
    change: 0,
    start: 0,
    target: null,
    pTargetMet: null,
    percentOfAchievable: 100,
    verdict: null,
    weeksToTarget: null,
    beyondTwoYears: false,
    tttSource: null,
    tttText: null,
    vsHard: 0,
    grade: 'A',
    ...over,
  };
}

function outcomes(fatEnd: number, hardFatEnd: number, autophagyPct: number, reached: boolean): GoalOutcome[] {
  return [
    outcome(0, 'fatMass', {
      p50: fatEnd,
      start: 25,
      change: fatEnd - 25,
      target: 20,
      band: { p10: fatEnd - 0.6, p90: fatEnd + 0.6 },
      pTargetMet: reached ? 0.82 : 0.12,
      percentOfAchievable: reached ? 100 : 70,
      verdict: reached ? 'reached' : 'notReached',
      weeksToTarget: reached ? 3 : 6,
      tttSource: reached ? 'ownRun' : 'route',
      tttText: reached ? 'reached in about 3 weeks' : 'about 6 weeks at this plan’s effort',
      vsHard: fatEnd - hardFatEnd,
    }),
    outcome(1, 'leanTissue', { p50: 61.9, start: 62, change: -0.1, target: 62, band: { p10: 61.5, p90: 62.1 }, verdict: 'kept', percentOfAchievable: 100, grade: 'B' }),
    outcome(2, 'autophagyIdx', { unit: 'index', p50: 34, start: 20, change: 14, percentOfAchievable: autophagyPct, grade: 'D' }),
  ];
}

const VERDICT_NONE: FastingVerdict = {
  used: false,
  kind: 'none',
  longestFastH: 0,
  text: 'A plan with weekly 24-hour fasts gave the same fat loss within 0.1 kg, with higher hunger peaks (+12 points), so this plan was kept.',
  rival: { kind: 'fast24', longestFastH: 24, structureId: 's-fast', reason: 'noGoalGain', goalDeltas: [{ goal: 0, delta: -0.1, unit: 'kg' }], hungerPeakDelta: 12, leanTissueDeltaKg: -0.3, deltaD: 0.1, detail: 'hunger' },
};
const VERDICT_FAST: FastingVerdict = { used: true, kind: 'fast24', longestFastH: 24, text: 'A weekly 24-hour fast raises the autophagy signal, which ranks third.' };

function summary(kind: PlanKind, subtitle: string, D: number, outs: GoalOutcome[], fasting: FastingVerdict, extra: Partial<RungSummary> = {}): RungSummary {
  return {
    kind,
    title: kind === 'hard' ? 'Hard' : kind === 'medium' ? 'Medium' : kind === 'easy' ? 'Easy' : 'Ideal',
    subtitle,
    difficulty: fixtureDifficulty(D),
    outcomes: outs,
    weeklyTrainingMin: 240,
    meanWindowH: 8,
    hunger: { meanIdx: 36, peak7Idx: 42, daysAboveTolerance: 0, adherencePct: 80, rating: 'moderate', text: 'hunger moderate' },
    fasting,
    bindingLimits: kind === 'ideal' ? [] : [{ group: 'trainingDays', label: 'training days', share: 0.71, text: '3 training days (on 71 % of days)' }],
    equipment: { required: [], optional: [], text: '' },
    safetyItems: [],
    ...extra,
  };
}

function payload(o: PlanOption): Omit<RungPlan, 'kind' | 'summary'> {
  const { id: _id, aBeatsThisShare, scorecard, fasting, ...rest } = o;
  return {
    ...rest,
    scorecard: scorecard.map(({ costVsA, ...sc }) => ({ ...sc, costVsHard: costVsA })),
    fasting: fasting ? { kind: fasting.used ? 'fast24' : 'none', longestFastH: fasting.used ? 24 : 0, ...fasting } : VERDICT_NONE,
    genome: { structureId: `s-${_id}`, x: [0.5] },
    hardBeatsThisShare: aBeatsThisShare,
  };
}

export const LIMIT_COSTS: LimitCost[] = [
  {
    group: 'trainingDays',
    label: 'training days',
    current: '3 training days',
    relaxedTo: '5 training days',
    deltas: [{ goal: 0, delta: -0.6, unit: 'kg' }],
    deltaD: 0.09,
    text: 'Allowing 5 training days instead of 3 would add 0.6 kg of fat loss by week 4.',
    euSpent: 120,
    adopt: { trainingDaysPerWeek: { min: 2, max: 5 } },
  },
  {
    group: 'eatingWindow',
    label: 'eating window',
    current: '8 h',
    relaxedTo: '10 h',
    deltas: [{ goal: 0, delta: -0.2, unit: 'kg' }],
    deltaD: 0.04,
    text: 'Allowing a 10-hour eating window instead of 8 would add 0.2 kg of fat loss.',
    euSpent: 80,
    adopt: { eatingWindow: { earliestH: 8, latestH: 20 } },
  },
  {
    group: 'equipment',
    label: 'equipment',
    current: 'what you have',
    relaxedTo: 'a pull-up bar',
    deltas: [{ goal: 1, delta: 0.4, unit: 'kg' }],
    deltaD: 0,
    text: 'Buying a pull-up bar would add 0.4 kg of muscle.',
    euSpent: 60,
    adopt: {},
  },
];

/** The plan ladder: options A/B/C of `fixtureResult()` as Hard/Medium/Easy, plus an Ideal (override any part). */
export function fixtureLadder(over: Partial<PlannerResultV2> = {}, opts: { ideal?: boolean; rungs?: RungId[] } = {}): PlannerResultV2 {
  const v1 = fixtureResult();
  const [a, b, c] = v1.options as [PlanOption, PlanOption, PlanOption];
  const want = new Set(opts.rungs ?? ['hard', 'medium', 'easy']);
  const rung = (kind: RungId, o: PlanOption, subtitle: string, D: number, fatEnd: number, autophagy: number, reached: boolean, fasting: FastingVerdict): RungPlan => ({
    ...payload(o),
    fasting,
    kind,
    summary: summary(kind, subtitle, D, outcomes(fatEnd, 19.8, autophagy, reached), fasting),
  });
  const rungs: PlannerResultV2['rungs'] = {};
  if (want.has('hard')) rungs.hard = rung('hard', a, 'Deficit 22 % · 4 sessions', 0.64, 19.8, 62, true, VERDICT_NONE);
  if (want.has('medium')) rungs.medium = rung('medium', b, 'Deficit 12 % · 3 sessions · 24-h fast weekly', 0.41, 20.9, 91, false, VERDICT_FAST);
  if (want.has('easy')) rungs.easy = rung('easy', c, 'Maintenance · 3 sessions', 0.18, 22.5, 20, false, VERDICT_NONE);
  const idealPlan: IdealPlanV2 = {
    ...payload(a),
    fasting: VERDICT_NONE,
    kind: 'ideal',
    summary: summary('ideal', 'Deficit 25 % · 5 sessions', 0.82, outcomes(19.2, 19.8, 70, true), VERDICT_NONE, { difficulty: fixtureDifficulty(0.82, { over: 1.2 }) }),
    relaxed: [
      { field: 'constraints.trainingDaysPerWeek', from: '3', to: 'up to 6', group: 'trainingDays' },
      { field: 'constraints.eatingWindow', from: '8 h', to: 'wake + 30 min to 3 h before bed', group: 'eatingWindow' },
    ],
    advised: [
      { domain: 'sleep', text: 'sleep midpoint around 03:00 if your work allows' },
      { domain: 'caffeine', text: 'no caffeine within 6 h of bed' },
    ],
    limitCosts: LIMIT_COSTS,
    gapVsHard: [{ goal: 0, delta: -0.6, unit: 'kg' }],
    interactionRemainder: [{ goal: 0, delta: -0.3, unit: 'kg' }],
    nothingBinds: false,
  };
  const { tier: _tier, ...prov } = v1.provenance;
  return {
    status: 'ok',
    complete: true,
    stoppedAt: null,
    rungs,
    ladder: {
      collapsed: (['hard', 'medium', 'easy'] as const)
        .filter((k) => !want.has(k))
        .map((k) => ({ rung: k, reason: 'notDistinct' as const, text: k === 'medium' ? 'not distinct · Easy already reaches 95 % of Hard’s fat loss; a harder plan buys little.' : 'same as Hard · Your goal is small enough that the easiest plan already reaches it.' })),
      checks: { dHM: 0.23, dME: 0.23, gowerMin: 0.3, ordered: true },
      frontier: [
        { D: 0.1, g: 0.3 },
        { D: 0.18, g: 0.45 },
        { D: 0.41, g: 0.8 },
        { D: 0.64, g: 1 },
      ],
    },
    ideal: opts.ideal === false ? null : idealPlan,
    feasibility: v1.feasibility,
    relations: v1.relations,
    noSafePlanReasons: [],
    message: null,
    stubModules: [],
    fasting: { offered: true, reason: 'Fasting was considered because the autophagy signal is one of your goals.', servedGoal: 2, tierMaxH: 24 },
    convergence: [],
    provenance: { ...prov, plannerVersion: 2, tier: 'S', holdoutGap: [0, 0, 0], difficultyWeights: [1, 1, 1, 1, 1, 1, 1] },
    ...over,
  };
}

/* ------------------------------------------------------------------------- ladder cases (batch 02, same-scale) */

/** A search's convergence: the best Hard's goal score rising in steps and settling (plans searched on x). */
export function fixtureConvergence(n = 12, euEnd = 240_000): ConvergencePoint[] {
  // improves for the first n − 4 points, then stays put (the search has settled)
  const raw = Array.from({ length: n }, (_, i) => 1 - 0.65 * Math.exp(-Math.min(i, n - 5) / 1.8));
  const top = raw[n - 1]!;
  return raw.map((r, i) => {
    const eu = Math.round(((i + 1) / n) * euEnd);
    const G = r / top;
    return { eu, wallMs: eu / 10, stage: i < n / 2 ? 'S2.hard' : 'S4.polish', keyHard: [G, 0, 0], G, hvLadder: 0.4 + 0.03 * i };
  });
}

const COLLAPSE_TEXT = {
  medium: 'It would repeat Hard or Easy with small changes.',
  easy: 'No plan with less effort than Hard reaches half of Hard’s fat loss: the closest reached 41 % at effort 22.',
} as const;

export type LadderCase = 'four' | 'three' | 'sameAsHard' | 'hardOnly' | 'sameEffort';

/**
 * The four ladder layouts the screens must handle (plan-ladder.md §12): all four cards; Hard, Easy and the Ideal with a
 * Medium chip and a carried Easy; the Ideal equal to Hard (no Ideal card); Hard alone with two chips and the search's
 * convergence curve. `sameEffort`: four cards with equal burdens (the Ideal past the limit on two rows) for bar widths.
 */
export function fixtureLadderCase(c: LadderCase): PlannerResultV2 {
  const collapse = (rungs: Array<'medium' | 'easy'>) => rungs.map((k) => ({ rung: k, reason: 'notDistinct' as const, text: COLLAPSE_TEXT[k] }));
  if (c === 'four') return fixtureLadder();
  if (c === 'sameEffort') {
    const v2 = fixtureLadder();
    const d = fixtureDifficulty(0.5);
    for (const k of ['hard', 'medium', 'easy'] as const) v2.rungs[k] = { ...v2.rungs[k]!, summary: { ...v2.rungs[k]!.summary, difficulty: d } };
    const over = fixtureDifficulty(0.5);
    // deficit 30 % past the limit, training time 90 % past it (drawn cut at half a track)
    over.components = over.components.map((x) => (x.id === 'deficit' ? { ...x, value: 1, raw: 13 } : x.id === 'trainingTime' ? { ...x, value: 1, raw: 19 } : x));
    v2.ideal = { ...v2.ideal!, summary: { ...v2.ideal!.summary, difficulty: over } };
    return v2;
  }
  if (c === 'three') {
    const v2 = fixtureLadder({}, { rungs: ['hard', 'easy'] });
    v2.ladder = { ...v2.ladder, collapsed: collapse(['medium']) };
    v2.rungs.easy = { ...v2.rungs.easy!, provenance: 'carried', fromTier: 'S' };
    v2.provenance = { ...v2.provenance, tier: 'X' };
    v2.convergence = fixtureConvergence();
    return v2;
  }
  const v2 = fixtureLadder({}, { rungs: ['hard'], ideal: c === 'sameAsHard' });
  v2.ladder = { ...v2.ladder, collapsed: collapse(['medium', 'easy']) };
  v2.provenance = { ...v2.provenance, tier: 'X' };
  v2.convergence = fixtureConvergence();
  if (c === 'sameAsHard') {
    const hard = v2.rungs.hard!;
    v2.ideal = {
      ...v2.ideal!,
      schedule: hard.schedule,
      simulation: hard.simulation,
      summary: { ...hard.summary, kind: 'ideal', title: 'Ideal', bindingLimits: [] },
      limitCosts: [],
      gapVsHard: [],
      interactionRemainder: [],
      nothingBinds: true,
      sameAsHard: {
        liftedWithoutEffect: [
          { group: 'trainingDays', label: 'training days', from: '3', to: 'up to 6' },
          { group: 'eatingWindow', label: 'eating window', from: '8 h', to: 'wake + 30 min to 3 h before bed' },
          { group: 'fasting', label: 'longest fast', from: '24 h', to: '72 h' },
        ],
      },
    };
  }
  return v2;
}
