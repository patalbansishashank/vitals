/**
 * W3 (C6/D4-05/D4-08) on the Planner screens: a target the finite search did not reach is "not found" (only a proven
 * policy conflict is a "limit conflict"), the Ideal is the best found without your limits (never a ceiling or what is
 * possible), a goal whose status forbids its forecast shows the status word with no number or range, and blood pressure
 * and glycaemia goals are entered with a target (never open-ended lowering).
 */
import { describe, expect, it } from 'vitest';
import type { GoalFeasibility, GoalScore } from '@/engine/planner/domain/types';
import { goalVerdict, scoreView } from './components/PlanParts';
import { goalMetric, modeTakesAmount, newGoal } from './catalogue';
import { IDEAL_CAPTION, NOTHING_BINDS, OF_BEST_FOUND, outcomeView, searchWord } from './ladder';
import { goalRelations } from './relations';
import { goalText } from './planFacts';
import { stageLabel } from './RunView';
import { toRankedGoal } from './request';
import { fixtureLadder, fixtureRequest } from './__tests__/fixtures';

const FORBIDDEN = /fastest safe|scientific ceiling|ceiling|what[’']s possible|impossible|not reachable|not achievable/i;

const feasibility = (over: Partial<GoalFeasibility>): GoalFeasibility => ({
  goal: 0,
  metric: 'fatMass',
  label: 'Fat mass',
  status: 'unattainable',
  baseline: 20,
  bestAchievable: 17,
  target: 14,
  nearestAttainableTarget: null,
  requiredWeeks: null,
  requiredHorizonDays: null,
  text: '',
  ...over,
});

const score = (over: Partial<GoalScore>): GoalScore => ({
  goal: 0,
  metric: 'fatMass',
  label: 'Fat mass',
  unit: 'kg',
  direction: 'target',
  start: 20,
  value: 17,
  change: -3,
  target: 14,
  percentOfAchievable: 80,
  percentOfTarget: 50,
  met: false,
  costVsA: 0,
  band: { p10: 16, p50: 17, p90: 18, pTargetMet: 0.2 },
  grade: 'A',
  ...over,
});

describe('finite-search words (D4-08)', () => {
  it('reads a legacy unattainable row as not found, a proven conflict as a limit conflict, outside the domain as limited', () => {
    expect(searchWord(feasibility({}))).toBe('not found');
    expect(searchWord(feasibility({ outcome: { outcome: 'provenPolicyConflict', proofIds: ['floorAboveCap'] } }))).toBe('limit conflict');
    expect(searchWord(feasibility({ outcome: { outcome: 'outsideSupportedDomain' } }))).toBe('limited');
    expect(searchWord(feasibility({ outcome: { outcome: 'notFoundWithinBudget' } }))).toBe('not found');
    expect(searchWord(null)).toBe('not found');
  });

  it('never words a missed target as impossible', () => {
    const miss = score({});
    expect(goalVerdict(miss, feasibility({}), false, false).word).toBe('not found');
    expect(goalVerdict(miss, feasibility({}), true, false).word).toBe('not found');
    expect(goalVerdict(miss, feasibility({ outcome: { outcome: 'provenPolicyConflict', proofIds: ['x'] } }), false, false).word).toBe('limit conflict');
  });

  it('the Ideal and the % reference are search results, not ceilings', () => {
    for (const t of [IDEAL_CAPTION, NOTHING_BINDS, OF_BEST_FOUND]) expect(t).not.toMatch(FORBIDDEN);
    const dir = outcomeView(fixtureLadder().rungs.hard!.summary.outcomes[2]!, fixtureRequest().goals[2], 'hard', 'metric');
    expect(dir.value).toBe(`↑ 62 % ${OF_BEST_FOUND}`);
  });
});

describe('goal statuses travel with the numbers (C6/D4-05)', () => {
  it('a forbidding status shows the word only: no number, no range, no gap to Hard', () => {
    const o = fixtureLadder().rungs.medium!.summary.outcomes[0]!;
    const v = outcomeView(o, fixtureRequest().goals[0], 'medium', 'metric', { status: 'unavailable' });
    expect(v).toMatchObject({ value: 'Unsupported', range: null, bar: null, status: 'unsupported', vsHard: null });
    const sv = scoreView(score({ status: 'modelLimit' }), undefined, 'metric', 12, false, undefined);
    expect(sv).toMatchObject({ status: 'unsupported', value: 'Model limit', detail: null });
  });

  it('a scenario forecast keeps its numbers and adds the word', () => {
    const o = fixtureLadder().rungs.hard!.summary.outcomes[0]!;
    const v = outcomeView(o, fixtureRequest().goals[0], 'hard', 'metric', { status: 'scenario' });
    expect(v.range).not.toBeNull();
    expect(v.verdict).toMatch(/ · Scenario$/);
    expect(scoreView(score({ status: 'limited' }), undefined, 'metric', 12, false, undefined).detail).toMatch(/Limited$/);
  });

  it('blood pressure and glycaemia goals take a target amount (never open-ended lowering)', () => {
    for (const id of ['sbp', 'glucose', 'fastingGlucose'] as const) {
      const m = goalMetric(id)!;
      expect(m.modes.every((x) => x.direction !== 'minimise'), id).toBe(true);
      expect(modeTakesAmount(m.modes[0]!), id).toBe(true);
      const fresh = newGoal(m);
      expect(fresh.amount, id).toBeNull(); // no universal clinical target is invented
      const g = toRankedGoal({ ...fresh, amount: id === 'sbp' ? 5 : 0.3 }, 0);
      expect(g.direction, id).toBe('target');
      expect(Number.isFinite(g.target), id).toBe(true);
      // the goal reads "lower by" its amount, never "lose" (D4-05)
      expect(goalText(g, 'metric'), id).toMatch(/^lower by /);
    }
    // a mass goal keeps its own words
    expect(goalText({ ...toRankedGoal(newGoal(goalMetric('fatMass')!), 0) }, 'metric')).toMatch(/^lose /);
  });

  it('the run’s stage line names the per-goal search, never what is possible (D4-08)', () => {
    expect(stageLabel('S2', 2)).toBe('searching each goal on its own');
    expect(stageLabel('S2', 2)).not.toMatch(FORBIDDEN);
  });

  it('goal relations never promise a timing penalty on muscle (D3-04)', () => {
    const rel = goalRelations([
      { metric: 'leanTissue', mode: 'keep' },
      { metric: 'bhb', mode: 'reach' },
    ]);
    expect(rel.map((r) => r.text).join(' ')).not.toMatch(/lean-tissue loss|slower muscle gain|protein spread/);
  });
});
