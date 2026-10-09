/**
 * Today on the documents and the command bus (as in the app), in the afternoon and at 01:30 — after midnight, before the
 * 04:00 rollover, when the app's day is still yesterday:
 * - LIV-14: sleep ticked "as planned" reads "you · as planned" (not "measured"); a typed night reads "you · typed".
 * - LIV-18: the weigh-in stays in the field after logging, also before the plan has a weight trend, and
 *   "N of the last 7 days logged" counts the day once something is logged on it.
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

  it('a weigh-in stays in the field and the day counts as logged', async () => {
    const { source } = await renderToday();
    const soFar = await screen.findByRole('region', { name: 'So far' });
    expect(within(soFar).getByText(/^0 of the last 7 days logged/)).toBeInTheDocument();
    expect(source.today(appToday)?.trendWeight).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Log weight' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log weight' });
    const field = within(dialog).getByLabelText(/^weight/);
    fireEvent.change(field, { target: { value: '89.2' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await settleCommits();
    });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'So far' })).getByText(/^1 of the last 7 days logged/)).toBeInTheDocument());
    expect((document.querySelector('[data-row="weigh"]') as HTMLElement).textContent).toContain('89.2 kg');
  }, 20_000);

  it('sleep ticked as planned reads "you · as planned"', async () => {
    await renderToday();
    const plan = await screen.findByRole('region', { name: 'Today’s plan' });
    await act(async () => {
      fireEvent.click(within(plan).getByRole('button', { name: 'Mark sleep as planned' }));
      await settleCommits();
    });
    // a logged stop collapses: what was logged and the row's own Undo in place of the main key
    await waitFor(() => expect(within(plan).getByRole('button', { name: 'Undo sleep' })).toBeInTheDocument());
    const row = plan.querySelector('[data-row="sleep"]') as HTMLElement;
    expect(row.textContent).toContain('you · as planned');
    expect(row.textContent).not.toContain('measured');
  }, 20_000);
});

describe('logged sources on the steps and sleep rows (model)', () => {
  const at = (over: Partial<ReturnType<typeof todayViewFixture>['logged']>) => {
    const v = todayViewFixture();
    v.biometrics = null;
    v.logged = { ...v.logged, ...over };
    return todayRows(v);
  };
  const entry = (kind: 'sleep' | 'steps', source: 'user' | 'ai' | 'device') => ({ id: `e-${kind}`, kind, label: kind, source, aiEstimated: source === 'ai' });

  it('the plan’s own number is "as planned", any other number was typed, a device night is measured', () => {
    const v = todayViewFixture();
    const sl = v.prescription!.sleep!;
    const planned = (sl.wakeH - sl.bedH + 24) % 24;
    expect(at({ sleepHours: planned, entries: [entry('sleep', 'user')] }).find((r) => r.id === 'sleep')?.logged?.source).toBe('you · as planned');
    expect(at({ sleepHours: planned - 1.5, entries: [entry('sleep', 'user')] }).find((r) => r.id === 'sleep')?.logged?.source).toBe('you · typed');
    expect(at({ sleepHours: planned - 1, entries: [entry('sleep', 'ai')] }).find((r) => r.id === 'sleep')?.logged?.source).toBe('Coach · text');
    expect(at({ steps: v.prescription!.steps!, entries: [entry('steps', 'user')] }).find((r) => r.id === 'steps')?.logged?.source).toBe('you · as planned');
    expect(at({ steps: 4000, entries: [entry('steps', 'user')] }).find((r) => r.id === 'steps')?.logged?.source).toBe('you · typed');
    const device = todayViewFixture();
    device.biometrics = { lastNight: { hours: 6.9, source: 'Fitbit' }, flags: [] };
    device.logged = { ...device.logged, sleepHours: 6.9 };
    expect(todayRows(device).find((r) => r.id === 'sleep')?.logged?.source).toBe('device · measured');
  });

  it('the weigh-in row carries the day’s weigh-in when there is no trend yet', () => {
    const v = todayViewFixture();
    v.trendWeight = null;
    expect(todayRows(v).find((r) => r.id === 'weigh')?.logged).toBeUndefined();
    expect(todayRows(v, { weighInKg: 89.2 }).find((r) => r.id === 'weigh')?.logged).toMatchObject({ value: 89.2, unit: 'kg' });
  });
});
