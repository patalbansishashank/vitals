import '@/features/charts/test/setupDom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CURRENT_TISSUE_FAT_ENDPOINT } from '@/lib/bodyContracts';
import type { GoalDraft } from '@/state/plannerStore';
import { GOAL_METRICS, goalMetric, newGoal, resolveSavedGoal } from '../catalogue';
import { buildPlannerRequest, defaultConstraints, plannableGoals } from '../request';
import { GoalRankList } from '../components/GoalRankList';
import { SuggestionCard } from '../components/SuggestionCard';
import { draftOf } from '../suggestApply';
import { createAiGoalSuggester, GOAL_SUGGESTION_SCHEMA } from '@/ai/coach/goalSuggester';
import type { ChatModel, ChatRequest } from '@/ai/providers/types';
import { installAiPorts } from '@/commands/aiPorts';
import { aiSuggestion } from '@/commands/planner/goalsSuggest';
import {
  signedReachKg,
  suggestGoals,
  suggestionProbeGoals,
  type GoalSuggestionInput,
} from '@/engine/planner/domain/suggestGoals';
import { compileRequest } from '@/engine/planner/domain/context';
import { targetReach } from '@/engine/planner/domain/reach';
import { inputFor } from '@/engine/planner/domain/__tests__/suggest.fixtures';
import type { PersonProfile } from '@/engine/types/profile';
import type { PlannerRequest } from '@/engine/planner/domain/types';

import { createMemoryRouter, RouterProvider } from 'react-router';
import PlannerPage from '../PlannerPage';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { withSystemWrite } from '@/state/scope';
import { useProfileStore } from '@/state/profileStore';
import { EMPTY_RUN, pickPlannerValues, usePlannerStore } from '@/state/plannerStore';
import { dispatchSync, settleCommits } from '@/commands';
import { exportAll, importAll } from '@/state/persistence';
vi.mock('../plannerClient', () => ({
  estimateTargetsAsync: () => Promise.resolve([]),
  checkpointFor: () => Promise.resolve({ state: 'none' }),
  discardCheckpoint: () => Promise.resolve(),
  cancelPlanning: () => {},
  planLadder: () => new Promise(() => {}),
  resumeLadder: () => Promise.reject(new Error('not used')),
}));

const draft = (
  metric: GoalDraft['metric'],
  mode: GoalDraft['mode'] = 'lower',
  amount: number | null = null,
): GoalDraft => ({ key: metric, metric, mode, amount, strength: 'should', functional: null });
const sanitizeGoals = (goals: unknown) => pickPlannerValues({ goals }).goals;
const neutral = draft('strength', 'raise');
afterEach(() => {
  cleanup();
  installAiPorts({});
});

describe('saved goal intent is reviewed without a numeric migration', () => {
  it('a finite explicit clinical-only request compiles without a weight goal', () => {
    const p: PersonProfile = {
      schemaVersion: 1,
      body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95 },
      labs: { sbpMmHg: 140 },
      startDate: '2026-10-05',
    };
    const req = buildPlannerRequest({
      profile: p,
      goals: [draft('sbp', 'lose', 5)],
      horizonDays: 112,
      startDate: '2026-10-05',
      constraints: defaultConstraints(undefined),
      strictness: 'balanced',
      safety: {
        outcome: {
          plannerAccess: 'full',
          mode: 'M0',
          restrictions: [],
          plannerLocks: [],
          fasting: {
            maxFastHours: 24,
            eligibleMaxHours: 24,
            bindingReasons: [],
            maxEligibleTier: 'T1',
            effectiveTier: 'T1',
            optInTiers: [],
            shortWindowAvailable: false,
          },
          flags: [],
        },
        plannerAccess: 'full',
        optedTier: null,
        shortWindowOn: false,
      },
    });
    const compiled = compileRequest(req);
    expect(compiled.goals).toHaveLength(1);
    expect(compiled.goals[0]?.startEstimate).toBe(140);
    expect(req.goals[0]?.target).toBe(-5);
    expect(req.goals[0]?.targetOrigin).toEqual({ kind: 'change', delta: -5, baseline: 140 });
    expect(compiled.goals[0]?.spec.target).toBe(135);
  });
  it.each(['1', '2'] as const)(
    'v%s import and re-import preserve legacy intent and stable supported order',
    async (version) => {
      const goals = [draft('sbp'), draft('bodyFatPct', 'lose', 3), neutral];
      const state = pickPlannerValues({ goals });
      const base = exportAll();
      const file =
        version === '1'
          ? {
              ...base,
              vitalsVersion: version,
              stores: { 'vitals.planner': { version: 1, state } },
              collections: {},
            }
          : {
              ...base,
              vitalsVersion: version,
              stores: undefined,
              collections: {
                goals: [
                  {
                    ...state,
                    _id: 'me',
                    _col: 'goals',
                    _schema: 1,
                    _rev: 'legacy',
                    _device: 'legacy',
                    _created: '',
                    _updated: '',
                  },
                ],
              },
            };
      await importAll(file);
      await importAll(file);
      expect(usePlannerStore.getState().goals).toEqual(goals);
      expect(plannableGoals(usePlannerStore.getState().goals)).toEqual([neutral]);
      expect(pickPlannerValues(exportAll()?.collections?.goals?.[0]).goals).toEqual(goals);
    },
  );
  it('endpoint identity survives the public edit command, document projection and reload adapter', async () => {
    withSystemWrite(() => usePlannerStore.setState({ ...pickPlannerValues({}), run: EMPTY_RUN }));
    const goal = newGoal(goalMetric('bodyFatPct')!);
    const result = dispatchSync('goals.edit', { ops: [{ op: 'add', goal }] });
    expect(result.ok).toBe(true);
    await settleCommits();
    const document = exportAll()?.collections?.goals?.[0];
    expect(pickPlannerValues(pickPlannerValues(document)).goals).toEqual([goal]);
    expect(pickPlannerValues(document).goals[0]?.endpointSemantics).toEqual(CURRENT_TISSUE_FAT_ENDPOINT);
  });
  it.each(['sbp', 'glucose', 'fastingGlucose'] as const)(
    '%s legacy lower/null stays unchanged and excluded, explicit keep/amount resolves',
    (metric) => {
      const old = draft(metric);
      expect(resolveSavedGoal(old)).toMatchObject({ runnable: false, reason: 'Review · choose target' });
      expect(sanitizeGoals(sanitizeGoals([old, neutral]))).toEqual([old, neutral]);
      expect(plannableGoals([old, neutral])).toEqual([neutral]);
      expect(resolveSavedGoal({ ...old, mode: 'keep' }).runnable).toBe(true);
      expect(
        resolveSavedGoal({ ...old, mode: 'lose', amount: metric === 'sbp' ? 5 : 0.3 }).goal?.target,
      ).toBe(metric === 'sbp' ? -5 : -0.3);
    },
  );
  it('legacy BF preserves identity and original operator, current tissue goal survives repeated sanitation', () => {
    for (const mode of ['lose', 'keep', 'reach'] as const) {
      const old = {
        ...draft('bodyFatPct', mode, 3),
        endpointSemantics: {
          version: 1,
          operator: 'scaleBodyFatWake',
          timeBasis: 'wake',
          provenance: 'original',
        } as const,
      };
      expect(sanitizeGoals(sanitizeGoals([old]))).toEqual([old]);
      expect(resolveSavedGoal(old)).toMatchObject({ runnable: false, reason: 'Review · legacy basis' });
      expect(plannableGoals([old, neutral])).toEqual([neutral]);
    }
    const fresh = newGoal(goalMetric('bodyFatPct')!);
    expect(fresh.endpointSemantics).toEqual(CURRENT_TISSUE_FAT_ENDPOINT);
    expect(resolveSavedGoal(sanitizeGoals(sanitizeGoals([fresh]))[0]!).runnable).toBe(true);
  });
  it('real clinical row displays Review and blank target, explicit choice is required', async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    render(<GoalRankList goals={[draft('sbp')]} onMove={vi.fn()} onUpdate={update} onRemove={vi.fn()} />);
    expect(screen.getByText('Review · choose target')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue('');
    await user.type(screen.getByRole('spinbutton'), '6{Enter}');
    expect(update).toHaveBeenCalledWith('sbp', { amount: 6, mode: 'lose' });
  });
  it.each(['bhb', 'glycogenTotal'] as const)('%s editor offers only finite explicit targets', (metric) => {
    const m = goalMetric(metric)!;
    expect(m.modes.map((s) => s.mode)).toEqual(['reach']);
    const fresh = newGoal(m);
    expect(fresh.amount).toBeNull();
    expect(resolveSavedGoal(fresh).runnable).toBe(false);
    expect(resolveSavedGoal({ ...fresh, amount: metric === 'bhb' ? 1 : 400 }).runnable).toBe(true);
  });
  it('each ordinary catalogue mode resolves when given its explicit bounded amount', () => {
    for (const m of GOAL_METRICS.filter((m) => m.eligible))
      for (const mode of m.modes) {
        const g = newGoal(m, mode.mode);
        if (mode.target === 'absolute' || mode.target === 'change') g.amount = m.target?.fallback ?? 1;
        expect(resolveSavedGoal(g).runnable, `${m.id}/${mode.mode}`).toBe(true);
      }
  });
});

const input: GoalSuggestionInput = {
  profile: { complete: true, sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95 },
  body: { bfPct: 24, bfBand: [18, 28], leanKg: 72, trainingAgeY: 2 },
  intake: {},
  markers: [],
  safety: { noWeightLossGoal: false, optedTier: null },
  reach: [],
  horizonDays: 112,
};
describe('optional suggestion controls preserve adopted goals until Apply', () => {
  it('actual Goals page gathers and persists an optional purpose without changing adopted goals before Apply', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    seedClearedSafety();
    withSystemWrite(() =>
      useProfileStore.setState({
        sex: 'male',
        ageYears: 35,
        heightCm: 180,
        weightKg: 95,
        knownBodyFat: { use: true, pct: 20, source: 'dxa' },
        training: { years: 2, quality: null },
        setup: 'done',
      }),
    );
    withSystemWrite(() =>
      usePlannerStore.setState({ ...pickPlannerValues({}), goals: [neutral], run: EMPTY_RUN }),
    );
    const router = createMemoryRouter([{ path: '/plan/goals', element: <PlannerPage /> }], {
      initialEntries: ['/plan/goals'],
    });
    render(<RouterProvider router={router} />);
    await user.click(screen.getByRole('button', { name: 'Add a goal' }));
    await user.click(screen.getByRole('button', { name: 'Suggest from my answers' }));
    await screen.findByRole('group', { name: 'Optional planning purpose' });
    expect(usePlannerStore.getState().goals).toEqual([neutral]);
    await user.click(screen.getByRole('button', { name: 'Strength' }));
    await screen.findByRole('button', { name: 'Replace my goal' });
    expect(usePlannerStore.getState().goals).toEqual([neutral]);
    await user.click(screen.getByRole('button', { name: 'Replace my goal' }));
    await settleCommits();
    expect(usePlannerStore.getState().suggested?.suggestion.purpose).toBe('strength');
    expect(usePlannerStore.getState().goals.some((g) => g.metric === 'fatMass' && g.mode === 'lose')).toBe(
      false,
    );
  });
  it('purpose and candidate target actions are explicit and targetless loss never invents five kg', async () => {
    const user = userEvent.setup();
    const s = suggestGoals(input),
      purpose = vi.fn(),
      candidate = vi.fn();
    render(
      <SuggestionCard
        state={{ status: 'ready', suggestion: s, stale: false }}
        goalCount={1}
        constraints={defaultConstraints(undefined)}
        fastingOptedIn={false}
        units="metric"
        onApply={vi.fn()}
        onAppend={vi.fn()}
        onClear={vi.fn()}
        onAgain={vi.fn()}
        onPurpose={purpose}
        onCandidate={candidate}
        linkFor={() => null}
        onOpen={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Strength' }));
    expect(purpose).toHaveBeenCalledWith('strength');
    await user.click(screen.getByRole('button', { name: 'Choose Fat mass: lose' }));
    expect(candidate).not.toHaveBeenCalled();
    await user.type(screen.getByRole('spinbutton', { name: 'Optional goal target (kg)' }), '2{Enter}');
    await user.click(screen.getByRole('button', { name: 'Add to suggestion' }));
    expect(candidate).toHaveBeenCalledWith(s.candidates![0], 2);
    expect(
      draftOf({ rank: 1, metric: 'fatMass', mode: 'lose', why: 'Chosen', targetFrom: 'direction' }, 'x'),
    ).toBeNull();
  });
  it.each(['maintenance', 'strength', 'health', 'performance'] as const)(
    '%s explicit purpose stays in the frozen suggestion and suppresses automatic loss',
    (purpose) => {
      const result = suggestGoals({ ...input, purpose });
      expect(result.purpose).toBe(purpose);
      expect(result.goals.some((g) => g.metric === 'fatMass' && g.mode === 'lose')).toBe(false);
      expect(result.structureHash).not.toBe(suggestGoals(input).structureHash);
    },
  );
  it('no-weight-loss locks retain useful neutral goals without loss candidates', () => {
    const result = suggestGoals({
      ...input,
      safety: { ...input.safety, noWeightLossGoal: true },
      purpose: 'fatLoss',
    });
    expect(result.goals.length).toBeGreaterThan(0);
    expect(result.candidates?.some((g) => g.mode === 'lose') ?? false).toBe(false);
  });
});

describe('provider can author only keyed prose', () => {
  const rule = {
    ...suggestGoals({ ...input, purpose: 'strength' }),
    goals: [
      {
        rank: 1,
        metric: 'fatMass',
        mode: 'lose',
        target: 2,
        unit: 'kg',
        targetFrom: 'band',
        why: 'Explicit bounded rule loss.',
      },
      { rank: 2, metric: 'strength', mode: 'raise', targetFrom: 'direction', why: 'Strength direction.' },
      {
        rank: 3,
        metric: 'ldl',
        mode: 'lower',
        targetFrom: 'direction',
        why: 'Entered marker.',
        because: { markerId: 'ldl', label: 'LDL', value: 4, unit: 'mmol/L', date: '2026-10-01' },
      },
    ] as ReturnType<typeof suggestGoals>['goals'],
    notes: [{ topic: 'safety' as const, text: 'Keep entered limit.' }],
    constraints: { maxSessionMin: 60 },
  };
  async function run(raw: unknown) {
    const complete = vi.fn(async (_r: ChatRequest) => ({
      message: { role: 'assistant' as const, parts: [{ type: 'text' as const, text: JSON.stringify(raw) }] },
      usage: null,
      stopReason: 'end' as const,
    }));
    installAiPorts({
      suggestGoals: createAiGoalSuggester({ model: 'fake', complete } as unknown as ChatModel),
    });
    return { result: await aiSuggestion(input, rule), complete };
  }
  it('real adapter/schema round trip preserves marker date, band target, every rank and limits', async () => {
    const { result, complete } = await run({
      rewrites: rule.goals.map((g) => ({ metric: g.metric, why: 'Plain rewritten reason.' })),
    });
    expect(result.fallback).toBeUndefined();
    expect(result.goals.map(({ why: _why, ...g }) => g)).toEqual(rule.goals.map(({ why: _why, ...g }) => g));
    expect(result.constraints).toEqual(rule.constraints);
    expect(result.notes).toEqual(rule.notes);
    expect(complete.mock.calls[0]![0].responseSchema?.schema).toEqual(GOAL_SUGGESTION_SCHEMA);
    expect(JSON.stringify(complete.mock.calls[0]![0].messages)).not.toMatch(/10 %|first two/);
  });
  it.each(['missingThird', 'target', 'units', 'provenance', 'because', 'limit', 'safety', 'extra'])(
    '%s provider schema escape falls back',
    async (change) => {
      const patch: Record<string, unknown> = {
        rewrites: rule.goals.map((g) => ({ metric: g.metric, why: 'Plain rewrite.' })),
      };
      if (change === 'missingThird') (patch.rewrites as unknown[]).pop();
      else if (change === 'extra')
        (patch.rewrites as unknown[]).push({ metric: 'autophagyIdx', why: 'Unsupported.' });
      else patch[change] = change === 'target' ? 2.04 : 'changed';
      expect((await run(patch)).result.fallback).toBeTruthy();
    },
  );
});

describe('numeric suggestions require a supported full horizon, independent of probe aspiration', () => {
  const profile: PersonProfile = {
    schemaVersion: 1,
    body: { sex: 'female', ageYears: 35, heightCm: 165, weightKg: 56, knownBodyFatPct: 42 },
    startDate: '2026-10-05',
  };
  function req(cap?: number): PlannerRequest {
    return {
      profile,
      goals: suggestionProbeGoals(),
      horizonDays: 112,
      ...(cap === undefined
        ? {}
        : {
            safety: {
              plannerAccess: 'full',
              mode: 'M0',
              restrictions: [],
              plannerLocks: [{ id: 'deficit-cap', value: cap, unit: '%', reasons: [] }],
              fasting: {
                maxFastHours: 24,
                maxEligibleTier: 'T1',
                effectiveTier: 'T1',
                optInTiers: [],
                shortWindowAvailable: false,
              },
              flags: [],
              optIns: { fastingTier: null, shortEatingWindow: false, levers: [] },
            },
          }),
    };
  }
  it('pure probes carry direction only', () =>
    expect(suggestionProbeGoals()).toEqual([
      { metric: 'fatMass', direction: 'minimise' },
      { metric: 'skeletalMuscle', direction: 'maximise' },
    ]));
  it.each([
    [10, 2],
    [5, 1],
    [2, null],
  ] as const)('%s percent cap gives %s kg only on full supported coverage', (cap, amount) => {
    const r = req(cap),
      directional = targetReach(r, 0)!;
    const aspiration = targetReach(
      { ...r, goals: [{ metric: 'fatMass', direction: 'minimise', target: -5, targetKind: 'change' }] },
      0,
    )!;
    expect(directional.changeAtHorizon).toBeCloseTo(aspiration.changeAtHorizon, 8);
    expect(directional.coveredDays).toBe(aspiration.coveredDays);

    const body = inputFor(profile, { reach: false });
    const suggestion = suggestGoals({ ...body, purpose: 'fatLoss', reach: [directional] });
    expect(suggestion.goals.find((g) => g.metric === 'fatMass' && g.mode === 'lose')?.target ?? null).toBe(
      amount,
    );
    expect(signedReachKg({ reach: [aspiration] }, 'fatMass', 'loss')).toBe(
      signedReachKg({ reach: [directional] }, 'fatMass', 'loss'),
    );
  });
  it('a stopped prefix or legacy reach never becomes a full-horizon claim', () => {
    const reach = targetReach(req(), 0)!;
    expect(reach.coveredDays!).toBeLessThan(112);
    expect(signedReachKg({ reach: [reach] }, 'fatMass', 'loss')).toBeNull();
    expect(
      signedReachKg(
        {
          reach: [
            { ...reach, coveredDays: undefined, requestedHorizonDays: undefined, completeHorizon: true },
          ],
        },
        'fatMass',
        'loss',
      ),
    ).toBeNull();
  });
});
