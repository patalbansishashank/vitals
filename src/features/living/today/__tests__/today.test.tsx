import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import TodayPage from '../TodayPage';
import { todayRows, goalDateLine, openItems, todayState, shortName } from '../model';
import { dialCentre, dialSummary } from '../components/TodayDial';
import { renderLiving } from '../../testing';
import { fixturePlan } from '../../data/fixtures';
import { CONTRACT_DATE, todayViewFixture } from './todayView.fixture';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const routes = { route: 'today' } as const;

function renderContract(over: Parameters<typeof todayViewFixture>[0] = {}) {
  const view = todayViewFixture(over);
  return renderLiving(<TodayPage />, {
    path: `/today/${CONTRACT_DATE}`,
    route: 'today/:date',
    source: (stub) => ({ ...stub.source, today: (d) => (d === CONTRACT_DATE ? view : stub.source.today(d)) }),
  });
}

describe('Today view model (from the Today contract)', () => {
  const view = todayViewFixture();

  it('orders the rows by time, untimed rows last, and joins the prescription into plain targets', () => {
    const rows = todayRows(view);
    expect(rows.map((r) => r.id)).toEqual(['weigh', 'meal:lunch', 'meal:snack', expect.stringMatching(/^session:/), 'meal:dinner', 'supplement:creatine', 'steps', 'sleep']);
    expect(rows.filter((r) => r.untimed).map((r) => r.glyph)).toEqual(['supplement', 'steps', 'sleep']);
    const lunch = rows[1]!;
    expect(lunch.label).toBe('lunch');
    expect(lunch.target).toMatch(/^\d[\d ]* kcal · \d+ g protein$/);
    expect(lunch.status).toBe('done');
    expect(lunch.logged).toMatchObject({ value: 640, sd: 100, unit: 'kcal', approx: true, source: 'Coach · text' });
    const lift = rows[3]!;
    expect(lift.label).toBe('lift · 45 min');
    expect(lift.status).toBe('partial');
    expect(lift.target.length).toBeGreaterThan(0);
    expect(rows.find((r) => r.id === 'steps')).toMatchObject({ status: 'partial', logged: { value: 6120 } });
    expect(rows.find((r) => r.id === 'sleep')?.status).toBe('empty');
  });

  it('merges a plan supplement the person already takes into one row with both doses (Q6-11)', () => {
    const own = [{ supplementId: 'creatine_monohydrate', state: 'taking' as const, dose: 7, unit: 'g', timesOfDay: ['morning' as const] }];
    const rows = todayRows(view, { supplements: own }).filter((r) => r.glyph === 'supplement');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'supplement:creatine', itemId: 'supplement:creatine', label: 'creatine monohydrate' });
    expect(rows[0]!.target).toMatch(/^you take 7 g · morning · plan suggests \d+(\.\d+)? g$/);
    // a row the person only has at home is not merged
    expect(todayRows(view, { supplements: [{ ...own[0]!, state: 'onHand' }] }).find((r) => r.glyph === 'supplement')?.label).toBe('creatine');
  });

  it('shows a ticked meal without a meal entry or a day mark as skipped (unknown is never "failed")', () => {
    const v = todayViewFixture();
    v.checklist = v.checklist.map((c) => (c.id === 'meal:snack' ? { ...c, done: true } : c));
    expect(todayRows(v).find((r) => r.id === 'meal:snack')?.status).toBe('skipped');
    const marked = todayViewFixture();
    marked.checklist = marked.checklist.map((c) => (c.id === 'meal:snack' || c.id === 'mark:all' ? { ...c, done: true } : c));
    expect(todayRows(marked).find((r) => r.id === 'meal:snack')?.status).toBe('done');
  });

  it('reads the goal-date line and the open items from the contract, never computing them', () => {
    expect(goalDateLine(view)).toEqual({ range: '21–30 Dec', shift: { days: 9, sd: 6 } });
    expect(goalDateLine(todayViewFixture({ drift: [{ metric: 'scaleWeight', state: 'onTrack', goalDate: { range: ['2026-12-21', '2026-12-30'], shiftDays: 2, shiftSd: 6 }, text: '' }] })).shift).toBeNull();
    const open = openItems(view, (id) => id);
    expect(open[0]).toMatch(/^energy is still open — it carries \d+ % of today$/);
  });

  it('derives the screen state from the plan and the date', () => {
    const p = fixturePlan('2026-10-01');
    expect(todayState(null, p, '2026-10-01', '2026-10-01')).toBe('active');
    expect(todayState(null, p, '2026-09-30', '2026-10-01')).toBe('past');
    expect(todayState(null, p, '2026-10-02', '2026-10-01')).toBe('future');
    expect(todayState(null, { ...p, status: 'scheduled', startDate: '2026-10-02' }, '2026-10-01', '2026-10-01')).toBe('scheduled');
    expect(todayState(null, { ...p, status: 'paused', pauses: [{ from: '2026-09-29', to: null }] }, '2026-10-01', '2026-10-01')).toBe('paused');
    expect(todayState(null, { ...p, status: 'paused', pauses: [{ from: '2026-09-29', to: null, reason: 'safety' }] }, '2026-10-01', '2026-10-01')).toBe('safetyPause');
    expect(todayState(null, p, p.plannedEndDate, p.plannedEndDate)).toBe('complete');
  });

  it('short names stay honest', () => {
    expect(shortName('Mudgar swing, single heavy club two-handed')).toBe('mudgar swing');
    expect(shortName('Dand (Hindu push-up)')).toBe('dand');
  });

  it('the dial centre and summary read the window and the fast', () => {
    const rx = view.prescription!;
    expect(dialCentre(rx, 13)).toEqual({ primary: 'eat until 20:00', secondary: '7 h left' });
    expect(dialCentre(rx, 9).secondary).toBe('window opens 12:00');
    expect(dialCentre(rx, 13, { state: 'running', sinceH: 14, remainingH: 2 })).toEqual({ primary: 'fast · 14 h', secondary: '2 h to go' });
    expect(dialSummary(rx)).toMatch(/^Eat 12:00–20:00, 3 meals: 12:30 \(\d[\d ]* kcal\)/);
    expect(dialSummary(rx)).toMatch(/Lift 17:30–18:15\./);
  });
});

describe('<TodayPage> rendering the contract', () => {
  it('renders the plan, the checklist, so far and the forecast from the TodayView', async () => {
    renderContract();
    expect(await screen.findByRole('heading', { level: 1, name: 'Wed 30 Sep' })).toBeInTheDocument();
    const plan = screen.getByRole('region', { name: 'Today’s plan' });
    expect(within(plan).getByText('this day’s plan as it was')).toBeInTheDocument();
    expect(within(plan).getByRole('button', { name: 'Mark snack as planned' })).toBeInTheDocument();
    expect(within(plan).getByRole('button', { name: 'Mark dinner as planned' })).toBeInTheDocument();
    expect(within(plan).getByRole('button', { name: /^lunch: as planned/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(plan).getByRole('button', { name: /^lift · 45 min: partly/ })).toBeInTheDocument();
    expect(within(plan).getByText('untimed')).toBeInTheDocument();
    const soFar = screen.getByRole('region', { name: 'So far' });
    expect(within(soFar).getByRole('img', { name: /Adherence so far 62 of 100/ })).toBeInTheDocument();
    expect(within(soFar).getByText(/based on \d of \d+ items/)).toBeInTheDocument();
    expect(within(soFar).getByText('6 of the last 7 days logged')).toBeInTheDocument();
    expect(soFar.textContent).not.toMatch(/streak/i);
    const forecast = screen.getByRole('region', { name: 'Against the forecast' });
    expect(within(forecast).getByText('trend 83.1 kg')).toBeInTheDocument();
    expect(forecast).toHaveTextContent('expected today 82.8–83.6');
    expect(forecast).toHaveTextContent('on track');
    expect(forecast).toHaveTextContent('goal date likely 21–30 Dec · moved by +9 days (±6)');
  });

  it('quiet mode turns numbers into words with a per-view "show numbers" key', async () => {
    renderContract({ quietMode: true, adherence: { ...todayViewFixture().adherence, a7: null, a28: null } });
    const soFar = await screen.findByRole('region', { name: 'So far' });
    expect(within(soFar).queryByText('62')).toBeNull();
    expect(within(soFar).getByText('mostly')).toBeInTheDocument();
    expect(soFar).toHaveTextContent(/eaten\s*about a third of today’s food/);
    expect(screen.queryByText('trend 83.1 kg')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'show numbers' })[0]!);
    expect(within(screen.getByRole('region', { name: 'So far' })).getByText('62')).toBeInTheDocument();
  });
});

describe('<TodayPage> logging through the actions (stand-in)', () => {
  it('a tick logs "as planned"; a second tap within 5 s undoes it', async () => {
    const h = renderLiving(<TodayPage />, { path: '/today', ...routes });
    const plan = await screen.findByRole('region', { name: 'Today’s plan' });
    const tick = within(plan).getByRole('button', { name: 'Mark lunch as planned' });
    await act(async () => fireEvent.click(tick));
    await waitFor(() => expect(within(plan).getByRole('button', { name: /^lunch: as planned/ })).toHaveAttribute('aria-pressed', 'true'));
    expect(h.stub.inspect().entries.filter((e) => e.kind === 'meal')).toHaveLength(1);
    await act(async () => fireEvent.click(within(plan).getByRole('button', { name: /^lunch: as planned/ })));
    await waitFor(() => expect(within(plan).getByRole('button', { name: 'Mark lunch as planned' })).toBeInTheDocument());
    expect(h.stub.inspect().entries.filter((e) => e.kind === 'meal')).toHaveLength(0);
  });

  it('"Mark day as planned" ticks every row and scores the day', async () => {
    const h = renderLiving(<TodayPage />, { path: '/today', ...routes });
    await screen.findByRole('region', { name: 'Today’s plan' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mark day as planned' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Mark (lunch|snack|dinner) as planned$/ })).toBeNull());
    expect(h.stub.inspect().dayMarks['2026-10-01']).toBe('asPlanned');
    expect(within(screen.getByRole('region', { name: 'So far' })).getByRole('img', { name: /Adherence so far 100 of 100/ })).toBeInTheDocument();
  });

  it('a weigh-in typed on the row is logged', async () => {
    const h = renderLiving(<TodayPage />, { path: '/today', ...routes });
    const field = await screen.findByRole('textbox', { name: 'weight' }).catch(() => screen.findByLabelText('weight'));
    fireEvent.change(field, { target: { value: '83.4' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(h.stub.inspect().measurements.map((m) => m.value)).toEqual([83.4]));
  });

  it('future dates are read-only previews; past dates are editable', async () => {
    renderLiving(<TodayPage />, { path: '/today/2026-10-03', route: 'today/:date' });
    const plan = await screen.findByRole('region', { name: 'Today’s plan' });
    expect(within(plan).getByText('Preview · the plan may still change')).toBeInTheDocument();
    for (const b of within(plan).getAllByRole('button', { name: /^Mark .* as planned$/ })) expect(b).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Mark day as planned' })).toBeNull();
  });

  it('the date strip moves between days and marks today', async () => {
    const h = renderLiving(<TodayPage />, { path: '/today', ...routes, routes: [{ path: 'today/:date', element: <TodayPage /> }] });
    const strip = await screen.findByRole('radiogroup', { name: 'Day' });
    const todayKey = within(strip).getByRole('radio', { name: /Thu 1 Oct, today/ });
    expect(todayKey).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(strip).getByRole('radio', { name: /^Tue 29 Sep/ }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/today/2026-09-29'));
  });

  it('a paused plan shows the paused notice with Resume', async () => {
    renderLiving(<TodayPage />, { path: '/today', ...routes, plan: fixturePlan('2026-10-01', { status: 'paused' }) });
    expect(await screen.findByText('Paused since Tue 29 Sep.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Resume' }).length).toBeGreaterThan(0);
  });

  it('a scheduled plan shows the countdown and a read-only preview of day 1', async () => {
    const p = { ...fixturePlan('2026-10-01', { dayIndex: -1 }), status: 'scheduled' as const };
    renderLiving(<TodayPage />, { path: '/today', ...routes, plan: p });
    expect(await screen.findByRole('heading', { name: /Spring cut starts tomorrow \(Fri 2 Oct\)\./ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard plan' })).toBeInTheDocument();
    expect(screen.getByText('A preview of day 1')).toBeInTheDocument();
  });
});
