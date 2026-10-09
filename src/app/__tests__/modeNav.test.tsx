import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { resetActivePlan, useActivePlanStore } from '@/features/living/activePlan';
import { currentDay, systemClock } from '@/features/living/clock';
import { installDocumentPlanSource } from '@/features/living/mode';
import { seedPlanDocs } from '@/features/living/__tests__/seedPlanDocs';
import { addDays } from '@/living';

// as in the app: the mode, the Living screens' reads and their writes all come from the plan documents
installDocumentPlanSource();
/** A plan on day 15 of 84, as documents. */
const seedPlan = () => seedPlanDocs({ startDate: addDays(currentDay(systemClock), -14) });

// The lazy screens load the command bus; load it once up front so cold module loading does not eat the test timeouts.
beforeAll(async () => {
  await import('@/commands');
  await import('@/features/living/boot');
}, 120_000);

// jsdom has no scrolling; ScrollRestoration calls it on navigation.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const tabBar = () => screen.getAllByRole('navigation', { name: 'Main' }).find((n) => n.classList.contains('lm-tabbar'))!;
const rail = () => screen.getAllByRole('navigation', { name: 'Main' }).find((n) => n.classList.contains('lm-rail'))!;
const names = (el: HTMLElement) =>
  within(el)
    .getAllByRole('link')
    .filter((a) => !a.classList.contains('lm-rail__brand'))
    .map((a) => a.textContent?.trim());

describe('mode-aware shell navigation (IA §3.4–§3.6)', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    resetActivePlan();
  });
  afterEach(() => resetActivePlan());

  it('Planning mode keeps the four destinations (plus the Coach key above settings)', async () => {
    renderAt('/body');
    await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
    expect(names(tabBar())).toEqual(['body', 'simulate', 'plan', 'evidence']);
    expect(names(rail())).toEqual(expect.arrayContaining(['body', 'simulate', 'plan', 'evidence', 'coach', 'settings']));
  });

  it('Living mode: Today · Food · Train · Coach · Progress, a lower group (no plan status in the rail); / goes to Today', async () => {
    await seedPlan();
    const router = renderAt('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'), { timeout: 5000 });
    expect(names(tabBar())).toEqual(['today', 'food', 'train', 'coach', 'progress']);
    expect(names(rail())).toEqual(['today', 'food', 'train', 'coach', 'progress', 'evidence', 'planning', 'settings']);
    expect(within(rail()).queryByText(/day 15/)).toBeNull();
    expect(tabBar()).toHaveStyle({ gridTemplateColumns: 'repeat(5, 1fr)' });
  });

  it('Planning tools set the override: the return key takes Today’s slot and the plan strip stays until Back to Today', async () => {
    await seedPlan();
    const router = renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    fireEvent.click(within(rail()).getByRole('link', { name: 'planning' }));
    await waitFor(() => expect(useActivePlanStore.getState().planningOverride).toBe(true));
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/today'));
    expect(names(tabBar())).toEqual(['today', 'body', 'simulate', 'plan', 'evidence']);
    const strip = screen.getByRole('region', { name: 'Plan running' });
    expect(strip).toHaveTextContent('Spring cut is running');
    expect(strip).toHaveTextContent('Changes here don’t touch it until you replace it.');
    expect(within(strip).queryByRole('button', { name: /dismiss|close/i })).toBeNull();
    fireEvent.click(within(strip).getByRole('button', { name: 'Back to Today' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    expect(useActivePlanStore.getState().planningOverride).toBe(false);
    expect(screen.queryByRole('region', { name: 'Plan running' })).toBeNull();
  });

  it('⌘/Ctrl + 0 returns to Today while a plan runs (also from the override)', async () => {
    await seedPlan();
    act(() => useActivePlanStore.getState().setPlanningOverride(true));
    const router = renderAt('/body');
    await screen.findByRole('region', { name: 'Plan running' }, { timeout: 5000 });
    fireEvent.keyDown(window, { key: '0', ctrlKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    expect(useActivePlanStore.getState().planningOverride).toBe(false);
  });

  it('without a plan, Today redirects to the Planner with a notice', async () => {
    const router = renderAt('/today');
    await waitFor(() => expect(router.state.location.pathname).toBe('/plan'), { timeout: 5000 });
    expect(await screen.findByText('Start a plan to use Today.')).toBeInTheDocument();
  });

  it('the Coach works in Planning mode without a plan', async () => {
    const router = renderAt('/coach');
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 });
    expect(router.state.location.pathname).toBe('/coach');
  });
});
