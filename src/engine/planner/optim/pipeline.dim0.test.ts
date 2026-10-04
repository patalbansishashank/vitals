/**
 * Structures without free genes (dimension 0, e.g. a fixed status-quo plan) must be evaluated but never searched: the
 * CMA-ES stages, polishing and QD emitters skip them instead of throwing "dimension must be ≥ 1" (regression, WP-P).
 */
import { describe, expect, it } from 'vitest';
import { runPlanner } from './pipeline';
import type { EvalOutput, EvalRequest, PlanStructure } from './types';

describe('dimension-0 structures', () => {
  it('a best-at-start fixed structure is kept without crashing the pipeline', async () => {
    const structures: PlanStructure[] = [
      { id: 'fixed', dim: 0 },
      { id: 'free', dim: 2, x0: [0.5, 0.5] },
    ];
    const f = (r: EvalRequest): EvalOutput => {
      // goal 1 is best on the fixed structure; goal 2 improves with x on the free one
      const g1 = r.structure === 0 ? 1 : 0.5 - 0.1 * (r.x[0] ?? 0);
      const g2 = r.structure === 0 ? 0 : (r.x[0] ?? 0) + (r.x[1] ?? 0);
      return { goals: [g1, g2], margins: [1], regulariser: 0, descriptors: [r.structure === 0 ? 0 : 0.5 + 0.4 * (r.x[1] ?? 0), 0.5] };
    };
    const res = await runPlanner(
      { structures, goals: [{ id: 'a', sense: 'max' }, { id: 'b', sense: 'max' }], baseline: { structure: 0, x: [] } },
      { evaluate: (batch) => batch.map(f) },
      { seed: 1, tier: 'S', totalEU: 400, ensembleSize: 2 },
    );
    expect(res.options.length).toBeGreaterThanOrEqual(1);
    expect(res.complete).toBe(true);
  });
});
