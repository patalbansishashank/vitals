import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import ProgressPage from '../ProgressPage';
import { DriftGoalCard } from '../components/DriftGoalCard';
import { defaultLogDay, logDayStatus } from '../sections/LogSection';
import { weekChange } from '../sections/CheckInsSection';
import { renderLiving } from '../../testing';
import type { DayGlance, DriftCard, HistoryDay } from '../../data/types';
import { checkInDates, readTrend, shiftMonth, signedInterval, trendWindow } from '../model';

describe('Progress page', () => {
  it('shows the cards when a plan is running, with the range switch in the Weight card and no section rail', async () => {
    const { result } = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Progress' })).toBeInTheDocument();
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    for (const name of ['Weight', 'Adherence', 'Log', 'Body', 'Blood markers', 'Check-ins'])
      expect(h2).toContain(name);
    // the plan's versions live in Plan details; no Plan card, no "Pause and end are in…" pointer
    expect(h2).not.toContain('Plan');
    expect(screen.queryByText(/Pause and end are in/)).not.toBeInTheDocument();
    // no anchor-chip rail, no section index, no plan name in the header
    expect(screen.queryByRole('navigation', { name: 'Progress sections' })).not.toBeInTheDocument();
    expect(screen.queryByText('Spring cut')).not.toBeInTheDocument();
    const weight = screen.getByRole('heading', { level: 2, name: 'Weight' }).closest('section')!;
    expect(within(weight).getByRole('radiogroup', { name: 'Trend range' })).toBeInTheDocument();
    const hero = weight.querySelector('.lm-hero');
    expect(hero?.getAttribute('aria-label')).toMatch(/^Trend \d+\.\d(–\d+\.\d)? kg$/);
    expect(weight.querySelector('[data-mark="as-prescribed"]')).toBeNull();
    expect(within(weight).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(within(weight).getByRole('button', { name: 'About Weight' })).toBeInTheDocument();
    expect(result.container.querySelector('.lmv-tickstrip')).toBeNull();
    // anchors survive (/progress#log)
    expect(result.container.querySelector('#log')).not.toBeNull();
  });

  it('phones: one column in reading order; desktop: weight | adherence head two columns that end near each other', async () => {
    const order = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('.lv-prog__col')).map((col) =>
        Array.from(col.querySelectorAll(':scope > .lm-gcard')).map((s) => s.id),
      );
    const phone = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await screen.findByRole('heading', { level: 2, name: 'Log' });
    expect(order(phone.result.container).flat()).toEqual(
      [
        'trend',
        'energy',
        'adherence',
        'log',
        'checkins',
        'steps',
        'heart-points',
        'overnight',
        'hrv',
        'body',
        'markers',
      ].filter((id) => phone.result.container.querySelector(`#${id}`)),
    );
    phone.result.unmount();

    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: /min-width:\s*64rem/.test(query),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const desk = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
      await screen.findByRole('heading', { level: 2, name: 'Log' });
      const [left, right] = order(desk.result.container);
      expect(left?.[0]).toBe('trend');
      expect(left).toContain('log');
      expect(right?.[0]).toBe('adherence');
      expect(right).toContain('body');
      expect(left).toContain('checkins');
      expect(desk.result.container.querySelector('.lv-prog__hero > #goals')).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('gives an empty history one lead and a direct weigh-in action', async () => {
    const user = userEvent.setup();
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress', plan: null });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Progress starts with a weigh-in' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Steps' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log your weight' }));
    const panel = await screen.findByRole('dialog', { name: 'Add a measurement' });
    expect(within(panel).getByRole('combobox')).toHaveValue('weight');
  });

  it('adherence prints its window, highlights the lowest part, and explains recorded-only coverage', async () => {
    const user = userEvent.setup();
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const card = (await screen.findByRole('heading', { level: 2, name: 'Adherence' })).closest('section')!;
    expect(card.textContent).toMatch(/Last 7 days/);
    expect(card.querySelectorAll('.lm-hero')).toHaveLength(1);
    expect(within(card).getByRole('img', { name: /^Adherence by part/ })).toBeInTheDocument();
    expect(within(card).queryByText(/Friday lifts happen/)).toBeNull();
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    await user.click(within(card).getByRole('button', { name: 'About Adherence' }));
    const info = await screen.findByRole('dialog', { name: 'How adherence is counted' });
    expect(info.textContent).toMatch(/left out, never scored as zero/);
    expect(info).toHaveTextContent('Friday lifts happen about 1 time in 3. The plan can move them.');
    expect(
      within(info).getByRole('region', { name: 'Adherence by part of the plan table' }),
    ).toBeInTheDocument();
  });

  it('log: one calendar and the selected day only — no list repeating the month', async () => {
    const user = userEvent.setup();
    const { router } = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const card = (await screen.findByRole('heading', { level: 2, name: 'Log' })).closest('section')!;
    const grid = within(card).getByRole('grid', { name: 'Log, October 2026' });
    expect(within(card).queryByRole('list')).toBeNull();
    // the month opens on today: selected in the calendar, one row under it that opens the day
    expect(
      within(grid)
        .getByRole('button', { name: /^Thu 1 Oct/ })
        .getAttribute('data-selected'),
    ).toBe('true');
    expect(within(grid).queryByRole('button', { name: /^Fri 2 Oct/ })).toBeNull();
    const today = within(card).getByRole('link', { name: 'Open Thu 1 Oct' });
    expect(today).toHaveAttribute('href', '/today/2026-10-01');
    expect(within(card).getAllByRole('link')).toHaveLength(1);
    // one month control drives the calendar; another month opens on its last day
    await user.click(within(card).getByRole('button', { name: 'Previous month' }));
    const sept = within(card).getByRole('grid', { name: 'Log, September 2026' });
    expect(within(card).getByRole('link', { name: 'Open Wed 30 Sep' })).toBeInTheDocument();
    // tapping a day selects it (it does not leave the page); the row follows, and scores read in percent
    await user.click(within(sept).getByRole('button', { name: /^Mon 28 Sep/ }));
    expect(router.state.location.pathname).toBe('/progress');
    expect(
      within(sept)
        .getByRole('button', { name: /^Mon 28 Sep/ })
        .getAttribute('data-selected'),
    ).toBe('true');
    const row = within(card).getByRole('link', { name: 'Open Mon 28 Sep' });
    expect(row).toHaveAttribute('href', '/today/2026-09-28');
    expect(row.textContent).not.toMatch(/\byou\b|typed/);
    expect(row.querySelector('.lv-prog-sel__status')?.textContent).toMatch(
      /^(\d+ %( · so far)?|Logged|Not logged|As planned|Paused)/,
    );
    expect(within(card).getAllByRole('link')).toHaveLength(1);
  });

  it('logs a waist girth from three readings (the action keeps the mean)', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await user.click(await screen.findByRole('button', { name: 'Add a measurement' }));
    const panel = await screen.findByRole('dialog', { name: 'Add a measurement' });
    expect(within(panel).queryByText(/we use the average/)).not.toBeInTheDocument();
    await user.type(within(panel).getByLabelText('Waist'), '94{Enter}');
    await user.click(within(panel).getByRole('button', { name: 'Add a reading' }));
    await user.type(within(panel).getByLabelText('Reading 2'), '94.5{Enter}');
    await user.click(within(panel).getByRole('button', { name: 'Add a reading' }));
    await user.type(within(panel).getByLabelText('Reading 3'), '94.4{Enter}');
    expect(within(panel).queryByRole('button', { name: 'Add a reading' })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    const m = h.stub.inspect().measurements;
    expect(m).toHaveLength(1);
    expect(m[0]!.metric).toBe('waistCm');
    expect(m[0]!.repeats).toEqual([94, 94.5, 94.4]);
    expect(m[0]!.value).toBeCloseTo(94.3, 5);
    expect(m[0]!.method).toBe('tape');
  });

  it('logs a single girth reading', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await user.click(await screen.findByRole('button', { name: 'Add a measurement' }));
    const panel = await screen.findByRole('dialog', { name: 'Add a measurement' });
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(within(panel).getByText('Enter a value first.')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('Waist'), '95{Enter}');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    const m = h.stub.inspect().measurements;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ metric: 'waistCm', value: 95 });
  });

  it('lists no "coming later" option and adds no fixed-precision or reset notes to body-fat readings (D5-07)', async () => {
    const user = userEvent.setup();
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await user.click(await screen.findByRole('button', { name: 'Add a measurement' }));
    const panel = await screen.findByRole('dialog', { name: 'Add a measurement' });
    const select = within(panel).getByRole('combobox');
    expect(within(select).queryByRole('option', { name: /labs|coming/i })).toBeNull();
    for (const o of within(select).getAllByRole('option')) expect(o).not.toBeDisabled();
    await user.selectOptions(select, 'bodyFat');
    expect(within(panel).queryByText(/±2 points/)).toBeNull();
    await user.click(within(panel).getByRole('radio', { name: 'DXA' }));
    expect(within(panel).queryByText(/Resets your composition estimate/)).toBeNull();
  });

  it('quiet mode hides composition and weights; a reveal applies to the page and can be closed', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await act(async () => {
      await h.stub.actions.setQuietMode(true);
    });
    expect(await screen.findByText('Composition is hidden while quiet mode is on.')).toBeInTheDocument();
    const weight = () => h.result.container.querySelector('#trend .lm-hero');
    expect(weight()?.getAttribute('aria-label')).toMatch(/^(Going down|Steady|Going up)$/);
    expect(h.result.container.querySelector('#body')?.textContent).not.toMatch(/94\.5|28\.9|24\.1|59\.3/);
    await user.click(screen.getByRole('button', { name: 'Show numbers' }));
    expect(screen.queryByText('Composition is hidden while quiet mode is on.')).not.toBeInTheDocument();
    expect(weight()?.getAttribute('aria-label')).toMatch(/kg/);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Hide numbers' }));
    expect(await screen.findByText('Composition is hidden while quiet mode is on.')).toBeInTheDocument();
  });
});

describe('log day', () => {
  const glance = (date: string, extra: Partial<DayGlance> = {}): DayGlance => ({
    date,
    inPlan: true,
    isStart: false,
    isEnd: false,
    paused: false,
    assumed: false,
    logged: false,
    score: null,
    ...extra,
  });
  const day = (date: string, extra: Partial<HistoryDay> = {}): HistoryDay => ({
    date,
    score: null,
    final: true,
    assumed: false,
    paused: false,
    entries: [],
    ...extra,
  });
  const score = (n: number, final = true): NonNullable<DayGlance['score']> => ({
    score: n,
    coverage: 1,
    items: [],
    final,
  });

  it('opens a month on the last day shown in it, else the month’s last day', () => {
    expect(defaultLogDay('2026-10', '2026-10-17')).toBe('2026-10-17');
    expect(defaultLogDay('2026-09', '2026-10-17')).toBe('2026-09-30');
    expect(defaultLogDay('2026-11', '2026-10-17')).toBe('2026-11-01');
  });

  it('says the score, or the state — a weigh-in or mark counts as logged, the same as the Adherence count', () => {
    const today = '2026-10-17';
    expect(
      logDayStatus(
        glance('2026-10-16', { score: score(54.4) }),
        day('2026-10-16', { score: score(54.4) }),
        today,
        false,
      ),
    ).toBe('54 %');
    expect(
      logDayStatus(
        glance(today, { score: score(40, false) }),
        day(today, { score: score(40, false), final: false }),
        today,
        false,
      ),
    ).toBe('40 % · so far');
    expect(logDayStatus(glance('2026-10-16', { score: score(90) }), undefined, today, true)).toBe(
      'As planned',
    );
    expect(logDayStatus(glance('2026-10-13', { logged: true }), day('2026-10-13'), today, false)).toBe(
      'Logged',
    );
    expect(logDayStatus(glance('2026-10-13'), day('2026-10-13'), today, false)).toBe('Not logged');
    expect(
      logDayStatus(
        glance('2026-10-13', { assumed: true }),
        day('2026-10-13', { assumed: true }),
        today,
        false,
      ),
    ).toBe('As planned');
    expect(
      logDayStatus(glance('2026-10-12', { paused: true }), day('2026-10-12', { paused: true }), today, false),
    ).toBe('Paused');
    expect(logDayStatus(glance('2026-10-24'), undefined, today, false)).toBe('Coming up');
  });
});

describe('check-in lines', () => {
  it('reads the week’s change from the source line, never inventing one', () => {
    expect(weekChange('trend −0.5 kg this week')).toEqual({ text: '−0.5 kg', value: -0.5 });
    expect(weekChange('trend +0.2 kg this week (likely +0.1 to +0.3)')).toEqual({
      text: '+0.2 kg',
      value: 0.2,
    });
    expect(weekChange('Not enough weigh-ins for a weekly trend yet.')).toBeNull();
  });
});

describe('Drift goal card', () => {
  const base: DriftCard = {
    goal: 1,
    metric: 'scaleWeight',
    label: 'Body weight',
    state: 'behind',
    goalDate: { range: ['2026-12-21', '2026-12-30'], shiftDays: 9, shiftSd: 6 },
    causes: [
      { cause: 'adherence', share: 0.7, text: 'Mostly adherence: two of three sessions were skipped.' },
    ],
    action: 'replan',
    text: 'Behind the forecast.',
  };

  it('shows the verdict, the moved goal date and exactly one action; a stored cause is never shown (D5-02)', () => {
    const onAction = vi.fn();
    render(
      <MemoryRouter>
        <DriftGoalCard card={base} onAction={onAction} />
      </MemoryRouter>,
    );
    expect(screen.getByText('behind')).toBeInTheDocument();
    expect(screen.getByText('goal date 21–30 Dec, moved by +9 days (±6)')).toBeInTheDocument();
    // causal shares are not identifiable from weight and logs (D5-02): a legacy stored cause stays unread
    expect(screen.queryByText('Mostly adherence: two of three sessions were skipped.')).toBeNull();
    const keys = screen.getAllByRole('button');
    expect(keys).toHaveLength(1);
    keys[0]!.click();
    expect(onAction).toHaveBeenCalledWith('replan');
  });

  it('offers easier options as its single action and no key for keep going', () => {
    const { rerender } = render(
      <DriftGoalCard
        card={{ ...base, action: 'easeOptions', goalDate: { ...base.goalDate, shiftDays: 2 } }}
        onAction={() => undefined}
      />,
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['See easier options']);
    expect(screen.queryByText(/moved by/)).not.toBeInTheDocument();
    rerender(
      <DriftGoalCard card={{ ...base, state: 'onTrack', action: 'keepGoing' }} onAction={() => undefined} />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('on track')).toBeInTheDocument();
  });

  it('never has more than one key per goal on the page', async () => {
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const goals = (await screen.findByRole('heading', { level: 2, name: 'Goal' })).closest('section')!;
    expect(within(goals).getByRole('button', { name: 'About Goal' })).toBeInTheDocument();
    expect(
      within(goals)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('data-variant') === 'action'),
    ).toHaveLength(1);
    for (const card of within(goals).queryAllByRole('article'))
      expect(within(card).queryAllByRole('button').length).toBeLessThanOrEqual(1);
  });
});

describe('progress model', () => {
  const plan = { startDate: '2026-09-17', plannedEndDate: '2026-12-10', policy: { checkInWeekday: 3 } };

  it('windows the trend by range and clips at the plan start', () => {
    expect(trendWindow('2wk', plan, '2026-10-01')).toEqual({ from: '2026-09-18', to: '2026-10-01' });
    expect(trendWindow('4wk', plan, '2026-10-01')).toEqual({ from: '2026-09-17', to: '2026-10-01' });
    expect(trendWindow('all', plan, '2026-10-01')).toEqual({ from: '2026-09-17', to: '2026-12-09' });
  });

  it('reads the trend arrays without estimating anything new', () => {
    const r = readTrend(
      {
        startDate: '2026-09-17',
        days: 5,
        todayIndex: 4,
        unit: 'kg',
        decimals: 1,
        weighIns: [
          { day: 0, value: 85 },
          { day: 2, value: 84.6 },
        ],
        trend: [85, 84.9, 84.8, Number.NaN, Number.NaN],
        trendSd: [0.3, 0.3, 0.3, 0.3, 0.3],
      },
      '2026-09-21',
    );
    expect(r).toEqual({ weighDays: 2, lastWeighIn: '2026-09-19', gapDays: 2, now: 84.8, sd: 0.3, first: 85 });
    const [near, far] = signedInterval(-2.4, 0.3);
    expect(near).toBeCloseTo(-2.02, 2);
    expect(far).toBeCloseTo(-2.78, 2);
  });

  it('lists weekly check-ins newest first, starting a week in', () => {
    expect(checkInDates({ startDate: '2026-09-17', policy: { checkInWeekday: 3 } }, '2026-10-01')).toEqual([
      '2026-10-01',
      '2026-09-24',
    ]);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});
