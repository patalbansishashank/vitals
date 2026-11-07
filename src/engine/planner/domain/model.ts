/**
 * `EnginePlanModel` (MODEL_SPEC §10.1): the evaluation-side `PlanModel` — decode → repair → `runEngine` in planner mode
 * (daily recording of the goal/constraint series only, ensemble parameter vectors from quantiles, early abort) →
 * goal functionals, state-space margins (17 §2.2 via §7.3), descriptors, regulariser, Gower features, cost.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { captureInitialSnapshot, runEngine } from '../../core/loop';
import { MODULES } from '../../core/moduleRegistry';
import { eaUnevaluatedDays, worstMargin } from '../../model/safety/constraints';
import { ketoFedStrict } from '../../model/safety/derived';
import { defaultSafetyConstants } from '../../model/safety/params';
import { PLANNER_MODULES } from './engineModules';
import { buildModelParams, quantilesToParams, variableParamCount } from '../../core/paramsRegistry';
import type { SeriesId } from '../../types/metrics';
import type { EngineSnapshot, RunOptions, SimulationResult, StateBound } from '../../types/result';
import type { Schedule } from '../../types/schedule';
import { complexityPenalty, hungerCapMargin, hungerPenalty } from '../optim/goals';
import { Rng, latinHypercube } from '../optim/rng';
import { HOLDOUT_DRAW_OFFSET, SAFETY_AUDIT_DRAW_OFFSET, type PlanModel, type RepairEntry, type Repaired } from '../optim/types';

/** First draw index of the holdout ensemble (optim `HOLDOUT_DRAW_OFFSET`, PLANNER_V2_SPEC §4.7). */
export const HOLDOUT_DRAW_BASE = HOLDOUT_DRAW_OFFSET;
/** First draw index of the reserved safety-audit stream (optim `SAFETY_AUDIT_DRAW_OFFSET`, C5/D4-03). */
export const SAFETY_AUDIT_DRAW_BASE = SAFETY_AUDIT_DRAW_OFFSET;
import type { PlanningContext } from './context';
import { baselineSchedule, decodePlan, type DecodedPlan } from './decode';
import { complexityCounts, descriptors, features, planFacts } from './features';
import { difficultyD } from './difficulty';
import { goalSeries, goalTrajectory, goalValue, missingGoalIndices, type GoalBinding } from './goalSpecs';
import { repairSchedule } from './repair';
import { closedRunStatuses, goalSense, guardedGoalValue, type PlannerCondition, type StatusEntry } from './capabilities';
import { OBJECTIVE_STATUSES } from '@/lib/bodyContracts';
import { HC } from './safety';
import { BLOCKS } from './registry/blocks';
import { reviewMuscleRetention } from './muscleRetention';
import type { SkeletonStructure } from './skeleton';

/** State-space constraint margins, in this order (17 §2.2 via MODEL_SPEC §7.3 scales). */
export const MARGIN_IDS = ['HC-E1', 'HC-E3', 'HC-E4', 'HC-E5', 'HC-E6', 'HC-E8', 'HC-P4', 'HC-P5', 'HC-E7', 'hungerCap', 'abort', 'gainRate', 'W-E07', 'W-M06', 'W-05-KETO-FED', 'W-S03',
  'W-E01', 'W-E03', 'W-E05', 'W-E10', 'W-E11', 'W-E13', 'W-E15', 'W-M01', 'W-S01', 'W-13-ALPERT', 'HC-E3.28', 'userMuscleRetention'] as const;

/** User's model-scenario budget, separate from the clinical safety margins and never relaxed by Ideal. */
export const MUSCLE_RETENTION_MARGIN_INDEX = MARGIN_IDS.indexOf('userMuscleRetention');

/**
 * Simulator-warning margins taken from the engine (`SimulationResult.warningMargins`, safety `computeWarningMargins`,
 * R-PLAN-SAFETY) into the planner's margin vector: id → index. W-E03 also shadows W-E04, W-E05 → E06, W-E11 → E12,
 * W-E13 → E14, W-E15 → E16. The warnings a plan may carry when listed (W-E07 in a deficit with training, W-E18 for women,
 * W-20-FAST-LEAN, W-F13 with opted-in fasts) are not constraints. The engine's W-E07 series is not copied as such: it is
 * the day-by-day energy availability on the days the Simulator's EA rules apply, and the planner reads its 30 kcal/kg FFM
 * floor from it (`eaFloorMargin`, ruling R-EA-PLANNER; indices 2 and 12).
 */
export const WARNING_MARGIN_INDEX: Readonly<Record<string, number>> = {
  'W-M06': 13, 'W-S03': 15, 'W-E01': 16, 'W-E03': 17, 'W-E05': 18, 'W-E10': 19, 'W-E11': 20, 'W-E13': 21,
  'W-E15': 22, 'W-M01': 23, 'W-S01': 24, 'W-13-ALPERT': 25,
};

const SAFETY_K = defaultSafetyConstants();

/**
 * Ruling R-EA-PLANNER (release check 2026-10-01): the planner's energy-availability floor is dossier 17's threshold
 * (HC-E4 / W-E08: 30 kcal/kg FFM, the engine's `safety.eaHardMin`), applied exactly where the Simulator's EA rules
 * apply — days with net exercise energy in the trailing 7 days and a 7-day deficit above 5 % (the engine's W-E07 margin
 * series is defined on exactly those days) — with the nominal headroom `CHANCE_CUSHION` (0.25 × 5 = 1.25 kcal/kg FFM,
 * so ≈ 31). The 35 kcal/kg FFM edge of W-E07 (30-35 for more than 14 days, a caution) is not a constraint: a deficit
 * plan for someone who trains may sit in that band and then lists the caution with its other safety notes.
 * D4-04: 30 is an explicit precautionary design policy on the eating-day statistic (`eatingDayEa7`), not a universal safe
 * boundary — meeting it never certifies safety, and logged menstrual/fatigue/performance/injury concerns trigger review
 * at any EA (`eaExposureReview`). The calendar exposure (`calendarEa7`/`calendarEa28`, fast days included) is reported
 * beside it and does not add a new blanket fasting prohibition.
 */
export const EA_FLOOR = { floor: SAFETY_K.eaHardMin, scale: SAFETY_K.scaleEa, cautionUpper: SAFETY_K.eaReducedUpper } as const;

/**
 * Energy-availability floor margin (EA7 − 30)/5, minimum over the days the Simulator's EA rules apply (NaN-free; +∞ when
 * they never apply). Read from the engine's own W-E07 warning-margin series (m = (EA7 − 35)/5 on applicable days, NaN
 * elsewhere) when the run computed it, else from the safety trace with the same applicability.
 */
export function eaFloorMargin(sim: SimulationResult): number {
  const shift = (EA_FLOOR.cautionUpper - EA_FLOOR.floor) / EA_FLOOR.scale;
  const wm = sim.warningMargins?.find((w) => w.id === 'W-E07');
  let v = Infinity;
  if (wm) {
    for (let d = 0; d < wm.margin.length; d++) {
      const x = wm.margin[d]!;
      if (Number.isFinite(x) && x + shift < v) v = x + shift;
    }
    return v;
  }
  const s = sim.safety;
  const ea = s.ea7;
  const eee = s.eee7;
  for (let d = 0; d < ea.length; d++) {
    const e = ea[d]!;
    const def = s.deficitPct7[d]!;
    if (!Number.isFinite(e) || !Number.isFinite(def) || def <= SAFETY_K.deficitAnyPct || (eee && !(eee[d]! > 0))) continue;
    const m = (e - EA_FLOOR.floor) / EA_FLOOR.scale;
    if (m < v) v = m;
  }
  return v;
}

/**
 * Planned rate of weight gain in a surplus, %BW/wk, by training status (13 §4C B21: 0.25-0.5 %BW/wk for novices and
 * intermediates, less for advanced lifters; 11 §6/§9: above ≈ 0.5 %/wk in trained lifters the gain is mostly fat).
 */
export const GAIN_RATE_TARGET_PCT: Readonly<Record<string, number>> = { none: 0.5, lt1y: 0.5, '1to3y': 0.5, gt3y: 0.25 };
export type MarginId = (typeof MARGIN_IDS)[number];

/**
 * Finite compatibility margin for "not evaluated" (C6): a rule that does not apply on any day (no deficit day, no fast) or
 * a quantity whose trace is unavailable. The optimizer may read it; it is never a pass for the joint safety screen when
 * the required output is unavailable — those indices are reported by `missingStateMargins` (`EvalOutput.missing`).
 */
export const MARGIN_NA = 10;
/**
 * Dossier-17 hard margins the independent safety audit requires (C5/D4-03): HC-E1, E3, E4, E5, E6, E8, P4, P5, E7, the
 * early abort and the 28-day deficit leg. The hunger cap is a tolerance, not safety; the Simulator-caution margins are
 * judged on the nominal run (their draws report the compatibility value by design) and enter the audit as a known
 * violation when the frozen candidate's nominal margin is negative.
 */
export const REQUIRED_SAFETY_MARGINS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 26];
/** The same as margin ids (certificate `requiredMargins`). */
export const REQUIRED_SAFETY_MARGIN_IDS: readonly string[] = REQUIRED_SAFETY_MARGINS.map((i) => MARGIN_IDS[i]!);
const MARGIN_CLAMP = 100;

/** Regulariser weights λ_H, λ_C, λ_T (18 §4.7.3 gives the form only; PROPOSED planner tuning constants). */
export const LAMBDA = { hunger: 1, complexity: 1, terminal: 1, burden: 0.1 } as const;
/** R_term tolerance on end-of-plan metabolic adaptation, fraction of RMR0 (PROPOSED). */
export const TERMINAL_ADAPTATION_TOL = 0.05;
/** Weight of the hunger cap inside v_S (18 §4.8 "lower weight"); margin unit 0.05 of the normalised index. */
const HUNGER_CAP_UNIT = 0.1;

export interface ModelOptions {
  bindings: readonly GoalBinding[];
  /**
   * Ensemble: seed and size M; the LHS is drawn once in quantile space (18 §4.15). `safetyAuditSize` sizes the reserved
   * safety-audit stream (default `size`), drawn from its own stream `ensemble/safetyAudit`.
   */
  ensemble?: { seed: number | string; size: number; holdoutSize?: number; safetyAuditSize?: number };
  /** Extra series to record (explanations / final options). */
  extraSeries?: readonly SeriesId[];
  /** Record every series (final option re-simulation). */
  recordAll?: boolean;
  /**
   * Run the engine in the Simulator's mode (`simulate`: safety warnings, hormone extras) instead of planner mode. The
   * final options are re-simulated this way so a plan shows exactly the warnings the Simulator will show (R-PLAN-SAFETY).
   */
  fullMode?: boolean;
  /**
   * Prior chance cushion per margin index (units of the margin), subtracted from the NOMINAL margins only. Default: the
   * fixed `DEFAULT_CUSHION`; the coordinator calibrates it from the ensemble spread before the run (`calibrateCushion`).
   */
  cushion?: ArrayLike<number>;
  /** Skip the burn-in by restoring a post-burn-in snapshot per parameter draw (default: horizons ≥ 120 days). */
  snapshots?: boolean;
}

/** `inEnergyPctMaint` (R-MAINT intake %) feeds the difficulty axis's deficit depth (PLANNER_V2_SPEC §1.1). */
const BASE_SERIES: readonly SeriesId[] = ['hunger', 'adherence', 'metabolicAdaptation', 'scaleWeight', 'bodyFatPct', 'fatMass', 'leanTissue', 'bhb', 'inEnergyPctMaint'];

/** W-05-KETO-FED proxy (danger rule: BHB > 3.0 mmol/L while eating): daily mean BHB on eating days, mmol/L (PROPOSED). */
export const KETO_FED_DAILY_MAX = 2.5;
/** The same proxy for the rule's > 6.0 mmol/L leg in the refeed phase after a fast: 2.5 × 6/3 (PROPOSED). */
export const KETO_ANY_DAILY_MAX = 5;

/**
 * Daily guard levels of W-05-KETO-FED, matching the engine rule (ruling R-FAST-GATE): null when the rule does not apply to
 * the person (no diabetes, no pregnancy/breastfeeding — `ketoFedStrict`; the margin is then not evaluated); otherwise the
 * 3.0 leg (proxy 2.5) outside the refeed phase after a fast and the 6.0 leg (proxy 5) on fast-event days and the
 * `safety.ketoFedRefeedWindowH` (72 h) after them. The planner already excludes these profiles from fasts over 12 h and
 * SGLT2/insulin users from ketogenic blocks, so the guard is defence in depth.
 */
export function ketoFedDailyLimits(ctx: PlanningContext, fastDay: ArrayLike<number> | undefined, nDays: number): Float64Array | null {
  if (!ketoFedStrict(ctx.rp.safety.flags, SAFETY_K.ketoFedNeedsDiabetes)) return null;
  const out = new Float64Array(nDays).fill(KETO_FED_DAILY_MAX);
  if (!fastDay) return out;
  const after = Math.ceil(SAFETY_K.ketoFedRefeedWindowH / 24);
  let last = -Infinity;
  for (let d = 0; d < nDays; d++) {
    if ((fastDay[d] ?? 0) > 0) last = d;
    if (d - last <= after) out[d] = KETO_ANY_DAILY_MAX;
  }
  return out;
}

/** Curves that get daily P10-P90 bands in the result (besides the goal metrics). */
export const BAND_SERIES: readonly SeriesId[] = ['scaleWeight', 'fatMass', 'leanTissue', 'bodyFatPct', 'hunger', 'skeletalMuscle', 'tdee', 'inEnergy'];

/** Stable key of a genome (quantised like the optimiser's cache, 1e-6). */
export function genomeKey(structureId: string, x: ArrayLike<number>): string {
  let s = structureId;
  for (let i = 0; i < x.length; i++) s += `,${Math.round(x[i]! * 1e6)}`;
  return s;
}

/**
 * Per-path observable keys a band record carries besides the metric series (C4/D5-02): the measurement operator is
 * applied to EACH ensemble member before any quantile, so a drift comparison never subtracts independent percentile
 * endpoints. `op:modelTissueMass` = FM + FFM_act of the same path at the end of each day (the engine's tissue-mass
 * convention: no glycogen/water transients); index 0 (t = 0) is NaN (the operator has no pre-run sample).
 */
export const BAND_OPERATOR_KEYS = ['op:modelTissueMass'] as const;
export type BandOperatorKey = (typeof BAND_OPERATOR_KEYS)[number];

/** Daily series y(0..T) (index 0 = t = 0) of the band series of one ensemble evaluation. */
export type BandRecord = Map<SeriesId | BandOperatorKey | `goal:${string}`, Float32Array>;

export class EnginePlanModel implements PlanModel<SkeletonStructure, Schedule, SimulationResult> {
  private readonly plans = new WeakMap<Schedule, DecodedPlan>();
  private readonly keys = new WeakMap<Schedule, string>();
  private readonly simDraw = new WeakMap<SimulationResult, number>();
  /** Schedule each run simulated (planner conditions read the planned inputs, D1-05/D7-07). */
  private readonly simSchedule = new WeakMap<SimulationResult, Schedule>();
  /** Band series of recent ensemble evaluations (draw ≥ 0), keyed by genome and draw (bounded FIFO). */
  private readonly bandCache = new Map<string, BandRecord>();
  static readonly BAND_CACHE_MAX = 800;
  private readonly compiled = new WeakMap<Schedule, ReturnType<typeof compileSchedule>>();
  private readonly drawCache = new Map<number, Float64Array | undefined>();
  private readonly snapCache = new Map<number, EngineSnapshot>();
  private baseCompiled: ReturnType<typeof compileSchedule> | null = null;
  private readonly series: SeriesId[];
  private readonly abortOn: StateBound[];
  private ensembleU: Float64Array | null = null;
  private holdoutU: Float64Array | null = null;
  private auditU: Float64Array | null = null;
  private P = 0;

  constructor(
    readonly ctx: PlanningContext,
    readonly opts: ModelOptions,
  ) {
    const set = new Set<SeriesId>(BASE_SERIES);
    set.add('tdee');
    set.add('inEnergy');
    if (ctx.request.constraints?.muscleRetention) set.add('skeletalMuscle');
    for (const b of opts.bindings) set.add(b.metric as SeriesId);
    for (const s of opts.extraSeries ?? []) set.add(s);
    this.series = [...set];
    // 18 §4.1 early abort on SafetyTrace quantities far beyond a hard bound (the run cannot become safe)
    this.abortOn = [
      { series: 'bodyFatPct', op: '<', value: ctx.caps.bfFloorPct - 2, id: 'HC-P5' },
      { series: 'bmi', op: '<', value: HC.bmi.projectedMin - 1, id: 'HC-P4' },
      { series: 'cumLossPct', op: '>', value: HC.cumLossMaxPct + 5, id: 'HC-E6' },
    ];
  }

  // ---- decode / repair
  decode(st: SkeletonStructure, x: Float64Array): Schedule {
    const plan = decodePlan(this.ctx, st, x);
    this.plans.set(plan.schedule, plan);
    this.keys.set(plan.schedule, genomeKey(st.id, x));
    return plan.schedule;
  }

  /** Band series of an ensemble evaluation already run for this genome and draw (S5 reuse), if cached. */
  cachedBands(structureId: string, x: ArrayLike<number>, draw: number): BandRecord | undefined {
    return this.bandCache.get(`${genomeKey(structureId, x)}|${draw}`);
  }

  /** Band series of one simulation: y(0..T) per series, plus the per-path operator values (`BAND_OPERATOR_KEYS`). */
  bandRecord(sim: SimulationResult): BandRecord {
    const rec: BandRecord = new Map();
    for (const id of new Set<SeriesId>([...this.opts.bindings.map((b) => b.metric as SeriesId), ...BAND_SERIES])) {
      const d = sim.daily[id];
      if (!d) continue;
      const y = new Float32Array(d.length + 1);
      y[0] = sim.initial[id] ?? Number.NaN;
      y.set(d, 1);
      rec.set(id, y);
    }
    const tm = sim.safety?.tissueMassKg;
    if (tm && tm.length) {
      const y = new Float32Array(tm.length + 1);
      y[0] = Number.NaN;
      y.set(tm, 1);
      rec.set('op:modelTissueMass', y);
    }
    // Preserve the operator of each complete path; bands of marginal FM/LT quantiles cannot form a BF band.
    for (const binding of this.opts.bindings) {
      const trajectory = goalTrajectory(sim, binding, this.ctx);
      if (trajectory.available && trajectory.values) rec.set(trajectory.bandKey as `goal:${string}`, Float32Array.from(trajectory.values));
    }
    return rec;
  }

  planOf(schedule: Schedule): DecodedPlan | undefined {
    return this.plans.get(schedule);
  }

  repair(_st: SkeletonStructure, schedule: Schedule): Repaired<Schedule> {
    const plan = this.plans.get(schedule);
    const r = repairSchedule(this.ctx, schedule, plan);
    if (plan) this.plans.set(r.schedule, plan);
    const key = this.keys.get(schedule);
    if (key) this.keys.set(r.schedule, key);
    return r;
  }

  // ---- ensemble (MODEL_SPEC §8, §10.1: quantilesToParams(defs, U[m]) cached per m; −1 = nominal)
  paramsFor(draw: number): Float64Array | undefined {
    if (draw < 0 || !this.opts.ensemble) return undefined;
    if (this.drawCache.has(draw)) return this.drawCache.get(draw);
    const defs = buildModelParams(MODULES).defs;
    this.P = variableParamCount(defs);
    let v: Float64Array | undefined;
    if (draw >= SAFETY_AUDIT_DRAW_BASE) {
      // reserved safety-audit stream (C5/D4-03): its own Latin hypercube from 'ensemble/safetyAudit', separate from the
      // selection and the outcome-holdout streams; never searched, selected on or repaired against
      const m = draw - SAFETY_AUDIT_DRAW_BASE;
      if (!this.auditU) {
        const Ma = Math.max(1, this.opts.ensemble.safetyAuditSize ?? this.opts.ensemble.size);
        this.auditU = this.P > 0 ? latinHypercube(Ma, this.P, new Rng(this.opts.ensemble.seed).fork('ensemble/safetyAudit')) : new Float64Array(0);
      }
      v = this.P > 0 && (m + 1) * this.P <= this.auditU.length ? quantilesToParams(defs, this.auditU.subarray(m * this.P, (m + 1) * this.P)) : undefined;
    } else if (draw >= HOLDOUT_DRAW_BASE) {
      // holdout ensemble (PLANNER_V2_SPEC §4.7): its own Latin hypercube from the stream 'ensemble/holdout', never searched on
      const m = draw - HOLDOUT_DRAW_BASE;
      if (!this.holdoutU) {
        const Mh = Math.max(1, this.opts.ensemble.holdoutSize ?? this.opts.ensemble.size);
        this.holdoutU = this.P > 0 ? latinHypercube(Mh, this.P, new Rng(this.opts.ensemble.seed).fork('ensemble/holdout')) : new Float64Array(0);
      }
      v = this.P > 0 && (m + 1) * this.P <= this.holdoutU.length ? quantilesToParams(defs, this.holdoutU.subarray(m * this.P, (m + 1) * this.P)) : undefined;
    } else {
      if (!this.ensembleU) {
        const M = Math.max(1, this.opts.ensemble.size);
        // selection ensemble (stream label kept from v1 so selection draws are unchanged)
        this.ensembleU = this.P > 0 ? latinHypercube(M, this.P, new Rng(this.opts.ensemble.seed).fork('ensemble')) : new Float64Array(0);
      }
      v = this.P > 0 ? quantilesToParams(defs, this.ensembleU.subarray(draw * this.P, (draw + 1) * this.P)) : undefined;
    }
    this.drawCache.set(draw, v);
    return v;
  }

  // ---- simulate
  private runOptions(draw: number): RunOptions {
    const opts: RunOptions = {
      mode: this.opts.fullMode ? 'simulate' : 'planner',
      record: 'daily',
      ...(this.opts.recordAll ? {} : { series: this.series }),
      abortOn: this.abortOn,
      burnInDays: 14,
      collectEvents: !!this.opts.recordAll,
      collectWarnings: !!this.opts.recordAll,
      constraints: true,
    };
    const po = this.paramsFor(draw);
    if (po) opts.paramOverrides = po;
    return opts;
  }

  /** Post-burn-in state per parameter draw (captured once; every candidate of this horizon restores it). */
  snapshotFor(draw: number): EngineSnapshot {
    const key = draw < 0 ? -1 : draw;
    let snap = this.snapCache.get(key);
    if (!snap) {
      if (!this.baseCompiled) this.baseCompiled = compileSchedule(baselineSchedule(this.ctx), this.ctx.rp);
      snap = captureInitialSnapshot(this.ctx.rp, this.baseCompiled, this.runOptions(draw), PLANNER_MODULES);
      this.snapCache.set(key, snap);
    }
    return snap;
  }

  simulate(schedule: Schedule, draw: number): SimulationResult {
    let cs = this.compiled.get(schedule);
    if (!cs) {
      cs = compileSchedule(schedule, this.ctx.rp);
      this.compiled.set(schedule, cs);
    }
    const opts = this.runOptions(draw);
    // measured (2026-09-30): restoring the snapshot (a structured clone of every module state) costs about what the
    // 14-day burn-in costs; it saves ≈ 4 % per 180-day run and loses ≈ 7 % at 84 days → default on for ≥ 120 days
    const useSnap = this.opts.snapshots ?? (!this.opts.fullMode && this.ctx.horizonDays >= 120);
    if (useSnap) opts.initialSnapshot = this.snapshotFor(draw);
    const sim = runEngine(this.ctx.rp, cs, opts, PLANNER_MODULES);
    this.simDraw.set(sim, draw);
    this.simSchedule.set(sim, schedule);
    const key = this.keys.get(schedule);
    if (draw >= 0 && key) {
      if (this.bandCache.size >= EnginePlanModel.BAND_CACHE_MAX) this.bandCache.delete(this.bandCache.keys().next().value!);
      this.bandCache.set(`${key}|${draw}`, this.bandRecord(sim));
    }
    return sim;
  }

  // ---- goal functionals (metric units)
  /**
   * Objective goal values (C6): the raw functional, with no credited benefit where the run's statuses withhold one
   * (`objectiveGoalValues`: D1-05 lean partition, D7-07 ketogenic lipid response, D1-08 out-of-domain runs).
   */
  goals(sim: SimulationResult): Float64Array {
    return objectiveGoalValues(this.ctx, this.opts.bindings, sim, this.simSchedule.get(sim));
  }

  /** Per-series statuses of a run this model simulated, closed over output dependencies (C6), with planner conditions. */
  statuses(sim: SimulationResult): Record<string, StatusEntry> {
    const schedule = this.simSchedule.get(sim);
    return closedRunStatuses(sim, schedule ? plannerConditions(this.ctx, schedule, sim) : []);
  }

  // ---- state-space margins (≥ 0 satisfied)
  constraints(sim: SimulationResult, schedule: Schedule): Float64Array {
    // the prior chance cushion shapes only the nominal search; ensemble draws are judged on the raw margins (P90 rule)
    const nominal = (this.simDraw.get(sim) ?? -1) < 0;
    const m = stateMargins(this.ctx, sim, schedule, nominal ? (this.opts.cushion ?? DEFAULT_CUSHION) : null);
    // Simulator-caution and prescription margins are judged on the nominal run the Simulator shows (with the fixed
    // headroom), not at P90: the chance constraint is for dossier 17's hard limits
    if (!nominal) for (const i of NOMINAL_ONLY_MARGINS) m[i] = MARGIN_NA;
    return m;
  }

  /** Margin indices whose required output is unavailable in this run (C6/D4-03; see `missingStateMargins`). */
  missingMargins(sim: SimulationResult): number[] {
    return missingStateMargins(sim, this.ctx);
  }

  /** Goal indices whose required output is unavailable in this run (C6/D4-05): scored at baseline, shown Unavailable. */
  missingGoals(sim: SimulationResult): number[] {
    return missingGoalIndices(sim, this.opts.bindings, this.ctx);
  }

  /**
   * Archive descriptors `[D, b₁, b₃, b₄]` (PLANNER_V2_SPEC §1.2): the difficulty D of the plan on this run first (it is
   * meaningful on the nominal run, draw −1; the archive only sees nominal evaluations), then energy cycling, fasting
   * load and exercise mode. b₂ (carbohydrate share) stays a Gower feature only. Without a run D reads the schedule's
   * planned energy and leaves hunger at the habit.
   */
  descriptors(schedule: Schedule, sim?: SimulationResult): Float64Array {
    const b = descriptors(this.ctx, schedule);
    return Float64Array.of(difficultyD(this.ctx, schedule, sim), b[0]!, b[2]!, b[3]!);
  }

  features(schedule: Schedule): Float64Array {
    return features(this.ctx, schedule);
  }

  regulariser(schedule: Schedule, sim: SimulationResult, log: readonly RepairEntry[]): number {
    return regulariserOf(this.ctx, schedule, sim, log);
  }

  /** 1 EU per horizon simulation; early-aborted runs cost the simulated fraction (MODEL_SPEC §10.1). */
  cost(_schedule: Schedule, sim: SimulationResult): number {
    const a = sim.meta.aborted;
    return a ? Math.max(0.05, (a.day + 1) / Math.max(1, sim.meta.nDays)) : 1;
  }
}

/**
 * Hunger burden of the run on the normalised [0, 1] scale, finite days only (D2-06): the HPI is an uncalibrated burden
 * index and the tolerance a subjective preference, never a medical threshold; a day without a value is missing, not zero
 * hunger (it neither lowers the penalty nor passes the tolerance cap).
 */
function hungerNorm(sim: SimulationResult): Float64Array | null {
  const h = sim.daily.hunger;
  if (!h || !h.length || !Number.isFinite(h[0]!)) return null;
  let n = 0;
  for (let i = 0; i < h.length; i++) if (Number.isFinite(h[i]!)) n++;
  if (n === h.length) return Float64Array.from(h, (v) => v / 100);
  const out = new Float64Array(n);
  for (let i = 0, j = 0; i < h.length; i++) if (Number.isFinite(h[i]!)) out[j++] = h[i]! / 100;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// planner conditions and objective goal values (C6; D1-05, D1-08, D7-07)
// ---------------------------------------------------------------------------------------------------------------

/**
 * D1-05: the surplus partition's protein routing knee (`composition.mPp0`, g/kg body mass/day): a versioned model-domain
 * routing flag of the existing surplus model, not a clinical requirement, a diagnostic threshold or the deficit model's
 * 0.8 g/kg FFM/day knee. Read from the parameter registry so the planner and the composition model use one value.
 */
export const LOW_PROTEIN_SURPLUS_ROUTING = { paramId: 'composition.mPp0', fallbackGPerKg: 0.75, version: 1 } as const;
let routingKnee: number | null = null;
function proteinRoutingKnee(): number {
  if (routingKnee === null) {
    const d = buildModelParams(MODULES).defs.find((x) => x.id === LOW_PROTEIN_SURPLUS_ROUTING.paramId);
    routingKnee = d && Number.isFinite(d.value) ? d.value : LOW_PROTEIN_SURPLUS_ROUTING.fallbackGPerKg;
  }
  return routingKnee;
}

/**
 * Conditions the planner detects from a candidate's planned inputs and its run (C6), on top of the engine's own series
 * statuses (which win when they already mark the same series):
 *  - D1-05 `lowProteinSurplusPartition`: a surplus day (resolved 7-day balance more than 5 % above maintenance) whose
 *    trailing 7-day planned protein on eating days is below the routing knee — the lean partition is scenario-only from
 *    that day (`limited`); fat, scale weight and body fat become conditional through the output dependencies;
 *  - D7-07 `uncertainKetogenicResponse`: a very-low-carbohydrate (ketogenic) pattern — the individual LDL response is
 *    uncertain (a nominally zero modelled response is not zero biological response), so LDL is `limited` from the
 *    pattern's start and ApoB follows it (`ketogenicFromDay`).
 */
export function plannerConditions(ctx: PlanningContext, schedule: Schedule, sim: SimulationResult): PlannerCondition[] {
  const out: PlannerCondition[] = [];
  const st = sim.meta.outputStatus ?? {};
  if (!st.leanTissue || OBJECTIVE_STATUSES.has(st.leanTissue.status)) {
    const f = planFacts(ctx, schedule);
    const def7 = sim.safety.deficitPct7;
    const knee = proteinRoutingKnee() * ctx.rp.weightKg;
    const n = Math.min(def7.length, f.proteinG.length);
    for (let d = 0; d < n; d++) {
      const v = def7[d]!;
      if (!(v < -DEFICIT_ANY_PCT)) continue;
      let sum = 0;
      let c = 0;
      for (let j = Math.max(0, d - 6); j <= d; j++) {
        if (f.zero[j]) continue;
        sum += f.proteinG[j]!;
        c++;
      }
      if (c > 0 && sum / c < knee) {
        out.push({ series: 'leanTissue', status: 'limited', reasonCode: 'lowProteinSurplusPartition', fromDay: d });
        break;
      }
    }
  }
  if (!st.ldl || OBJECTIVE_STATUSES.has(st.ldl.status)) {
    const from = ketogenicFromDay(ctx, schedule);
    if (from !== null) out.push({ series: 'ldl', status: 'limited', reasonCode: 'uncertainKetogenicResponse', fromDay: from });
  }
  return out;
}

/**
 * First plan day of a very-low-carbohydrate (ketogenic) pattern (D7-07), or null: the start of a B2 block, else the first
 * day whose trailing 7 days hold at least 4 eating days averaging no more planned carbohydrate than the B2 block's own
 * upper bound (`BLOCKS.B2.carbG.max`; schedules without block ids — habitual, Simulator or living — keep the condition).
 * Fast days are not eating days: a fast alone is not a ketogenic diet.
 */
export function ketogenicFromDay(ctx: PlanningContext, schedule: Schedule): number | null {
  const block = (schedule.blocks ?? []).filter((b) => b.buildingBlockId === 'B2' && b.endDay > b.startDay).sort((x, y) => x.startDay - y.startDay)[0];
  if (block) return block.startDay;
  const maxCarbG = BLOCKS.B2.carbG?.max;
  if (maxCarbG === undefined) return null;
  const f = planFacts(ctx, schedule);
  for (let d = 0; d < f.carbKcal.length; d++) {
    let sum = 0;
    let c = 0;
    for (let j = Math.max(0, d - 6); j <= d; j++) {
      if (f.zero[j]) continue;
      sum += f.carbKcal[j]! / 4;
      c++;
    }
    if (c >= 4 && sum / c <= maxCarbG) return Math.max(0, d - 6);
  }
  return null;
}

/** +1 when the goal on `metric` wants it higher (`goalSense`); a binding outside the ranked goals reads as +1. */
function senseOf(ctx: PlanningContext, metric: string, start: number): 1 | -1 {
  const g = ctx.goals.find((x) => x.metric === metric);
  return g ? goalSense(g, start) : 1;
}

/**
 * Objective goal values of one run (C6; every route that ranks plans with an `EnginePlanModel` uses it): the raw goal
 * functional, guarded by `guardedGoalValue` under the run's closed statuses — no positive lean change under an
 * unsupported partition (D1-05), no LDL/ApoB reduction under an uncertain ketogenic response (D7-07), no change at all in
 * an out-of-domain run (D1-08). Time-to-target functionals are left to their own search.
 */
export function objectiveGoalValues(ctx: PlanningContext, bindings: readonly GoalBinding[], sim: SimulationResult, schedule?: Schedule): Float64Array {
  const raw = Float64Array.from(bindings, (b) => goalValue(sim, b, ctx));
  const conditions = schedule ? plannerConditions(ctx, schedule, sim) : [];
  if (!conditions.length && !sim.meta.outputStatus && !sim.meta.validity) return raw;
  const statuses = closedRunStatuses(sim, conditions);
  bindings.forEach((b, k) => {
    if (b.functional === 'ttt') return;
    const y = goalSeries(sim, b, ctx);
    const start = y && Number.isFinite(y[0]!) ? y[0]! : Number.NaN;
    raw[k] = guardedGoalValue(b.metric, senseOf(ctx, b.metric, start), raw[k]!, start, statuses, sim.meta.validity);
  });
  return raw;
}

export function regulariserOf(ctx: PlanningContext, schedule: Schedule, sim: SimulationResult, log: readonly RepairEntry[]): number {
  const h = hungerNorm(sim);
  const H = h ? hungerPenalty(h, ctx.practical.hTol) : 0;
  const C = complexityPenalty(complexityCounts(ctx, schedule, log));
  let Rt = 0;
  if (h) Rt += Math.max(0, h[h.length - 1]! - ctx.practical.hTol);
  const ad = sim.final.metabolicAdaptation;
  if (ad !== undefined && Number.isFinite(ad)) Rt += Math.max(0, -ad / ctx.rp.rmr0Kcal - TERMINAL_ADAPTATION_TOL);
  const r = LAMBDA.hunger * H + LAMBDA.complexity * C + LAMBDA.terminal * Rt + LAMBDA.burden * trainingBurden(ctx, schedule);
  return Number.isFinite(r) ? r : 0;
}

/**
 * Time burden of the plan's exercise beyond the person's habit (QA item 9: cardio and steps proportionate): added
 * weekly session minutes / 600 + added daily steps / 10 000. Tie-breaker only (λ 0.1): exercise is kept where it helps a
 * ranked goal; with maintenance resolved at the planned activity (R-MAINT) extra cardio no longer buys a hidden deficit.
 */
export function trainingBurden(ctx: PlanningContext, schedule: Schedule): number {
  const f = planFacts(ctx, schedule);
  const T = Math.max(1, f.kcal.length);
  let minutes = 0;
  let steps = 0;
  for (let d = 0; d < f.kcal.length; d++) {
    minutes += f.cardioMin[d]! + f.rtMin[d]!;
    steps += f.steps[d]!;
  }
  const habitMin = 60 * ctx.rp.habits.sessionsPerWeek;
  return Math.max(0, (7 * minutes) / T - habitMin) / 600 + Math.max(0, steps / T - ctx.rp.habits.typicalSteps) / 10000;
}

function minOver(a: Float32Array, from: number, f: (v: number) => number): number {
  let m = Infinity;
  for (let d = from; d < a.length; d++) {
    const v = a[d]!;
    if (!Number.isFinite(v)) continue;
    const x = f(v);
    if (x < m) m = x;
  }
  return m;
}

const fin = (x: number) => (Number.isFinite(x) ? Math.max(-MARGIN_CLAMP, Math.min(MARGIN_CLAMP, x)) : MARGIN_NA);
/** 17 §2.5 "any deficit" threshold used by safety's margins (deficit_pct_7 > 5 %; safety.deficitAnyPct). */
const DEFICIT_ANY_PCT = 5;

/**
 * Prior chance tightening (PROPOSED planner tuning, 18 §4.15 spirit): the nominal search keeps this many margin units
 * away from the physiology-sensitive bounds (deficit cap, energy availability, rate of loss / gain, BMI and body-fat
 * floors), so finalists usually pass the P90 chance constraint without spending the small S5 repair budget.
 */
export const CHANCE_CUSHION = 0.25;
/** Margins that get a cushion: the physiology-sensitive HC-E3, E4, E5, E8, P4, P5, E7 and W-E07 (not E1/E6, hunger, abort). */
export const CUSHIONED_MARGINS: readonly number[] = [1, 2, 3, 5, 6, 7, 8, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];

/** Margins checked on the nominal run only (gain-rate target, W-E07, W-M06, W-05-KETO-FED, W-S03). */
export const NOMINAL_ONLY_MARGINS: readonly number[] = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];

/** W-E07 (17 §3): energy availability 30-35 kcal/kg FFM for more than 14 days, with exercise and a deficit, is a caution (listed, not a constraint: R-EA-PLANNER). */
export const EA_CAUTION = { upper: 35, days: 14, scale: 5 } as const;
/** Fixed prior cushion (used when no calibration is available). */
export const DEFAULT_CUSHION: Float64Array = Float64Array.from(MARGIN_IDS, (_, i) => (CUSHIONED_MARGINS.includes(i) ? CHANCE_CUSHION : 0));
/** Chance tightening factor (optim CHANCE_TIGHTEN_FACTOR) and the cap of a calibrated cushion, margin units. */
const CUSHION_FACTOR = 1.25;
const CUSHION_MAX = 2;

/** Probes count for a margin's calibration only when their median margin lies in this band (units): near the bound. */
export const CUSHION_NEAR_BOUND = { lo: -1, hi: 2 } as const;

/**
 * Calibrate the prior cushion from the ensemble spread of a few probe plans (18 §4.15 policy 2 applied a priori):
 * cushion_i = max(DEFAULT, 1.25 · lower median over near-bound probes of (P50 − P10) of margin i across draws), capped
 * at 2 units. `margins[p][m]` = raw margin vector of probe p under draw m.
 *
 * Only probes whose median margin is near the bound (`CUSHION_NEAR_BOUND`) count: the spread of a quantity scales with
 * its size (a 1.5 %BW/wk loss rate varies across draws about twice as much as a 0.75 % one), so the spread measured at a
 * far-infeasible corner overstated the cushion several-fold (1.6 units = 0.4 %BW/wk on the rate cap, i.e. the nominal
 * search was held to about half of the safe loss rate; measured near the bound the P50 − P10 gap is ≈ 0.1 units).
 */
export function calibrateCushion(margins: ReadonlyArray<ReadonlyArray<ArrayLike<number>>>): Float64Array {
  const out = Float64Array.from(DEFAULT_CUSHION);
  for (const i of CUSHIONED_MARGINS) {
    const gaps: number[] = [];
    for (const probe of margins) {
      const v = probe.map((m) => m[i]!).filter((x) => Number.isFinite(x) && x !== MARGIN_NA).sort((a, b) => a - b);
      if (v.length < 3) continue;
      const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]!;
      const med = q(0.5);
      if (med < CUSHION_NEAR_BOUND.lo || med > CUSHION_NEAR_BOUND.hi) continue;
      gaps.push(med - q(0.1));
    }
    if (!gaps.length) continue;
    // lower median over the probes: a typical plan's spread (the per-plan P90 chance constraint in S5 stays authoritative
    // for plans whose spread is wider, e.g. heavy cardio whose energy cost is uncertain)
    gaps.sort((a, b) => a - b);
    const gap = gaps[Math.floor((gaps.length - 1) / 2)]!;
    out[i] = Math.min(CUSHION_MAX, Math.max(out[i]!, CUSHION_FACTOR * gap));
  }
  return out;
}

/** Safety-trace series each engine margin reads (an absent or all-NaN trace = the quantity is unavailable). */
const ENGINE_TRACE: Readonly<Record<string, keyof SimulationResult['safety']>> = {
  'HC-E1': 'ei7', 'HC-E3': 'deficitPct7', 'HC-E4': 'ea7', 'HC-E5': 'rate14PctPerWk', 'HC-E6': 'cumLossPct', 'HC-E8': 'rate14PctPerWk',
  'HC-P4': 'bmi', 'HC-P5': 'bodyFatPct', 'HC-E7': 'deficitPct7',
};

/**
 * Required margins whose output is unavailable (C6/D4-03): an engine margin the run did not compute, or whose safety
 * trace is absent or entirely non-finite (a stub), and the 28-day deficit leg without its traces. A rule that is simply
 * not applicable on any day (finite trace, no applicable day) is not missing.
 */
export function missingStateMargins(sim: SimulationResult, ctx?: PlanningContext): number[] {
  const s = sim.safety as unknown as Partial<Record<string, ArrayLike<number> | undefined>>;
  const unavailable = (key: string | undefined) => {
    const a = key ? s[key] : undefined;
    if (!a || !a.length) return true;
    for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]!)) return false;
    return true;
  };
  const out: number[] = [];
  for (const [id, idx] of ENGINE_IDS) {
    const computed = sim.constraints ? sim.constraints.some((c) => c.id === id) : id !== 'HC-E7';
    if (!computed || unavailable(ENGINE_TRACE[id] as string)) out.push(idx);
    else if (id === 'HC-E4' && eaUnevaluated(sim)) out.push(idx);
  }
  if (unavailable('deficitPct28') || !s['fastDay']) out.push(26);
  const budget = ctx?.request.constraints?.muscleRetention;
  if (budget && reviewMuscleRetention(budget, sim).status === 'unavailable') out.push(MUSCLE_RETENTION_MARGIN_INDEX);
  return out.sort((a, b) => a - b);
}

/**
 * D8-04: a day on which the energy-availability rules apply (exercise in the trailing 7 days, a deficit, not a fast-event
 * day) but EA_7 has no value (missing intake or an invalid fat-free mass): the exposure is incomplete, so the floor is
 * unchecked for the run — never a pass by "not applicable".
 */
export function eaUnevaluated(sim: SimulationResult): boolean {
  return eaUnevaluatedDays(sim.safety, SAFETY_K).length > 0;
}

/** Engine margin ids merged into the planner's margin vector (HC-F2 is enforced input-side by the tier rules). */
const ENGINE_IDS: ReadonlyArray<[string, number]> = [
  ['HC-E1', 0], ['HC-E3', 1], ['HC-E4', 2], ['HC-E5', 3], ['HC-E6', 4], ['HC-E8', 5], ['HC-P4', 6], ['HC-P5', 7], ['HC-E7', 8],
];

/**
 * 17 state-space margins m = (bound − value)/scale (MODEL_SPEC §7.3), minimum over days. The engine's own
 * `result.constraints` (safety's `computeConstraintMargins`, with the 18:10 fast-day semantics: 7-day rules on non-fast
 * days, 28-day mean floor and tissue-based rate on fast days) is authoritative; the planner adds the tighter caps that
 * come from the user's screening locks (deficit cap, rate cap). NaN (not applicable) → MARGIN_NA.
 */
export function stateMargins(ctx: PlanningContext, sim: SimulationResult, _schedule: Schedule, cushion: ArrayLike<number> | null = null): Float64Array {
  const s = sim.safety;
  const caps = ctx.caps;
  const out = new Float64Array(MARGIN_IDS.length).fill(MARGIN_NA);
  const muscleBudget = ctx.request.constraints?.muscleRetention;
  if (muscleBudget) {
    const review = reviewMuscleRetention(muscleBudget, sim);
    // Missing predictions cannot satisfy a user budget. This is a model feasibility condition, not a health claim.
    out[MUSCLE_RETENTION_MARGIN_INDEX] = Number.isFinite(review.margin) ? fin(review.margin) : -1;
  }
  if (sim.constraints?.length) {
    for (const cm of sim.constraints) {
      const hit = ENGINE_IDS.find(([id]) => id === cm.id);
      if (!hit) continue;
      const w = worstMargin(cm).value;
      if (Number.isFinite(w)) out[hit[1]] = fin(Math.min(out[hit[1]]!, w));
    }
    // user/screening locks tighter than 17's own caps, on deficit days (deficit_pct_7 > DEFICIT_ANY_PCT)
    out[1] = fin(Math.min(out[1]!, minOver(s.deficitPct7, 0, (v) => (v > DEFICIT_ANY_PCT ? (caps.deficitCapPct - v) / 5 : Infinity))));
    out[3] = fin(Math.min(out[3]!, minOver(s.rate14PctPerWk, 13, (v) => (caps.rateCapPct - v) / 0.25)));
  } else {
    out[0] = fin(minOver(s.ei7, 0, (v) => (v - caps.energyFloorKcal) / 100));
    out[1] = fin(minOver(s.deficitPct7, 0, (v) => (v > DEFICIT_ANY_PCT ? (caps.deficitCapPct - v) / 5 : Infinity)));
    const bw0 = ctx.rp.weightKg;
    const e5a = minOver(s.rate14PctPerWk, 13, (v) => (caps.rateCapPct - v) / 0.25);
    const e5b = minOver(s.rate14KgPerWk, 13, (v) => (caps.rateCapKg - v) / (0.0025 * bw0));
    out[3] = fin(Math.min(e5a, e5b));
    out[4] = fin(minOver(s.cumLossPct, 0, (v) => (HC.cumLossMaxPct - v) / 5));
    out[5] = fin(minOver(s.rate14PctPerWk, 13, (v) => (caps.gainCapPct + v) / 0.25));
    out[6] = fin(minOver(s.bmi, 0, (v) => (v - HC.bmi.projectedMin) / 1));
    out[7] = fin(minOver(s.bodyFatPct, 0, (v) => (v - caps.bfFloorPct) / 2));
  }
  // HC-E4 (R-EA-PLANNER): the 30 kcal/kg FFM floor on the days the Simulator's EA rules apply (exercise and a deficit),
  // not on every day as the engine's generic HC-E4 margin reads it (a sedentary person at the kcal floor is not in scope)
  const eaM = eaFloorMargin(sim);
  out[2] = Number.isFinite(eaM) ? fin(eaM) : MARGIN_NA;
  if (cushion) for (let i = 0; i < out.length; i++) if (out[i]! !== MARGIN_NA && (cushion[i] ?? 0) > 0) out[i] = out[i]! - cushion[i]!;
  const h = hungerNorm(sim);
  if (h) out[9] = fin((0.5 * hungerCapMargin(h, ctx.practical.hTol)) / (HUNGER_CAP_UNIT / 2));
  const a = sim.meta.aborted;
  out[10] = a ? -(1 + Math.max(0, a.magnitude)) : MARGIN_NA;
  // D1-08: a model-limit termination (a numerical tissue floor ended the run with its last conserved hour) is not a
  // forecast: the candidate is infeasible like an early abort, so no clipped later day can win the ranking
  if (sim.meta.validity?.status === 'modelLimit') out[10] = Math.min(a ? out[10]! : 0, -1);
  // gain-rate target of a surplus (prescription quality, 13 B21): on surplus days, from day 14 (14-day trend)
  const gt = GAIN_RATE_TARGET_PCT[ctx.rp.habits.trainingHistory] ?? 0.5;
  let gm = Infinity;
  for (let d = 13; d < s.rate14PctPerWk.length; d++) {
    const def = s.deficitPct7[d]!;
    const r = s.rate14PctPerWk[d]!;
    if (!Number.isFinite(def) || !Number.isFinite(r) || def >= -DEFICIT_ANY_PCT) continue;
    gm = Math.min(gm, (gt + r) / 0.25);
  }
  out[11] = fin(gm);
  // index 12 ('W-E07', nominal run only): the same floor with the fixed headroom — it guards the Simulator's W-E08
  // (danger, EA < 30) and W-E20 (caution, EA < 30 for > 14 days); W-E07 itself (30-35 for > 14 days) is a listed caution
  out[12] = Number.isFinite(eaM) ? fin(eaM) : MARGIN_NA;
  // W-M06 (17 HC-M3 in the Simulator): 7-day mean fat ≥ 15 % of energy and ≥ 30 g on non-fast days with EI_7 ≥ 800 kcal;
  // a state-space margin because the resolved intake (R-MAINT: maintenance at the planned activity) differs from the
  // planned-energy proxies repair works with
  let fm = Infinity;
  for (let d = 6; d < s.fatPctEnergy.length; d++) {
    const pctE = s.fatPctEnergy[d]!;
    const ei = s.ei7[d]!;
    if (!Number.isFinite(pctE) || !Number.isFinite(ei) || ei < 800) continue;
    fm = Math.min(fm, (pctE - HC.fat.minPctEnergy) / 5, ((pctE * ei) / 900 - HC.fat.minG) / 10);
  }
  out[13] = fin(fm);
  // W-05-KETO-FED proxy (ruling R-FAST-GATE: the guard matches the rule, not evaluated where the rule does not apply):
  // fast-event days and the day after one (its daily mean still holds fasting hours) are skipped; eating days keep the
  // daily mean BHB ≤ 2.5 mmol/L outside the refeed phase, ≤ 5 in it (the Simulator-mode check stays authoritative)
  const bhb = sim.daily.bhb;
  const fd = s.fastDay;
  let km = Infinity;
  const lim = bhb ? ketoFedDailyLimits(ctx, fd, bhb.length) : null;
  if (bhb && lim) {
    for (let d = 1; d < bhb.length; d++) {
      if (fd && (fd[d]! > 0 || fd[d - 1]! > 0)) continue;
      const v = bhb[d]!;
      if (Number.isFinite(v)) km = Math.min(km, (lim[d]! - v) / 0.5);
    }
  }
  out[14] = fin(km);
  // W-S03 (17 §3): with a waist above 102 / 88 cm or a waist-to-height ratio ≥ 0.5, a planned surplus above 5 % of TDEE_7
  // is a caution; such a person's lean gain stays at ≤ 5 % (the 28-day surplus leg near fasts, as in the engine)
  const waist = ctx.rp.body.circumferences?.waistCm ?? NaN;
  const whtr = ctx.rp.body.whtr;
  if (waist > (ctx.caps.sex === 'female' ? 88 : 102) || whtr >= 0.5) {
    let sm = Infinity;
    const d28 = s.deficitPct28;
    for (let d = 0; d < s.deficitPct7.length; d++) {
      const v = s.deficitPct7[d]!;
      if (!Number.isFinite(v)) continue;
      const v28 = d28 ? d28[d]! : v;
      sm = Math.min(sm, (Math.max(v, Number.isFinite(v28) && fd && fd[d]! > 0 ? v28 : v) + DEFICIT_ANY_PCT) / DEFICIT_ANY_PCT);
    }
    out[15] = fin(sm);
  }
  // HC-E3 over the 28 days around a fast (ruling R-FAST-GATE, planner prescription policy): ruling 18:10 evaluates the
  // 7-day deficit cap on non-fast days, so fasts could add deficit beyond the cap (golden a: weekly 24-h fasts on top of a
  // 25 % deficit, 1.7 kg more fat and lost muscle at the rate cap). A fast delivers part of the same capped deficit
  // (20 §4C "a delivery pattern of a small deficit"; no fat-loss advantage at equal weekly energy): with a fast-event day
  // in the trailing 28 days, the 28-day mean deficit (all days) also stays within the cap.
  const d28 = s.deficitPct28;
  if (d28 && fd) {
    let e28 = Infinity;
    let last = -Infinity;
    for (let d = 0; d < d28.length; d++) {
      if (fd[d]! > 0) last = d;
      const v = d28[d]!;
      if (d - last >= 28 || !Number.isFinite(v) || v <= DEFICIT_ANY_PCT) continue;
      e28 = Math.min(e28, (caps.deficitCapPct - v) / 5);
    }
    out[26] = fin(e28);
  }
  // the engine's own warning margins (R-PLAN-SAFETY), when the run computed them, replace the planner's estimates above
  for (const wm of sim.warningMargins ?? []) {
    const i = WARNING_MARGIN_INDEX[wm.id];
    if (i === undefined) continue;
    let v = Infinity;
    for (let d = 0; d < wm.margin.length; d++) {
      const x = wm.margin[d]!;
      if (Number.isFinite(x) && x < v) v = x;
    }
    out[i] = fin(v);
  }
  // headroom on the nominal-only margins (the calibrated cushion keeps them at the default: their draws are not judged)
  if (cushion) for (const i of NOMINAL_ONLY_MARGINS) if (out[i]! !== MARGIN_NA && (cushion[i] ?? 0) > 0) out[i] = out[i]! - cushion[i]!;
  return out;
}
