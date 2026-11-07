/**
 * Today on the documents and the command bus (as in the app), in the afternoon and at 01:30 — after midnight, before the
 * 04:00 rollover, when the app's day is still yesterday:
 * - LIV-14: a stop ticked "as planned" reads its value against the plan ("8 000 of 8 000 steps"), never a provenance
 *   chip; a night the plan sets no hours for is never invented by the tick.
 * - LIV-18: the weigh-in stays on its row after logging, also before the plan has a weight trend.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { settleCommits } from '@/commands';
import { LivingClockContext, clockToday, fixedClock } from '../../clock';
import { resetActivePlan } from '../../activePlan';
import { installDocumentPlanSource } from '../../mode';
import { LivingActionsProvider } from '../../data/actions';
import { LivingDataProvider } from '../../data/source';
import { createCommandLivingActions } from '../../data/commands';
import { createDocumentLivingSource } from '../../data/documents';
import { seedPlanDocs } from '../../__tests__/seedPlanDocs';
import { todayRows } from '../model';
import { todayViewFixture } from './todayView.fixture';
import TodayPage from '../TodayPage';

window.scrollTo = (() => undefined) as typeof window.scrollTo;
async function revealPlan() {
  const plan = await screen.findByRole('region', { name: 'Today' });
  const whole = within(plan).queryByRole('button', { name: /^Whole day/ });
  if (whole) fireEvent.click(whole);
  for (const button of plan.querySelectorAll<HTMLButtonElement>('.lv-group__head[aria-expanded="false"]'))
    fireEvent.click(button);
  return plan;
}

installDocumentPlanSource();

const WALLS = [
  { label: 'at 13:00', wall: '2026-10-02T13:00:00', appToday: '2026-10-02' },
  { label: 'at 01:30 (before the 04:00 rollover)', wall: '2026-10-02T01:30:00', appToday: '2026-10-01' },
] as const;

describe.each(WALLS)('Today logging on the documents $label', ({ wall, appToday }) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(wall));
    freshState({ cleared: true });
    resetActivePlan();
  });
  afterEach(() => vi.useRealTimers());

  async function renderToday() {
    const clock = fixedClock(wall);
    expect(clockToday(clock)).toBe(appToday);
    // started today: no logs before, and no weight trend yet
    await seedPlanDocs({ startDate: appToday });
    const source = createDocumentLivingSource({ clock });
    const actions = createCommandLivingActions(source);
    const router = createMemoryRouter(
      [
        {
          path: '/today',
          element: (
            <LivingClockContext.Provider value={clock}>
              <LivingDataProvider value={source}>
                <LivingActionsProvider value={actions}>
                  <TodayPage />
                </LivingActionsProvider>
              </LivingDataProvider>
            </LivingClockContext.Provider>
          ),
        },
      ],
      { initialEntries: ['/today'] },
    );
    render(<RouterProvider router={router} />);
    return { source, actions };
  }

  it('a weigh-in stays on its row after logging', async () => {
    const { source } = await renderToday();
    const plan = await revealPlan();
    expect(await screen.findByRole('region', { name: 'Eaten so far' })).toBeInTheDocument();
    expect(source.today(appToday)?.trendWeight).toBeNull();
    fireEvent.click(
      within(plan.querySelector('[data-row="weigh"]') as HTMLElement).getByRole('button', {
        name: 'Log weight',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Weight' });
    const field = within(dialog).getByLabelText('Weight');
    fireEvent.change(field, { target: { value: '89.2' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await settleCommits();
    });
    await waitFor(() =>
      expect((document.querySelector('[data-row="weigh"]') as HTMLElement).textContent).toContain('89.2 kg'),
    );
    // logged: the value itself opens the weight sheet to change it
    expect(screen.getByRole('button', { name: 'Change weight' })).toBeInTheDocument();
  }, 20_000);

  it('steps ticked as planned read against the plan, and the tick then offers Undo', async () => {
    await renderToday();
    const plan = await revealPlan();
    await act(async () => {
      fireEvent.click(within(plan).getByRole('button', { name: 'Mark steps as planned' }));
      await settleCommits();
    });
    await waitFor(() => expect(within(plan).getByRole('button', { name: 'Undo steps' })).toBeInTheDocument());
    const row = plan.querySelector('[data-row="steps"]') as HTMLElement;
    expect(row.textContent).toContain('8,000 of 8,000 steps');
    expect(row.textContent).not.toMatch(/you ·|typed|measured/);
  }, 20_000);

  it('Partly on a blank breakfast is breakfast’s alone: it reads partly after a fresh read, dinner stays open, no food appears', async () => {
    const { source } = await renderToday();
    const plan = await revealPlan();
    fireEvent.click(within(plan).getByRole('button', { name: 'Details for breakfast' }));
    const sheet = await screen.findByRole('dialog', { name: 'Breakfast' });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('radio', { name: 'Partly' }));
      await settleCommits();
    });
    const row = (id: string) => plan.querySelector(`[data-row="${id}"]`) as HTMLElement;
    await waitFor(() => expect(row('meal:meal1')).toHaveAttribute('data-state', 'partial'));
    expect(row('meal:meal1').textContent).toContain('partly');
    expect(row('meal:meal3')).toHaveAttribute('data-state', 'empty');
    // a fresh reader over the same documents (a reload) reads the same answer, and no food was logged for it
    const again = createDocumentLivingSource({ clock: fixedClock(wall) }).today(appToday)!;
    expect(again.marks?.meals).toEqual({ meal1: 'partly' });
    expect(todayRows(again).find((r) => r.id === 'meal:meal1')?.status).toBe('partial');
    expect(todayRows(again).find((r) => r.id === 'meal:meal3')?.status).toBe('empty');
    expect(again.logged.entries.filter((e) => e.kind === 'meal')).toEqual([]);
    expect(source.today(appToday)?.logged.totals.energyKcal.value).toBe(0);
  }, 20_000);

  it('sleep with no hours in the plan is never ticked as an invented night', async () => {
    await renderToday();
    const plan = await revealPlan();
    expect(within(plan).queryByRole('button', { name: 'Mark sleep as planned' })).toBeNull();
    fireEvent.click(within(plan).getByRole('button', { name: 'Change sleep' }));
    expect(await screen.findByRole('dialog', { name: 'Sleep' })).toBeInTheDocument();
  }, 20_000);
});

describe('logged values on the steps and sleep rows (model)', () => {
  const at = (over: Partial<ReturnType<typeof todayViewFixture>['logged']>) => {
    const v = todayViewFixture();
    v.logged = { ...v.logged, ...over };
    return todayRows(v);
  };

  it('steps read against the plan; a night reads its hours; no source travels with them', () => {
    const v = todayViewFixture();
    expect(at({ steps: 4000 }).find((r) => r.id === 'steps')?.logged).toEqual({
      value: 4000,
      unit: 'steps',
      planned: v.prescription!.steps,
    });
    expect(at({ sleepHours: 6.9 }).find((r) => r.id === 'sleep')?.logged).toEqual({
      value: 6.9,
      unit: 'h',
      decimals: 1,
    });
  });

  it('the weigh-in row carries the day’s weigh-in when there is no trend yet', () => {
    const v = todayViewFixture();
    v.trendWeight = null;
    expect(todayRows(v).find((r) => r.id === 'weigh')?.logged).toBeUndefined();
    expect(todayRows(v, { weighInKg: 89.2 }).find((r) => r.id === 'weigh')?.logged).toMatchObject({
      value: 89.2,
      unit: 'kg',
    });
  });
});
