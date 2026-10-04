/**
 * Evaluator wrapper that records the anytime trace of a run: cumulative EU and wall time, and every feasible nominal
 * evaluation that is not dominated (goals maximised, difficulty minimised) by one recorded before it. Any monotone
 * score of the goals (the weighted goal score on any fixed scale) reaches its best-so-far value on a recorded point,
 * so time to quality can be computed afterwards on the final reference scale. Optionally scores a visited-archive grid.
 */
import type { EvalOutput, EvalRequest, Evaluator } from '../optim/types';
import { violation } from '../optim/types';
import type { TracePoint } from './metrics';

export interface TraceOptions {
  /** +1 for maximised goals, −1 for minimised ones (metric direction of the raw functionals). */
  signs: readonly number[];
  /** The first descriptor is the difficulty D (ladder problems). */
  hasD: boolean;
  /** Wall clock (performance.now). */
  now: () => number;
  /** Called for every feasible nominal evaluation (visited-archive scoring). */
  onFeasible?: (raw: ArrayLike<number>, descriptors: ArrayLike<number>) => void;
}

export class TracingEvaluator implements Evaluator {
  eu = 0;
  requests = 0;
  readonly trace: TracePoint[] = [];
  private front: Float64Array[] = [];
  private t0: number;

  constructor(
    private readonly inner: Evaluator,
    private readonly opts: TraceOptions,
  ) {
    this.t0 = opts.now();
  }

  /** Restart the clock and the counters (a new run on the same evaluator). */
  reset(): void {
    this.eu = 0;
    this.requests = 0;
    this.trace.length = 0;
    this.front = [];
    this.t0 = this.opts.now();
  }

  elapsed(): number {
    return this.opts.now() - this.t0;
  }

  async evaluate(batch: readonly EvalRequest[]): Promise<readonly EvalOutput[]> {
    const outs = await this.inner.evaluate(batch);
    const ms = this.elapsed();
    for (let i = 0; i < outs.length; i++) {
      const out = outs[i]!;
      this.requests++;
      this.eu += out.cost ?? 1;
      if (batch[i]!.draw !== -1) continue;
      if (violation(out.margins) > 0) continue;
      this.opts.onFeasible?.(out.goals, out.descriptors);
      this.offer(out, ms);
    }
    return outs;
  }

  private offer(out: EvalOutput, ms: number): void {
    const K = this.opts.signs.length;
    const D = this.opts.hasD && out.descriptors.length ? Number(out.descriptors[0]) : NaN;
    const o = new Float64Array(K + (Number.isFinite(D) ? 1 : 0));
    for (let k = 0; k < K; k++) {
      const v = Number(out.goals[k]);
      if (!Number.isFinite(v)) return;
      o[k] = this.opts.signs[k]! * v;
    }
    if (Number.isFinite(D)) o[K] = -D;
    for (const f of this.front) {
      if (f.length !== o.length) continue;
      let dominated = true;
      for (let j = 0; j < o.length; j++)
        if (f[j]! < o[j]!) {
          dominated = false;
          break;
        }
      if (dominated) return;
    }
    this.front = this.front.filter((f) => {
      if (f.length !== o.length) return true;
      for (let j = 0; j < o.length; j++) if (o[j]! < f[j]!) return true;
      return false;
    });
    this.front.push(o);
    this.trace.push({
      eu: this.eu,
      ms: Math.round(ms * 10) / 10,
      raw: Array.from(out.goals, Number),
      D,
      b1: out.descriptors.length > 1 ? Number(out.descriptors[1]) : NaN,
    });
  }
}
