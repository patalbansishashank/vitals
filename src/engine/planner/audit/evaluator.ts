/**
 * Goal evaluator completeness (PLANNER_V2_SPEC §6.3 check 3; R6 §7.2 item 3): the planner's functional of every goal
 * metric reads the series its evidence edges touch, and the planner-mode run (recording only the goal series) gives the
 * same goal value as the Simulator-mode run on random plans: planner-mode shortcuts may not drop a mechanism a goal needs.
 */
import { SERIES, type MetricId, type SeriesId } from '../../types/metrics';
import { Rng } from '../optim/rng';
import { compileRequest } from '../domain/context';
import { edgesTo } from '../domain/evidenceGraph';
import { EnginePlanModel } from '../domain/model';
import { enumerateStructures } from '../domain/skeleton';
import type { PlannerRequest } from '../domain/types';
import { CORPUS_PERSONAS } from './corpus';
import { bindingFor } from './probes';

export const GOAL_METRICS: readonly MetricId[] = SERIES.filter((d) => d.kind === 'metric' && d.goal !== 'none').map((d) => d.id as MetricId);

/** Series an edge touches that the planner does not record when the metric is a goal (should be empty). */
export function unrecordedEdgeSeries(): string[] {
  const ctx = compileRequest({ profile: CORPUS_PERSONAS.man88!, goals: [{ metric: 'fatMass', direction: 'minimise' }], horizonDays: 84 });
  const missing = new Set<string>();
  for (const m of GOAL_METRICS) {
    const model = new EnginePlanModel(ctx, { bindings: [bindingFor(m)] });
    const recorded = new Set((model as unknown as { series: SeriesId[] }).series);
    for (const e of edgesTo(m)) for (const s of e.mechanism.series) if (!recorded.has(s)) missing.add(`${m}: ${s}`);
  }
  return [...missing];
}

export interface ModeAgreement {
  plans: number;
  compared: number;
  maxRelDiff: number;
  diffs: string[];
}

/** Planner-mode vs Simulator-mode goal values on `n` random plans (three goal metrics each, cycling through all). */
export function plannerVsSimulator(n = 50, tol = 1e-9, seed = 'audit-check3'): ModeAgreement {
  const rng = new Rng(seed);
  const personas = Object.values(CORPUS_PERSONAS);
  const diffs: string[] = [];
  let compared = 0;
  let maxRelDiff = 0;
  for (let i = 0; i < n; i++) {
    const goals = [0, 1, 2].map((k) => GOAL_METRICS[(3 * i + k) % GOAL_METRICS.length]!).map((metric) => ({ metric, direction: 'maximise' as const }));
    const req: PlannerRequest = { profile: personas[i % personas.length]!, goals, horizonDays: i % 3 === 0 ? 126 : 84, safety: { optIns: { fastingTier: 'T2' } } };
    const ctx = compileRequest(req);
    const sts = enumerateStructures(ctx);
    const st = sts[1 + rng.int(Math.max(1, sts.length - 1))] ?? sts[0]!;
    const x = Float64Array.from({ length: st.dim }, () => rng.float());
    const bindings = ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));
    const planner = new EnginePlanModel(ctx, { bindings });
    const full = new EnginePlanModel(ctx, { bindings, fullMode: true, recordAll: true });
    const schedule = planner.repair(st, planner.decode(st, x)).schedule;
    const a = planner.goals(planner.simulate(schedule, -1));
    const b = full.goals(full.simulate(schedule, -1));
    bindings.forEach((bd, k) => {
      compared++;
      const va = a[k]!;
      const vb = b[k]!;
      const rel = Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb), 1e-12);
      if (Number.isFinite(rel)) maxRelDiff = Math.max(maxRelDiff, rel);
      if (!(rel <= tol)) diffs.push(`${bd.metric} plan ${i} (${st.id}): planner ${va} vs Simulator ${vb}`);
    });
  }
  return { plans: n, compared, maxRelDiff, diffs };
}
