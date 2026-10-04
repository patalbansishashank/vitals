/**
 * Ruling R-FAST-GATE (PLAN item 8 decision 6; PLANNER_V2_SPEC §3.7): preflight hints when fasting is opted in but no
 * goal turns it on or a muscle goal ranks above the goal it serves, or the longest fast stays under the opted-in tier's
 * maximum; and `expertMode` passed through `toSafetyInput` (T4 reachable in the engine when the app flag is on).
 */
import { describe, expect, it } from 'vitest';
import type { ScreeningOutcome } from '@/features/onboarding';
import { expertModeOn } from '@/features/onboarding/safetyRules';
import { compileSafetyCaps } from '@/engine/planner/domain/safety';
import { compileRequest } from '@/engine/planner/domain/context';
import { goalMetric, newGoal } from '../catalogue';
import { preflightHints } from '../preflight';
import { buildPlannerRequest, defaultConstraints, requestHash, toSafetyInput, type SafetySnapshot } from '../request';
import { PROFILE, START } from './fixtures';

const body = { weightKg: 88, bmi: 27.8, bodyFatPct: 21.5, sex: 'male' as const, trainingHistory: '1to3y' as const };
const goal = (id: Parameters<typeof goalMetric>[0], mode?: Parameters<typeof newGoal>[1]) => newGoal(goalMetric(id)!, mode);
const c = (o: Partial<ReturnType<typeof defaultConstraints>> = {}) => ({ ...defaultConstraints(PROFILE.habits), ...o });
const ids = (h: ReturnType<typeof preflightHints>) => h.map((x) => x.id);

describe('fasting preflight hints (R-FAST-GATE)', () => {
  it('opted into 72 h with the longest fast left at 24 h: says so and offers to raise it', () => {
    const hints = preflightHints({ goals: [goal('autophagyIdx'), goal('fatMass', 'lose')], horizonDays: 112, constraints: c(), body, safetyMaxFastH: 72 });
    const h = hints.find((x) => x.id === 'fasting-short-longest')!;
    expect(h.title).toBe('You’ve opted in to fasts up to 72 h, but your longest fast is set to 24 h.');
    expect(h.body).toBe('Plans can’t use 48- or 72-hour fasts.');
    expect(h.action).toEqual({ kind: 'set-longest-fast', hours: 72, label: 'Allow 72 h fasts' });
    // T2 (48 h) read from an explicit tier; no hint once the limit matches the tier
    expect(preflightHints({ goals: [goal('autophagyIdx')], horizonDays: 112, constraints: c(), body, fastingOptedTier: 'T2' }).find((x) => x.id === 'fasting-short-longest')!.action).toMatchObject({ hours: 48 });
    expect(ids(preflightHints({ goals: [goal('autophagyIdx')], horizonDays: 112, constraints: c({ longestFastH: 72 }), body, safetyMaxFastH: 72 }))).not.toContain('fasting-short-longest');
    // without an opt-in (cap 24 h) there is nothing to say
    expect(ids(preflightHints({ goals: [goal('autophagyIdx')], horizonDays: 112, constraints: c(), body, safetyMaxFastH: 24 }))).not.toContain('fasting-short-longest');
  });

  it('opted in, but no goal fasting serves: plans will not include fasts', () => {
    const hints = preflightHints({ goals: [goal('vo2max', 'raise')], horizonDays: 112, constraints: c({ longestFastH: 72 }), body, fastingOptedTier: 'T3' });
    expect(hints.find((x) => x.id === 'fasting-no-goal')?.title).toBe('None of your goals gains from fasting, so plans won’t include fasts.');
    // the same request with fat loss ranked first is served (the planner decides whether a fast helps)
    expect(ids(preflightHints({ goals: [goal('fatMass', 'lose')], horizonDays: 112, constraints: c({ longestFastH: 72 }), body, fastingOptedTier: 'T3' }))).not.toContain('fasting-no-goal');
    // the evidence graph credits a fast for lower LDL (the engine gate offers it; the optimiser decides)
    expect(ids(preflightHints({ goals: [goal('ldl', 'lower'), goal('vo2max', 'raise')], horizonDays: 112, constraints: c({ longestFastH: 72 }), body, fastingOptedTier: 'T3' }))).not.toContain('fasting-no-goal');
  });

  it('opted in, a muscle goal above the goal fasting serves: plans will not use fasting (replaces the "top two" hint)', () => {
    const goals = [goal('leanTissue', 'gain'), goal('autophagyIdx')];
    const hints = preflightHints({ goals, horizonDays: 112, constraints: c({ longestFastH: 72 }), body, fastingOptedTier: 'T3' });
    const h = hints.find((x) => x.id === 'fasting-muscle-above')!;
    expect(h.title).toMatch(/^With muscle ranked above autophagy/);
    expect(h.body).toBe('Long gaps without protein slow muscle gain.');
    expect(ids(hints)).not.toContain('fasting-muscle');
    // the engine gate agrees: not offered
    const ctx = compileRequest(buildPlannerRequest({ goals, horizonDays: 112, startDate: START, constraints: c({ longestFastH: 72 }), strictness: 'balanced', profile: PROFILE, safety: snapshot('T3', 72) }));
    expect(ctx.fastingRelevant).toBe(false);
    // with a stated preference the top goal is served, as the engine gate reads it
    expect(ids(preflightHints({ goals, horizonDays: 112, constraints: c({ longestFastH: 72, prefersFasting: true }), body, fastingOptedTier: 'T3' }))).not.toContain('fasting-muscle-above');
  });
});

function snapshot(tier: 'T2' | 'T3' | 'T4' | null, maxFastHours: number, expertModeAvailable?: boolean): SafetySnapshot {
  const outcome = {
    plannerAccess: 'full',
    mode: 'M0',
    restrictions: [],
    plannerLocks: [{ id: 'max-fast', value: maxFastHours, reasons: [{ rule: 'HC-F1', source: tier ? 'opt-in' : 'default' }] }],
    fasting: { maxEligibleTier: 'T4', eligibleMaxHours: 168, maxFastHours, effectiveTier: 'T3', optInTiers: ['T2', 'T3', 'T4'], bindingReasons: [], shortWindowAvailable: true },
    flags: [],
  } as unknown as SafetySnapshot['outcome'] & Pick<ScreeningOutcome, 'fasting'>;
  return { outcome, plannerAccess: 'full', optedTier: tier, shortWindowOn: false, ...(expertModeAvailable !== undefined ? { expertModeAvailable } : {}) };
}

describe('expertMode pass-through (PLAN item 8 decision 6)', () => {
  it('is set only with a T4 opt-in and the expert-mode flag; the app flag stays off', () => {
    expect(expertModeOn('T4')).toBe(false); // EXPERT_MODE_AVAILABLE is false in the app
    expect(expertModeOn('T4', true)).toBe(true);
    expect(expertModeOn('T3', true)).toBe(false);
    expect(toSafetyInput(snapshot('T4', 168, true)).expertMode).toBe(true);
    expect(toSafetyInput(snapshot('T4', 168)).expertMode).toBeUndefined();
    expect(toSafetyInput(snapshot('T3', 72, true)).expertMode).toBeUndefined();
  });

  it('makes the expert tier (fasts over 72 h) reachable in the engine, and leaves other requests (and their hashes) unchanged', () => {
    const heavy = { ...PROFILE, body: { ...PROFILE.body, weightKg: 98 } };
    const req = (s: SafetySnapshot) =>
      buildPlannerRequest({ goals: [goal('autophagyIdx')], horizonDays: 112, startDate: START, constraints: c({ longestFastH: 72 }), strictness: 'balanced', profile: heavy, safety: s });
    const on = compileRequest(req(snapshot('T4', 168, true)));
    expect(on.caps.fastTierAllowed.T4).toBe(false); // the user's longest fast (72 h) still caps it …
    const raw = req(snapshot('T4', 168, true));
    const caps = compileSafetyCaps(on.rp, raw.safety, { ...raw.constraints!, maxFastHours: 168 });
    expect(caps.fastTierAllowed.T4).toBe(true); // … but with the limit raised, T4 is reachable through expertMode
    const off = compileRequest(req(snapshot('T4', 168)));
    expect(compileSafetyCaps(off.rp, req(snapshot('T4', 168)).safety, { ...raw.constraints!, maxFastHours: 168 }).fastTierAllowed.T4).toBe(false);
    expect(requestHash(req(snapshot('T3', 72)))).toBe(requestHash(req(snapshot('T3', 72, false))));
  });
});
