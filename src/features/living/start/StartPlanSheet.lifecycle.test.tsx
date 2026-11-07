/**
 * Phase 0C consumer check of the start sheet against the lifecycle providers (C5/C6; D4-01, D4-02, D4-03):
 *  - the sheet shows the option's safety as a word and never green by default (no attached check = Unchecked);
 *  - a known violation or a limit conflict cannot be started (the header verb carries the reason);
 *  - with the planner's real revalidation installed, `plan.start` re-checks the CURRENT safety: a stored option status
 *    never authorizes, a refused start leaves no plan, keeps the sheet open and says why (logging is untouched);
 *  - the current screening's exercise gate reads "Exercise · Review" (the gate the planner and the command read);
 *  - closing the sheet never starts anything.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components';
import { fixtureRequest, fixtureResult } from '@/features/planner/__tests__/fixtures';
import { freshState } from '@/commands/__tests__/harness';
import { installLivingPorts } from '@/commands/livingWiring';
import type { PlanOption } from '@/engine/planner/domain/types';
import { EMPTY_RUN, usePlannerStore } from '@/state/plannerStore';
import { useSafetyStore } from '@/state/safetyStore';
import { withSystemWrite } from '@/state/scope';
import { LivingClockContext, fixedClock } from '../clock';
import { resetActivePlan } from '../activePlan';
import { getActivePlanSource, installDocumentPlanSource } from '../mode';
import { SAFETY_BLOCK, StartPlanEntry, StartPlanSheet } from './StartPlanSheet';

installDocumentPlanSource();
// the planner's own revalidation (the default port): every start re-checks the current safety state
installLivingPorts();

const WALL = '2026-10-02T13:00:00';

function renderEntry(option: PlanOption) {
  const result = fixtureResult();
  const router = createMemoryRouter(
    [
      {
        path: '/plan/results',
        element: (
          <LivingClockContext.Provider value={fixedClock(WALL)}>
            <StartPlanEntry option={option} request={fixtureRequest()} provenance={result.provenance} name={option.name} />
            <Toaster />
          </LivingClockContext.Provider>
        ),
      },
      { path: '/today', element: <h1>Today</h1> },
    ],
    { initialEntries: ['/plan/results'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Start this plan' }));
  return screen.findByRole('dialog', { name: 'Start Hard' });
}

describe('Start sheet × lifecycle safety (C5, 0C)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(WALL));
    freshState({ cleared: true });
    resetActivePlan();
    withSystemWrite(() => usePlannerStore.setState({ run: { ...EMPTY_RUN, status: 'done', request: fixtureRequest(), result: fixtureResult() } }));
  });
  afterEach(() => vi.useRealTimers());

  it('experimental scenario tracking is an explicit choice and is labelled separately from checked safety', async () => {
    const router = createMemoryRouter([{ path: '/', element: <LivingClockContext.Provider value={fixedClock(WALL)}><StartPlanSheet open onClose={vi.fn()} scenario={{ id: 'custom', name: 'Chosen routine', schedule: fixtureResult().options[0]!.schedule }} /></LivingClockContext.Provider> }]);
    render(<RouterProvider router={router} />);
    const toggle = screen.getByRole('switch', { name: 'Experimental tracking' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByText(/This exact program and forecast are unvalidated/)).toBeInTheDocument();
    expect(screen.queryByText(/^Safety · Verified$/)).not.toBeInTheDocument();
  });

  it('no attached check reads Unchecked, never a green default', async () => {
    const option = { ...fixtureResult().options[0]! };
    delete (option as { safety?: unknown }).safety;
    renderEntry(option);
    const sheet = await openSheet();
    expect(within(sheet).getByText(/^Safety · Unchecked/)).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/within safety limits|safe plan|\d+\s?% chance/i);
  });

  it.each([
    ['violation', 'Review'],
    ['conflict', 'Limit conflict'],
  ] as const)('a known %s cannot be started: the verb carries the reason', async (status, word) => {
    renderEntry({ ...fixtureResult().options[0]!, safety: { status } });
    const sheet = await openSheet();
    expect(within(sheet).getByText(new RegExp(`^Safety · ${word}`))).toBeInTheDocument();
    const start = within(sheet).getByRole('button', { name: 'Start plan' });
    expect(start).toHaveAttribute('aria-disabled', 'true');
    await act(async () => fireEvent.click(start));
    expect(getActivePlanSource().get().plan).toBeFalsy();
    expect(screen.getByText(SAFETY_BLOCK)).toBeInTheDocument();
  });

  it('a stored Verified never authorizes by itself: plan.start revalidates now and refuses an unsafe schedule, leaving no plan', async () => {
    // the fixture plan breaks the planner's current rules (39/40-h fasts without opt-in, an energy-floor breach)
    const router = renderEntry({ ...fixtureResult().options[0]!, safety: { status: 'verified' } });
    const sheet = await openSheet();
    expect(within(sheet).getByText(/^Safety · Verified/)).toBeInTheDocument();
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Start plan' })));
    // the command refuses with its reason as a toast; the sheet stays, nothing went live, no navigation
    await waitFor(() => expect(document.querySelector('.lm-toast__msg')).not.toBeNull());
    // the planner's reason in plain words (its rule code stays in the record, not on screen)
    const msg = document.querySelector('.lm-toast__msg')!.textContent ?? '';
    expect(msg).toMatch(/maintenance/);
    expect(msg).not.toMatch(/^HC-|^[A-Z]{1,3}-[A-Z0-9]+/);
    expect(router.state.location.pathname).toBe('/plan/results');
    expect(screen.getByRole('dialog', { name: 'Start Hard' })).toBeInTheDocument();
    expect(getActivePlanSource().get().plan).toBeFalsy();
  });

  it('closing the sheet never starts a plan', async () => {
    renderEntry({ ...fixtureResult().options[0]!, safety: { status: 'verified' } });
    const sheet = await openSheet();
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Close' })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Start Hard' })).not.toBeInTheDocument());
    expect(getActivePlanSource().get().plan).toBeFalsy();
  });

  it('the current screening’s exercise gate reads "Exercise · Review" (a Q13 yes still without context)', async () => {
    withSystemWrite(() => useSafetyStore.setState({ answers: { symptoms: 'yes' } }));
    renderEntry(fixtureResult().options[0]!);
    const sheet = await openSheet();
    expect(within(sheet).getByText(/Exercise · Review/)).toBeInTheDocument();
  });
});
