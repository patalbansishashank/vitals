// @vitest-environment node
import {
  conflictMatrix,
  formatPayoff,
  formatRelationMessage,
  kneePoint,
  priorityCosts,
  relationMessages,
} from './conflicts';
import { GoalSystem } from './goals';
import { Rng, latinHypercube } from './rng';

/** Desirabilities + utilities of LHS samples of f(x) with baseline f(x_b). */
function samples(K: number, dim: number, f: (x: Float64Array) => number[], baseline: number[], n = 3000) {
  const gs = new GoalSystem(Array.from({ length: K }, (_, k) => ({ id: `g${k}`, sense: 'max' as const })));
  gs.setBaseline(baseline);
  const X = latinHypercube(n, dim, new Rng('conf'));
  const F: number[][] = [];
  for (let i = 0; i < n; i++) {
    const v = f(X.subarray(i * dim, (i + 1) * dim));
    F.push(v);
    gs.observe(v, true);
  }
  const d = new Float64Array(n * K);
  const u = new Float64Array(n);
  F.forEach((v, i) => {
    d.set(gs.desirability(v), i * K);
    u[i] = gs.utility(v, 0);
  });
  return { d, u };
}

describe('conflict / synergy matrix (§4.13)', () => {
  it('classifies a constructed toy: conflict, trade-off, synergy, compatible', () => {
    // g0 = x0, g1 = 1 − x0 (conflict), g2 = 1 − 0.3·x0 (trade-off with g0), g3 = x1, g4 = x1 (synergy)
    const { d, u } = samples(5, 2, (x) => [x[0]!, 1 - x[0]!, 1 - 0.3 * x[0]!, x[1]!, x[1]!], [0, 0, 0, 0, 0]);
    const m = conflictMatrix(d, 5, u);
    const cls = (i: number, j: number) => m.cls[i * 5 + j];
    expect(cls(0, 1)).toBe('conflict');
    expect(cls(1, 0)).toBe('conflict');
    expect(m.kappa[1]!).toBeGreaterThan(0.9);
    expect(cls(0, 2)).toBe('tradeOff'); // holding g0 within 0.05 of its best leaves ≤ 1 − 0.3·0.95 of g2
    expect(m.kappa[2]!).toBeGreaterThan(0.1);
    expect(m.kappa[2]!).toBeLessThan(0.5);
    expect(cls(3, 4)).toBe('synergy');
    expect(cls(4, 3)).toBe('synergy');
    expect(cls(0, 3)).toBe('compatible');
    expect(cls(3, 0)).toBe('compatible');
    expect(Number.isNaN(m.kappa[0]!)).toBe(true);
    // payoff table: at goal 0's anchor, goal 1 is ~0
    expect(m.payoff[0 * 5 + 0]!).toBeGreaterThan(0.99);
    expect(m.payoff[0 * 5 + 1]!).toBeLessThan(0.01);
  });

  it('produces the user-facing messages', () => {
    const { d, u } = samples(3, 2, (x) => [x[0]!, 1 - x[0]!, x[1]!], [0, 0, 0]);
    const m = conflictMatrix(d, 3, u);
    const msgs = relationMessages(m, [0.97, 0.35, 0.99]);
    const conflict = msgs.filter((x) => x.kind === 'conflict');
    expect(conflict).toHaveLength(1);
    const text = formatRelationMessage(conflict[0]!, ['lose fat', 'maximise autophagy', 'strength']);
    expect(text).toMatch(
      /^Goal 2 \(maximise autophagy\) conflicts with goal 1 \(lose fat\): keeping goal 1 within 5 % of its best leaves at most \d+ % of goal 2's potential\. At your priority order you get 35 %\.$/,
    );
    expect(formatPayoff(m, 1, 0, ['lose fat', 'maximise autophagy'])).toMatch(
      /^If you ranked goal 2 \(maximise autophagy\) first it would reach 100 % and goal 1 \(lose fat\) would reach [0-2] %\.$/,
    );
    expect(Array.from(priorityCosts([1, 0.35]))).toEqual([0, 0.65]);
  });

  it('knee point of a trade-off curve', () => {
    const pts = [0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => ({ x, y: 1 - x ** 4 }));
    expect(kneePoint(pts)).toBe(3); // max of x − x⁴ at x = 4^{−1/3} ≈ 0.63
  });
});
