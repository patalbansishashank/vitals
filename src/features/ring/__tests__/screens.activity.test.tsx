/** Activity › Movement (until r087 the Ring's Activity tab). (r071: split out of `screens.test.tsx`.) */
import './clock';
import { STEPS_DAY_WORDS } from '@/features/living/activity/StepsDayChart';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { dispatch } from '@/commands/bus';
import { makeGaugeFixture } from '../fixtures';
import { setRingActivitySource } from '../useActivities';
import { activitySource, candidate, sessionEntry } from './activityFixtures';
import { shiftDate } from '../model';
import { RING_COPY } from '../copy';
import { ringHooks, setupScreens, renderAt, today, card, header, expectWordsOnly } from './screenKit';

setupScreens();
// the page is its own lazy chunk: load it once so its first render does not eat a test's timeout
beforeAll(async () => {
  await import('@/features/living/activity/MovementPage');
}, 120_000);

/** The activity list's card title (the Ring copy's word for it). */
const LIST = RING_COPY.workouts;

describe('Activity › Movement', () => {
  ringHooks();

  it('Movement: steps against the goal above steps by hour, 30-day steps and the day’s activity list', async () => {
    renderAt('/activity');
    // (r087) one place under one name, its three tabs in the bar; the ring's freshness and status stay in the header
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, { timeout: 8000 })).toBeInTheDocument();
    const tabs = within(header()).getByRole('navigation', { name: 'Activity section' });
    expect(within(tabs).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Train', '/train'],
      ['Movement', '/activity'],
      ['Energy', '/energy'],
    ]);
    expect(within(tabs).getByRole('link', { name: 'Movement' })).toHaveAttribute('aria-current', 'page');
    expect(within(header()).getByText(/^Phone sent \d{2}:\d{2}$/)).toBeInTheDocument();
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
    // (r087) and on one day it is that day's list: no 30-day span, no pager
    const list = card(LIST);
    expect(await within(list).findByText('No counted activities this day.')).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Earlier' })).toBeNull();
    // the empty line says it once: no "0 counted" under it
    expect(within(list).queryByText(RING_COPY.countedCount(0))).toBeNull();
    // (r087) Energy is the next tab: no link card to it among the cards
    expect(screen.queryByRole('heading', { level: 2, name: 'Energy burned' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'View energy' })).toBeNull();
  });

  it('Movement (S25/A14): a day lists its approved activities with their Gauge evidence linked; a longer stretch pages 30 days at a time', async () => {
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
    const first = renderAt(`/activity?date=${w.date}`);
    await screen.findByRole('heading', { name: 'Movement' }, { timeout: 8000 });
    let list = card(LIST);
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
    // (r087) one day selected: that day only, so nothing to page through
    expect(within(list).queryByRole('button', { name: 'Earlier' })).toBeNull();
    expect(within(list).queryByRole('button', { name: 'Later' })).toBeNull();
    first.dispose();
    cleanup();
    // the day before holds none of it
    const before = renderAt(`/activity?date=${shiftDate(w.date, -1)}`);
    await screen.findByRole('heading', { name: 'Movement' }, { timeout: 8000 });
    expect(await within(card(LIST)).findByText('No counted activities this day.')).toBeInTheDocument();
    before.dispose();
    cleanup();
    // 60 days: the newest 30 first; Earlier pages back inside the range (nothing there), Later returns
    renderAt(`/activity?period=range&from=${shiftDate(today, -59)}&to=${today}`);
    list = (await screen.findByRole('heading', { level: 2, name: LIST }, { timeout: 8000 })).closest('section')!;
    expect(await within(list).findByRole('link')).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Later' })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Earlier' }));
    expect(await within(list).findByText('No counted activities in these 30 days.')).toBeInTheDocument();
    // the range's first page: nothing earlier to open
    expect(within(list).queryByRole('button', { name: 'Earlier' })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Later' }));
    expect(await within(list).findByRole('link')).toBeInTheDocument();
  });

  // (r087) a calendar month is never split: with 30-day pages a 31-day month left its 1st on a page of its own and
  // out of the count
  it('Movement: 31 days, the longest month, list on one page with the first day counted; a day more pages', async () => {
    const entries = (first: string) =>
      activitySource({
        sessions: [
          sessionEntry({ id: 'e-first', date: first, startH: 7, durationMin: 20, grossKcal: 150 }),
          sessionEntry({ id: 'e-last', date: today, startH: 8, durationMin: 25, grossKcal: 180 }),
        ],
      });
    const month = shiftDate(today, -30);
    setRingActivitySource(entries(month));
    const whole = renderAt(`/activity?period=range&from=${month}&to=${today}`);
    let list = (await screen.findByRole('heading', { level: 2, name: LIST }, { timeout: 8000 })).closest('section')!;
    expect(await within(list).findByText(RING_COPY.countedCount(2))).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).queryByRole('button', { name: 'Earlier' })).toBeNull();
    expect(within(list).queryByRole('button', { name: 'Later' })).toBeNull();
    whole.dispose();
    cleanup();
    // 32 days: the newest 30, then the two before them
    const longer = shiftDate(today, -31);
    setRingActivitySource(entries(longer));
    renderAt(`/activity?period=range&from=${longer}&to=${today}`);
    list = (await screen.findByRole('heading', { level: 2, name: LIST }, { timeout: 8000 })).closest('section')!;
    expect(await within(list).findByText(RING_COPY.countedCount(1))).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Earlier' }));
    expect(await within(list).findByText(/^150\s?kcal$/)).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).queryByRole('button', { name: 'Earlier' })).toBeNull();
  });

  // (r087) the burn is worked out from the same uploads: Energy's bar says how fresh they are too, so the header
  // keeps its lines from one Activity tab to the next
  it('Energy carries the same freshness line in its header as Movement', async () => {
    renderAt('/energy');
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, { timeout: 8000 })).toBeInTheDocument();
    expect(await within(header()).findByText(/^Phone sent \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(within(header()).getByRole('navigation', { name: 'Activity section' })).getByRole('link', { name: 'Energy' })).toHaveAttribute('aria-current', 'page');
  });

  // (0.6.3 INT) quiet mode on Movement: the update time as words, the figure-only charts give way to a line, the
  // activity rows say the part of the day (dates stay, as on every date strip)
  it('quiet mode: Movement’s Movement and Steps cards and the activity list carry no digits', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    renderAt('/activity');
    const movement = (
      await screen.findByRole('heading', { level: 2, name: 'Movement' }, { timeout: 8000 })
    ).closest('section')!;
    // (r069 D3) the steps-through-the-day chart gives way to its words
    expect(
      await within(movement).findByText(STEPS_DAY_WORDS.quiet, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expectWordsOnly(movement);
    expectWordsOnly(card('Steps'));
    const workouts = card(LIST);
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
