import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import ProgressPage from '../ProgressPage';
import { DriftGoalCard } from '../components/DriftGoalCard';
import { renderLiving } from '../../testing';
import type { DriftCard } from '../../data/types';
import { checkInDates, readTrend, shiftMonth, signedInterval, sliceHistory, trendWindow } from '../model';
import { createStubScoresSource } from '../../data/scores';

const EIGHT = ['Trend', 'Goals', 'Adherence', 'Body', 'Body signals', 'From your ring', 'Log', 'Check-ins', 'Plan'];

describe('Progress page', () => {
  it('shows all eight sections with anchor chips when a plan is running', async () => {
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Progress' })).toBeInTheDocument();
    for (const name of EIGHT) expect(screen.getAllByRole('heading', { level: 2, name }).length).toBeGreaterThan(0);
    const navs = screen.getAllByRole('navigation', { name: 'Progress sections' });
    expect(navs.length).toBeGreaterThan(0);
    const chips = within(navs[0]!).getAllByRole('link');
    // E20: markers — the blood markers section follows body signals
    expect(chips.map((a) => a.textContent)).toEqual(['trend', 'goals', 'adherence', 'body', 'body signals', 'from your ring', 'blood markers', 'log', 'check-ins', 'plan']);
    expect(chips[0]).toHaveAttribute('href', '#trend');
    // context row: plan name and the range bank
    expect(screen.getByText('Spring cut')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Trend range' })).toBeInTheDocument();
    // trend readout from the source's arrays
    expect(screen.getByText(/^trend \d+\.\d kg \(±0\.3\) · since day 1/)).toBeInTheDocument();
  });

  it('shows only Body, Body signals and Log without a plan', async () => {
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress', plan: null });
    expect(await screen.findByRole('heading', { level: 2, name: 'Body' })).toBeInTheDocument();
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(['Body', 'Body signals', 'From your ring', 'Blood markers', 'Log']); // E20: markers; plan 04: the ring's link card
    // the link card replaces the E29 steps and workouts faceplates
    const card = document.getElementById('activity')!;
    expect(within(card).getByRole('link', { name: 'Open body signals' })).toHaveAttribute('href', '/signals');
    expect(within(card).getByText('steps today')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Steps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Workouts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Trend range' })).not.toBeInTheDocument();
    const chips = within(screen.getAllByRole('navigation', { name: 'Progress sections' })[0]!).getAllByRole('link');
    expect(chips.map((a) => a.textContent)).toEqual(['body', 'body signals', 'from your ring', 'blood markers', 'log']); // E20: markers; plan 04: the ring's link card
  });

  it('logs a waist girth from three repeats (the action keeps the mean)', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await user.click(await screen.findByRole('button', { name: 'Add a measurement' }));
    const panel = await screen.findByRole('dialog', { name: 'Add a measurement' });
    expect(within(panel).getByText('repeat 2–3 times; we use the average')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('repeat 1'), '94{Enter}');
    await user.type(within(panel).getByLabelText('repeat 2'), '94.5{Enter}');
    await user.type(within(panel).getByLabelText('repeat 3'), '94.4{Enter}');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    const m = h.stub.inspect().measurements;
    expect(m).toHaveLength(1);
    expect(m[0]!.metric).toBe('waistCm');
    expect(m[0]!.repeats).toEqual([94, 94.5, 94.4]);
    expect(m[0]!.value).toBeCloseTo(94.3, 5);
    expect(m[0]!.method).toBe('tape');
  });

  it('offers labs as a disabled option and notes rough and DXA body-fat readings', async () => {
    const user = userEvent.setup();
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await user.click(await screen.findByRole('button', { name: 'Add a measurement' }));
    const panel = await screen.findByRole('dialog', { name: 'Add a measurement' });
    const select = within(panel).getByRole('combobox');
    expect(within(select).getByRole('option', { name: 'labs — coming later' })).toBeDisabled();
    await user.selectOptions(select, 'bodyFat');
    expect(within(panel).getByText('kept as a rough reading (±2 points)')).toBeInTheDocument();
    await user.click(within(panel).getByRole('radio', { name: 'DXA' }));
    expect(within(panel).getByText('This resets your composition estimate.')).toBeInTheDocument();
  });

  it('turns numbers into words in quiet mode, with a "show numbers" key for the view', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await screen.findByRole('heading', { level: 2, name: 'Body' });
    await act(async () => {
      await h.stub.actions.setQuietMode(true);
    });
    expect(await screen.findByText('Composition is hidden while quiet mode is on.')).toBeInTheDocument();
    expect(screen.queryByText(/^trend \d/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/^trend (going down|steady|going up)/).length).toBeGreaterThan(0);
    expect(screen.getByText('about usual')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'show numbers' })[0]!);
    expect(screen.queryByText('Composition is hidden while quiet mode is on.')).not.toBeInTheDocument();
    expect(screen.getByText('fat mass')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'hide numbers' })).toBeInTheDocument();
  });

  it('opens a score detail and an empty stage for an unknown metric', async () => {
    renderLiving(<ProgressPage />, { path: '/progress/hrv.status', route: 'progress/:metric' });
    expect(await screen.findByRole('heading', { level: 1, name: 'HRV status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What it changes in your plan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it’s worked out' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor opinion' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'History range' })).toBeInTheDocument();
  });

  it('shows "Nothing to show for this." for an unknown metric', async () => {
    renderLiving(<ProgressPage />, { path: '/progress/not-a-score', route: 'progress/:metric' });
    expect(await screen.findByText('Nothing to show for this.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Progress' })).toHaveAttribute('href', '/progress');
  });
});

describe('Drift goal card', () => {
  const base: DriftCard = {
    goal: 1,
    metric: 'scaleWeight',
    label: 'Body weight',
    state: 'behind',
    goalDate: { range: ['2026-12-21', '2026-12-30'], shiftDays: 9, shiftSd: 6 },
    causes: [{ cause: 'adherence', share: 0.7, text: 'Mostly adherence: two of three sessions were skipped.' }],
    action: 'replan',
    text: 'Behind the forecast.',
  };

  it('shows the verdict, the moved goal date, the cause and exactly one action', () => {
    const onAction = vi.fn();
    render(
      <MemoryRouter>
        <DriftGoalCard card={base} onAction={onAction} />
      </MemoryRouter>,
    );
    expect(screen.getByText('behind')).toBeInTheDocument();
    expect(screen.getByText('goal date likely 21–30 Dec, moved by +9 days (±6)')).toBeInTheDocument();
    expect(screen.getByText('Mostly adherence: two of three sessions were skipped.')).toBeInTheDocument();
    const keys = screen.getAllByRole('button');
    expect(keys).toHaveLength(1);
    keys[0]!.click();
    expect(onAction).toHaveBeenCalledWith('replan');
  });

  it('offers easier options as its single action and no key for keep going', () => {
    const { rerender } = render(<DriftGoalCard card={{ ...base, action: 'easeOptions', goalDate: { ...base.goalDate, shiftDays: 2 } }} onAction={() => undefined} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['See easier options']);
    expect(screen.queryByText(/moved by/)).not.toBeInTheDocument();
    rerender(<DriftGoalCard card={{ ...base, state: 'onTrack', action: 'keepGoing' }} onAction={() => undefined} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('on track')).toBeInTheDocument();
  });

  it('never has more than one key per goal on the page', async () => {
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const goals = (await screen.findByRole('heading', { level: 2, name: 'Goals' })).closest('section')!;
    for (const card of within(goals).getAllByRole('article')) expect(within(card).queryAllByRole('button').length).toBeLessThanOrEqual(1);
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
      { startDate: '2026-09-17', days: 5, todayIndex: 4, unit: 'kg', decimals: 1, weighIns: [{ day: 0, value: 85 }, { day: 2, value: 84.6 }], trend: [85, 84.9, 84.8, Number.NaN, Number.NaN], trendSd: [0.3, 0.3, 0.3, 0.3, 0.3] },
      '2026-09-21',
    );
    expect(r).toEqual({ weighDays: 2, lastWeighIn: '2026-09-19', gapDays: 2, now: 84.8, sd: 0.3, first: 85 });
    const [near, far] = signedInterval(-2.4, 0.3);
    expect(near).toBeCloseTo(-2.02, 2);
    expect(far).toBeCloseTo(-2.78, 2);
  });

  it('lists weekly check-ins newest first, starting a week in', () => {
    expect(checkInDates({ startDate: '2026-09-17', policy: { checkInWeekday: 3 } }, '2026-10-01')).toEqual(['2026-10-01', '2026-09-24']);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('slices a score history to the last weeks', () => {
    const h = createStubScoresSource('2026-10-01').detail('hrv.status')!.history;
    const s = sliceHistory(h, 28);
    expect(s.days).toBe(28);
    expect(s.nightly).toHaveLength(28);
    expect(s.startDate).toBe('2026-09-04');
    expect(s.versions?.[0]?.day).toBe(28 - 1 - 11);
  });
});
