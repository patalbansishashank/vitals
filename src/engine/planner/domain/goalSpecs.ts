/**
 * Goal construction from the ranked list (dossier 18 §4.5-4.7; MODEL_SPEC §10.1 `goals(sim)`): metric functionals
 * over `sim.daily[seriesId]` in metric units, direction and targets resolved against the start value y(0) of a
 * baseline run, degradation tolerances from the ladder × strictness (lexicographic priorities with tolerances).
 *
 * D4-05 (C6): a body-fat goal is judged on the tissue fat fraction 100·FM/(FM + FFM_act) of the composition tissue binding
 * (actual `safety.tissueMassKg`, FM and FFM_act at one sampled time, reference glycogen/water inside FFM_act, never
 * FM + leanTissue), in every route that reads goals through `goalSeries` (ordinary runs, reach/Ideal, ForwardModel and
 * replan); the wake-hour `bodyFatPct` series (FM / scale) stays a display operator. A goal whose required output is
 * missing or non-finite is unavailable (`goalValueStatus`): its finite compatibility value is never a benefit — the
 * optimizer excludes it (`missingGoals`) and rows show Unavailable, never 0 or a fabricated success.
 */
import type { ObjectiveShape } from '@/lib/bodyContracts';
import { snapshotCompositionTissue } from '../../model/composition';
import { GOAL_CAPABILITY } from '../../types/metrics';
import { runGoalStatus, statusAllowsObjective } from './capabilities';
import { endMean, timeToTarget, windowMean, type GoalSpec } from '../optim/goals';
import { SERIES, isProductionGoalEligible, type MetricId, type SeriesId } from '../../types/metrics';
import type { SimulationResult } from '../../types/result';
import type { PlanningContext, ResolvedGoal } from './context';

/** How the model computes one goal functional. */
export interface GoalBinding {
  metric: MetricId;
  /** Series actually read (scale-weight goals read tissue mass from the safety trace, 18 §4.5 rule 1). */
  functional: 'end' | 'mean' | 'ttt';
  useTissueMass: boolean;
  /** Time-to-target runs only: θ and the direction of approach. */
  ttt?: { theta: number; direction: 1 | -1 };
}

export interface BuiltGoals {
  specs: GoalSpec[];
  bindings: GoalBinding[];
  /** Start values y(0) used to resolve targets (metric units). */
  start: number[];
  /** Absolute targets (metric units) or null. */
  targets: (number | null)[];
}

/** Goal-eligible metrics for the UI (id, label, unit, allowed directions). */
export function goalEligibleMetrics(): Array<{
  id: MetricId;
  label: string;
  unit: string;
  goal: string;
  objectives: readonly ObjectiveShape[];
  satiation: 'required' | 'optional' | 'none';
  note?: string;
}> {
  return SERIES.filter((d) => d.kind === 'metric' && isProductionGoalEligible(d.id)).map((d) => ({
    id: d.id as MetricId,
    label: d.id === 'bodyFatPct' ? 'Tissue fat' : d.label,
    unit: d.unit,
    goal: GOAL_CAPABILITY[d.id as MetricId].objectives[0] ?? 'none',
    objectives: GOAL_CAPABILITY[d.id as MetricId].objectives,
    satiation: GOAL_CAPABILITY[d.id as MetricId].satiation,
    ...('goalNote' in d && d.goalNote ? { note: d.goalNote as string } : {}),
  }));
}

/** Metrics judged on the tissue fat fraction of the composition binding (D4-05). */
export const TISSUE_FRACTION_GOALS: ReadonlySet<string> = new Set(['bodyFatPct']);

/** Series a goal's functional reads: its required engine outputs (D4-05; a run must record them). */
export function goalRequiredSeries(metric: string): SeriesId[] {
  return TISSUE_FRACTION_GOALS.has(metric) ? ['fatMass', 'leanTissue'] : [metric as SeriesId];
}

/** Versioned derived trajectories; historical raw series and adopted forecasts remain unchanged. */
export const GOAL_TRAJECTORY_VERSION = 3;

export interface GoalTrajectory {
  version: number;
  metric: MetricId;
  operator: string;
  timeBasis: 'endOfDay' | 'catalogue';
  bandKey: string;
  startDay: number;
  endDay: number;
  available: boolean;
  reasonCode: string;
  status: ReturnType<typeof runGoalStatus>['status'];
  values: Float64Array | null;
  initial: number | null;
  referenceFfmKg: number | null;
  referenceBinding: {
    source: 'snapshot' | 'safetyTrace' | 'catalogue';
    unit: 'kg';
    runStartDate: string;
    startDay: number;
    engineVersion: string;
    registryHash: string;
  } | null;
  sample(absoluteDay: number): number | null;
  functionalAt(absoluteDay: number): number | null;
  crossing(target: number, direction: 1 | -1, fromDay?: number): number | null;
}

/**
 * A trajectory bound to this actual run. Coordinates are absolute boundary days: sample(21) is end of day20,
 * including when the run starts from a day14 snapshot. No context profile is used to reconstruct its reference.
 */
export function goalTrajectory(
  sim: SimulationResult,
  b: GoalBinding,
  _ctx?: PlanningContext,
): GoalTrajectory {
  const startDay = sim.meta.startDay ?? 0;
  const tissueFraction = TISSUE_FRACTION_GOALS.has(b.metric);
  const tissue = tissueFraction || b.useTissueMass;
  const operator = tissueFraction
    ? 'tissueFatFraction'
    : b.useTissueMass
      ? 'modelTissueMass'
      : (GOAL_CAPABILITY[b.metric]?.operator ?? b.metric);
  const source = tissue ? sim.daily.fatMass : sim.daily[b.metric];
  let values: Float64Array | null = null;
  let referenceFfmKg: number | null = null;
  let reasonCode = 'missingOutput';
  let referenceSource: 'snapshot' | 'safetyTrace' | 'catalogue' = 'catalogue';
  const st = runGoalStatus(sim, b.metric);
  if (source && source.length >= startDay) {
    if (tissue) {
      const lt = sim.daily.leanTissue;
      const tm = sim.safety.tissueMassKg;
      const snap = sim.snapshots?.[startDay] ?? (sim.snapshot?.day === startDay ? sim.snapshot : undefined);
      const snapTissue = snap ? snapshotCompositionTissue(snap) : null;
      if (snapTissue) {
        referenceFfmKg = snapTissue.referenceFfmKg;
        referenceSource = 'snapshot';
      }
      // The safety tissue trace is sampled at the exact same end-of-day time as FM and LT.
      if (referenceFfmKg === null && lt && tm) {
        for (let d = startDay; d < Math.min(source.length, lt.length, tm.length); d++) {
          const ref = tm[d]! - source[d]! - lt[d]!;
          if (Number.isFinite(ref) && ref >= 0) {
            referenceFfmKg = ref;
            referenceSource = 'safetyTrace';
            break;
          }
        }
      }
      if (lt && tm && referenceFfmKg !== null) {
        const n = Math.min(source.length, lt.length, tm.length) - startDay + 1;
        values = new Float64Array(n);
        const f0 = snapTissue?.fatMassKg ?? sim.initial.fatMass;
        const l0 = snapTissue?.leanTissueKg ?? sim.initial.leanTissue;
        const tm0 =
          snapTissue?.tissueMassKg ?? (f0 === undefined || l0 === undefined ? NaN : f0 + l0 + referenceFfmKg);
        values[0] = tissueFraction ? (100 * (f0 ?? NaN)) / tm0 : tm0;
        for (let j = 1; j < n; j++) {
          const d = startDay + j - 1;
          values[j] = tissueFraction ? (100 * source[d]!) / tm[d]! : tm[d]!;
          if (!(tm[d]! > 0)) values[j] = NaN;
        }
      }
    } else {
      values = new Float64Array(source.length - startDay + 1);
      values[0] = sim.initial[b.metric] ?? NaN;
      for (let j = 1; j < values.length; j++) values[j] = source[startDay + j - 1]!;
    }
    if (values) {
      reasonCode = Array.from(values).every(Number.isFinite) ? 'ok' : 'nonFiniteOutput';
      if (reasonCode !== 'ok') values = null;
    }
  }
  const endDay = startDay + (values ? values.length - 1 : 0);
  const sample = (day: number): number | null => {
    const j = day - startDay;
    return values && Number.isInteger(j) && j >= 0 && j < values.length ? values[j]! : null;
  };
  const functionalAt = (day: number): number | null => {
    if (sample(day) === null || !values) return null;
    const j = day - startDay;
    // Time-to-target approaches the sampled metric; END7 smoothing belongs only to end-value goals.
    if (b.functional === 'ttt') return values[j]!;
    // A continuation cannot claim a complete END7 window until the required samples are covered.
    if (b.functional === 'end' && startDay > 0 && j < 7) return null;
    return j === 0 ? values[0]! : b.functional === 'mean' ? windowMean(values, 1, j) : endMean(values, 7, j);
  };
  return {
    version: GOAL_TRAJECTORY_VERSION,
    metric: b.metric,
    operator,
    timeBasis: tissue ? 'endOfDay' : 'catalogue',
    bandKey: `goal:${b.metric}:${operator}:${GOAL_TRAJECTORY_VERSION}`,
    startDay,
    endDay,
    available: values !== null,
    reasonCode,
    status: st.status,
    values,
    initial: values ? values[0]! : null,
    referenceFfmKg,
    referenceBinding: values
      ? {
          source: referenceSource,
          unit: 'kg',
          runStartDate: sim.meta.startDate,
          startDay,
          engineVersion: sim.meta.engineVersion,
          registryHash: sim.meta.registryHash,
        }
      : null,
    sample,
    functionalAt,
    crossing(target, direction, fromDay = startDay) {
      if (!Number.isFinite(target)) return null;
      for (let day = Math.max(startDay, fromDay); day <= endDay; day++) {
        const value = functionalAt(day);
        if (value !== null && direction * (value - target) >= 0) return day;
      }
      return null;
    },
  };
}

/** Local samples for optimizer functionals; date/current consumers use the envelope's absolute coordinates. */
export function goalSeries(sim: SimulationResult, b: GoalBinding, ctx: PlanningContext): Float64Array | null {
  return goalTrajectory(sim, b, ctx).values;
}

/** Coherent member trajectories are transformed before reduction; wake BF bands are never tissue goal bands. */
export function goalTrajectoryBands(
  members: readonly SimulationResult[],
  b: GoalBinding,
  ctx?: PlanningContext,
) {
  const paths = members.map((s) => goalTrajectory(s, b, ctx));
  if (!paths.length || paths.some((p) => !p.available || !statusAllowsObjective(p.status))) return null;
  const startDay = Math.max(...paths.map((p) => p.startDay));
  const endDay = Math.min(...paths.map((p) => p.endDay));
  if (endDay < startDay) return null;
  const low = new Float64Array(endDay - startDay + 1);
  const high = new Float64Array(low.length);
  for (let d = startDay; d <= endDay; d++) {
    const a = paths.map((p) => p.sample(d)!).sort((x, y) => x - y);
    const q = (p: number) => {
      const j = p * (a.length - 1);
      const lo = Math.floor(j);
      return a[lo]! + (a[Math.ceil(j)]! - a[lo]!) * (j - lo);
    };
    low[d - startDay] = q(0.1);
    high[d - startDay] = q(0.9);
  }
  return { key: paths[0]!.bandKey, operator: paths[0]!.operator, startDay, endDay, low, high };
}

/** A goal functional with its availability (C6: numbers and statuses travel separately). */
export interface GoalValueResult {
  /** Φ in metric units; when unavailable an internal finite compatibility value that must never count as benefit. */
  value: number;
  available: boolean;
  /** 'ok' | 'missingOutput' (a required series is absent) | 'nonFiniteOutput'. */
  reasonCode: 'ok' | 'missingOutput' | 'nonFiniteOutput';
}

/** Internal compatibility value of an unavailable goal: the run's start value, else the profile estimate, else 0. */
function compatValue(y: Float64Array | null, b: GoalBinding, ctx: PlanningContext): number {
  const y0 = y && y.length ? y[0]! : Number.NaN;
  if (Number.isFinite(y0)) return y0;
  const g = ctx.goals.find((x) => x.metric === b.metric);
  return g && Number.isFinite(g.startEstimate) ? g.startEstimate : 0;
}

/** Raw functional Φ with its availability (D4-05): a missing or non-finite required output is unavailable. */
export function goalValueStatus(
  sim: SimulationResult,
  b: GoalBinding,
  ctx: PlanningContext,
): GoalValueResult {
  const tr = goalTrajectory(sim, b, ctx);
  const y = tr.values;
  if (!y || y.length < 2)
    return { value: compatValue(y, b, ctx), available: false, reasonCode: 'missingOutput' };
  let v: number;
  if (b.functional === 'ttt' && b.ttt) v = timeToTarget(y, b.ttt.theta, b.ttt.direction).objective;
  else v = tr.functionalAt(tr.endDay) ?? Number.NaN;
  if (Number.isFinite(v)) return { value: v, available: true, reasonCode: 'ok' };
  return { value: compatValue(y, b, ctx), available: false, reasonCode: 'nonFiniteOutput' };
}

/**
 * Raw functional Φ in metric units (finite). An unavailable goal returns its compatibility value — callers that rank or
 * show goals use `goalValueStatus` / `missingGoalIndices` so it is excluded (C6), never read as zero benefit or success.
 */
export function goalValue(sim: SimulationResult, b: GoalBinding, ctx: PlanningContext): number {
  return goalValueStatus(sim, b, ctx).value;
}

/** Indices of goals whose required output is unavailable in this run (D4-05; `EvalOutput.missingGoals`). */
export function missingGoalIndices(
  sim: SimulationResult,
  bindings: readonly GoalBinding[],
  ctx: PlanningContext,
): number[] {
  const out: number[] = [];
  bindings.forEach((b, k) => {
    if (!goalValueStatus(sim, b, ctx).available) out.push(k);
  });
  return out;
}

function directionOf(g: ResolvedGoal, y0: number, target: number | null): 'max' | 'min' {
  if (g.direction === 'maximise') return 'max';
  if (g.direction === 'minimise') return 'min';
  const ref = Number.isFinite(y0) ? y0 : g.startEstimate;
  if (target === null) return g.def.direction === 'down' ? 'min' : 'max';
  if (!Number.isFinite(ref)) return g.def.direction === 'down' ? 'min' : 'max';
  // a target equal to the start value is "met at baseline" (min with that target)
  return target <= ref ? 'min' : 'max';
}

/** A "keep" goal: a target of zero change from the start (the UI's "keep" phrasing). */
export function isKeepGoal(g: ResolvedGoal): boolean {
  return g.spec.target === 0 && g.spec.targetKind === 'change';
}

/** Shortfall that takes a keep goal's desirability to zero: 5 % of the start value, at least 0.5 kg for masses. */
export function keepScale(g: ResolvedGoal, y0: number): number {
  return Math.max(0.05 * Math.abs(y0), g.def.unit === 'kg' ? 0.5 : 1e-3);
}

/**
 * Build GoalSpecs from the ranked goals and the baseline's start values (`start[i]` = y(0) of goal i, NaN if unknown).
 */
export function buildGoals(ctx: PlanningContext, start: readonly number[]): BuiltGoals {
  const specs: GoalSpec[] = [];
  const bindings: GoalBinding[] = [];
  const targets: (number | null)[] = [];
  ctx.goals.forEach((g, i) => {
    const y0 = Number.isFinite(start[i]!) ? start[i]! : g.startEstimate;
    const raw = g.spec.target;
    const target =
      raw === undefined
        ? null
        : g.spec.targetKind === 'change'
          ? Number.isFinite(y0)
            ? y0 + raw
            : null
          : raw;
    const keep = isKeepGoal(g) && target !== null && Number.isFinite(y0);
    const sense =
      keep && g.direction === 'target'
        ? g.def.direction === 'up'
          ? 'max'
          : 'min'
        : directionOf(g, y0, target);
    const spec: GoalSpec = { id: g.metric, label: g.def.label, sense };
    if (target !== null) spec.target = target;
    // "keep X" stays an active goal even when the baseline keeps it (QA item 6: "gain muscle, keep fat mass")
    if (keep) spec.keep = keepScale(g, y0);
    if (g.spec.tolerance !== undefined) spec.tolerance = g.spec.tolerance;
    specs.push(spec);
    bindings.push({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass });
    targets.push(target);
  });
  return {
    specs,
    bindings,
    start: ctx.goals.map((g, i) => (Number.isFinite(start[i]!) ? start[i]! : g.startEstimate)),
    targets,
  };
}
