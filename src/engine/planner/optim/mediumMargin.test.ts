// @vitest-environment node
/** Medium's own distinctness margins (PLANNER_V2_SPEC §12.8, E21b): smaller than Hard-Easy's, scaled by their distance. */
import { describe, expect, it } from 'vitest';
import { LADDER_DEFAULTS, MEDIUM_MARGIN, ladderDistinctness, mediumMargins } from './ladder';
import type { RungId } from './types';

const spec = { minDGap: LADDER_DEFAULTS.minDGap, minGower: LADDER_DEFAULTS.minGower };
const pairs = (hm: number, me: number, he: number) => (a: RungId, b: RungId) => {
  const k = [a, b].sort().join('-');
  return k === 'hard-medium' ? hm : k === 'easy-medium' ? me : he;
};

describe('mediumMargins', () => {
  it('max(0.10, distance(Hard, Easy) / 3) and an effort gap of 0.08 when Easy stands', () => {
    expect(mediumMargins(0.24, spec)).toEqual({ minDGap: 0.08, minGower: 0.1 });
    expect(mediumMargins(0.45, spec).minGower).toBeCloseTo(0.15, 12);
    expect(MEDIUM_MARGIN.duplicate).toBe(0.05);
  });
  it('the pairwise rule without Easy', () => {
    expect(mediumMargins(NaN, spec)).toEqual(spec);
    expect(mediumMargins(null, spec)).toEqual(spec);
  });
});

describe('ladderDistinctness with the Medium margin', () => {
  const H = { D: 0.6, d1: 1 };
  const E = { D: 0.4, d1: 0.6 };
  it('keeps a Medium that sits between a distinct Hard-Easy pair (gaps 0.10 and 0.10, distances 0.12 and 0.13 of 0.30)', () => {
    const r = ladderDistinctness(H, { D: 0.5, d1: 0.8 }, E, pairs(0.12, 0.13, 0.3), spec);
    expect(r).toMatchObject({ medium: true, easy: true, collapsed: [] });
  });
  it('drops a Medium under the scaled distance, with the threshold it failed in the detail', () => {
    const r = ladderDistinctness(H, { D: 0.5, d1: 0.8 }, E, pairs(0.14, 0.2, 0.48), spec);
    expect(r.medium).toBe(false);
    expect(r.collapsed[0]).toMatchObject({ rung: 'medium', reason: 'notDistinct' });
    expect(r.collapsed[0]!.detail.minGower).toBeCloseTo(0.16, 12);
    expect(r.collapsed[0]!.detail.gower).toBe(0.14);
  });
  it('drops a Medium under the 0.08 effort gap', () => {
    const r = ladderDistinctness(H, { D: 0.47, d1: 0.7 }, E, pairs(0.2, 0.2, 0.4), spec);
    expect(r.collapsed[0]).toMatchObject({ rung: 'medium', reason: 'tooClose', detail: { minDGap: 0.08 } });
    expect(r.collapsed[0]!.detail.dGap).toBeCloseTo(0.07, 12);
  });
  it('Hard and Easy keep 0.20: when they are closer, Medium repeats Easy\'s reason marked viaEasy', () => {
    const r = ladderDistinctness(H, { D: 0.5, d1: 0.8 }, E, pairs(0.12, 0.12, 0.18), spec);
    expect(r).toMatchObject({ medium: false, easy: false });
    expect(r.collapsed.map((c) => [c.rung, c.reason, c.detail.viaEasy])).toEqual([
      ['easy', 'notDistinct', undefined],
      ['medium', 'notDistinct', 1],
    ]);
  });
  it('without Easy, Medium keeps the pairwise rule (0.15 effort, 0.20 distance)', () => {
    expect(ladderDistinctness(H, { D: 0.5, d1: 0.8 }, null, pairs(0.3, NaN, NaN), spec).collapsed[0]).toMatchObject({ reason: 'tooClose', detail: { minDGap: 0.15 } });
    expect(ladderDistinctness(H, { D: 0.4, d1: 0.8 }, null, pairs(0.15, NaN, NaN), spec).collapsed[0]).toMatchObject({ reason: 'notDistinct', detail: { minGower: 0.2 } });
  });
});
