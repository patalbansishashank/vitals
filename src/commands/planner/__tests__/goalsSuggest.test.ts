/**
 * `goals.suggest` (E19): read-only, rule result by default, AI result checked against the rules with a fake provider
 * (recorded replies), fallback lines, and the applied record through `goals.edit` `setSuggested`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { suggestGoals, type GoalSuggestion, type GoalSuggestionInput } from '@/engine/planner/domain/suggestGoals';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, installAiPorts, installPorts, settleCommits } from '../..';
import { AI, freshState } from '../../__tests__/harness';
import { AI_DISAGREED, AI_FALLBACK, NO_COACH } from '../goalsSuggest';

/** A 95-kg man at about 28 % body fat who has trained under a year, with a fat-loss reach of 7.2 kg in 16 weeks. */
const INPUT: GoalSuggestionInput = {
  profile: { complete: true, sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95, habits: { trainingHistory: 'lt1y' } },
  body: { bfPct: 28, bfBand: [25, 31], leanKg: 68.4, trainingAgeY: 0.5, measuredBodyFat: true },
  intake: { training: { prefs: { daysPerWeek: 3, minPerSession: 60, bestTime: 'evening' } } },
  markers: [],
  devices: {},
  safety: { noWeightLossGoal: false, optedTier: null },
  reach: [
    {
      goal: 0,
      metric: 'fatMass',
      supported: true,
      kind: 'loss',
      start: 26.6,
      target: 21.6,
      valueAtHorizon: 19.4,
      changeAtHorizon: -7.2,
      reachableInHorizon: true,
      weeks: 11,
      beyondTwoYears: false,
      beyondSafetyLimits: false,
      ratePerWeek: 0.45,
      text: '',
    },
  ],
};
const RULE = suggestGoals(INPUT);
const goalsDoc = () => getDocumentStore().peek<Record<string, unknown>>('goals', 'me');

beforeEach(() => {
  freshState({ cleared: true });
  installPorts({ goalSuggest: { gather: async () => INPUT } });
});
afterEach(() => {
  installPorts({ goalSuggest: undefined });
  installAiPorts({});
});

describe('goals.suggest', () => {
  it('returns the rule suggestion and writes nothing', async () => {
    const before = JSON.stringify(goalsDoc());
    const r = await dispatch('goals.suggest', {});
    expect(r.ok).toBe(true);
    const out = (r as { output: GoalSuggestion }).output;
    expect(out).toEqual(RULE);
    expect(out.goals[0]).toMatchObject({ metric: 'fatMass', mode: 'lose', target: 7, targetFrom: 'fastestSafeReach' });
    expect(out.constraints).toMatchObject({ trainingDays: [2, 3], maxSessionMin: 60, trainingTimeH: 18 });
    await settleCommits();
    expect(JSON.stringify(goalsDoc())).toBe(before);
  });

  it('is available to the Coach as a read tool', async () => {
    const r = await dispatch('goals.suggest', { source: 'rule' }, { actor: AI });
    expect(r.ok).toBe(true);
  });

  it('fails plainly when the Planner has not installed its inputs', async () => {
    installPorts({ goalSuggest: undefined });
    const r = await dispatch('goals.suggest', {});
    expect(r).toMatchObject({ ok: false, error: { code: 'precondition_failed' } });
  });

  it('source ai without a Coach: the rule result with a line saying so', async () => {
    const r = await dispatch('goals.suggest', { source: 'ai' });
    expect((r as { output: GoalSuggestion }).output).toEqual({ ...RULE, fallback: NO_COACH });
  });

  it('source ai with an agreeing reply: the AI result (reworded, with a clarifying question)', async () => {
    const reply = {
      goals: RULE.goals.map((g) => ({ ...g, why: `${g.why} (Coach)` })),
      constraints: RULE.constraints,
      notes: [],
      missing: RULE.missing,
      clarify: ['Do you lift at home or in a gym?'],
    };
    installAiPorts({ suggestGoals: async () => ({ raw: reply, version: 'ai:fake-model@1' }) });
    const out = ((await dispatch('goals.suggest', { source: 'ai' })) as { output: GoalSuggestion }).output;
    expect(out.source).toBe('ai');
    expect(out.version).toBe('ai:fake-model@1');
    expect(out.clarify).toEqual(['Do you lift at home or in a gym?']);
    // the equivalence oracle: the rule's top goal is in the AI ranking and no rule limit is contradicted
    expect(out.goals.map((g) => g.metric)).toContain(RULE.goals[0]!.metric);
    for (const [k, v] of Object.entries(out.constraints)) expect(RULE.constraints[k as keyof typeof RULE.constraints]).toEqual(v);
  });

  it('source ai with a disagreeing reply or a failed call: the rule result with a line', async () => {
    installAiPorts({
      suggestGoals: async () => ({ raw: { goals: [{ metric: 'vo2max', mode: 'raise', why: 'Fitness first.' }], constraints: { longestFastH: 72 }, missing: [] }, version: 'ai:fake@1' }),
    });
    let out = ((await dispatch('goals.suggest', { source: 'ai' })) as { output: GoalSuggestion }).output;
    expect(out).toEqual({ ...RULE, fallback: AI_DISAGREED });
    installAiPorts({ suggestGoals: async () => Promise.reject(new Error('network')) });
    out = ((await dispatch('goals.suggest', { source: 'ai' })) as { output: GoalSuggestion }).output;
    expect(out).toEqual({ ...RULE, fallback: AI_FALLBACK });
  });
});

describe('goals.edit setSuggested (the goals.suggested record)', () => {
  it('stores the applied suggestion with provenance and clears it', async () => {
    const record = { suggestion: RULE, at: '2026-10-02T10:00:00.000Z', provenance: { source: 'rule' as const, version: 'rule@1' }, goalKeys: ['fatMass-1'] };
    const r = await dispatch('goals.edit', { ops: [{ op: 'setSuggested', record }] });
    expect(r.ok).toBe(true);
    await settleCommits();
    expect(goalsDoc()!.suggested).toMatchObject({ provenance: { source: 'rule', version: 'rule@1' }, goalKeys: ['fatMass-1'], at: record.at });
    await dispatch('goals.edit', { ops: [{ op: 'setSuggested', record: null }] });
    await settleCommits();
    expect(goalsDoc()!.suggested).toBeNull();
  });
});
