/** Ring › Activity. (r071: split out of `screens.test.tsx`.) */
import './clock';
import { STEPS_DAY_WORDS } from '@/features/living/activity/StepsDayChart';
import { fireEvent, screen, within } from '@testing-library/react';
import { dispatch } from '@/commands/bus';
import { makeGaugeFixture } from '../fixtures';
import { setRingActivitySource } from '../useActivities';
import { activitySource, candidate, sessionEntry } from './activityFixtures';
import { shiftDate } from '../model';
import { ringHooks, setupScreens, renderAt, today, card, expectWordsOnly } from './screenKit';

setupScreens();

describe('Ring screens: activity', () => {
  ringHooks();

  it('Activity: steps against the goal above steps by hour, 30-day steps and the workout list', async () => {
    renderAt('/ring/activity');
    const move = (await screen.findByRole('heading', { name: 'Movement' }, { timeout: 8000 })).closest(
      'section',
    )!;
    expect(await within(move).findByRole('meter', { name: 'Steps' })).toBeInTheDocument();
    // (r069 D3) the day's counted steps in time, its activities on the axis
    expect(await within(move).findByRole('img', { name: /^Steps through the day/ })).toBeInTheDocument();
    const activeMinutes = (await makeGaugeFixture().daily(today))?.activity?.activeMinutes;
    expect(activeMinutes).not.toBeNull();
    expect(within(move).queryByText(/^Active time /)).toBeNull();
    expect(within(move).getByText('Ring goal 9,000')).toBeInTheDocument();
    fireEvent.click(within(move).getByRole('button', { name: 'About Movement' }));
    const detail = await screen.findByRole('dialog', { name: 'Steps, distance and energy' });
    expect(within(detail).getByText('Active time')).toBeInTheDocument();
    expect(within(detail).getByText(`${activeMinutes} min · Ring`)).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('img', { name: /^Steps by day, / })).toBeInTheDocument();
    // (0.6.3 S25) the list is the canonical activities: nothing approved yet lists nothing, Gauge's sessions never stand in
    expect(
      await within(card('Workouts')).findByText('No counted activities in these 30 days.'),
    ).toBeInTheDocument();
  });

  it('Activity (S25/A14): approved activities with their Gauge evidence linked, pending apart, history pages', async () => {
    const api = makeGaugeFixture();
    const w = (await api.workouts(shiftDate(today, -6), today))!.sessions.find((s) => s.type === 'run')!;
    const start = Date.parse(w.start);
    setRingActivitySource(
      activitySource({
        sessions: [
          sessionEntry({
            id: 'e-run',
            date: w.date,
            startH: 7,
            durationMin: 30,
            key: 'k-run',
            grossKcal: 320,
          }),
        ],
        candidates: [
          candidate({
            key: 'k-run',
            status: 'approved',
            refs: [`gauge:${w.id}`],
            date: w.date,
            start,
            end: start + 30 * 60_000,
            entryId: 'e-run',
          }),
          candidate({
            key: 'k-pend',
            status: 'pending',
            refs: ['hc:walk-1'],
            date: today,
            start: Date.parse(`${today}T06:00:00`),
            end: Date.parse(`${today}T06:20:00`),
          }),
          candidate({
            key: 'k-rej',
            status: 'rejected',
            refs: ['gauge:rejected-1'],
            date: today,
            start: Date.parse(`${today}T05:00:00`),
            end: Date.parse(`${today}T05:20:00`),
          }),
        ],
      }),
    );
    renderAt('/ring/activity');
    await screen.findByRole('heading', { name: 'Movement' }, { timeout: 8000 });
    const list = card('Workouts');
    const link = await within(list).findByRole('link');
    expect(link.getAttribute('href')).toBe(
      `/ring/workouts/${encodeURIComponent(w.id)}?date=${w.date}&activity=e-run`,
    );
    // (r068 A03) the energy as "320 kcal" on the row; the card says what is counted
    expect(within(list).getByText(/^320\s?kcal$/)).toBeInTheDocument();
    // (r070) nothing is asked: no review card; rejected: nowhere
    expect(screen.queryByRole('heading', { name: 'To review' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Review' })).toBeNull();
    expect(screen.queryByText(/rejected-1/)).toBeNull();
    expect(within(list).getByText(/^1 counted/)).toBeInTheDocument();
    // history: Earlier pages back 30 days (nothing there), Later returns
    fireEvent.click(within(list).getByRole('button', { name: 'Earlier' }));
    expect(await within(list).findByText('No counted activities in these 30 days.')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Later' }));
    expect(await within(list).findByRole('link')).toBeInTheDocument();
  });

  // (0.6.3 INT) quiet mode on the Activity tab: the update time as words, the figure-only charts give way to a line, the
  // activity rows say the part of the day (dates stay, as on every date strip)
  it('quiet mode: the Activity tab’s Movement and Steps cards and the activity list carry no digits', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    renderAt('/ring/activity');
    const movement = (
      await screen.findByRole('heading', { level: 2, name: 'Movement' }, { timeout: 8000 })
    ).closest('section')!;
    // (r069 D3) the steps-through-the-day chart gives way to its words
    expect(
      await within(movement).findByText(STEPS_DAY_WORDS.quiet, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expectWordsOnly(movement);
    expectWordsOnly(card('Steps'));
    const workouts = card('Workouts');
    for (const el of workouts.querySelectorAll('.rg-rows, .rg-none')) expectWordsOnly(el as HTMLElement);
  });

  it('Activity: the steps lineage chip opens Steps by source, with the source chart (Codex UI #25)', async () => {
    renderAt('/ring');
    const activity = (
      await screen.findByRole('heading', { level: 2, name: 'Activity' }, { timeout: 8000 })
    ).closest('section')!;
    const chip = await within(activity).findByRole(
      'button',
      { name: /^Steps by source\s?(Ring and phone|Ring|Phone)/ },
      { timeout: 5000 },
    );
    fireEvent.click(chip);
    expect(await screen.findByRole('heading', { name: 'Steps by source' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Steps by hour: ring/ })).toBeInTheDocument();
  });
});
