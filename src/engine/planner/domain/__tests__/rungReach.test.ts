// @vitest-environment node
/**
 * Time to target per rung (PLANNER_V2_SPEC §1.4): `rungReach` walks the fastest-safe route family by intensity α so the
 * route's difficulty over its first 12 weeks fits a rung's D. Consistency rules: never faster than the fastest safe rate;
 * less effort never reaches the target sooner (up to one week of rounding); a rung at the safe rate gets the pre-run
 * hint verbatim; at most 6 engine runs per rung and goal; plain words only.
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile } from '../../../types/profile';
import { compileRequest } from '../context';
import { runLadderPlanner } from '../ladderPlanner';
import { RUNG_REACH_STEPS, estimateTargets, rungReach, targetReach } from '../reach';
import type { PlannerRequest, RankedGoal, RungId } from '../types';
import { GOLDEN } from './golden.requests';

const MAN_88: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88 }, habits: { sessionsPerWeek: 3, trainingHistory: '1to3y' }, startDate: '2026-10-05' };
const FAT_8: RankedGoal = { metric: 'fatMass', direction: 'target', target: -8, targetKind: 'change' };
const request: PlannerRequest = { profile: MAN_88, goals: [FAT_8], horizonDays: 84, seed: 7, constraints: { trainingDaysPerWeek: { min: 0, max: 3 } } };
const INTERNAL = /dossier|§|\bR-[A-Z]|\bHC-|\bW-[A-Z0-9]/;

describe('rungReach: time to target at a rung’s effort (§1.4)', () => {
  const ctx = compileRequest(request);
  const fast = targetReach(ctx, 0)!;
  const top = rungReach(ctx, 0, 1)!;

  it('at or above the fastest-safe route’s effort it is the pre-run hint verbatim, with no extra runs', () => {
    expect(fast.supported).toBe(true);
    expect(fast.weeks).not.toBeNull();
    expect(top.alpha).toBe(1);
    expect(top.simulations).toBe(0);
    expect(top.weeks).toBe(fast.weeks);
    expect(top.text).toBe(fast.text);
    expect(top.text).toBe(estimateTargets(request)[0]!.text);
    expect(top.routeD).toBeGreaterThan(0);
    // the tolerance: a rung a hair below the route's D still sits at the safe rate
    expect(rungReach(ctx, 0, top.routeD - 0.01)!.text).toBe(fast.text);
  }, 120_000);

  it('less effort takes longer, never shorter than the fastest safe rate, within 6 runs, in plain words', () => {
    const d1 = top.routeD;
    const hi = rungReach(ctx, 0, 0.6 * d1)!;
    const lo = rungReach(ctx, 0, 0.3 * d1)!;
    for (const r of [hi, lo]) {
      expect(r.simulations).toBeLessThanOrEqual(RUNG_REACH_STEPS);
      expect(r.alpha).toBeLessThan(1);
      if (Number.isFinite(r.routeD)) expect(r.routeD).toBeLessThanOrEqual(r === hi ? 0.6 * d1 : 0.3 * d1);
      expect(r.text).not.toMatch(INTERNAL);
      expect(r.text).toMatch(/^At this plan's effort it takes (about \d+ weeks|more than two years)/);
    }
    expect(hi.alpha).toBeGreaterThanOrEqual(lo.alpha);
    const w = (r: typeof hi) => (r.weeks === null ? Infinity : r.weeks);
    expect(w(hi)).toBeGreaterThanOrEqual(fast.weeks!);
    expect(w(lo)).toBeGreaterThanOrEqual(w(hi) - 1);
    expect(w(hi)).toBeGreaterThan(fast.weeks!);
  }, 120_000);

  it('no effort at all: more than two years, never an extrapolation', () => {
    const r = rungReach(ctx, 0, 0)!;
    expect(r.weeks).toBeNull();
    expect(r.beyondTwoYears).toBe(true);
    expect(r.text).toMatch(/more than two years/);
  }, 120_000);

  it('goals without a canonical route have no answer (callers fall back)', () => {
    const c = compileRequest({ ...request, goals: [{ metric: 'autophagyIdx', direction: 'maximise' }] });
    expect(rungReach(c, 0, 0.5)).toBeNull();
  }, 120_000);
});

describe('per-rung time to target in the ladder (request c, tier S)', () => {
  it('Easy ≥ Medium ≥ Hard ≥ the fastest safe rate; Hard at the safe rate says what the Goals screen said', async () => {
    const req = { ...GOLDEN.c, budget: { tier: 'S' as const } };
    const v2 = await runLadderPlanner(req, { tier: 'S' });
    expect(v2.status).toBe('ok');
    const pre = estimateTargets(req)[0]!;
    const weeks = (r: RungId) => {
      const o = v2.rungs[r]?.summary.outcomes[0];
      return o ? (o.beyondTwoYears ? Infinity : (o.weeksToTarget ?? null)) : undefined;
    };
    const order: RungId[] = ['hard', 'medium', 'easy'];
    const ws = order.map(weeks).filter((x): x is number => typeof x === 'number');
    for (let k = 1; k < ws.length; k++) expect(ws[k]!).toBeGreaterThanOrEqual(ws[k - 1]! - 1);
    const H = v2.rungs.hard!.summary.outcomes[0]!;
    if (H.tttSource === 'route') {
      if (pre.weeks !== null) expect(H.beyondTwoYears || (H.weeksToTarget ?? 0) >= pre.weeks).toBe(true);
      const top = rungReach(compileRequest(req), 0, v2.rungs.hard!.summary.difficulty.D)!;
      if (top.alpha === 1) expect(H.tttText).toBe(pre.text);
    }
    for (const r of order) for (const o of v2.rungs[r]?.summary.outcomes ?? []) expect(o.tttText ?? '').not.toMatch(INTERNAL);
  }, 1_800_000);
});
