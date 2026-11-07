import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { isPlanningScreen, planCapsuleOf } from '@/app/shell/modeNav';
import { freshState } from '@/commands/__tests__/harness';
import { resetActivePlan, useActivePlanStore, type ActivePlan } from '@/features/living/activePlan';
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
/** The desktop sidebar (shown from 1024 px; CSS hides it below, jsdom renders both). */
const sidebar = () => screen.getAllByRole('navigation', { name: 'Main' }).find((n) => n.classList.contains('lm-sidebar'))!;
/** The navigation keys' accessible names (dock keys and sidebar rows: their aria-label). */
const names = (el: HTMLElement) => within(el).getAllByRole('link').map((a) => a.getAttribute('aria-label') ?? a.textContent?.trim());
/** The sidebar's first group (Today …) and its Planning group (r068 U14). */
const rail = () => sidebar().querySelector<HTMLElement>("[data-group='main']")!;
const planning = () => sidebar().querySelector<HTMLElement>("[data-group='planning']")!;
const yourPlan = () => sidebar().querySelector<HTMLElement>("[data-group='plan']")!;
const header = () => document.querySelector<HTMLElement>('.lm-ctx-slot')!;

describe('mode-aware shell navigation (IA §3.4–§3.6, SPEC §4)', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    resetActivePlan();
  });
  afterEach(() => resetActivePlan());

  // r068 U14: a labelled dock of five keys with Ring in it and More last; the sidebar one stable list in groups
  it('Planning mode: the dock is Today · Plan · Activities · Ring · More, and the sidebar Today · Activities · Ring · Energy · Progress, then Planning', async () => {
    renderAt('/body');
    await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
    // the same slots as Living's Today · Food · Train · Ring · More: Activities / Train third, Ring fourth (r068 V6)
    expect(names(tabBar())).toEqual(['today', 'plan', 'activities', 'ring', 'more']);
    // r068 L29: Progress (weigh-ins, body, markers) needs no plan, so Planning lists it too
    expect(names(rail())).toEqual(['today', 'activities', 'ring', 'energy', 'progress']);
    expect(names(planning())).toEqual(['body', 'simulate', 'plan', 'coach']);
    expect(within(tabBar()).getByRole('link', { name: 'today' })).toHaveAttribute('href', '/today');
    expect(within(tabBar()).getByRole('link', { name: 'more' })).toHaveAttribute('href', '/more');
    expect(tabBar().closest('.lm-dock')).not.toBeNull();
    // the Plan key stands for the three planning steps: current on Your body
    expect(within(tabBar()).getByRole('link', { name: 'plan' })).toHaveAttribute('aria-current', 'page');
    // the dock keys carry their words
    expect(within(tabBar()).getByRole('link', { name: 'ring' })).toHaveTextContent('Ring');
    // r071: the current key is an ivory capsule drawn by ONE thumb, translated to the key's index (Plan is the second of five)
    const thumbs = tabBar().querySelectorAll('.lm-tabbar__thumb');
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toHaveAttribute('aria-hidden', 'true');
    expect(tabBar().style.getPropertyValue('--lm-tabbar-n')).toBe('5');
    expect(tabBar().style.getPropertyValue('--lm-tabbar-i')).toBe('1');
    expect(tabBar()).not.toHaveAttribute('data-thumb');
    // the header's ⋯ holds no places
    expect(within(header()).queryByRole('menuitem', { name: 'Settings' })).toBeNull();
  });

  it('Planning mode: ⌘/Ctrl + 1…4 follow the dock (1 = Today, 3 = Activities, 4 = Ring)', async () => {
    const router = renderAt('/body');
    await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    fireEvent.keyDown(window, { key: '4', ctrlKey: true });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/ring/));
  });

  it('Planning mode: the Plan key opens the Planner when no planning step was used yet, never the Your body setup', async () => {
    renderAt('/today');
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 });
    expect(within(tabBar()).getByRole('link', { name: 'plan' })).toHaveAttribute('href', '/plan');
  });

  it('a planning step’s header joins the three steps (Body · Simulate · Plan) below 1024 px', async () => {
    renderAt('/simulate');
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 });
    const steps = await within(header()).findByRole('navigation', { name: 'Planning step' });
    expect(within(steps).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Body', '/body'],
      ['Simulate', '/simulate'],
      ['Plan', '/plan'],
    ]);
    expect(within(steps).getByRole('link', { name: 'Simulate' })).toHaveAttribute('aria-current', 'page');
  });

  it('Living mode: the dock is Today · Food · Train · Ring · More; the sidebar adds Food and Your plan (Plan details); / goes to Today', async () => {
    await seedPlan();
    const router = renderAt('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'), { timeout: 5000 });
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    expect(names(tabBar())).toEqual(['today', 'food', 'train', 'ring', 'more']);
    expect(names(rail())).toEqual(['today', 'food', 'train', 'ring', 'energy', 'progress']);
    // (r068 final M19) a plan adds only its own page; Progress and Coach keep their groups in both modes
    expect(names(yourPlan())).toEqual(['plan details']);
    expect(within(yourPlan()).getByRole('link', { name: 'plan details' })).toHaveAttribute('href', '/plan/active');
    expect(names(planning())).toEqual(['body', 'simulate', 'plan', 'coach']);
    expect(within(sidebar()).queryByText(/day 15/)).toBeNull();
    expect(within(tabBar()).getByRole('link', { name: 'today' })).toHaveAttribute('aria-current', 'page');
    expect(within(rail()).getByRole('link', { name: 'today' })).toHaveAttribute('aria-current', 'page');
  });

  it('More is a page: every place the dock lacks, in labelled groups, Settings last; the More key lights there and on those places', async () => {
    await seedPlan();
    const router = renderAt('/more');
    await screen.findByRole('heading', { level: 1, name: 'More' }, { timeout: 8000 });
    const main = document.querySelector<HTMLElement>('.lm-page')!;
    expect(within(main).getAllByRole('group').map((g) => g.getAttribute('aria-labelledby') && within(g).getAllByRole('link').map((l) => l.getAttribute('href')))).toEqual([
      ['/plan/active', '/progress', '/coach'],
      ['/body', '/simulate', '/plan'],
      ['/evidence'],
      ['/settings'],
    ]);
    expect(within(tabBar()).getByRole('link', { name: 'more' })).toHaveAttribute('aria-current', 'page');
    expect(tabBar().style.getPropertyValue('--lm-tabbar-i')).toBe('4'); // the thumb rests under More, the last key
    fireEvent.click(within(main).getByRole('link', { name: /^Coach/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/coach'));
    expect(within(tabBar()).getByRole('link', { name: 'more' })).toHaveAttribute('aria-current', 'page');
  });

  it('Planning mode’s More leaves out the three steps the dock’s Plan key stands for, and leads with Energy and Progress (r069 D4, r068 L29: they need no plan)', async () => {
    renderAt('/more');
    await screen.findByRole('heading', { level: 1, name: 'More' }, { timeout: 8000 });
    const main = document.querySelector<HTMLElement>('.lm-page')!;
    const blocks = Array.from(main.querySelectorAll<HTMLElement>('.settings-block'));
    expect(blocks.map((g) => within(g).getAllByRole('link').map((l) => l.getAttribute('href')))).toEqual([['/energy', '/progress'], ['/coach', '/evidence'], ['/settings']]);
    // the first group is unlabelled (as the sidebar's), the others labelled
    expect(blocks.map((g) => g.getAttribute('role'))).toEqual([null, 'group', 'group']);
  });

  it('the Your body setup hides the dock but keeps a way out: ✕ in the header leaves for Today (r068 V1)', async () => {
    const router = renderAt('/body?setup=basics');
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 });
    expect(document.querySelector('.lm-tabbar')).toBeNull();
    fireEvent.click(await within(header()).findByRole('button', { name: 'Close setup' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });

  it('Living mode on a planning screen reached by a link: the dock keeps its Living keys (More lit), the header carries the plan’s status icon', async () => {
    await seedPlan();
    const router = renderAt('/simulate');
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 });
    expect(useActivePlanStore.getState().planningOverride).toBe(false);
    expect(names(tabBar())).toEqual(['today', 'food', 'train', 'ring', 'more']);
    expect(within(tabBar()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('aria-label'))).toEqual(['more']);
    expect(within(planning()).getByRole('link', { name: 'simulate' })).toHaveAttribute('aria-current', 'page');
    expect(within(header()).queryByRole('button', { name: 'Back to Today' })).toBeNull();
    // the running plan, among the header's status icons (one icon, not a strip in the page)
    const planIcon = await within(header()).findByRole('link', { name: 'Spring cut is running, day 15 of 84' });
    expect(planIcon.closest('.lm-ctx__caps')).not.toBeNull();
    expect(planIcon).toHaveAttribute('href', '/plan/active');
    expect(document.querySelectorAll('.lm-plan-status')).toHaveLength(1);
    // a planning screen's ⋯ holds only its own actions (none here), so the plan icon ends the bar
    expect(within(header()).queryByRole('button', { name: 'More' })).toBeNull();
    fireEvent.click(within(tabBar()).getByRole('link', { name: 'today' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    // a Living screen: no plan icon (Today states the plan day in its own fact line)
    expect(document.querySelector('.lm-plan-status')).toBeNull();
    expect(names(tabBar())).toEqual(['today', 'food', 'train', 'ring', 'more']);
  });

  it('the plan status icon’s screens: Body, Simulate, the Planner and Evidence while a plan runs (any screen in the override), never Plan details', () => {
    const plan = { id: 'p' } as unknown as ActivePlan;
    for (const p of ['/body', '/body?setup=basics', '/simulate', '/simulate/s1/results', '/plan', '/plan/goals', '/plan/results', '/evidence', '/evidence/topics/x'])
      expect([p, isPlanningScreen(p.split('?')[0]!)]).toEqual([p, true]);
    for (const p of ['/plan/active', '/plan/active/versions/2', '/planner', '/today', '/food', '/coach', '/settings', '/onboarding/activity', '/bodyx'])
      expect([p, isPlanningScreen(p)]).toEqual([p, false]);
    expect(planCapsuleOf({ override: false, plan }, '/evidence')).toBe(plan);
    expect(planCapsuleOf({ override: false, plan }, '/coach')).toBeNull();
    expect(planCapsuleOf({ override: true, plan }, '/coach')).toBe(plan);
    expect(planCapsuleOf({ override: false, plan: null }, '/body')).toBeNull();
  });

  it('⌘/Ctrl + 0 returns to Today while a plan runs (also from the override)', async () => {
    await seedPlan();
    act(() => useActivePlanStore.getState().setPlanningOverride(true));
    const router = renderAt('/body');
    await screen.findByRole('link', { name: /Spring cut is running/ }, { timeout: 5000 });
    fireEvent.keyDown(window, { key: '0', ctrlKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    expect(useActivePlanStore.getState().planningOverride).toBe(false);
  });

  // 0.6.3: Today works without a plan (it used to redirect to the Planner); Food and Train still need one
  it('without a plan, Today is a page of its own; Food still redirects to the Planner with one banner under the header', async () => {
    const router = renderAt('/today');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    expect(router.state.location.pathname).toBe('/today');
    expect(screen.getByRole('heading', { name: 'No plan running' })).toBeInTheDocument();
    expect(screen.queryByText('Start a plan to use this screen.')).toBeNull();
    cleanup();
    const food = renderAt('/food');
    await waitFor(() => expect(food.state.location.pathname).toBe('/plan'), { timeout: 5000 });
    const banner = await screen.findByText('Start a plan to use this screen.');
    expect(banner.closest('.lm-notices')).not.toBeNull();
    expect(document.querySelectorAll('.lm-notices .lm-banner')).toHaveLength(1);
  });

  it('the start screen is Today in Planning mode: a stored last route of Settings never opens the app', async () => {
    localStorage.setItem('vitals.ui.lastRoute', JSON.stringify({ state: '/settings', version: 1 }));
    const router = renderAt('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'), { timeout: 5000 });
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    expect(within(tabBar()).getByRole('link', { name: 'today' })).toHaveAttribute('aria-current', 'page');
  });

  it('Settings is never remembered as the last screen, and its Back with no history lands on Today (phone)', async () => {
    localStorage.removeItem('vitals.ui.lastRoute');
    const router = renderAt('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' }, { timeout: 8000 });
    expect(localStorage.getItem('vitals.ui.lastRoute')).toBeNull();
    fireEvent.click(within(header()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
  });

  it('the Coach works in Planning mode without a plan', async () => {
    const router = renderAt('/coach');
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 });
    expect(router.state.location.pathname).toBe('/coach');
  });
});
