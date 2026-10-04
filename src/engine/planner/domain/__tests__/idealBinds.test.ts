// @vitest-environment node
/**
 * The Ideal differs from Hard when a practical limit binds, and is Hard's own plan when none does (PLANNER_V2_SPEC §12.3,
 * plan 02 item 10; QA Q3-J5-05). The request is the app's own for the 34-year-old vegetarian man of the QA fixture
 * (habit-derived limits, screening locks, creatine consent), quick tier S. Before the fix the Ideal's search kept one
 * finalist at tier S, a running plan the simulator flags (weekly running distance up 400 %), so it returned no plan and
 * the ladder fell back to "None of your limits is binding; the Ideal is this same plan".
 */
import { describe, expect, it } from 'vitest';
import { runLadderPlanner } from '../ladderPlanner';
import { idealRequest } from '../limits';
import type { PlannerRequestV2 } from '../types';

const APP_REQUEST: PlannerRequestV2 = {
  profile: {
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 34, heightCm: 175, weightKg: 88 },
    habits: {
      sessionsPerWeek: 4,
      lifingCardioMix: 0.2,
      typicalSteps: 6000,
      bedTimeH: 0,
      wakeTimeH: 8,
      habitualAlcoholDrinksPerWeek: 0,
      sleepQuality: 'fair',
      dietAnimalLevel: 'vegetarian',
      activity: {
        work: 'desk',
        workDaysPerWeek: 5,
        workHoursPerDay: 8,
        commute: { mode: 'walk', activeMinPerWorkday: 20 },
        steps: { source: 'estimate', weeklyMean: 6000 },
        offDay: 'mixed',
        onFeetAtHome: 'some',
        recreation: [{ label: 'cricket', intensity: 'moderate', minPerWeek: 120 }],
      },
    },
    startDate: '2026-10-05',
    safety: { mode: 'M0', flags: { fastingOptIn: 'none' } },
  },
  goals: [{ metric: 'fatMass', direction: 'target', target: -2, targetKind: 'change' }],
  horizonDays: 56,
  startDate: '2026-10-05',
  constraints: {
    trainingDaysPerWeek: { min: 2, max: 4 },
    allowedTrainingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    trainingTimeH: 18,
    maxSessionMin: 75,
    cardioDaysPerWeek: { min: 0, max: 3 },
    cardioModality: 'cycle',
    eatingWindow: { earliestH: 8, latestH: 20 },
    mealsPerDay: { min: 2, max: 4 },
    steps: { min: 5000, max: 10000 },
    excludedLevers: ['L5', 'waterFast', 'zeroDay'],
    fasting: 'allowed',
    prefersFasting: false,
    sleepFixed: true,
    hungerTolerance: 'medium',
    maxFastHours: 24,
  },
  safety: {
    plannerAccess: 'full',
    mode: 'M0',
    restrictions: [],
    plannerLocks: [
      { id: 'deficit-cap', value: 25, reasons: [{ rule: 'HC-E3' }] },
      { id: 'max-fast', value: 24, reasons: [{ rule: 'HC-F1' }] },
      { id: 'min-eating-window', value: 6, reasons: [{ rule: 'HC-F5' }] },
      { id: 'no-vled', reasons: [{ rule: 'HC-E1' }] },
      { id: 'rate-cap', value: 0.75, reasons: [{ rule: 'HC-E5' }] },
    ],
    fasting: { maxFastHours: 24, maxEligibleTier: 'T4', effectiveTier: 'T1', optInTiers: ['T2', 'T3', 'T4'], shortWindowAvailable: true },
    flags: [],
    optIns: { fastingTier: null, shortEatingWindow: false, levers: ['creatine'] },
  },
  strictness: 'balanced',
} as PlannerRequestV2;

describe('the Ideal against Hard (tier S, the app request)', () => {
  it('VO₂max ↑ with sessions capped at 20 min: the session limit binds, so the Ideal is a plan of its own', async () => {
    const req: PlannerRequestV2 = {
      ...APP_REQUEST,
      goals: [{ metric: 'vo2max', direction: 'maximise' }],
      constraints: { ...APP_REQUEST.constraints, maxSessionMin: 20 },
    };
    const v2 = await runLadderPlanner(req, { tier: 'S' });
    const H = v2.rungs.hard!;
    const I = v2.ideal!;
    expect(H).toBeDefined();
    expect(I).not.toBeNull();
    expect(H.summary.bindingLimits.map((b) => b.group)).toContain('sessionTime');
    // a card of its own: not Hard's plan, and better on the goal by more than its resolution (≥ 1 mL/kg/min here)
    expect(I.sameAsHard ?? null).toBeNull();
    expect(I.nothingBinds).toBe(false);
    expect(I.genome).not.toEqual(H.genome);
    expect(I.summary.outcomes[0]!.vsHard).toBeGreaterThan(1);
    expect(I.summary.weeklyTrainingMin).toBeGreaterThan(H.summary.weeklyTrainingMin);
    // the session limit's own cost is measured and stated
    const cost = I.limitCosts.find((c) => c.group === 'sessionTime');
    expect(cost?.deltas[0]!.delta ?? 0).toBeGreaterThan(0);
    // the Ideal lifts practical limits only: safety and consent stay as they are
    expect(idealRequest(req).request.safety).toEqual(req.safety);
  }, 1_800_000);

  it('fat mass −2 kg (reached inside the limits): no limit binds, so the Ideal is Hard\'s own plan', async () => {
    const v2 = await runLadderPlanner(APP_REQUEST, { tier: 'S' });
    const I = v2.ideal!;
    expect(v2.rungs.hard).toBeDefined();
    expect(I.nothingBinds).toBe(true);
    expect(I.sameAsHard?.liftedWithoutEffect.length ?? 0).toBeGreaterThan(0);
  }, 1_800_000);
});
