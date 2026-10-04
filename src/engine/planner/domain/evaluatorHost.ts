/**
 * Evaluation side of the planner (MODEL_SPEC §10.2): everything an evaluator worker holds — the compiled request,
 * the structure list (same order as the coordinator's), the goal bindings and the ensemble — for each problem variant
 * (the main problem and the extended-horizon time-to-target problems, 18 §4.14.3). Pure: the same code runs in the
 * worker (`src/workers/planner.evaluator.worker.ts`) and in Node tests (local evaluator), so results are identical.
 */
import { evaluatePlan } from '../optim/pipeline';
import type { EvalOutput, EvalRequest } from '../optim/types';
import { compileRequest, withHorizon, type PlanningContext } from './context';
import type { GoalBinding } from './goalSpecs';
import { EnginePlanModel } from './model';
import { enumerateStructures, type SkeletonStructure } from './skeleton';
import type { LimitGroupId, PlannerRequest } from './types';
import { idealRequest, relaxGroup } from './limits';

/** Problem variant an evaluation belongs to. */
export type EvalVariant =
  | { kind: 'main' }
  | { kind: 'ttt'; goal: number; horizonDays: number; theta: number; direction: 1 | -1 }
  /** The Ideal (PLANNER_V2_SPEC §2): the request with every practical limit relaxed (`idealRequest`). */
  | { kind: 'ideal' }
  /** One limit group relaxed to its Ideal value (`relaxGroup`): the shadow price of that limit (§2.4). */
  | { kind: 'limit'; group: LimitGroupId };

export interface HostInit {
  request: PlannerRequest;
  ensemble: { seed: number | string; size: number; holdoutSize?: number };
  /** Calibrated prior chance cushion per margin (model default when absent). */
  cushion?: readonly number[];
}

export function variantKey(v: EvalVariant): string {
  switch (v.kind) {
    case 'main':
    case 'ideal':
      return v.kind;
    case 'limit':
      return `limit:${v.group}`;
    default:
      return `ttt:${v.goal}:${v.horizonDays}:${v.theta}:${v.direction}`;
  }
}

/** The request a variant plans for (the Ideal and limit variants transform the user's request; deterministic). */
export function variantRequest(init: HostInit, v: EvalVariant): PlannerRequest {
  if (v.kind === 'ideal') return idealRequest(init.request).request;
  if (v.kind === 'limit') return relaxGroup(init.request, v.group);
  return init.request;
}

export interface VariantProblem {
  ctx: PlanningContext;
  structures: SkeletonStructure[];
  model: EnginePlanModel;
  bindings: GoalBinding[];
}

/** Build the variant's context, structures and model (deterministic in (request, variant)). */
export function buildVariant(init: HostInit, v: EvalVariant, base?: PlanningContext): VariantProblem {
  const ctx0 = v.kind === 'ideal' || v.kind === 'limit' ? compileRequest(variantRequest(init, v)) : (base ?? compileRequest(init.request));
  const ctx = v.kind === 'ttt' ? withHorizon(ctx0, v.horizonDays) : ctx0;
  const structures = enumerateStructures(ctx);
  const bindings: GoalBinding[] =
    v.kind !== 'ttt'
      ? ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }))
      : [{ metric: ctx.goals[v.goal]!.metric, functional: 'ttt', useTissueMass: ctx.goals[v.goal]!.useTissueMass, ttt: { theta: v.theta, direction: v.direction } }];
  const model = new EnginePlanModel(ctx, { bindings, ensemble: init.ensemble, ...(init.cushion ? { cushion: init.cushion } : {}) });
  return { ctx, structures, model, bindings };
}

/** Holds variant problems and answers batches (one per worker, or one local instance). */
export class EvaluatorHost {
  private readonly variants = new Map<string, VariantProblem>();
  private base: PlanningContext | null = null;
  constructor(readonly init: HostInit) {}

  variant(v: EvalVariant): VariantProblem {
    const k = variantKey(v);
    let p = this.variants.get(k);
    if (!p) {
      this.base = this.base ?? compileRequest(this.init.request);
      p = buildVariant(this.init, v, this.base);
      this.variants.set(k, p);
    }
    return p;
  }

  evaluate(v: EvalVariant, batch: readonly EvalRequest[]): EvalOutput[] {
    const p = this.variant(v);
    return batch.map((r) => evaluatePlan(p.model, p.structures, r));
  }

  /**
   * Daily band series of one plan for ensemble draws 0..draws−1 (reuses the S5 ensemble runs this host already made;
   * otherwise simulates). Returns one Float32Array per draw: series-major, each of length T + 1 (t = 0 first), in the
   * order of `seriesIds`.
   */
  bands(v: EvalVariant, structure: number, x: Float64Array, draws: number, seriesIds: readonly string[], drawBase = 0): Float32Array[] {
    const p = this.variant(v);
    const st = p.structures[structure]!;
    const out: Float32Array[] = [];
    const T = p.ctx.horizonDays + 1;
    let sched: ReturnType<VariantProblem['model']['repair']>['schedule'] | null = null;
    for (let m = drawBase; m < drawBase + draws; m++) {
      let rec = p.model.cachedBands(st.id, x, m);
      if (!rec) {
        sched = sched ?? p.model.repair(st, p.model.decode(st, x)).schedule;
        rec = p.model.bandRecord(p.model.simulate(sched, m));
      }
      const buf = new Float32Array(seriesIds.length * T).fill(Number.NaN);
      seriesIds.forEach((id, k) => {
        const y = rec!.get(id as never);
        if (y) buf.set(y.subarray(0, T), k * T);
      });
      out.push(buf);
    }
    return out;
  }

  /** Calibration (18 §4.19): ms per nominal horizon simulation of the default genome of the first real structure. */
  calibrate(now: () => number, repeats = 3): number {
    const p = this.variant({ kind: 'main' });
    const st = p.structures[Math.min(1, p.structures.length - 1)]!;
    const times: number[] = [];
    for (let i = 0; i < repeats; i++) {
      const t0 = now();
      evaluatePlan(p.model, p.structures, { structure: p.structures.indexOf(st), x: Float64Array.from(st.x0), draw: -1 });
      times.push(now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)]!;
  }
}
