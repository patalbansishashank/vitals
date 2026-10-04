/**
 * Goal construction from the ranked list (dossier 18 §4.5-4.7; MODEL_SPEC §10.1 `goals(sim)`): metric functionals
 * over `sim.daily[seriesId]` in metric units, direction and targets resolved against the start value y(0) of a
 * baseline run, degradation tolerances from the ladder × strictness (lexicographic priorities with tolerances).
 */
import { endMean, timeToTarget, windowMean, type GoalSpec } from '../optim/goals';
import { SERIES, type MetricId, type SeriesId } from '../../types/metrics';
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
export function goalEligibleMetrics(): Array<{ id: MetricId; label: string; unit: string; goal: string; note?: string }> {
  return SERIES.filter((d) => d.kind === 'metric' && d.goal !== 'none').map((d) => ({
    id: d.id as MetricId,
    label: d.label,
    unit: d.unit,
    goal: d.goal,
    ...('goalNote' in d && d.goalNote ? { note: d.goalNote as string } : {}),
  }));
}

/** Daily series y(0..T) for a goal (index 0 = initial state after burn-in). NaN-free when possible. */
export function goalSeries(sim: SimulationResult, b: GoalBinding, ctx: PlanningContext): Float64Array | null {
  if (b.useTissueMass) {
    const tm = sim.safety.tissueMassKg;
    if (tm.length && Number.isFinite(tm[0]!) && Number.isFinite(tm[tm.length - 1]!)) {
      const y = new Float64Array(tm.length + 1);
      y[0] = ctx.rp.fm0Kg + ctx.rp.ffm0Kg;
      for (let i = 0; i < tm.length; i++) y[i + 1] = tm[i]!;
      return y;
    }
  }
  const id = b.metric as SeriesId;
  const d = sim.daily[id];
  if (!d) return null;
  const y = new Float64Array(d.length + 1);
  y[0] = sim.initial[id] ?? d[0] ?? NaN;
  for (let i = 0; i < d.length; i++) y[i + 1] = d[i]!;
  return y;
}

/** Raw functional Φ in metric units (never NaN: falls back to the start value, then 0). */
export function goalValue(sim: SimulationResult, b: GoalBinding, ctx: PlanningContext): number {
  const y = goalSeries(sim, b, ctx);
  if (!y || y.length < 2) return 0;
  let v: number;
  if (b.functional === 'ttt' && b.ttt) v = timeToTarget(y, b.ttt.theta, b.ttt.direction).objective;
  else v = b.functional === 'mean' ? windowMean(y, 1, y.length - 1) : endMean(y, 7);
  if (Number.isFinite(v)) return v;
  const y0 = y[0]!;
  return Number.isFinite(y0) ? y0 : 0;
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
    const target = raw === undefined ? null : g.spec.targetKind === 'change' ? (Number.isFinite(y0) ? y0 + raw : null) : raw;
    const keep = isKeepGoal(g) && target !== null && Number.isFinite(y0);
    const sense = keep && g.direction === 'target' ? (g.def.direction === 'up' ? 'max' : 'min') : directionOf(g, y0, target);
    const spec: GoalSpec = { id: g.metric, label: g.def.label, sense };
    if (target !== null) spec.target = target;
    // "keep X" stays an active goal even when the baseline keeps it (QA item 6: "gain muscle, keep fat mass")
    if (keep) spec.keep = keepScale(g, y0);
    if (g.spec.tolerance !== undefined) spec.tolerance = g.spec.tolerance;
    specs.push(spec);
    bindings.push({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass });
    targets.push(target);
  });
  return { specs, bindings, start: ctx.goals.map((g, i) => (Number.isFinite(start[i]!) ? start[i]! : g.startEstimate)), targets };
}
