import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { fixtureRequest, fixtureResult } from '@/features/planner/__tests__/fixtures';
import { freshState } from '@/commands/__tests__/harness';
import { addDays, type PlanDoc } from '@/living';
import { EMPTY_RUN, usePlannerStore } from '@/state/plannerStore';
import { getDocumentStore } from '@/state/runtime';
import { withSystemWrite } from '@/state/scope';
import { LivingClockContext, currentDay, fixedClock, systemClock } from '../../clock';
import { resetActivePlan } from '../../activePlan';
import { installDocumentPlanSource, getActivePlanSource } from '../../mode';
import { seedPlanDocs, SEED_PLAN_ID } from '../../__tests__/seedPlanDocs';
import { StartPlanEntry } from '../StartPlanSheet';

// the start sheet writes through plan.start / plan.replace; the mode reads the plan documents (as in the app)
installDocumentPlanSource();
// The bus reads the system clock and the sheet its Living clock; both are pinned to the same wall time, once in the
// afternoon and once at 01:30 — after midnight but before the 04:00 rollover, when the app's day is still yesterday and
// a plan started "tomorrow" must start on the calendar date that has just begun, not go live at once (LIV-06, LIV-17).
const WALLS = [
  { label: 'at 13:00', wall: '2026-10-02T13:00:00', appToday: '2026-10-02' },
  { label: 'at 01:30 (before the 04:00 rollover)', wall: '2026-10-02T01:30:00', appToday: '2026-10-01' },
] as const;
let WALL: string = WALLS[0].wall;
let TODAY = '';

function renderEntry() {
  const result = fixtureResult();
  const option = result.options[0]!; // A → Hard
  const router = createMemoryRouter(
    [
      {
        path: '/plan/results',
        element: (
          <LivingClockContext.Provider value={fixedClock(WALL)}>
            <StartPlanEntry option={option} request={fixtureRequest()} provenance={result.provenance} name={option.name} />
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

describe.each(WALLS)('Start this plan (plan-ladder §6.7) $label', ({ wall, appToday }) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(wall));
    WALL = wall;
    TODAY = currentDay(systemClock);
    expect(TODAY).toBe(appToday);
    freshState({ cleared: true });
    resetActivePlan();
    // the Planner result the sheet was opened from (plan.start reads the rung from it)
    withSystemWrite(() => usePlannerStore.setState({ run: { ...EMPTY_RUN, status: 'done', request: fixtureRequest(), result: fixtureResult() } }));
  });
  afterEach(() => vi.useRealTimers());

  it('opens the start sheet with tomorrow, the default name and the plan’s training days; Start plan makes it live and lands on Today', async () => {
    const router = renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Start this plan' }));
    const sheet = await screen.findByRole('dialog', { name: 'Start Hard' });
    expect(within(sheet).getByRole('textbox', { name: 'Plan name' })).toHaveValue('Hard plan · October');
    expect(within(sheet).getByRole('radio', { name: 'tomorrow' })).toHaveAttribute('aria-checked', 'true');
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Start plan' })));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    const plan = getActivePlanSource().get().plan!;
    expect(plan).toMatchObject({ rung: 'hard', status: 'scheduled', startDate: addDays(TODAY, 1) });
    expect(plan.name).toMatch(/^Hard plan · /);
    expect(plan.doc?.request.goals[0]).toMatchObject({ targetKind: 'absolute' });
    expect(plan.version?.version).toBe(1);
    expect(plan.intentions).toMatchObject({ weighInClockH: 7, missedSessionPlan: 'nextDay' });
    expect(plan.policy.checkInWeekday).toBeGreaterThanOrEqual(0);
  });

  it('with a plan running the key reads "Replace active plan…" and needs the typed word', async () => {
    await seedPlanDocs({ startDate: addDays(TODAY, -14) });
    const router = renderEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Replace active plan…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Start Hard' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Replace active plan…' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Replace Spring cut?' });
    const key = within(confirm).getByRole('button', { name: 'Replace plan' });
    expect(key).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: 'replace' } });
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Replace plan' })));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    await waitFor(() => expect(getActivePlanSource().get().plan?.rung).toBe('hard'));
    const old = getDocumentStore().peek<PlanDoc>('plans', SEED_PLAN_ID);
    expect(old).toMatchObject({ name: 'Spring cut', status: 'ended', ended: { reason: 'replaced' } });
  });
});
