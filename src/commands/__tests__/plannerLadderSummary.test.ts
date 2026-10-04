import { describe, expect, it } from 'vitest';
import { toV1Result } from '@/engine/planner/domain/compat';
import { fixtureLadderCase } from '@/features/planner/__tests__/fixtures';
import { ladderSummary } from '../defs/planner';

// planner.result carries the ladder (plan 02 item 10): the levels present, the reasons for the ones not kept, the Ideal
describe('planner.result ladder summary', () => {
  it('lists the four levels when all exist', () => {
    const l = ladderSummary(toV1Result(fixtureLadderCase('four')))!;
    expect(l.rungs.map((r) => r.kind)).toEqual(['hard', 'medium', 'easy']);
    expect(l.collapsed).toEqual([]);
    expect(l.ideal?.sameAsHard).toBe(false);
    expect(l.rungs[0]!.burdens).toHaveLength(7);
  });
  it('gives the reason for each rung it did not keep and flags an Ideal equal to Hard', () => {
    const l = ladderSummary(toV1Result(fixtureLadderCase('sameAsHard')))!;
    expect(l.tier).toBe('X');
    expect(l.collapsed.map((c) => c.rung)).toEqual(['medium', 'easy']);
    expect(l.collapsed.every((c) => c.text.length > 0)).toBe(true);
    expect(l.ideal?.sameAsHard).toBe(true);
    expect(l.convergencePoints).toBeGreaterThan(0);
  });
  it('is null without a v2 result', () => {
    expect(ladderSummary(null)).toBeNull();
  });
});
