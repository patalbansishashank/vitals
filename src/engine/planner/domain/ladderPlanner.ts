/**
 * Planner v2 coordinator (docs/PLANNER_V2_SPEC.md §1-§4, §9.2): the plan ladder (Hard · Medium · Easy) from one
 * optimiser run with the difficulty axis, then the Ideal plan (practical limits removed, safety and consent kept) and
 * what each binding limit costs. Every number shown comes from the holdout ensemble. `runDomainPlanner` (v1 shape) is
 * a deprecated wrapper over this (`compat.ts`).
 */
import { ENGINE_VERSION } from '../../core/defaults';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { violation, type EvalOutput, type Evaluator } from '../optim/types';
import { GOAL_SCORE_STEP, timeToTarget } from '../optim/goals';
import { formatRelationMessage } from '../optim/conflicts';
import { DEFAULT_PLANNER_ALGORITHM, runPlannerWith, type PlannerAlgorithm } from '../optim/hybrid';
import { STOPPED_BEFORE_PLAN } from './stoppedLadder';
import { TIER_BUDGET_EU, TIER_ENSEMBLE, TIER_HOLDOUT, idealBudgetEU, runPlanner, type OptionSummary, type PlannerCheckpointData, type PlannerConfig, type PlannerProblem, type PlannerProgress, type PlannerResult as OptimResult, type Tier } from '../optim/pipeline';
import { hashString, type Rng } from '../optim/rng';
import { quantileSorted } from '../optim/stats';
import { LIBRARY_VERSION } from './registry/blocks';
import { compileRequest, type PlanningContext } from './context';
import { decodePlan, gridStep as gridStepOf, roundGenome as roundGenomeOf } from './decode';
import { mod24, sleepHoursOf } from './ideal';
import { EvaluatorHost, type EvalVariant, type HostInit, type VariantProblem } from './evaluatorHost';
import { optionName, distinguishingTags, uniqueNames, ruleText } from './explain';
import { FEATURE_SCHEMA, featuresHaveFast, planFacts } from './features';
import { buildGoals, goalSeries } from './goalSpecs';
import { EnginePlanModel, HOLDOUT_DRAW_BASE, MARGIN_IDS, calibrateCushion } from './model';
import { amount, fastingVerdict, goalSteps, inSentence, rivalVerdict, type RivalPlan } from './fastingExplain';
import { stubModules } from './physiology';
import { mutateStructure as mutate, structureGoalClasses, transferGenome as transfer, type SkeletonStructure } from './skeleton';
import { validatePlan } from './validate';
import { ROUTE_MAX_WEEKS, beyondSafetyLimits, canonicalSeeds, routeKind, rungReach, targetReach } from './reach';
import {
  MIN_TOLERANCE_SHARE,
  ablationsFor,
  assessRival,
  buildOption,
  desirabilityFrom,
  equalEnergyFastTwins,
  feasibilityReport,
  goalScoreOf,
  goalSpreads,
  nearestFastingStructures,
  scheduleFor,
  seedOf,
  skeletonFasts,
  timeToTargetRun,
  unlistableWarnings,
  type Assembly,
  type PlannerOptions,
  type RivalRecord,
  type TttResult,
} from './planner';
import { difficulty } from './difficulty';
import { ADVISED_IDEAL, bindingLimits, gMinMetric, idealRequest, limitText, relaxGroup } from './limits';
import { purchaseBurden, type EquipmentForResult } from './equipment';
import { toV1Option } from './compat';
import { easyStartLines } from './easyStarts';
import type {
  ConvergencePoint,
  DifficultyBreakdown,
  GoalOutcome,
  IdealPlanV2,
  LadderInfo,
  LimitBinding,
  LimitCost,
  LimitGroupId,
  PlanOption,
  PlanKind,
  PlannerProgressV2,
  PlannerRequestV2,
  PlannerResultV2,
  PlannerTier,
  RungId,
  RungPlan,
  RungProvenance,
  RungSummary,
  TargetReach,
} from './types';
import { DIFFICULTY_COMPONENTS, RUNG_IDS } from './types';

export interface LadderPlannerOptions extends Omit<PlannerOptions, 'onProgress' | 'tier'> {
  onProgress?: (p: PlannerProgressV2) => void;
  tier?: PlannerTier;
  /** Main search algorithm (default `DEFAULT_PLANNER_ALGORITHM`: the hybrid; 'v2' selectable in dev settings). */
  algorithm?: PlannerAlgorithm;
  /** Run the Ideal plan (default true) and the limit costs (default true; needs the Ideal). */
  ideal?: boolean;
  limitCosts?: boolean;
  /** Tier X checkpoints (§4.9): save every round/stage end; resume continues a saved run of the same request. */
  checkpoint?: { save: (cp: PlannerCheckpointData & { key: string }) => void | Promise<void>; resume?: PlannerCheckpointData; everyEU?: number };
}

const RUNG_TITLE: Readonly<Record<PlanKind, string>> = { hard: 'Hard', medium: 'Medium', easy: 'Easy', ideal: 'Ideal' };
const V1_INDEX: Readonly<Record<RungId, number>> = { hard: 0, medium: 1, easy: 2 };
/** Difficulty weights (equal, §1.7); versioned in provenance. */
export const DIFFICULTY_WEIGHTS: readonly number[] = DIFFICULTY_COMPONENTS.map(() => 1 / DIFFICULTY_COMPONENTS.length);
export const PLANNER_VERSION = 2;

/** Checkpoint key (§4.9): hash of the canonical request, engine version, registry hash, library and planner versions. */
export function checkpointKeyOf(request: PlannerRequestV2): string {
  const { budget: _b, previous: _p, ...rest } = request;
  const canon = JSON.stringify([rest, ENGINE_VERSION, buildModelParams(MODULES).registryHash, LIBRARY_VERSION, PLANNER_VERSION]);
  return `ckpt-${hashString(canon).toString(16)}`;
}

function emptyV2(status: PlannerResultV2['status'], message: string, tier: PlannerTier, seed: string): PlannerResultV2 {
  return {
    status,
    complete: true,
    stoppedAt: null,
    rungs: {},
    ladder: { collapsed: [], checks: { dHM: 0, dME: 0, gowerMin: 0, ordered: true }, frontier: [] },
    ideal: null,
    feasibility: [],
    relations: [],
    noSafePlanReasons: [],
    message,
    stubModules: stubModules(),
    fasting: { offered: false, reason: message, servedGoal: null, tierMaxH: 0 },
    convergence: [],
    provenance: { seed, tier, budgetEU: 0, euUsed: 0, registryHash: buildModelParams(MODULES).registryHash, engineVersion: ENGINE_VERSION, libraryVersion: LIBRARY_VERSION, structures: 0, plannerVersion: 2, holdoutGap: [], difficultyWeights: [...DIFFICULTY_WEIGHTS] },
  };
}

const fmtNum = (x: number) => {
  const v = Math.abs(x);
  return v >= 10 ? String(Math.round(v)) : v >= 1 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString();
};

const TIER_SEARCH: Readonly<Record<string, string>> = { S: 'the quick search', M: 'the earlier search', L: 'the longer search', X: 'the exhaustive search' };

/**
 * Sentence for a collapsed rung (§1.3 "each collapse carries a reason code and a sentence"; plain words). A carried
 * rung that failed (§12.1, `detail.carried`) says which check it failed against the new Hard; Easy's proof of absence
 * (§12.2, `detail.bestG1`) says how close the nearest easier plan came.
 */
export function collapseText(rung: RungId, reason: string, detail: Record<string, number>, goal1: string, fromTier?: string): string {
  const pct = detail.gShare !== undefined && Number.isFinite(detail.gShare) ? Math.round(100 * detail.gShare) : null;
  const name = rung === 'easy' ? 'Easy' : 'Medium';
  if (detail.carried) {
    const src = TIER_SEARCH[fromTier ?? ''] ?? 'the earlier search';
    const Src = src.charAt(0).toUpperCase() + src.slice(1);
    if (detail.gShareCarried !== undefined && Number.isFinite(detail.gShareCarried))
      return `${Src}'s ${name} now reaches only ${Math.round(100 * detail.gShareCarried)} % of the new Hard's ${goal1}${detail.needed !== undefined && Number.isFinite(detail.needed) ? ` (it needs ${Math.round(100 * detail.needed)} %)` : ''}.`;
    if (detail.carriedSafe === 0 || detail.carriedValid === 0 || detail.carriedChance === 0)
      return `${Src}'s ${name} no longer passes the safety checks with the new numbers.`;
    if (reason === 'tooClose') return `${Src}'s ${name} is now almost as much effort as the new Hard.`;
    if (reason === 'notDistinct') return `${Src}'s ${name} would now repeat ${rung === 'medium' ? 'Hard or Easy' : 'the new Hard'} with small changes.`;
  }
  // Medium copies Easy's failure (§12.8): Hard and the nearest easier plan are too alike, so nothing fits between them
  if (rung === 'medium' && detail.viaEasy === 1 && (reason === 'tooClose' || reason === 'notDistinct'))
    return reason === 'tooClose'
      ? `The nearest easier plan is almost as much effort as Hard, so there is no room for a plan in between.`
      : `Hard and the nearest easier plan are almost the same plan, so there is no room for a plan in between.`;
  switch (reason) {
    case 'tooClose':
      return rung === 'medium'
        ? `${pct !== null ? `Easy already reaches ${pct} % of Hard's ${goal1}` : `Easy and Hard are close in effort`}; a plan in between would buy little.`
        : `An easier plan would be almost as much effort as Hard, so it would not be a real choice.`;
    case 'notDistinct':
      return `It would repeat ${rung === 'medium' ? 'Hard or Easy' : 'Hard'} with small changes.`;
    case 'belowMinimal':
      return `Your goal is small enough that the least change that gets a worthwhile result is Hard itself.`;
    case 'stopped':
      return `The search was stopped before ${name} was found or checked.`;
    default:
      if (rung === 'easy' && detail.bestG1 !== undefined && Number.isFinite(detail.bestG1) && detail.closestD !== undefined && Number.isFinite(detail.closestD))
        return `No plan with less effort than Hard reaches half of Hard's ${goal1}: the closest reached ${Math.round(100 * detail.bestG1)} % at effort ${Math.round(100 * detail.closestD)}.`;
      return rung === 'easy'
        ? `No plan with less effort than Hard reaches at least half of Hard's ${goal1} within your limits.`
        : `No plan between Easy and Hard stands out within your limits.`;
  }
}


/** Ladder hypervolume of {(g, 1 − D)} with reference (0, 0). */
export function ladderHypervolume(points: ReadonlyArray<{ g: number; D: number }>): number {
  const pts = points.map((p) => ({ x: Math.max(0, p.g), y: Math.max(0, 1 - p.D) })).sort((a, b) => b.x - a.x || b.y - a.y);
  let hv = 0;
  let yMax = 0;
  for (const p of pts) {
    if (p.y <= yMax) continue;
    hv += p.x * (p.y - yMax);
    yMax = p.y;
  }
  return hv;
}


/**
 * Run the planner v2 for a request. Deterministic in (request, seed, tier) for any worker count. Returns the ladder, the
 * Ideal (unless `ideal: false`) and the limit costs (unless `limitCosts: false`).
 */
export async function runLadderPlanner(request: PlannerRequestV2, opts: LadderPlannerOptions = {}): Promise<PlannerResultV2> {
  const seed = seedOf(request);
  const tier: PlannerTier = opts.tier ?? (request.budget?.tier as PlannerTier | undefined) ?? 'S';
  const ctx = compileRequest(request);
  if (ctx.caps.blocked) return emptyV2('blocked', ctx.caps.blocked, tier, seed);
  if (ctx.problems.length) return emptyV2('invalid', ctx.problems.join(' '), tier, seed);
  const wantIdeal = opts.ideal !== false;
  const wantCosts = wantIdeal && opts.limitCosts !== false;

  const ensembleSize = request.budget?.ensembleSize ?? TIER_ENSEMBLE[tier as Tier];
  // holdout ensemble (§4.7); an explicit ensemble size (tests, small budgets) sizes both ensembles
  const holdoutSize = ensembleSize > 0 ? (request.budget?.ensembleSize ?? TIER_HOLDOUT[tier as Tier]) : 0;
  const init0: HostInit = { request, ensemble: { seed, size: ensembleSize, holdoutSize } };
  let cushion: number[] | undefined;
  let goalSpread: number[] | null = null;
  if (ensembleSize > 0 && opts.calibrateCushion !== false) {
    const pv = new EvaluatorHost(init0).variant({ kind: 'main' });
    const draws = Math.min(ensembleSize, 12);
    const corner = (st: SkeletonStructure, deficit: boolean): Float64Array =>
      Float64Array.from(st.genes, (g, i) => {
        if (/\.energy$/.test(g.path)) return deficit ? 0 : 1;
        if (/^(cardio\.|rt\.|steps$)/.test(g.path)) return deficit ? 1 : 0;
        return st.x0[i]!;
      });
    const margins: Float64Array[][] = [];
    const goalDraws: Float64Array[][] = [];
    for (const st of pv.structures.slice(1, 5)) {
      for (const x of [Float64Array.from(st.x0), corner(st, true), corner(st, false)]) {
        const sched = pv.model.repair(st, pv.model.decode(st, x)).schedule;
        const ms: Float64Array[] = [];
        const gs: Float64Array[] = [];
        for (let m = 0; m < draws; m++) {
          const sim = pv.model.simulate(sched, m);
          ms.push(pv.model.constraints(sim, sched));
          gs.push(pv.model.goals(sim));
        }
        margins.push(ms);
        goalDraws.push(gs);
      }
    }
    cushion = Array.from(calibrateCushion(margins));
    goalSpread = goalSpreads(goalDraws, ctx.goals.length);
  }
  const init: HostInit = { ...init0, ...(cushion ? { cushion } : {}) };
  const localHost = new EvaluatorHost(init);
  const evaluatorFor = opts.evaluatorFor ?? ((v: EvalVariant) => ({ evaluate: (batch: Parameters<Evaluator['evaluate']>[0]) => localHost.evaluate(v, batch) }));
  const bandsFor: NonNullable<PlannerOptions['bandsFor']> =
    opts.bandsFor ?? (async (v, structure, x, draws, series, _o, base) => localHost.bands(v, structure, x, draws, series, base ?? 0));
  const main = localHost.variant({ kind: 'main' });

  const baseSched = main.model.repair(main.structures[0]!, main.model.decode(main.structures[0]!, new Float64Array(0))).schedule;
  const baseSim = main.model.simulate(baseSched, -1);
  const start = main.bindings.map((b) => {
    const y = goalSeries(baseSim, b, ctx);
    return y ? y[0]! : NaN;
  });
  const goals = buildGoals(ctx, start);
  if (goalSpread) goals.specs.forEach((sp, i) => {
    const w = goalSpread![i]!;
    if (Number.isFinite(w) && w > 0) sp.minTolerance = MIN_TOLERANCE_SHARE * w;
  });
  const full = new EnginePlanModel(ctx, { bindings: goals.bindings, ensemble: init.ensemble, recordAll: true, fullMode: true });
  const a: Assembly = { ctx, goals, full, main };

  // ---------------------------------------------------------------- progress (v2 events; rung changes never throttled)
  const now = opts.now;
  const interval = opts.progressIntervalMs ?? 250;
  let lastEmit = -Infinity;
  let lastSig = '';
  let lastStage = '';
  let lastV2: PlannerProgressV2 | null = null;
  const provCache = new Map<string, NonNullable<PlannerProgressV2['provisional']['hard']>>();
  const provisionalOf = (s: OptionSummary & { D?: number }) => {
    const key = `${s.structure}|${Array.from(s.x, (v) => v.toFixed(6)).join(',')}`;
    let p = provCache.get(key);
    if (!p) {
      const { schedule, plan } = scheduleFor(a, s.structure, s.x);
      const pct = Array.from(s.percentOfPossible, (v, k) => {
        const isKeep = goals.specs[k]?.keep !== undefined;
        const x = isKeep ? Math.min(1, s.desirability[k]!) : v;
        return Number.isFinite(x) ? Math.round(1000 * x) / 10 : 0;
      });
      p = { structureId: s.structureId, title: optionName(ctx, schedule, plan), D: s.D ?? NaN, percentOfAchievable: pct, schedule };
      provCache.set(key, p);
    }
    return p;
  };
  // the rungs of the last event: an event without rung information (a convergence point) repeats them, so a rung never
  // disappears from the run view once it was shown
  let lastRungs: Partial<Record<PlanKind, OptionSummary & { D?: number }>> = {};
  const emit = (stage: string, euUsed: number, euBudget: number, rungsIn: Partial<Record<PlanKind, OptionSummary & { D?: number }>>, score: number | null, convergence?: ConvergencePoint, force = false) => {
    if (!opts.onProgress) return;
    const rungs = Object.keys(rungsIn).length ? { ...lastRungs, ...rungsIn } : lastRungs;
    lastRungs = rungs;
    const provisional: PlannerProgressV2['provisional'] = {};
    for (const [k, s] of Object.entries(rungs) as Array<[PlanKind, OptionSummary & { D?: number }]>) if (s) provisional[k] = provisionalOf(s);
    const sig = (Object.keys(provisional) as PlanKind[]).map((k) => `${k}:${provisional[k]!.structureId}:${provisional[k]!.percentOfAchievable.join(',')}`).join('|');
    const changed = sig !== lastSig;
    const t = now ? now() : 0;
    if (!force && now && !changed && stage === lastStage && !convergence && t - lastEmit < interval) return;
    lastEmit = t;
    lastSig = sig;
    lastStage = stage;
    lastV2 = { stage, fraction: Math.min(1, euUsed / Math.max(1, euBudget)), euUsed, euBudget, score: score ?? lastV2?.score ?? null, provisional, changed, ...(convergence ? { convergence } : {}) };
    opts.onProgress(lastV2);
  };
  const late = (stage: string) => {
    if (!opts.onProgress || !lastV2) return;
    opts.onProgress({ ...lastV2, stage, fraction: Math.max(lastV2.fraction, 0.99), changed: false });
  };

  // ---------------------------------------------------------------- main run: race, stages, QD, ladder, robust (P0-P5, P7)
  const totalTier = request.budget?.totalEU ?? opts.totalEU ?? TIER_BUDGET_EU[tier as Tier];
  const idealEU = wantIdeal ? idealBudgetEU(tier as Tier, totalTier) : 0;
  const seeds = canonicalSeeds(ctx, main.structures);
  const g1Min = gMinMetric(ctx, 0);
  const problem: PlannerProblem<SkeletonStructure> = {
    structures: main.structures,
    goals: goals.specs,
    baseline: { structure: 0, x: [] },
    ...(seeds.length ? { seeds } : {}),
    mutateStructure: (() => {
      const cache = new Map<number, number[]>();
      return (s: number, rng: Rng) => mutate(main.structures, s, rng, cache);
    })(),
    transferGenome: (f, t, x) => transfer(main.structures[f]!, main.structures[t]!, x),
    roundGenome: (s, x) => roundGenomeOf(ctx, main.structures[s]!, x),
    gridStep: (s) => gridStepOf(main.structures[s]!),
    validate: (s, x) => {
      const st = main.structures[s]!;
      const sched = main.model.repair(st, main.model.decode(st, x)).schedule;
      const v = validatePlan(ctx, sched);
      if (!v.ok) return v;
      const bad = unlistableWarnings(ctx, sched, full.simulate(sched, -1));
      return bad.length ? { ok: false, reasons: bad.map((w) => `simulator ${w.severity} ${w.id} (days ${w.startDay + 1}-${w.endDay + 1})`) } : v;
    },
    ablations: (s, x) => ablationsFor(main.structures, s, x),
    featureSchema: FEATURE_SCHEMA,
    ladder: {
      gMinMetric: g1Min ?? Number.NaN,
      // the Ideal (P6) runs on top of the tier total; the optimiser reports its budget only when it runs
      reserveIdeal: wantIdeal,
      ...(request.ladder?.easyShare !== undefined ? { easyShare: request.ladder.easyShare } : {}),
      ...(request.ladder?.mediumFallbackShare !== undefined ? { mediumShare: request.ladder.mediumFallbackShare } : {}),
    },
    structureTags: (s: number) => structureGoalClasses(ctx, main.structures[s]!.skeleton),
    easyStarts: (s: number, xHard: Float64Array) => easyStartLines(ctx, s, main.structures[s]!, xHard),
    ...(ctx.fastingRelevant ? { group: (s: number, out: EvalOutput) => (skeletonFasts(main.structures[s]!.skeleton) && featuresHaveFast(out.features) ? 'fast' : null) } : {}),
  };
  const ckptKey = checkpointKeyOf(request);
  const cfg: PlannerConfig = {
    seed,
    tier: tier as Tier,
    ensembleSize,
    holdoutSize,
    strictness: request.strictness ?? 'balanced',
    // the run spends the whole tier total; the Ideal and the limit costs spend idealBudgetEU on top
    totalEU: totalTier,
    ...(opts.pipeline ?? {}),
  };
  if (now) cfg.now = now;
  if (opts.signal) cfg.signal = opts.signal;
  // §12.1: the previous ladder of the same request, by structure id (a structure this request no longer has is skipped)
  if (request.previous) {
    const at = new Map(main.structures.map((st, i) => [st.id, i] as const));
    const prevRungs: NonNullable<PlannerConfig['previous']>['rungs'] = {};
    // Hard is weighed only by a stopped run (pipeline finish)
    for (const r of ['hard', 'medium', 'easy'] as const) {
      const g = request.previous.rungs[r];
      const i = g ? at.get(g.structureId) : undefined;
      if (g && i !== undefined) prevRungs[r] = { structure: i, x: g.x };
    }
    if (prevRungs.medium || prevRungs.easy || prevRungs.hard) cfg.previous = { tier: request.previous.tier, rungs: prevRungs };
  }
  if (opts.checkpoint) cfg.checkpoint = { save: (cp) => opts.checkpoint!.save({ ...cp, key: ckptKey }), ...(opts.checkpoint.resume ? { resume: opts.checkpoint.resume } : {}), ...(opts.checkpoint.everyEU ? { everyEU: opts.checkpoint.everyEU } : {}) };
  if (opts.onProgress) {
    cfg.onProgress = (p: PlannerProgress) => {
      const r = p.rungs ?? {};
      const rungs: Partial<Record<PlanKind, OptionSummary & { D?: number }>> = {};
      if (r.hard ?? p.provisional) rungs.hard = (r.hard ?? p.provisional)!;
      if (r.medium) rungs.medium = r.medium;
      if (r.easy) rungs.easy = r.easy;
      emit(p.stage, p.euUsed, p.euBudget + idealEU, rungs, rungs.hard ? +rungs.hard.utility.toFixed(4) : null, p.convergence);
    };
    cfg.onConvergence = (c) => emit(c.stage, c.eu, totalTier, {}, null, c);
  }
  const res = await runPlannerWith(opts.algorithm ?? DEFAULT_PLANNER_ALGORITHM, problem, evaluatorFor({ kind: 'main' }, init), cfg);
  opts.onOptimResult?.(res);
  const aborted = () => !!opts.signal?.aborted;

  const labels = ctx.goals.map((g) => g.def.label);
  const relations = res.relations.map((m) => formatRelationMessage(m, labels));
  const reach: Array<TargetReach | null> = ctx.goals.map((g, i) => (goals.targets[i] !== null && routeKind(g) ? targetReach(ctx, i) : null));
  const ttt = new Map<number, TttResult>();
  if (opts.timeToTarget !== false && res.complete && !aborted()) {
    for (let i = 0; i < ctx.goals.length; i++) {
      if (res.feasibility[i]?.status !== 'unattainable' || goals.targets[i] === null) continue;
      if (reach[i]?.supported) continue;
      if (beyondSafetyLimits(ctx, i, goals.targets[i]!)) continue;
      late('ttt');
      const plans: Array<{ structure: number; x: Float64Array }> = [];
      const anchor = res.anchors?.[i];
      if (anchor) plans.push({ structure: anchor.structure, x: anchor.x });
      if (res.options[0]) plans.push({ structure: res.options[0].structureIndex, x: res.options[0].x });
      ttt.set(i, await timeToTargetRun(init, ctx, goals, i, { ...(opts.signal ? { signal: opts.signal } : {}), tier: tier === 'X' ? 'L' : tier }, evaluatorFor, { structures: main.structures, plans }));
    }
  }
  late('S6');

  // ---------------------------------------------------------------- fasting rival (§3.6), one search shared by all rungs
  const hardRes = res.options[0];
  let fastCmp: { rival: RivalPlan | null; steps: Float64Array } | null = null;
  let rivalD = Number.NaN;
  if (ctx.fastingRelevant && res.options.some((o) => !featuresHaveFast(o.output.features))) {
    const steps = goalSteps(goals.specs.map((sp) => sp.minTolerance), res.goals.scales.map((sc) => sc.u - sc.b));
    const cands: Array<RivalRecord & { D: number }> = [];
    const gb = res.groupBest?.fast;
    const evalRecs = async (props: Array<{ structure: number; x: Float64Array }>, firstOnly: boolean) => {
      for (let i = 0; i < props.length; i += firstOnly ? 1 : props.length) {
        const batch = firstOnly ? [props[i]!] : props;
        const outs = await evaluatorFor({ kind: 'main' }, init).evaluate(batch.map((p) => ({ ...p, draw: -1 })));
        let found = false;
        outs.forEach((out, j) => {
          if (!featuresHaveFast(out.features)) return;
          const d = desirabilityFrom(res, goals.specs, out.goals);
          const p = batch[j]!;
          cands.push({ structure: p.structure, x: p.x, desirability: d, goalScore: goalScoreOf(res, d), vS: violation(out.margins), violated: Array.from(out.margins).flatMap((m, c) => (m < 0 || Number.isNaN(m) ? [c] : [])), reg: out.regulariser, D: out.descriptors[0] ?? NaN });
          found = true;
        });
        if (firstOnly && found) return;
      }
    };
    if (hardRes && !aborted() && !featuresHaveFast(hardRes.output.features)) await evalRecs(equalEnergyFastTwins(ctx, main.structures, hardRes.structureIndex, hardRes.x).slice(0, 4), false);
    if (!cands.length && gb) {
      const [o] = await evaluatorFor({ kind: 'main' }, init).evaluate([{ structure: gb.structure, x: gb.x, draw: -1 }]);
      cands.push({ structure: gb.structure, x: gb.x, desirability: gb.desirability, goalScore: gb.goalScore, vS: gb.vS, violated: gb.violated, reg: gb.regulariser, D: o?.descriptors[0] ?? NaN });
    }
    if (!cands.length && hardRes && !aborted())
      await evalRecs(nearestFastingStructures(main.structures, hardRes.structureIndex, 4).map((j) => ({ structure: j, x: transfer(main.structures[hardRes.structureIndex]!, main.structures[j]!, hardRes.x) })), true);
    const level = (g: number) => Math.floor(g / GOAL_SCORE_STEP + 1e-9);
    const rec = cands.reduce<(RivalRecord & { D: number }) | null>((m, c) => (!m || c.vS < m.vS || (c.vS === m.vS && (level(c.goalScore) > level(m.goalScore) || (level(c.goalScore) === level(m.goalScore) && (c.reg < m.reg || (c.reg === m.reg && c.goalScore > m.goalScore))))) ? c : m), null);
    const chanceOf =
      ensembleSize > 0 && !aborted()
        ? async (structure: number, x: Float64Array) => {
            const outs = await evaluatorFor({ kind: 'main' }, init).evaluate(Array.from({ length: ensembleSize }, (_, m) => ({ structure, x, draw: m })));
            let worst: string | null = null;
            let wv = 0;
            const C = outs[0]?.margins.length ?? 0;
            for (let c = 0; c < C; c++) {
              const col = outs.map((q) => q.margins[c]!).sort((p, q) => p - q);
              const p10 = quantileSorted(col, 0.1);
              if (p10 < wv) {
                wv = p10;
                worst = MARGIN_IDS[c] ?? String(c);
              }
            }
            return { ok: worst === null, worst };
          }
        : null;
    rivalD = rec?.D ?? NaN;
    fastCmp = { rival: rec ? await assessRival(a, rec, chanceOf) : null, steps };
  }

  // ---------------------------------------------------------------- rungs (P8): options in rung order
  const lad = res.ladder ?? null;
  const rungOf = (k: number): RungId => (res.options[k] as { rung?: RungId }).rung ?? RUNG_IDS[k] ?? 'easy';
  // a stopped run whose own Hard has not reached goal 1's least worthwhile change (g_min, the floor every rung must clear)
  // is a barely searched start point (stopped in the first phase), not a plan: none is shown and the result says the
  // search stopped before it found one. A Hard carried from the previous search is that search's plan and stays.
  const hardOpt0 = res.options.find((_, k) => rungOf(k) === 'hard') as { provenance?: RungProvenance } | undefined;
  const stoppedBeforePlan = aborted() && !!lad && !!hardOpt0 && hardOpt0.provenance !== 'carried' && !(lad.gHard >= lad.gMin && lad.gHard > 0);
  const builtRaw = await Promise.all(
    (stoppedBeforePlan ? [] : res.options).map(async (_, k) => {
      const b = await buildOption(a, res, k, relations, bandsFor, holdoutSize, fastCmp, { kind: 'main' }, HOLDOUT_DRAW_BASE, { ideal: false });
      return b ? { k, b } : null;
    }),
  );
  const built = builtRaw.filter((x): x is NonNullable<typeof x> => x !== null);
  const hardBuilt = built.find((x) => rungOf(x.k) === 'hard') ?? built[0];
  // an easier rung without a fast whose rival beats it on the goals: the rival is above this rung's difficulty, or it lost
  // to Hard on the goals (said with Hard's numbers) — PLANNER_V2_SPEC §3.6 reason 'difficulty'
  if (fastCmp?.rival && hardBuilt)
    for (const x of built) {
      const f = x.b.option.fasting;
      if (x === hardBuilt || !f?.rival || (f.rival.reason !== 'shortlist' && f.rival.reason !== 'alternative')) continue;
      const D = res.options[x.k]!.output.descriptors[0] ?? NaN;
      const v = rivalVerdict(ctx, fastCmp.rival, x.b.side, fastCmp.steps, hardBuilt.b.side);
      const harder = Number.isFinite(rivalD) && Number.isFinite(D) && rivalD > D + 0.02;
      let vv = v;
      if (harder) {
        // "A plan with a 48-hour fast reaches 0.4 kg more fat loss but is harder than Easy allows; see Hard."
        const gain = v.goalDeltas.find((d) => (goals.specs[d.goal]!.sense === 'min' ? -d.delta : d.delta) > 0);
        const lab = gain ? ctx.goals[gain.goal]!.def.label : null;
        const more = gain && lab ? ` reaches ${amount(Math.abs(gain.delta))} ${gain.unit} more ${inSentence(lab)}${goals.specs[gain.goal]!.sense === 'min' ? ' loss' : ''}, but` : '';
        vv = { ...v, reason: 'difficulty', text: `A plan with ${fastCmp.rival.phrase} was considered. It${more} is harder than the ${RUNG_TITLE[rungOf(x.k)]} plan allows; see the Hard plan.` };
      }
      const fv = fastingVerdict(ctx, f.kind ?? 'none', f.longestFastH ?? 0, '', vv, null);
      const at = x.b.option.explanation.indexOf(f.text);
      if (at >= 0) x.b.option.explanation[at] = fv.text;
      x.b.option.fasting = fv;
    }
  const names = built.map((x) => optionName(ctx, x.b.option.schedule, x.b.plan, x.b.option.simulation));
  const extras = built.map((x) => distinguishingTags(x.b.option.schedule, x.b.plan));
  uniqueNames(names, extras).forEach((n, i) => (built[i]!.b.option.name = n));
  built.forEach((x) => (x.b.option.id = (['A', 'B', 'C'] as const)[V1_INDEX[rungOf(x.k)]]!));

  // per-rung summaries
  const hardOpt = hardBuilt?.b.option ?? null;
  const tttWeeks: Partial<Record<RungId, Array<number | null>>> = {};
  const summaries = new Map<RungId, RungSummary>();
  for (const rung of RUNG_IDS) {
    const x = built.find((y) => rungOf(y.k) === rung);
    if (!x) continue;
    const o = res.options[x.k]!;
    const { schedule, log } = scheduleFor(a, o.structureIndex, o.x);
    const eq = x.b.equipment;
    // D of the plan as prescribed (the composed sessions when a training profile was given), nominal planner-mode run
    const nominal = main.model.simulate(x.b.option.schedule, -1);
    const diff = difficulty(ctx, x.b.option.schedule, nominal, { purchaseBurden: purchaseBurden(eq?.required ?? []) });
    const binding = bindingLimits(ctx, main.structures[o.structureIndex]!, o.x, schedule, log, o.output.margins);
    const outcomes = goalOutcomes(rung, x.b.option, hardOpt, reach, ttt, tttWeeks, diff.D);
    summaries.set(rung, summaryOf(rung, x.b.option, diff, outcomes, binding, eq, ctx));
  }

  const rungs: PlannerResultV2['rungs'] = {};
  for (const x of built) {
    const rung = rungOf(x.k);
    const s = summaries.get(rung);
    if (!s) continue;
    const o = res.options[x.k]!;
    rungs[rung] = toRungPlan(rung, x.b.option, s, main.structures[o.structureIndex]!.id, o.x, x.b.equipment?.sessions);
    const prov = (o as { provenance?: RungProvenance }).provenance ?? 'own';
    rungs[rung]!.provenance = prov;
    if (prov === 'carried' && cfg.previous) rungs[rung]!.fromTier = cfg.previous.tier as PlannerTier;
  }

  const collapsed: LadderInfo['collapsed'] = (lad?.collapsed ?? [])
    .filter((c) => !rungs[c.rung])
    .map((c) => ({
      rung: c.rung,
      reason: c.reason,
      text: collapseText(c.rung, c.reason, c.detail ?? {}, (labels[0] ?? 'goal').toLowerCase(), cfg.previous?.tier),
      detail: { ...(c.detail ?? {}) },
      ...(c.detail?.carried ? { carried: true } : {}),
    }));
  // a rung missing without a reason: a stopped run never proved it absent, so it says it stopped ('infeasible' needs a proof)
  const missingReason = res.complete && !aborted() ? 'infeasible' : 'stopped';
  for (const r of ['medium', 'easy'] as const)
    if (!rungs[r] && !collapsed.some((c) => c.rung === r) && rungs.hard)
      collapsed.push({ rung: r, reason: missingReason, text: collapseText(r, missingReason, {}, (labels[0] ?? 'goal').toLowerCase()), detail: {} });
  const ladder: LadderInfo = {
    collapsed,
    easyProof: !rungs.easy && lad?.easySearch?.proof ? { ...lad.easySearch.proof, rejected: lad.easySearch.proof.rejected.map((q) => ({ ...q })) } : null,
    checks: lad?.checks ?? { dHM: 0, dME: 0, gowerMin: 0, ordered: true },
    frontier: (lad?.staircase ?? []).map((p) => ({ D: p.D, g: p.g })),
  };

  // ---------------------------------------------------------------- Ideal (P6) and limit costs (§2)
  let ideal: IdealPlanV2 | null = null;
  if (wantIdeal && !aborted() && (rungs.hard || res.noSafePlan)) {
    late('ideal');
    ideal = await runIdeal({ request, init, tier, idealEU, variantOf: (v) => localHost.variant(v), evaluatorFor, bandsFor, holdoutSize, ensembleSize, a, res, rungs, wantCosts, seed, summaries, ...(opts.signal ? { signal: opts.signal } : {}) });
  }

  // the Ideal search did not run because the person stopped the search: said, not silently absent (§12.3)
  const idealSkipped = wantIdeal && !ideal && rungs.hard && aborted() ? ('stopped' as const) : null;

  const optionsV1 = RUNG_IDS.flatMap((r) => (rungs[r] ? [toV1Option(rungs[r]!)] : []));
  const noSafe = res.noSafePlan;
  const reasons = noSafe ? noSafe.violated.map((j) => `Would break ${ruleText(MARGIN_IDS[j] ?? String(j))}.`) : [];
  const status: PlannerResultV2['status'] = rungs.hard ? 'ok' : 'noSafePlan';
  const convergence: ConvergencePoint[] = res.convergence ?? [];
  return {
    status,
    complete: res.complete && !aborted(),
    stoppedAt: res.stoppedAt,
    rungs,
    ladder,
    ideal,
    ...(idealSkipped ? { idealSkipped } : {}),
    feasibility: feasibilityReport(a, res, ttt, reach, optionsV1),
    relations,
    noSafePlanReasons:
      status === 'noSafePlan' && !reasons.length && !stoppedBeforePlan
        ? [res.shortfall === 'noCandidates' ? 'No plan satisfied every safety limit and your constraints.' : 'No plan stayed within every safety limit across the model’s uncertainty range; a longer horizon or less ambitious targets may help.']
        : reasons,
    message: stoppedBeforePlan ? STOPPED_BEFORE_PLAN : status === 'noSafePlan' ? 'No safe plan was found for these goals and limits.' : null,
    stubModules: stubModules(),
    fasting: { offered: ctx.fastingRelevant, reason: ctx.fastingReason, servedGoal: ctx.fastingServedGoal, tierMaxH: ctx.caps.maxFastH },
    convergence,
    provenance: {
      seed,
      tier,
      budgetEU: res.provenance.budgetEU + idealEU,
      euUsed: res.provenance.euUsed + (ideal ? ideal.limitCosts.reduce((s, c) => s + c.euSpent, 0) : 0),
      registryHash: buildModelParams(MODULES).registryHash,
      engineVersion: ENGINE_VERSION,
      libraryVersion: LIBRARY_VERSION,
      structures: main.structures.length,
      plannerVersion: 2,
      holdoutGap: res.holdoutGap ?? [],
      difficultyWeights: [...DIFFICULTY_WEIGHTS],
      ...(tier === 'X' ? { checkpointKey: ckptKey } : {}),
    },
  };

  // ---------------------------------------------------------------- helpers bound to this run
  function goalOutcomes(rung: RungId, o: PlanOption, hard: PlanOption | null, reachAll: ReadonlyArray<TargetReach | null>, tttAll: Map<number, TttResult>, weeksSoFar: Partial<Record<RungId, Array<number | null>>>, dRung: number): GoalOutcome[] {
    const wk: Array<number | null> = [];
    const out = o.scorecard.map((sc, i): GoalOutcome => {
      const p50 = sc.band?.p50 ?? sc.value;
      const hp = hard?.scorecard[i];
      const hardP50 = hp ? (hp.band?.p50 ?? hp.value) : p50;
      const t = rungTtt(rung, i, o, reachAll[i] ?? null, tttAll.get(i) ?? null, weeksSoFar, dRung);
      // Infinity marks "more than two years" so easier rungs inherit it in the monotonicity clamp of `rungTtt`
      wk.push(t.beyond ? Infinity : t.weeks);
      return {
        goal: i,
        metric: sc.metric,
        label: sc.label,
        unit: sc.unit,
        p50,
        band: sc.band ? { p10: sc.band.p10, p90: sc.band.p90 } : null,
        change: p50 - sc.start,
        start: sc.start,
        target: sc.target,
        pTargetMet: sc.band?.pTargetMet ?? null,
        percentOfAchievable: sc.percentOfAchievable,
        verdict: sc.verdict ?? null,
        weeksToTarget: t.weeks,
        beyondTwoYears: t.beyond,
        tttSource: t.source,
        tttText: t.text,
        vsHard: rung === 'hard' ? 0 : p50 - hardP50,
        grade: sc.grade,
      };
    });
    weeksSoFar[rung] = wk;
    return out;
  }

  /**
   * Time to target per rung (PLANNER_V2_SPEC §1.4): the rung's own crossing inside the horizon; else `rungReach` — the
   * fastest-safe route family at the intensity whose first-12-week D fits this rung's D (a rung at the safe rate gets the
   * pre-run hint verbatim). Final clamp (spec consistency rule): weeks(Easy) ≥ weeks(Medium) ≥ weeks(Hard) and Hard ≥ the
   * fastest-safe weeks, applied to route answers only (an own-run crossing is what the plan's own run shows and is never
   * moved); a harder rung at "more than two years" makes the easier ones the same. Fallback when no route family exists
   * for the goal (e.g. non-body-composition targets): Hard reads the search's time-to-target run, easier rungs extrapolate
   * their own pace over the last 8 weeks.
   */
  function rungTtt(rung: RungId, i: number, o: PlanOption, r: TargetReach | null, t: TttResult | null, weeksSoFar: Partial<Record<RungId, Array<number | null>>>, dRung: number): { weeks: number | null; beyond: boolean; source: GoalOutcome['tttSource']; text: string | null } {
    const target = goals.targets[i];
    if (target === null || target === undefined || goals.specs[i]!.keep !== undefined) return { weeks: null, beyond: false, source: null, text: null };
    const b = goals.bindings[i]!;
    const y = goalSeries(o.simulation, b, ctx);
    const direction: 1 | -1 = goals.specs[i]!.sense === 'min' ? -1 : 1;
    if (y) {
      const hit = timeToTarget(y, target, direction).tHit;
      if (hit !== null) {
        const w = Math.max(1, Math.ceil(hit / 7));
        return { weeks: w, beyond: false, source: 'ownRun', text: `reached in about ${w} weeks` };
      }
    }
    // weeks of the harder rungs (Infinity = more than two years) and, for Hard, the fastest safe rate
    const harder: RungId[] = rung === 'medium' ? ['hard'] : rung === 'easy' ? ['medium', 'hard'] : [];
    const floor = Math.max(rung === 'hard' ? (r?.weeks ?? t?.weeks ?? 0) : 0, ...harder.map((h) => weeksSoFar[h]?.[i] ?? 0));
    const beyond2y = { weeks: null, beyond: true, source: 'route' as const, text: `At this plan's effort it takes more than two years.` };
    if (r?.supported) {
      const rr = Number.isFinite(dRung) ? rungReach(ctx, i, dRung) : null;
      if (rr) {
        if (floor === Infinity) return beyond2y;
        if (rr.weeks === null) return { weeks: null, beyond: rr.beyondTwoYears, source: 'route', text: rr.text };
        if (rr.weeks >= floor) return { weeks: rr.weeks, beyond: false, source: 'route', text: rr.text };
        // clamped up to a harder rung's answer (bisection and weekly rounding noise only)
        const w = floor;
        return w > ROUTE_MAX_WEEKS ? beyond2y : { weeks: w, beyond: false, source: 'route', text: rr.alpha === 1 && rung === 'hard' ? rr.text : `At this plan's effort it takes about ${w} weeks.` };
      }
      // the route family could not be built: Hard keeps the fastest-safe answer (fallback below for the others)
      if (rung === 'hard') {
        if (r.beyondTwoYears || r.weeks === null) return { weeks: null, beyond: r.beyondTwoYears, source: 'route', text: r.text };
        return { weeks: r.weeks, beyond: false, source: 'route', text: r.text };
      }
    }
    // fallback: own pace over the last 8 weeks, extrapolated (an estimate at this plan's effort)
    if (floor === Infinity) return beyond2y;
    let weeks: number | null = null;
    if (y) {
      const Tn = y.length - 1;
      const w = Math.min(56, Tn);
      const rate = w > 0 ? (direction * (y[Tn]! - y[Tn - w]!)) / (w / 7) : 0;
      const gap = direction * (target - y[Tn]!);
      if (rate > 1e-6) weeks = Math.ceil(Tn / 7 + gap / rate);
    }
    if (weeks !== null) weeks = Math.max(weeks, floor || 0);
    if (weeks === null || weeks > ROUTE_MAX_WEEKS) return beyond2y;
    return { weeks, beyond: false, source: 'route', text: `At this plan's effort it takes about ${weeks} weeks.` };
  }

  function summaryOf(rung: PlanKind, o: PlanOption, diff: DifficultyBreakdown, outcomes: GoalOutcome[], binding: LimitBinding[], eq: EquipmentForResult | null, c: PlanningContext): RungSummary {
    const f = planFacts(c, o.schedule);
    let mins = 0;
    let win = 0;
    let eat = 0;
    for (let d = 0; d < f.kcal.length; d++) {
      mins += f.rtMin[d]! + f.cardioMin[d]!;
      if (!f.zero[d]) {
        win += f.windowLen[d]!;
        eat++;
      }
    }
    return {
      kind: rung,
      title: RUNG_TITLE[rung],
      subtitle: o.name,
      difficulty: diff,
      outcomes,
      weeklyTrainingMin: Math.round((7 * mins) / Math.max(1, f.kcal.length)),
      meanWindowH: eat ? Math.round((10 * win) / eat) / 10 : 0,
      hunger: o.hunger,
      fasting: o.fasting ?? { used: false, kind: 'none', longestFastH: 0, text: '' },
      bindingLimits: binding,
      equipment: eq && (eq.text || eq.required.length || eq.optional.length) ? { required: eq.required, optional: eq.optional, text: eq.text } : { required: [], optional: [], text: 'nothing to buy' },
      safetyItems: o.safetyItems ?? [],
    };
  }
}

function toRungPlan(rung: RungId, o: PlanOption, summary: RungSummary, structureId: string, x: Float64Array, sessions?: RungPlan['sessions']): RungPlan {
  const { id: _id, aBeatsThisShare, scorecard, fasting, ...rest } = o;
  return {
    ...rest,
    kind: rung,
    summary,
    scorecard: scorecard.map(({ costVsA, ...s }) => ({ ...s, costVsHard: costVsA })),
    fasting: fasting ?? summary.fasting,
    genome: { structureId, x: Array.from(x) },
    hardBeatsThisShare: aBeatsThisShare,
    ...(sessions?.length ? { sessions } : {}),
  };
}

interface IdealArgs {
  request: PlannerRequestV2;
  init: HostInit;
  tier: PlannerTier;
  idealEU: number;
  variantOf: (v: EvalVariant) => VariantProblem;
  evaluatorFor: (v: EvalVariant, init: HostInit) => Evaluator;
  bandsFor: NonNullable<PlannerOptions['bandsFor']>;
  holdoutSize: number;
  ensembleSize: number;
  a: Assembly;
  res: OptimResult<SkeletonStructure>;
  rungs: PlannerResultV2['rungs'];
  wantCosts: boolean;
  seed: string;
  summaries: Map<RungId, RungSummary>;
  signal?: { readonly aborted: boolean };
}

const skKey = (st: SkeletonStructure) => {
  const { segments, overlay, event, creatine, omega3, viscousFibre } = st.skeleton;
  return JSON.stringify([segments, overlay, event, creatine, omega3, viscousFibre]);
};

/**
 * Re-express a transferred genome so it decodes, in the relaxed request, to the source plan itself (QA PLN-03). Gene
 * transfer maps values over the genes' nominal ranges, but the decoder reads many genes over ranges that depend on the
 * request and on earlier genes (sets over the session cap, the training clock over the decoded waking day), and the
 * relaxed-only genes (sleep, training clock, cardio modality; §2.2) would sit at their defaults (an 8-h night at a moved
 * midpoint, another clock or modality). Here every gene gets the source plan's decoded value (relaxed-only genes: the
 * source's own night, session start and modality), placed in the target decoder's range; three passes settle the
 * ranges that depend on earlier genes. The relaxed request's feasible set contains the source plan, so the seed is it.
 */
export function alignRelaxedGenes(fromCtx: PlanningContext, src: SkeletonStructure, srcX: ArrayLike<number>, toCtx: PlanningContext, dst: SkeletonStructure, y: Float64Array): Float64Array {
  const from = decodePlan(fromCtx, src, srcX);
  const ls = from.lifestyle;
  const segKey = (sk: SkeletonStructure['skeleton'], i: number) => {
    const s = sk.segments[i]!;
    return s.kind === 'phase' ? s.block : `cyc:${s.on}`;
  };
  const fromSeg = new Map<string, number>();
  src.skeleton.segments.forEach((_, i) => fromSeg.set(segKey(src.skeleton, i), i));
  const want = new Map<number, number | ((lo: number, hi: number) => number)>();
  dst.genes.forEach((g, j) => {
    let path = g.path;
    const m = /^seg(\d+)\.(.*)$/.exec(path);
    if (m) {
      const pos = Number(m[1]);
      const k = fromSeg.get(segKey(dst.skeleton, pos)) ?? (pos < src.skeleton.segments.length ? pos : undefined);
      if (k === undefined) return;
      path = `seg${k}.${m[2]}`;
    }
    const i = src.geneIndex[path];
    // a gene the source decoder never read keeps a zero range: nothing to copy
    if (i !== undefined && (from.ranges[2 * i] !== 0 || from.ranges[2 * i + 1] !== 0)) want.set(j, from.values[i]!);
  });
  const dur = sleepHoursOf(ls.bedH, ls.wakeH);
  const set = (path: string, v: number | ((lo: number, hi: number) => number)) => {
    const j = dst.geneIndex[path];
    if (j !== undefined && !want.has(j)) want.set(j, v);
  };
  set('sleep.durationH', dur);
  // the midpoint range may run below 0 or past 24: the source midpoint's turn closest to the range centre
  const mid = mod24(ls.bedH + dur / 2);
  set('sleep.midpointH', (lo, hi) => mid + 24 * Math.round(((lo + hi) / 2 - mid) / 24));
  if (ls.rtSessions > 0 || ls.cardioSessions > 0) set('train.clockH', ls.trainingStartH);
  const k = toCtx.practical.idealModalities.indexOf(ls.cardioModality);
  if (k >= 0) set('cardio.modality', k);
  if (!want.size) return y;
  for (let pass = 0; pass < 3; pass++) {
    const r = decodePlan(toCtx, dst, y).ranges;
    for (const [j, w] of want) {
      const lo = r[2 * j]!;
      const hi = r[2 * j + 1]!;
      if (!(hi > lo)) continue;
      const v = typeof w === 'function' ? w(lo, hi) : w;
      y[j] = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    }
  }
  return y;
}

/** Genomes of the given plans transferred by gene path into another structure list (same skeleton, else the closest id). */
function transferSeeds(
  from: readonly SkeletonStructure[],
  to: readonly SkeletonStructure[],
  plans: ReadonlyArray<{ structure: number; x: ArrayLike<number> }>,
  ctxs?: { from: PlanningContext; to: PlanningContext },
): Array<{ structure: number; x: Float64Array }> {
  const out: Array<{ structure: number; x: Float64Array }> = [];
  for (const p of plans) {
    const src = from[p.structure];
    if (!src || src.skeleton.baseline) continue;
    const k = skKey(src);
    const j = to.findIndex((t) => !t.skeleton.baseline && skKey(t) === k);
    if (j <= 0) continue;
    const y = transfer(src, to[j]!, Float64Array.from(p.x));
    out.push({ structure: j, x: ctxs ? alignRelaxedGenes(ctxs.from, src, p.x, ctxs.to, to[j]!, y) : y });
  }
  return out;
}

/** A variant's assembly (context, goals with the main run's start values and precision, Simulator-mode model). */
function assemblyFor(vp: VariantProblem, base: Assembly, init: HostInit): Assembly {
  const goals = buildGoals(vp.ctx, base.goals.start);
  goals.specs.forEach((sp, i) => {
    const mt = base.goals.specs[i]?.minTolerance;
    if (mt !== undefined) sp.minTolerance = mt;
  });
  const full = new EnginePlanModel(vp.ctx, { bindings: goals.bindings, ensemble: init.ensemble, recordAll: true, fullMode: true });
  return { ctx: vp.ctx, goals, full, main: vp };
}

function problemFor(as: Assembly, seeds: Array<{ structure: number; x: Float64Array }>): PlannerProblem<SkeletonStructure> {
  const st = as.main.structures;
  return {
    structures: st,
    goals: as.goals.specs,
    baseline: { structure: 0, x: [] },
    ...(seeds.length ? { seeds } : {}),
    mutateStructure: (() => {
      const cache = new Map<number, number[]>();
      return (s: number, rng: Rng) => mutate(st, s, rng, cache);
    })(),
    transferGenome: (f, t, x) => transfer(st[f]!, st[t]!, x),
    roundGenome: (s, x) => roundGenomeOf(as.ctx, st[s]!, x),
    gridStep: (s) => gridStepOf(st[s]!),
    validate: (s, x) => {
      const sched = as.main.model.repair(st[s]!, as.main.model.decode(st[s]!, x)).schedule;
      const v = validatePlan(as.ctx, sched);
      if (!v.ok) return v;
      const bad = unlistableWarnings(as.ctx, sched, as.full.simulate(sched, -1));
      return bad.length ? { ok: false, reasons: bad.map((w) => `simulator ${w.severity} ${w.id}`) } : v;
    },
    ablations: (s, x) => ablationsFor(st, s, x),
    featureSchema: FEATURE_SCHEMA,
  };
}

/**
 * "add 0.6 kg of fat loss", "lower hunger pressure by 0.7 points", "raise strength index by 0.7 %": a goal improvement in
 * plain words (metric units; index units read as points).
 */
function gainPhrase(as: Assembly, i: number, gain: number): string {
  const g = as.ctx.goals[i]!;
  const label = g.def.label.toLowerCase();
  const unit = g.def.unit === 'index' || g.def.unit === '' ? 'points' : g.def.unit.replace(/ of baseline$/, '');
  const amt = `${fmtNum(gain)}${unit === '%' ? ' %' : ` ${unit}`}`;
  if (as.goals.specs[i]!.sense === 'min' && /kg$/.test(unit) && / mass$/.test(label)) return `add ${amt} of ${label.replace(/ mass$/, '')} loss`;
  return `${as.goals.specs[i]!.sense === 'min' ? 'lower' : 'raise'} ${label} by ${amt}`;
}

/** Improvement of a metric delta in the goal's direction (positive = better). */
const improvement = (as: Assembly, i: number, delta: number) => (as.goals.specs[i]!.sense === 'min' ? -delta : delta);

/**
 * Whether a plan is lexicographically worse than a reference: `gains[k]` = its improvement over the reference on goal k
 * (goal direction, metric units), `quanta[k]` = goal k's resolution. The first goal whose gain exceeds its quantum either
 * way decides; ties at every goal are not worse.
 */
export function lexicographicallyWorse(gains: readonly number[], quanta: readonly number[]): boolean {
  for (let k = 0; k < gains.length; k++) {
    const q = Math.max(0, quanta[k] ?? 0) + 1e-12;
    if (gains[k]! > q) return false;
    if (gains[k]! < -q) return true;
  }
  return false;
}

async function runIdeal(x: IdealArgs): Promise<IdealPlanV2 | null> {
  const { a, res, init } = x;
  const ctx = a.ctx;
  const smallTier: Tier = x.tier === 'X' ? 'L' : (x.tier as Tier);
  const hard = res.options[0] ?? null;
  const vi = x.variantOf({ kind: 'ideal' });
  const aI = assemblyFor(vi, a, init);
  const plans = res.options.map((o) => ({ structure: o.structureIndex, x: o.x }));
  if (!plans.length && res.noSafePlan) plans.push({ structure: res.noSafePlan.structure, x: res.noSafePlan.x });
  // Hard first: the Ideal's feasible set contains Hard's plan, so Hard's genome (its relaxed-only genes set to Hard's
  // own sleep, clock and modality) is the warm start the Ideal must not fall below (QA PLN-03)
  const seedsI = transferSeeds(a.main.structures, vi.structures, plans, { from: ctx, to: vi.ctx });
  const idealShare = Math.max(1, Math.floor((x.wantCosts ? 0.6 : 1) * x.idealEU));
  const resI = await runPlanner(problemFor(aI, seedsI), x.evaluatorFor({ kind: 'ideal' }, init), {
    seed: `${x.seed}/ideal`,
    tier: smallTier,
    totalEU: idealShare,
    ensembleSize: x.ensembleSize,
    holdoutSize: x.holdoutSize,
    optionCount: 1,
    strictness: x.request.strictness ?? 'balanced',
    ...(x.signal ? { signal: x.signal } : {}),
  });
  const best = resI.options[0];
  // the Ideal's feasible set contains Hard's plan: a search that returns nothing leaves Hard's plan as the Ideal (§12.3)
  if (!best) return x.rungs.hard ? hardAsIdeal(x, []) : null;
  const b = await buildOption(aI, resI, 0, [], x.bandsFor, x.holdoutSize, null, { kind: 'ideal' }, HOLDOUT_DRAW_BASE, { ideal: true });
  if (!b) return x.rungs.hard ? hardAsIdeal(x, []) : null;
  const o = b.option;
  o.name = optionName(aI.ctx, o.schedule, b.plan, o.simulation);
  if (o.fasting?.rival?.reason === 'notEvaluated') {
    const { rival: _r, ...f } = o.fasting;
    o.fasting = { ...f, text: f.used ? f.text : 'No fast.' };
  }
  const nominal = vi.model.simulate(o.schedule, -1);
  const diff = difficulty(ctx, o.schedule, nominal, { purchaseBurden: purchaseBurden(b.equipment?.required ?? []) });
  const eq = b.equipment;
  const hardOpt = x.rungs.hard ?? null;
  const W = Math.round(ctx.horizonDays / 7);
  const outcomes: GoalOutcome[] = o.scorecard.map((sc, i) => {
    const p50 = sc.band?.p50 ?? sc.value;
    const hp = hardOpt?.scorecard[i];
    const hardP50 = hp ? (hp.band?.p50 ?? hp.value) : p50;
    const y = goalSeries(o.simulation, aI.goals.bindings[i]!, aI.ctx);
    const target = aI.goals.targets[i];
    const hit = y && target !== null && target !== undefined && aI.goals.specs[i]!.keep === undefined ? timeToTarget(y, target, aI.goals.specs[i]!.sense === 'min' ? -1 : 1).tHit : null;
    const w = hit !== null ? Math.max(1, Math.ceil(hit / 7)) : null;
    return {
      goal: i, metric: sc.metric, label: sc.label, unit: sc.unit, p50, band: sc.band ? { p10: sc.band.p10, p90: sc.band.p90 } : null,
      change: p50 - sc.start, start: sc.start, target: sc.target, pTargetMet: sc.band?.pTargetMet ?? null, percentOfAchievable: sc.percentOfAchievable,
      verdict: sc.verdict ?? null, weeksToTarget: w, beyondTwoYears: false, tttSource: w !== null ? 'ownRun' : null, tttText: w !== null ? `reached in about ${w} weeks` : null,
      vsHard: p50 - hardP50, grade: sc.grade,
    };
  });
  const summary: RungSummary = {
    kind: 'ideal', title: 'Ideal', subtitle: o.name, difficulty: diff, outcomes,
    weeklyTrainingMin: 0, meanWindowH: 0, hunger: o.hunger, fasting: o.fasting ?? { used: false, kind: 'none', longestFastH: 0, text: '' },
    bindingLimits: [], equipment: eq && (eq.text || eq.required.length || eq.optional.length) ? { required: eq.required, optional: eq.optional, text: eq.text } : { required: [], optional: [], text: 'nothing to buy' },
    safetyItems: o.safetyItems ?? [],
  };
  {
    const f = planFacts(aI.ctx, o.schedule);
    let mins = 0;
    let win = 0;
    let eat = 0;
    for (let d = 0; d < f.kcal.length; d++) {
      mins += f.rtMin[d]! + f.cardioMin[d]!;
      if (!f.zero[d]) { win += f.windowLen[d]!; eat++; }
    }
    summary.weeklyTrainingMin = Math.round((7 * mins) / Math.max(1, f.kcal.length));
    summary.meanWindowH = eat ? Math.round((10 * win) / eat) / 10 : 0;
  }

  const quantumMetric = (i: number) => {
    const sc = res.goals.scales[i];
    const span = sc ? Math.abs(sc.u - sc.b) : 0;
    const q = res.quanta?.q[i] ?? 0.01;
    return Math.max(q * span, a.goals.specs[i]?.minTolerance ?? 0);
  };
  // The Ideal's feasible set contains Hard's plan (limits only removed), so the Ideal is never below Hard: when the run's
  // best is lexicographically worse than Hard on the holdout P50s (goal by goal, beyond each goal's quantum), Hard's own
  // plan is the Ideal and no limit binds (QA PLN-03)
  const hardRung = x.rungs.hard ?? null;
  const useHard = !!hardRung && !!hardOpt && lexicographicallyWorse(outcomes.map((oc) => improvement(a, oc.goal, oc.vsHard)), outcomes.map((oc) => quantumMetric(oc.goal)));

  // gap vs Hard, per goal, holdout P50 (metric units)
  const gapVsHard = outcomes.map((oc) => ({ goal: oc.goal, delta: hardOpt && !useHard ? oc.vsHard : 0, unit: oc.unit }));
  const nothingBinds = !!hardOpt && gapVsHard.every((g) => improvement(a, g.goal, g.delta) <= quantumMetric(g.goal) + 1e-12);

  // what each binding limit costs (shadow prices, §2.4)
  const limitCosts: LimitCost[] = [];
  const hardSum = x.summaries.get('hard');
  if (x.wantCosts && hard && hardSum && !x.signal?.aborted) {
    const groups: LimitGroupId[] = [];
    for (const bl of [...hardSum.bindingLimits].sort((p, q) => q.share - p.share)) if (!groups.includes(bl.group)) groups.push(bl.group);
    const maxGroups = x.tier === 'S' || x.tier === 'M' ? 4 : groups.length;
    const chosen = groups.slice(0, maxGroups);
    let left = Math.max(0, x.idealEU - idealShare);
    const hardVals = hard.metricValues;
    for (let n = 0; n < chosen.length && !x.signal?.aborted; n++) {
      const group = chosen[n]!;
      const budget = Math.max(30, Math.floor(Math.min(0.05 * TIER_BUDGET_EU[smallTier], left / (chosen.length - n))));
      const vl = x.variantOf({ kind: 'limit', group });
      const aL = assemblyFor(vl, a, init);
      const seedsL = transferSeeds(a.main.structures, vl.structures, [{ structure: hard.structureIndex, x: hard.x }], { from: ctx, to: vl.ctx });
      const resL = await runPlanner(problemFor(aL, seedsL), x.evaluatorFor({ kind: 'limit', group }, init), {
        seed: `${x.seed}/limit/${group}`, tier: 'S', totalEU: budget, ensembleSize: 0, optionCount: 1, strictness: x.request.strictness ?? 'balanced',
        ...(x.signal ? { signal: x.signal } : {}),
      });
      left -= resL.provenance.euUsed;
      const bl = resL.options[0];
      const lt = limitText(group, x.request, relaxGroup(x.request, group));
      if (!bl) continue;
      let deltas = Array.from(bl.metricValues, (v, i) => ({ goal: i, delta: v - hardVals[i]!, unit: a.ctx.goals[i]!.def.unit }));
      const { schedule: sL } = scheduleFor(aL, bl.structureIndex, bl.x);
      const dL = difficulty(ctx, sL, vl.model.simulate(sL, -1)).D;
      let deltaD = dL - (hardSum.difficulty.D ?? 0);
      // Hard's plan stays feasible with the limit relaxed, so a short search that ends lexicographically below it is
      // search noise, not a cost of the limit (QA pass 2; the Ideal's fallback rule, PLN-03): no change
      if (lexicographicallyWorse(deltas.map((d) => improvement(a, d.goal, d.delta)), deltas.map((d) => quantumMetric(d.goal)))) {
        deltas = deltas.map((d) => ({ ...d, delta: 0 }));
        deltaD = 0;
      }
      const lead = deltas.find((d) => improvement(a, d.goal, d.delta) > quantumMetric(d.goal));
      const text = lead
        ? `Allowing ${lt.relaxedTo} instead of ${lt.current} would ${gainPhrase(a, lead.goal, improvement(a, lead.goal, lead.delta))} by week ${W}.`
        : `Allowing ${lt.relaxedTo} instead of ${lt.current} changes nothing measurable for your goals.`;
      limitCosts.push({ group, label: lt.label, current: lt.current, relaxedTo: lt.relaxedTo, deltas, deltaD: Math.round(1000 * deltaD) / 1000, text, euSpent: resL.provenance.euUsed, adopt: lt.adopt });
    }
    // lexicographic by quantised goal improvement, priority order
    const qd = (c: LimitCost) => c.deltas.map((d) => Math.floor(improvement(a, d.goal, d.delta) / Math.max(1e-9, quantumMetric(d.goal))));
    limitCosts.sort((p, q) => {
      const P = qd(p);
      const Q = qd(q);
      for (let i = 0; i < Math.min(P.length, Q.length); i++) if (P[i] !== Q[i]) return Q[i]! - P[i]!;
      return p.group < q.group ? -1 : 1;
    });
  }
  const interactionRemainder = gapVsHard.map((g) => ({ goal: g.goal, delta: g.delta - limitCosts.reduce((s, c) => s + (c.deltas[g.goal]?.delta ?? 0), 0), unit: g.unit }));
  const relaxed = idealRequest(x.request).relaxed;
  if (useHard && hardRung) return { ...hardAsIdeal(x, limitCosts), gapVsHard, interactionRemainder };
  const { id: _id, aBeatsThisShare, scorecard, fasting, ...rest } = o;
  const genome = { structureId: vi.structures[best.structureIndex]!.id, x: Array.from(best.x) };
  const same =
    hardRung &&
    idealSameAsHard(
      { nothingBinds, genome, D: diff.D, outcomes: outcomes.map((oc) => ({ goal: oc.goal, vsHard: oc.vsHard })) },
      { genome: hardRung.genome, D: x.summaries.get('hard')?.difficulty.D ?? NaN },
      quantumMetric,
    );
  return {
    ...rest,
    kind: 'ideal',
    summary,
    scorecard: scorecard.map(({ costVsA, ...s }) => ({ ...s, costVsHard: costVsA })),
    fasting: fasting ?? summary.fasting,
    genome,
    hardBeatsThisShare: aBeatsThisShare,
    ...(b.equipment?.sessions.length ? { sessions: b.equipment.sessions } : {}),
    relaxed,
    advised: [...ADVISED_IDEAL],
    limitCosts,
    gapVsHard,
    interactionRemainder,
    nothingBinds,
    sameAsHard: same ? { liftedWithoutEffect: liftedWithoutEffect(x.request) } : null,
  };
}

/** Hard's own plan as the Ideal (nothing beat it without the limits): the UI shows no second card (§12.3). */
function hardAsIdeal(x: IdealArgs, limitCosts: LimitCost[]): IdealPlanV2 {
  const hardRung = x.rungs.hard!;
  const { kind: _k, summary: hs, provenance: _p, fromTier: _t, ...payload } = hardRung;
  const zero = hs.outcomes.map((oc) => ({ goal: oc.goal, delta: 0, unit: oc.unit }));
  return {
    ...payload,
    kind: 'ideal',
    summary: { ...hs, kind: 'ideal', title: 'Ideal', outcomes: hs.outcomes.map((oc) => ({ ...oc, vsHard: 0 })), bindingLimits: [] },
    relaxed: idealRequest(x.request).relaxed,
    advised: [...ADVISED_IDEAL],
    limitCosts,
    gapVsHard: zero,
    interactionRemainder: zero.map((z) => ({ ...z })),
    nothingBinds: true,
    sameAsHard: { liftedWithoutEffect: liftedWithoutEffect(x.request) },
  };
}

/** The limits the Ideal lifts, one row per limit group ("3 training days" → "5 training days"). */
export function liftedWithoutEffect(request: PlannerRequestV2): NonNullable<NonNullable<IdealPlanV2['sameAsHard']>['liftedWithoutEffect']> {
  const groups: LimitGroupId[] = [];
  for (const r of idealRequest(request).relaxed) if (!groups.includes(r.group)) groups.push(r.group);
  return groups.map((group) => {
    const lt = limitText(group, request, relaxGroup(request, group));
    return { group, label: lt.label, from: lt.current, to: lt.relaxedTo };
  });
}

/**
 * Ideal equals Hard (§12.3): nothing binds, or the Ideal's genome decodes to Hard's plan (same structure, genes within
 * 1e-6), or the Ideal differs from Hard on no goal by more than the goal's quantum and |D_I − D_H| < 0.01.
 */
export function idealSameAsHard(
  ideal: { nothingBinds: boolean; genome: { structureId: string; x: readonly number[] }; D: number; outcomes: ReadonlyArray<{ goal: number; vsHard: number }> },
  hard: { genome: { structureId: string; x: readonly number[] }; D: number },
  quantum: (goal: number) => number,
): boolean {
  if (ideal.nothingBinds) return true;
  const g = ideal.genome;
  const h = hard.genome;
  if (g.structureId === h.structureId && g.x.length === h.x.length && g.x.every((v, i) => Math.abs(v - h.x[i]!) <= 1e-6)) return true;
  return Number.isFinite(ideal.D) && Number.isFinite(hard.D) && Math.abs(ideal.D - hard.D) < 0.01 && ideal.outcomes.every((o) => Math.abs(o.vsHard) <= quantum(o.goal) + 1e-12);
}
