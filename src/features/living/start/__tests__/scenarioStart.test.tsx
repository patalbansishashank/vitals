import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { dispatch, dispatchSync, outputOf } from '@/commands';
import { addDays, type PlanDoc } from '@/living';
import { useScheduleStore } from '@/state/scheduleStore';
import { getDocumentStore } from '@/state/runtime';
import { LivingClockContext, currentDay, fixedClock, systemClock } from '../../clock';
import { resetActivePlan } from '../../activePlan';
import { installDocumentPlanSource, getActivePlanSource } from '../../mode';
import { seedPlanDocs, SEED_PLAN_ID } from '../../__tests__/seedPlanDocs';
import { ScenarioStartEntry } from '../ScenarioStartEntry';

installDocumentPlanSource();
const TODAY = currentDay(systemClock);

async function scenario() {
  const id = outputOf(dispatchSync('scenario.ensureActive', {}))!.scenarioId;
  await dispatch('scenario.applyStarter', { id, starter: 'maintenance8' });
  await dispatch('scenario.rename', { id, name: 'My cut' });
  const sc = useScheduleStore.getState().scenarios.find((s) => s.id === id)!;
  return { id: sc.id, name: sc.name, schedule: sc.schedule };
}

function renderEntry(sc: Awaited<ReturnType<typeof scenario>>, disabledReason?: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/simulate',
        element: (
          <LivingClockContext.Provider value={fixedClock(`${TODAY}T10:00:00`)}>
            <ScenarioStartEntry scenario={sc} disabledReason={disabledReason} />
          </LivingClockContext.Provider>
        ),
      },
      { path: '/today', element: <h1>Today</h1> },
    ],
    { initialEntries: ['/simulate'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('Start this plan from a Simulator scenario (IA §4.7, SUITE_SPEC §3.1)', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    resetActivePlan();
  });

  it('opens the scenario start sheet; Start plan starts a custom plan from the scenario and lands on Today', async () => {
    const sc = await scenario();
    const router = renderEntry(sc);
    fireEvent.click(screen.getByRole('button', { name: 'Start this plan' }));
    const sheet = await screen.findByRole('dialog', { name: 'Start My cut' });
    expect(within(sheet).getByRole('textbox', { name: 'Plan name' })).toHaveValue('My cut');
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Start plan' })));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    const plan = getActivePlanSource().get().plan!;
    expect(plan).toMatchObject({ rung: 'custom', name: 'My cut', status: 'scheduled', startDate: addDays(TODAY, 1) });
    expect(plan.doc?.origin).toMatchObject({ kind: 'scenario', scenarioId: sc.id });
    expect(plan.version?.schedule.horizonDays).toBe(sc.schedule.horizonDays);
  });

  it('with a plan running it replaces it after the typed word', async () => {
    const sc = await scenario();
    await seedPlanDocs({ startDate: addDays(TODAY, -14) });
    const router = renderEntry(sc);
    fireEvent.click(screen.getByRole('button', { name: 'Replace active plan…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Start My cut' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Replace active plan…' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Replace Spring cut?' });
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: 'replace' } });
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Replace plan' })));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    await waitFor(() => expect(getActivePlanSource().get().plan?.rung).toBe('custom'));
    expect(getDocumentStore().peek<PlanDoc>('plans', SEED_PLAN_ID)).toMatchObject({ status: 'ended', ended: { reason: 'replaced' } });
  });

  it('a scenario that cannot run cannot be started', async () => {
    const sc = await scenario();
    renderEntry(sc, 'Paint at least one week first');
    expect(screen.getByRole('button', { name: 'Start this plan' })).toHaveAttribute('aria-disabled', 'true');
  });
});
