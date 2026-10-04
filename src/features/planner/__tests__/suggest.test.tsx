/**
 * "Suggest from my answers" on the Goals page (planner-goals.md §12, E19): never pre-filled; the key is secondary;
 * the proposal card shows ranked goals with reasons, limits and a missing list; Apply / Add only new goals / Clear;
 * Undo restores; nothing runs until Find plans; an unanswered profile shows the missing list and no goals.
 */
import '@/features/charts/test/setupDom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { settleCommits } from '@/commands';
import { Toaster } from '@/components';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { getDocumentStore } from '@/state/runtime';
import { EMPTY_RUN, pickPlannerValues, usePlannerStore } from '@/state/plannerStore';
import { useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import PlannerPage from '../PlannerPage';
import { basedOnAnswersLine } from '../ladder';
import { missingLink } from '../GoalsView';
import { suggestionWhy } from '../suggestApply';

const client = vi.hoisted(() => ({ planned: 0 }));
vi.mock('../plannerClient', () => ({
  planLadder: () => {
    client.planned++;
    return new Promise(() => {});
  },
  resumeLadder: () => Promise.reject(new Error('not in these tests')),
  checkpointFor: () => Promise.resolve({ state: 'none' }),
  discardCheckpoint: () => Promise.resolve(),
  cancelPlanning: () => {},
  estimateTargetsAsync: () => Promise.resolve([]),
}));

let router: ReturnType<typeof createMemoryRouter>;
function renderGoals() {
  const page = <PlannerPage />;
  router = createMemoryRouter(
    [
      { path: '/plan/goals', element: page },
      { path: '*', element: <p>elsewhere</p> },
    ],
    { initialEntries: ['/plan/goals'] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

const card = () => screen.getByRole('article', { name: /Suggested goals/ });
/** The card once the suggestion is ready (its missing list is always there in these profiles). */
async function readyCard() {
  await screen.findByText('missing', {}, { timeout: 5000 });
  return card();
}
const keyOf = () => screen.getByRole('button', { name: 'Suggest from my answers' });

beforeEach(() => {
  localStorage.clear();
  client.planned = 0;
  seedClearedSafety();
  withSystemWrite(() => useSettingsStore.setState({ units: 'metric' }));
  // 38-year-old man, 180 cm, 92 kg: body fat above the healthy band; training history not answered
  withSystemWrite(() => useProfileStore.setState({ sex: 'male', ageYears: 38, heightCm: 180, weightKg: 92, setup: 'done' }));
  withSystemWrite(() => usePlannerStore.setState({ ...pickPlannerValues({ startDate: '2026-10-05' }), run: EMPTY_RUN }));
});
afterEach(() => withSystemWrite(() => usePlannerStore.setState({ run: EMPTY_RUN })));

describe('Suggest from my answers', () => {
  it('starts empty with a secondary key; the card proposes; Apply fills goals and records provenance; Undo restores; nothing runs', async () => {
    const user = userEvent.setup();
    renderGoals();
    expect(usePlannerStore.getState().goals).toEqual([]);
    const key = keyOf();
    expect(key).toHaveAttribute('data-variant', 'default');
    expect(screen.queryByRole('article', { name: /Suggested goals/ })).toBeNull();

    await user.click(key);
    const c = await readyCard();
    const items = within(c).getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/Fat mass.*lose.*kg/);
    expect(items[0]!.textContent).toMatch(/above the healthy band/);
    expect(within(c).getByText('missing')).toBeInTheDocument();
    expect(within(c).getByText(/How long you have trained decides/)).toBeInTheDocument();
    expect(usePlannerStore.getState().goals).toEqual([]); // a proposal only

    await user.click(within(c).getByRole('button', { name: 'Apply' }));
    expect(usePlannerStore.getState().goals.map((g) => g.metric)).toEqual(['fatMass', 'leanTissue']);
    expect(usePlannerStore.getState().suggested).toMatchObject({ provenance: { source: 'rule', version: 'rule@1' } });
    await settleCommits();
    expect(getDocumentStore().peek<Record<string, unknown>>('goals', 'me')!.suggested).toMatchObject({ provenance: { source: 'rule' } });
    expect(screen.getAllByText('suggested').length).toBeGreaterThan(0);
    // each applied goal keeps its one-line reason under the row (Q3-J4-05)
    expect(document.querySelector('.lp-goal__why')?.textContent).toMatch(/above the healthy band/);
    expect(client.planned).toBe(0);

    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0]!);
    await waitFor(() => expect(usePlannerStore.getState().goals).toEqual([]));
    expect(usePlannerStore.getState().suggested).toBeNull();
  }, 30_000);

  it('with goals already listed: Replace states it, Add only new goals appends, Clear discards', async () => {
    const user = userEvent.setup();
    withSystemWrite(() => usePlannerStore.setState({ goals: [{ key: 'v', metric: 'vo2max', mode: 'raise', amount: null, strength: 'should', functional: null }] }));
    renderGoals();
    await user.click(keyOf());
    let c = await readyCard();
    expect(within(c).getByRole('button', { name: 'Replace my goal' })).toBeInTheDocument();
    await user.click(within(c).getAllByRole('button', { name: 'Clear' })[0]!);
    expect(screen.queryByRole('article', { name: /Suggested goals/ })).toBeNull();
    expect(usePlannerStore.getState().goals.map((g) => g.metric)).toEqual(['vo2max']);

    await user.click(keyOf());
    c = await readyCard();
    await user.click(within(c).getByRole('button', { name: 'Add only new goals' }));
    expect(usePlannerStore.getState().goals.map((g) => g.metric)).toEqual(['vo2max', 'fatMass', 'leanTissue']);
  }, 30_000);

  it('an unanswered profile: no invented goals, the missing list with Add links', async () => {
    const user = userEvent.setup();
    // a lean 30-year-old with no training answer: inside the healthy band, nothing to decide on
    withSystemWrite(() => useProfileStore.setState({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 70, setup: 'done' }));
    renderGoals();
    await user.click(keyOf());
    const c = await readyCard();
    expect(within(c).getByText(/Not enough answered to suggest goals/)).toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(within(c).getAllByRole('button', { name: /^Add:/ }).length).toBeGreaterThanOrEqual(4);
    await user.click(within(c).getByRole('button', { name: /Add: Your daily activity/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/activity'));
  });

  it('the key waits for Your body', () => {
    withSystemWrite(() => useProfileStore.setState({ sex: 'unspecified', ageYears: null, heightCm: null, weightKg: null, setup: 'none' } as never));
    renderGoals();
    expect(keyOf()).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('helpers', () => {
  it('missing answers link to where they are given', () => {
    expect(missingLink('body.waist')).toBe('/body#shape');
    expect(missingLink('training.experience')).toMatch(/^\/onboarding\/training/);
    expect(missingLink('nope')).toBeNull();
  });
  it('a suggested goal shows its reason until the person edits it (Q3-J4-05)', () => {
    const suggestion = {
      source: 'rule' as const,
      version: 'rule@1',
      goals: [{ rank: 1, metric: 'fatMass' as const, mode: 'lose' as const, target: 5, unit: 'kg', targetFrom: 'band' as const, why: 'Your body fat is above the healthy band.' }],
      constraints: {},
    } as never;
    const record = { suggestion, goalKeys: ['k'] };
    const g = { key: 'k', metric: 'fatMass' as const, mode: 'lose' as const, amount: 5, strength: 'should' as const, functional: null };
    expect(suggestionWhy(g, record)).toBe('Your body fat is above the healthy band.');
    expect(suggestionWhy({ ...g, amount: 4 }, record)).toBeNull();
    expect(suggestionWhy({ ...g, key: 'other' }, record)).toBeNull();
    expect(suggestionWhy(g, null)).toBeNull();
  });
  it('the ladder line appears only while suggested goals are planned', () => {
    const rec = { provenance: { source: 'rule' as const }, goalKeys: ['a'] };
    expect(basedOnAnswersLine(rec, ['a', 'b'])).toBe('Goals based on your answers.');
    expect(basedOnAnswersLine({ ...rec, provenance: { source: 'ai' } }, ['a'])).toMatch(/Coach/);
    expect(basedOnAnswersLine(rec, ['b'])).toBeNull();
    expect(basedOnAnswersLine(null, ['a'])).toBeNull();
  });
});
