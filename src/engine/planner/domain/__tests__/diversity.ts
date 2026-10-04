/**
 * Shared realistic requests and assertions for the M-budget diversity tests (one test file per request so vitest runs
 * them in parallel). Real runs from the UI returned a single plan; with the archive re-ranking, diverse finalists and the
 * nominal chance cushion these requests return 2-3 meaningfully different options at tier M.
 */
import { expect } from 'vitest';
import type { PersonProfile } from '../../../types/profile';
import { compileRequest } from '../context';
import { plannedKcal } from '../decode';
import { runDomainPlanner } from '../planner';
import type { PlannerRequest, PlannerResult } from '../types';
import { validatePlan } from '../validate';
import { expectLadder, expectSimulatorAgrees } from './golden';

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95, knownBodyFatPct: 28 }, habits: { typicalSteps: 6000, sessionsPerWeek: 2, trainingHistory: 'lt1y' }, startDate: '2026-10-05' };
const LEAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 28, heightCm: 178, weightKg: 72, knownBodyFatPct: 14 }, habits: { typicalSteps: 9000, sessionsPerWeek: 4, trainingHistory: '1to3y' }, startDate: '2026-10-05' };
const WOMAN: PersonProfile = { schemaVersion: 1, body: { sex: 'female', ageYears: 40, heightCm: 168, weightKg: 82 }, habits: { typicalSteps: 7000, sessionsPerWeek: 2, trainingHistory: 'lt1y' }, startDate: '2026-10-05' };

export const DIVERSITY_REQUESTS: Record<'r1' | 'r2' | 'r3', PlannerRequest> = {
  /** 1) lose 8 kg fat, 2) keep muscle, 3) low hunger — 84 days. */
  r1: { profile: MAN, goals: [{ metric: 'fatMass', direction: 'target', target: -8, targetKind: 'change' }, { metric: 'leanTissue', direction: 'maximise' }, { metric: 'hunger', direction: 'minimise' }], horizonDays: 84, seed: 1, budget: { tier: 'M' } },
  /** 1) gain muscle, 2) minimise fat gain — 112 days. */
  r2: { profile: LEAN, goals: [{ metric: 'leanTissue', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }], horizonDays: 112, seed: 2, budget: { tier: 'M' } },
  /** 1) fat loss, 2) autophagy index, 3) muscle — fasting opted in (T3) and preferred — 112 days. */
  r3: {
    profile: WOMAN,
    goals: [{ metric: 'fatMass', direction: 'minimise' }, { metric: 'autophagyIdx', direction: 'maximise' }, { metric: 'leanTissue', direction: 'maximise' }],
    horizonDays: 112,
    seed: 3,
    budget: { tier: 'M' },
    safety: { mode: 'M0', optIns: { fastingTier: 'T3' }, fasting: { maxFastHours: 72 } },
    constraints: { prefersFasting: true },
  },
};

export async function runDiversity(key: 'r1' | 'r2' | 'r3'): Promise<PlannerResult> {
  const req = DIVERSITY_REQUESTS[key];
  const res = await runDomainPlanner(req, { tier: 'M', timeToTarget: false });
  expect(res.status).toBe('ok');
  expect(res.complete).toBe(true);
  // ≥ 2 options, pairwise different plans, unique names
  // ladder semantics (PLANNER_V2_SPEC §9.6 item 6): distinct easier rungs, or each missing rung says why
  expectLadder(res);
  const sigs = res.options.map((o) => JSON.stringify([o.schedule.programs, o.schedule.days, o.schedule.events ?? []]));
  expect(new Set(sigs).size).toBe(res.options.length);
  expect(new Set(res.options.map((o) => o.name)).size).toBe(res.options.length);
  const ctx = compileRequest(req);
  for (const o of res.options) {
    expect(validatePlan(ctx, o.schedule).ok).toBe(true);
    expectSimulatorAgrees(req, o); // R-PLAN-SAFETY
    // evidence sanity: no sequencing credited, fasting explained, safety notes graded, bands present
    expect(o.explanation.join(' ')).toMatch(/no fat-loss bonus/);
    expect(o.fasting?.text.length ?? 0).toBeGreaterThan(10);
    expect((o.safetyItems ?? []).every((x) => ['info', 'caution', 'danger'].includes(x.severity))).toBe(true);
    expect(o.bands?.draws ?? 0).toBeGreaterThan(0);
    const k = plannedKcal(ctx, o.schedule);
    for (let d = 0; d < k.length; d++) expect(Number.isFinite(k[d]!)).toBe(true);
  }
  return res;
}
