// @vitest-environment node
import { GoalSystem } from './goals';
import {
  PRACTICALLY_TIED,
  decisionStability,
  evaluateEnsemble,
  robustKey,
  robustRerank,
  robustSummary,
} from './robust';
import type { EvalOutput } from './types';

const out = (g: number[], margin: number, reg = 0): EvalOutput => ({
  goals: g,
  margins: [margin],
  regulariser: reg,
  descriptors: [],
});

function goals() {
  const gs = new GoalSystem([
    { id: 'fat', sense: 'max', target: 10 },
    { id: 'lean', sense: 'max' },
  ]);
  gs.setBaseline([0, 0]);
  gs.observe([12, 2], true);
  gs.setFloorFrom(0, 10);
  gs.setFloorFrom(1, 2);
  return gs;
}

describe('ensemble statistics (§4.15)', () => {
  it('bands, P(target met), chance constraint at P90 and tightening', () => {
    const gs = goals();
    const outs = Array.from({ length: 11 }, (_, m) => out([8 + 0.4 * m, 1.5], 0.2 - 0.05 * m)); // fat 8..12, margin 0.2..−0.3
    const r = robustSummary(outs, gs);
    expect(r.draws).toBe(11);
    expect(r.goals[0]!.p50).toBeCloseTo(10, 12);
    expect(r.goals[0]!.p10).toBeCloseTo(8.4, 12);
    expect(r.goals[0]!.p90).toBeCloseTo(11.6, 12);
    expect(r.goals[0]!.pTargetMet).toBeCloseTo(6 / 11, 12);
    expect(r.margins[0]!.p10).toBeCloseTo(-0.25, 12);
    expect(r.chanceFeasible).toBe(false);
    expect(r.chanceViolation).toBeCloseTo(0.25, 12);
    expect(r.tightening[0]!).toBeCloseTo(0.2, 12); // P50 − P10 = −0.05 − (−0.25)
    expect(r.goals[0]!.dCvar).toBeLessThan(r.goals[0]!.dMean);
    expect(Number.isNaN(r.goals[1]!.pTargetMet)).toBe(true);
  });

  it('robust re-ranking puts chance-feasible finalists first, then floors, then robust utility; CVaR mode is cautious', () => {
    const gs = goals();
    const risky = robustSummary([out([12, 2], -0.1), out([12, 2], 0.3), out([12, 2], 0.3)], gs); // best U but P10 margin < 0
    const safeLow = robustSummary([out([9, 1], 0.2), out([9, 1], 0.2), out([9, 1], 0.2)], gs);
    const safeHigh = robustSummary([out([10, 2], 0.1), out([11, 2], 0.1), out([10, 1.9], 0.1)], gs);
    expect(robustRerank([risky, safeLow, safeHigh], gs)).toEqual([2, 1, 0]);
    expect(robustKey(safeHigh, gs)[0]).toBe(0);
    const spread = [out([6, 2], 1), out([12, 2], 1), out([12, 2], 1), out([12, 2], 1), out([12, 2], 1)];
    expect(robustSummary(spread, gs, { mode: 'cvar' }).robustD[0]!).toBeLessThan(
      robustSummary(spread, gs).robustD[0]!,
    );
  });

  it('decision stability across common draws', () => {
    const gs = goals();
    const a = robustSummary([out([10, 2], 1), out([9, 2], 1), out([11, 2], 1), out([6, 2], 1)], gs);
    const b = robustSummary([out([9, 2], 1), out([10, 2], 1), out([8, 2], 1), out([7, 2], 1)], gs);
    const share = decisionStability(a, b, 0);
    expect(share).toBeCloseTo(0.5, 12); // wins draws 0 and 2 → practically tied
    expect(share).toBeLessThan(PRACTICALLY_TIED);
  });

  it('evaluateEnsemble uses the same draws for every finalist (common random numbers), finalist-major', async () => {
    const seen: string[] = [];
    const res = await evaluateEnsemble(['A', 'B'], 3, (batch) => {
      batch.forEach((b) => seen.push(`${b.candidate}${b.draw}`));
      return batch.map((b) => out([b.draw, 0], 1));
    });
    expect(seen).toEqual(['A0', 'A1', 'A2', 'B0', 'B1', 'B2']);
    expect(res.map((r) => r.map((o) => o.goals[0]))).toEqual([
      [0, 1, 2],
      [0, 1, 2],
    ]);
  });
});
