import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import TodayPage from '../TodayPage';
import { lastTimedAt, nextUp, todayRows, goalDateLine, openItems, todayState, shortName } from '../model';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY, fixturePlan } from '../../data/fixtures';
import { CONTRACT_DATE, todayViewFixture } from './todayView.fixture';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const routes = { route: 'today' } as const;
async function revealPlan() {
  const plan = await screen.findByRole('region', { name: /^(Today|Plan)$/ });
  const whole = within(plan).queryByRole('button', { name: /^Whole day/ });
  if (whole) fireEvent.click(whole);
  for (const button of plan.querySelectorAll<HTMLButtonElement>('.lv-group__head[aria-expanded="false"]'))
    fireEvent.click(button);
  return plan;
}

/** Group spaces vary (thin, narrow no-break): compare text with plain spaces. */
const flat = (el: Element | null) => (el?.textContent ?? '').replace(/[\u2009\u202f\u00a0]/g, ' ');

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
    expect(rows.map((r) => r.id)).toEqual([
      'weigh',
      'meal:lunch',
      'meal:snack',
      expect.stringMatching(/^session:/),
      'meal:dinner',
      'supplement:creatine',
      'steps',
      'sleep',
    ]);
    expect(rows.filter((r) => r.untimed).map((r) => r.glyph)).toEqual(['supplement', 'steps', 'sleep']);
    const lunch = rows[1]!;
    expect(lunch.label).toBe('lunch');
    expect(lunch.target).toMatch(/^\d[\d ]* kcal · \d+ g protein$/);
    // 640 kcal logged is short of the plan's lunch beyond the tolerance: the row reads Partly, as the meal sheet does
    // (components/mealMark), never a full tick beside "640 of … kcal"
    expect(lunch.status).toBe('partial');
    // what was logged, against the plan: no source, no range
    expect(lunch.logged).toEqual({
      value: 640,
      unit: 'kcal',
      planned: view.prescription!.meals[0]!.energyKcal,
    });
    const lift = rows[3]!;
    expect(lift.label).toBe('lift · 45 min');
    expect(lift.status).toBe('partial');
    expect(lift.target.length).toBeGreaterThan(0);
    const steps = rows.find((r) => r.id === 'steps')!;
    expect(steps).toMatchObject({
      status: 'partial',
      logged: { value: 6120, unit: 'steps', planned: view.prescription!.steps },
    });
    expect(steps.target).toMatch(/^\d[\d,]* steps$/);
    expect(rows.find((r) => r.id === 'sleep')?.status).toBe('empty');
    // the weigh-in's time is in the time column: no filler under it
    expect(rows[0]!.target).toBe('');
  });

  it('merges a plan supplement the person already takes into one row with both doses (Q6-11)', () => {
    const own = [
      {
        supplementId: 'creatine_monohydrate',
        state: 'taking' as const,
        dose: 7,
        unit: 'g',
        timesOfDay: ['morning' as const],
      },
    ];
    const rows = todayRows(view, { supplements: own }).filter((r) => r.glyph === 'supplement');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'supplement:creatine',
      itemId: 'supplement:creatine',
      label: 'creatine monohydrate',
    });
    expect(rows[0]!.target).toMatch(/^you take 7 g · morning · plan suggests \d+(\.\d+)? g$/);
    // a row the person only has at home is not merged
    expect(
      todayRows(view, { supplements: [{ ...own[0]!, state: 'onHand' }] }).find(
        (r) => r.glyph === 'supplement',
      )?.label,
    ).toBe('creatine');
  });

  it('a meal with no food reads its own answer, never another meal’s; the day’s mark answers the rest', () => {
    const status = (v: ReturnType<typeof todayViewFixture>, id: string) =>
      todayRows(v).find((r) => r.id === id)?.status;
    const answered = (
      meals: Record<string, 'asPlanned' | 'partly' | 'not'>,
      day: { food?: 'asPlanned' | 'partly' | 'not'; all?: 'asPlanned' } = {},
    ) => {
      const v = todayViewFixture();
      v.marks = { ...day, meals };
      v.checklist = v.checklist.map((c) =>
        c.kind === 'meal' && (meals[c.id.slice(5)] || day.food || day.all) ? { ...c, done: true } : c,
      );
      return v;
    };
    // snack partly: partial (not skipped), dinner untouched
    expect(status(answered({ snack: 'partly' }), 'meal:snack')).toBe('partial');
    expect(status(answered({ snack: 'partly' }), 'meal:dinner')).toBe('empty');
    expect(status(answered({ snack: 'not' }), 'meal:snack')).toBe('skipped');
    expect(status(answered({ snack: 'not' }), 'meal:dinner')).toBe('empty');
    // a day-wide mark answers every meal without food or its own answer; the meal's own answer wins over it
    expect(status(answered({}, { all: 'asPlanned' }), 'meal:dinner')).toBe('done');
    expect(status(answered({ snack: 'not' }, { food: 'partly' }), 'meal:snack')).toBe('skipped');
    expect(status(answered({ snack: 'not' }, { food: 'partly' }), 'meal:dinner')).toBe('partial');
    // food logged for the meal is read by its amount, whatever was said before
    expect(status(answered({ lunch: 'not' }), 'meal:lunch')).toBe('partial');
    // ticked with nothing logged or said for it (another meal's food near its time): still open, never "skipped"
    const ticked = todayViewFixture();
    ticked.checklist = ticked.checklist.map((c) => (c.id === 'meal:snack' ? { ...c, done: true } : c));
    expect(status(ticked, 'meal:snack')).toBe('empty');
  });

  it('reads the goal-date line and the open items from the contract, never computing them', () => {
    expect(goalDateLine(view)).toEqual({ range: '21–30 Dec', shift: { days: 9, sd: 6 } });
    expect(
      goalDateLine(
        todayViewFixture({
          drift: [
            {
              metric: 'scaleWeight',
              state: 'onTrack',
              goalDate: { range: ['2026-12-21', '2026-12-30'], shiftDays: 2, shiftSd: 6 },
              text: '',
            },
          ],
        }),
      ).shift,
    ).toBeNull();
    const open = openItems(view, (id) => id);
    expect(open[0]).toMatch(/^energy is still open — it carries \d+ % of today$/);
  });

  it('next up: the open timed row from now on, the weigh-in only in the morning, never an untimed row', () => {
    const rows = todayRows(todayViewFixture());
    // 13:00: snack (16:30) is next; the morning weigh-in is logged, lunch is done
    expect(nextUp(rows, 13)?.id).toBe('meal:snack');
    // 21:00: nothing timed ahead, the earliest still open (snack) is next
    expect(nextUp(rows, 21)?.id).toBe('meal:snack');
    // an open weigh-in leads the morning, and stops being next at 11:00
    const v = todayViewFixture({ trendWeight: null });
    v.checklist = v.checklist.map((c) => (c.id === 'weigh' ? { ...c, done: false } : c));
    expect(nextUp(todayRows(v), 8)?.id).toBe('weigh');
    expect(nextUp(todayRows(v), 11.5)?.id).toBe('meal:snack');
    // everything timed answered: nothing is next (steps and sleep are untimed)
    const all = todayRows(view).map((r) => (r.untimed ? r : { ...r, status: 'done' as const }));
    expect(nextUp(all, 13)).toBeNull();
    expect(lastTimedAt(rows)).toBe(19.5);
  });

  it('derives the screen state from the plan and the date', () => {
    const p = fixturePlan('2026-10-01');
    expect(todayState(null, p, '2026-10-01', '2026-10-01')).toBe('active');
    expect(todayState(null, p, '2026-09-30', '2026-10-01')).toBe('past');
    expect(todayState(null, p, '2026-10-02', '2026-10-01')).toBe('future');
    expect(
      todayState(null, { ...p, status: 'scheduled', startDate: '2026-10-02' }, '2026-10-01', '2026-10-01'),
    ).toBe('scheduled');
    expect(
      todayState(
        null,
        { ...p, status: 'paused', pauses: [{ from: '2026-09-29', to: null }] },
        '2026-10-01',
        '2026-10-01',
      ),
    ).toBe('paused');
    expect(
      todayState(
        null,
        { ...p, status: 'paused', pauses: [{ from: '2026-09-29', to: null, reason: 'safety' }] },
        '2026-10-01',
        '2026-10-01',
      ),
    ).toBe('safetyPause');
    expect(todayState(null, p, p.plannedEndDate, p.plannedEndDate)).toBe('complete');
  });

  it('short names stay honest', () => {
    expect(shortName('Mudgar swing, single heavy club two-handed')).toBe('mudgar swing');
    expect(shortName('Dand (Hindu push-up)')).toBe('dand');
  });
});

describe('<TodayPage> rendering the contract (a past day)', () => {
  it('one header: another day is titled by its weekday, with its date and plan day, a way back to Today and the one ⋯', async () => {
    renderContract();
    expect(await screen.findByRole('heading', { level: 1, name: 'Wednesday' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('30 September · day 14 of 84')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'More' })).toHaveLength(1);
    // no plan name or rung, no notices zone, no "Next up" on a day that is over
    expect(screen.queryByText(/Spring cut/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Next up' })).toBeNull();
  });

  it('renders the plan as a rail of ticks, with the logged value against the plan and no provenance', async () => {
    renderContract();
    const plan = await revealPlan();
    // The eating window belongs to the hero foot; measurements belong to their cards.
    expect(within(plan).getByText(/^Eat \d\d:\d\d–\d\d:\d\d$/)).toBeInTheDocument();
    expect(plan.querySelector('.lm-cardhead')).toBeInTheDocument();
    expect(within(plan).getByRole('button', { name: 'Mark snack as planned' })).toBeInTheDocument();
    expect(within(plan).getByRole('button', { name: 'Mark dinner as planned' })).toBeInTheDocument();
    const lunch = plan.querySelector('[data-row="meal:lunch"]') as HTMLElement;
    // logged short of the plan: the row's mark is Partly, matching its meal sheet
    expect(lunch.dataset.state).toBe('partial');
    expect(flat(lunch)).toMatch(/640 of \d[\d ]* kcal/);
    expect(lunch.textContent).not.toMatch(/Coach|≈|\(\d/);
    expect((plan.querySelector('[data-row^="session:"]') as HTMLElement).textContent).toContain('partly');
    expect(within(plan).queryByText('any time')).toBeNull();
    // one control per stop: the tick, and the text opens the sheet; no per-row ⋯
    const dinner = plan.querySelector('[data-row="meal:dinner"]') as HTMLElement;
    expect(within(dinner).getByRole('button', { name: 'Details for dinner' })).toBeInTheDocument();
    expect(within(dinner).queryByRole('button', { name: /^More for/ })).toBeNull();
    expect(dinner.dataset.state).toBe('empty');
    // a past day can be marked at once
    expect(within(plan).getByRole('button', { name: 'Mark all as planned' })).toBeInTheDocument();
  });

  it('renders the day total and the weight from the TodayView', async () => {
    renderContract();
    const total = await screen.findByRole('region', { name: 'Day total' });
    fireEvent.click(within(total).getByRole('button', { name: 'Plan score · 62' }));
    expect(within(total).getByRole('img', { name: /Adherence so far 62 of 100/ })).toBeInTheDocument();
    // Eaten is a dotted track with a named target; the plan score expands separately.
    expect(within(total).getByRole('meter', { name: 'Eaten' })).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/640.*kcal/),
    );
    // The hero keeps the amount and unit together, with the target in mono facts.
    expect(flat(total)).toMatch(/640.*kcal.*of \d.*kcal/);
    expect(total.textContent).not.toMatch(/last 7 days|≈|streak/i);
    const weight = screen.getByRole('region', { name: 'Weight' });
    expect(weight).toHaveTextContent('83.1');
    expect(weight).toHaveTextContent('on track');
    expect(weight).toHaveTextContent('Goal 21–30 Dec');
    fireEvent.click(within(weight).getByRole('button', { name: 'About Weight' }));
    expect(await screen.findByRole('dialog', { name: 'Weight' })).toHaveTextContent(
      /Moved 9.*days later \(±6\)/,
    );
    expect(weight.textContent).not.toMatch(/expected today/);
  });

  it('quiet mode turns numbers into words; "Show numbers" is in the header ⋯', async () => {
    const user = userEvent.setup();
    renderContract({ quietMode: true, adherence: { ...todayViewFixture().adherence, a7: null, a28: null } });
    const soFar = await screen.findByRole('region', { name: 'Day total' });
    expect(within(soFar).queryByText('62')).toBeNull();
    expect(within(soFar).getByText('mostly')).toBeInTheDocument();
    expect(within(soFar).getByRole('button', { name: 'Plan score' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(
      within(soFar).getByRole('img', { name: 'Eaten about a third of today’s food' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('83.1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Show numbers' }));
    expect(
      within(screen.getByRole('region', { name: 'Day total' })).getByRole('button', {
        name: 'Plan score · 62',
      }),
    ).toBeInTheDocument();
  });
});

describe('<TodayPage> logging through the actions (stand-in)', () => {
  it('the tick logs the meal in one tap, and a second tap undoes it', async () => {
    const h = renderLiving(
      <>
        <TodayPage />
        <Toaster />
      </>,
      { path: '/today', ...routes },
    );
    const plan = await revealPlan();
    await act(async () =>
      fireEvent.click(within(plan).getByRole('button', { name: 'Mark lunch as planned' })),
    );
    await waitFor(() => expect(within(plan).getByRole('button', { name: 'Undo lunch' })).toBeInTheDocument());
    expect((plan.querySelector('[data-row="meal:lunch"]') as HTMLElement).dataset.state).toBe('done');
    expect(h.stub.inspect().entries.filter((e) => e.kind === 'meal')).toHaveLength(1);
    expect((await screen.findAllByText('Lunch marked as planned')).length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(within(plan).getByRole('button', { name: 'Undo lunch' })));
    await waitFor(() =>
      expect(within(plan).getByRole('button', { name: 'Mark lunch as planned' })).toBeInTheDocument(),
    );
    expect(h.stub.inspect().entries.filter((e) => e.kind === 'meal')).toHaveLength(0);
  });

  it('"Mark all as planned" waits until the day is over, then ticks every row and scores the day', async () => {
    renderLiving(<TodayPage />, { path: '/today', ...routes });
    await revealPlan();
    // 13:00: dinner and the session are still ahead
    expect(screen.queryByRole('button', { name: 'Mark all as planned' })).toBeNull();
  });

  it('"Mark all as planned" after the last timed item ticks every row', async () => {
    const h = renderLiving(<TodayPage />, { path: '/today', ...routes, now: `${FIXTURE_TODAY}T22:30:00` });
    await revealPlan();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mark all as planned' })));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Mark (lunch|snack|dinner) as planned$/ })).toBeNull(),
    );
    expect(h.stub.inspect().dayMarks[FIXTURE_TODAY]).toBe('asPlanned');
    const eaten = screen.getByRole('region', { name: 'Eaten so far' });
    fireEvent.click(within(eaten).getByRole('button', { name: 'Plan score · 100' }));
    expect(within(eaten).getByRole('img', { name: /Adherence so far 100 of 100/ })).toBeInTheDocument();
  });

  it('Next up shows the next thing on the real today', async () => {
    renderLiving(<TodayPage />, { path: '/today', ...routes });
    const next = await screen.findByRole('region', { name: 'Today' });
    // the time is the card's one focal value (the headline role), what to do follows it
    expect(next.querySelector('.lv-day-hero__open .lm-hero')?.textContent).toMatch(/^\d\d:\d\d$/);
    expect(next.querySelector('.lv-day-hero__word')?.textContent).not.toBe('');
    expect(within(next).getByRole('button', { name: /^Mark next .* as planned$/ })).toBeInTheDocument();
    expect(next.querySelector('.lv-day-hero__rail')).toBeInTheDocument();
  });

  it('Next up with no set time (a weigh-in with no time) gives the item itself the focal role, with no empty time', async () => {
    const p = fixturePlan(FIXTURE_TODAY);
    const { weighInClockH, ...intentions } = p.intentions;
    expect(weighInClockH).toBe(7);
    renderLiving(<TodayPage />, {
      path: '/today',
      ...routes,
      plan: { ...p, intentions },
      now: `${FIXTURE_TODAY}T07:00:00`,
    });
    const next = await screen.findByRole('region', { name: 'Today' });
    expect(next.querySelector('.lv-day-hero__open .lm-hero')).toBeNull();
    expect(next.querySelector('.lv-day-hero__word')?.textContent).toMatch(/^weigh in$/i);
    expect(within(next).getAllByRole('button', { name: 'Log weight' }).length).toBeGreaterThan(0);
  });

  it('Log weight opens the weight sheet and saves the weigh-in', async () => {
    const h = renderLiving(<TodayPage />, { path: '/today', ...routes });
    const plan = await revealPlan();
    fireEvent.click(
      within(plan.querySelector('[data-row="weigh"]') as HTMLElement).getByRole('button', {
        name: 'Log weight',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Weight' });
    const field = within(dialog).getByLabelText('Weight');
    fireEvent.change(field, { target: { value: '83.4' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.stub.inspect().measurements.map((m) => m.value)).toEqual([83.4]));
  });

  it('future dates are read-only previews; nothing logged or weighed is shown for them', async () => {
    renderLiving(<TodayPage />, { path: '/today/2026-10-03', route: 'today/:date' });
    const plan = await revealPlan();
    expect(within(plan).getByText('Preview')).toBeInTheDocument();
    expect(within(plan).queryAllByRole('button', { name: /^Mark .* as planned$/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Mark all as planned' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'So far' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Day total' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Weight' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Next up' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Saturday' })).toBeInTheDocument();
  });

  it('the date control reads today and its calendar opens another day', async () => {
    const h = renderLiving(<TodayPage />, {
      path: '/today',
      ...routes,
      routes: [{ path: 'today/:date', element: <TodayPage /> }],
    });
    const control = await screen.findByRole('button', { name: 'Today · Thu 1 Oct, choose a day' });
    fireEvent.click(control);
    const sheet = await screen.findByRole('dialog', { name: 'Choose a day' });
    expect(within(sheet).getByRole('button', { name: /^Thu 1 Oct, today/ })).toHaveAttribute(
      'aria-current',
      'date',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Previous month' }));
    fireEvent.click(within(sheet).getByRole('button', { name: /^Tue 29 Sep/ }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/today/2026-09-29'));
    expect(await screen.findByRole('button', { name: 'Tue 29 Sep, choose a day' })).toBeInTheDocument();
  });

  it('check-in day: the header’s check-in icon (gold dot) opens the weekly check-in (never a notice in the page)', async () => {
    const user = userEvent.setup();
    renderLiving(<TodayPage />, { path: '/today', ...routes });
    const icon = await screen.findByRole('button', { name: 'Weekly check-in ready' });
    expect(icon).toHaveClass('lm-status-icon');
    expect(icon).toHaveTextContent('');
    expect(icon.querySelector('.lm-status-icon__dot')).not.toBeNull();
    expect(icon).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(icon);
    expect(await screen.findByRole('dialog', { name: 'Weekly check-in' })).toBeInTheDocument();
    expect(screen.queryByText(/weekly check-in is ready/i)).toBeNull();
  });

  it('the weekly check-in commits with its header verb (Cancel · title · Check in); closing never records it (C6)', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<TodayPage />, { path: '/today', ...routes });
    const checkIn = vi.spyOn(h.stub.actions, 'checkIn');
    await user.click(await screen.findByRole('button', { name: 'Weekly check-in ready' }));
    let sheet = await screen.findByRole('dialog', { name: 'Weekly check-in' });
    await within(sheet).findByRole('heading', { name: 'This week' });
    expect(within(sheet).queryByRole('button', { name: 'Done' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Close' })).toBeNull();
    // the bars read in sentence case
    const bars = within(sheet).getByRole('list', { name: 'Adherence by part of the plan' });
    for (const label of bars.querySelectorAll('.lmc-bb__label')) expect(label.textContent).toMatch(/^[A-Z]/);
    // Cancel closes without a check-in
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Weekly check-in' })).not.toBeInTheDocument(),
    );
    expect(checkIn).not.toHaveBeenCalled();
    // the header verb records it once and closes
    await user.click(await screen.findByRole('button', { name: 'Weekly check-in ready' }));
    sheet = await screen.findByRole('dialog', { name: 'Weekly check-in' });
    await user.click(within(sheet).getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Weekly check-in' })).not.toBeInTheDocument(),
    );
  });

  it('proposals waiting: the inbox icon counts them in its name and opens them as change cards', async () => {
    const user = userEvent.setup();
    // a week day other than the check-in day, so the capsule speaks for the proposals
    const plan = {
      ...fixturePlan(FIXTURE_TODAY),
      policy: { checkInWeekday: 0 as const, autoApplyLoadLowering: true },
    };
    renderLiving(<TodayPage />, { path: '/today', ...routes, plan });
    await user.click(await screen.findByRole('button', { name: '1 change waiting' }));
    const sheet = await screen.findByRole('dialog', { name: 'Changes waiting' });
    expect(within(sheet).getByRole('article', { name: /an easier session today/ })).toBeInTheDocument();
    expect(within(sheet).queryByText(/the plan · /)).toBeNull();
  });

  it('check-in day with a proposal waiting: both icons, the check-in first, before the ⋯', async () => {
    renderLiving(<TodayPage />, { path: '/today', ...routes });
    const checkIn = await screen.findByRole('button', { name: 'Weekly check-in ready' });
    const changes = await screen.findByRole('button', { name: '1 change waiting' });
    expect(checkIn.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      changes.compareDocumentPosition(screen.getByRole('button', { name: 'More' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('a paused plan shows the pause icon (no dot), which opens Resume', async () => {
    const user = userEvent.setup();
    renderLiving(<TodayPage />, {
      path: '/today',
      ...routes,
      plan: fixturePlan(FIXTURE_TODAY, { status: 'paused' }),
    });
    const icon = await screen.findByRole('button', { name: 'Plan paused' });
    expect(icon.querySelector('.lm-status-icon__dot')).toBeNull();
    await user.click(icon);
    const sheet = await screen.findByRole('dialog', { name: 'Plan paused' });
    expect(within(sheet).getByText('Since Tue 29 Sep')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Resume plan' })).toBeInTheDocument();
  });

  it('a scheduled plan shows when it starts, what to do before day 1 and a read-only preview of day 1', async () => {
    const p = { ...fixturePlan(FIXTURE_TODAY, { dayIndex: -1 }), status: 'scheduled' as const };
    renderLiving(<TodayPage />, { path: '/today', ...routes, plan: p });
    expect(await screen.findByRole('heading', { name: 'Starts tomorrow' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Discard plan…' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByRole('button', { name: 'Log weight' }).length).toBeGreaterThan(0);
    const day1 = screen.getByText('Day 1', { selector: 'summary' });
    expect(day1.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(day1);
    expect(screen.queryByRole('button', { name: /^Mark .* as planned$/ })).toBeNull();
    expect(screen.queryByText(/Change start date|after the bathroom|maintenance/)).toBeNull();
  });
});
