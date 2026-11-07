/**
 * r069 D4: "The energy card only shows us that specific day. We need a page on how much was burned on a day and at what
 * time." The day Energy page: the model (the engine's ledger grouped by kind, conserved; today's quarter pro rata; each
 * activity's source and method in words) and the page over the screenshot harness's day (Today's own figures, the chart
 * by kind with the activities on its axis, the activities with their kcal and ranges, what is measured and estimated, an
 * earlier day through the day strip, quiet mode words only).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnergyComponent, EnergyDay } from '@/living/sensors/energyDay';
import type { RingActivity } from '@/features/ring/activities';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { addDays } from '@/living/dates';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { ActivityDataProvider, type ActivityData } from '../../activity/data';
import { commandsFixture, dayFixture, fixtureActivityData } from '../../today/__screens__/fixtures';
import { expectWordsOnly } from '../../__tests__/wordsOnly';
import { energyText } from '../../activity/model';
import { fmtDay } from '../../format';
import EnergyPage from '../EnergyPage';
import {
  ENERGY_PAGE_WORDS as W,
  METHOD_WORDS,
  activityRows,
  basisText,
  kindColumns,
  kindSplit,
  kindsOf,
  COMPONENT_ORDER,
  COMPONENT_LABEL,
  rowWhen,
} from '../model';

vi.mock('@/state/gaugeImport', () => ({
  runGaugeImport: vi.fn(async () => ({ ran: false, reason: 'off' })),
}));
window.scrollTo = (() => undefined) as typeof window.scrollTo;

const comp = (o: Partial<Record<EnergyComponent, number>>): Record<EnergyComponent, number> => ({
  rmr: 0,
  neatBase: 0,
  stepsEnergy: 0,
  exercise: 0,
  recovery: 0,
  tef: 0,
  other: 0,
  ...o,
});
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('r069 D4: energy by kind', () => {
  it('groups the ledger into resting, everyday movement, food digestion and exercise, and keeps the total', () => {
    const c = comp({ rmr: 18, other: 1, neatBase: 3, stepsEnergy: 4, exercise: 20, recovery: 2, tef: 5 });
    expect(kindsOf(c)).toEqual({ resting: 19, movement: 7, digestion: 5, exercise: 22 });
    expect(sum(kindsOf(c))).toBeCloseTo(sum(c), 9);
  });

  it('a quarter with fewer steps than the usual day draws no movement and keeps its total (the difference off resting)', () => {
    const c = comp({ rmr: 18, neatBase: 2, stepsEnergy: -5, tef: 1 });
    const k = kindsOf(c);
    expect(k.movement).toBe(0);
    expect(k.resting).toBe(15);
    expect(sum(k)).toBeCloseTo(sum(c), 9);
  });

  it('today counts the quarter now is in pro rata: so far + likely rest = the day', () => {
    const t0 = Date.parse('2026-10-29T00:00:00Z');
    const bins15 = Array.from({ length: 4 }, (_, i) => ({
      start: t0 + i * 900_000,
      kcal: 20,
      components: comp({ rmr: 16, tef: 4 }),
    }));
    const cols = kindColumns({ bins15 } as unknown as EnergyDay, t0 + 900_000 + 450_000);
    expect(cols.map((c) => c.pastFrac)).toEqual([1, 0.5, 0, 0]);
    expect(cols.map((c) => c.future)).toEqual([false, false, true, true]);
    const s = kindSplit(cols);
    expect(s.soFar).toBe(30);
    expect(s.ahead).toBe(50);
    expect(s.total).toBe(80);
    expect(s.byKind).toEqual({ resting: 24, movement: 0, digestion: 6, exercise: 0 });
    // a past day: nothing ahead
    expect(kindSplit(kindColumns({ bins15 } as unknown as EnergyDay, Number.POSITIVE_INFINITY)).ahead).toBe(
      0,
    );
  });

  it('each activity says where it came from and how its energy was estimated; not-yet-counted ones come last', () => {
    const a = (o: Partial<RingActivity>): RingActivity =>
      ({
        id: 'x',
        status: 'approved',
        date: '2026-10-29',
        window: null,
        pauses: [],
        durationMin: 30,
        exerciseId: 'walk',
        grossKcal: 100,
        aboveRestKcal: null,
        candidateKey: null,
        gaugeIds: [],
        sources: ['ring'],
        zones: null,
        rpeCr10: null,
        avgHr: null,
        ...o,
      }) as RingActivity;
    expect(basisText(a({ kcalMethod: 'acsm' }))).toBe(`${W.byRing} · ${METHOD_WORDS.acsm}`);
    expect(basisText(a({ sources: ['logged'], kcalMethod: 'compendiumMet' }))).toBe(
      `${W.byHand} · ${METHOD_WORDS.compendiumMet}`,
    );
    expect(basisText(a({ status: 'pending', kcalMethod: null }))).toBe(W.toReview);
    const desk = a({
      id: 'desk',
      sources: ['logged'],
      exerciseId: 'treadmill_desk_slow',
      window: { start: Date.parse('2026-10-29T09:33:00Z'), end: Date.parse('2026-10-29T10:03:00Z') },
      kcalRange: { lo: 79, hi: 147 },
      grossKcal: 113,
    });
    const bike = a({
      id: 'bike',
      status: 'pending',
      exerciseId: 'stationary_bike',
      window: { start: Date.parse('2026-10-29T05:04:00Z'), end: Date.parse('2026-10-29T05:20:00Z') },
    });
    const rows = activityRows(
      { approved: [desk, a({ id: 'old', date: '2026-10-28' })], pending: [bike] },
      '2026-10-29',
    );
    expect(rows.map((r) => [r.id, r.pending])).toEqual([
      ['desk', false],
      ['bike', true],
    ]);
    expect(rows[0]).toMatchObject({ kcal: 113, range: { lo: 79, hi: 147 } });
    expect(rowWhen(rows[0]!)).toMatch(/^\d\d:\d\d–\d\d:\d\d · 30 min$/);
  });
});

// ------------------------------------------------------------------------------------------------- the page
const NOW = Date.parse(`${FIXTURE_TODAY}T13:00:00`);

function setup(o: { path?: string; quiet?: boolean } = {}) {
  const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
  const data: ActivityData = fixtureActivityData(f, { quiet: !!o.quiet, commands: commandsFixture(f) });
  const h = renderLiving(
    <ActivityDataProvider value={data}>
      <EnergyPage />
    </ActivityDataProvider>,
    { path: o.path ?? '/energy', route: '/energy/:date?' },
  );
  return { ...h, data };
}

afterEach(() => {
  withSystemWrite(() => useSettingsStore.setState({ quietMode: false }));
});

describe('r071: the Energy page', () => {
  it('shows the day curve without daily bars and lists only counted components, with one info panel', async () => {
    setup();
    const card = (await screen.findByRole('heading', { name: W.burned }, { timeout: 8000 })).closest(
      'section',
    )!;
    expect(within(card).getByRole('img', { name: /^Burned so far .* kcal, likely / })).toBeInTheDocument();
    expect(card.querySelectorAll('.lm-hero')).toHaveLength(1);
    expect(within(card).queryByRole('img', { name: /^Energy burned by day/ })).toBeNull();
    expect(card.querySelector('[data-kind="avg"]')).toBeNull();
    expect(within(card).getByRole('img', { name: /^Cumulative energy burned/ })).toBeInTheDocument();
    const components = screen.getByRole('list', { name: 'Energy components' });
    const countedRows = within(components).getAllByRole('listitem');
    expect(countedRows.length).toBeLessThan(7);
    for (const row of countedRows) expect(row.querySelector('.en-components__value')!.textContent).not.toMatch(/^0 kcal$/);
    expect(screen.queryByText(/^Not counted today/)).toBeNull();
    const breakdown = components.closest('section')!;
    expect(within(breakdown).getAllByRole('button', { name: /^About / })).toHaveLength(1);
    expect(within(components).getByText('Everyday movement (NEAT)')).toBeInTheDocument();
    for (const row of within(components).getAllByRole('listitem'))
      expect(row.querySelector('.en-components__range')).toBeNull();
    fireEvent.click(within(breakdown).getByRole('button', { name: 'About What made up the burn' }));
    const componentInfo = await screen.findByRole('dialog');
    const componentTable = within(componentInfo).getByRole('table');
    expect(within(componentTable).getAllByRole('row')).toHaveLength(8);
    expect(componentTable).toHaveTextContent('Likely range');
    fireEvent.click(within(componentInfo).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('heading', { name: W.howKnown })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'About Burned' }));
    const info = await screen.findByRole('dialog', { name: 'Energy' });
    expect(within(info).getByRole('heading', { name: W.measured })).toBeInTheDocument();
    expect(within(info).getByText(/Steps from the ring and phone/)).toBeInTheDocument();
    expect(within(info).getByText(/Food digestion from what you logged/)).toBeInTheDocument();
  });

  it('keeps Today’s canonical total and bedtime forecast exactly', async () => {
    const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
    const data = fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
    let soFar = 0;
    let total = 0;
    const spy: ActivityData = {
      ...data,
      useToday: (d, t) => {
        const v = data.useToday(d, t);
        soFar = v?.model.energy?.soFar ?? 0;
        total = v?.model.energy?.byBedtime ?? 0;
        return v;
      },
    };
    renderLiving(
      <ActivityDataProvider value={spy}>
        <EnergyPage />
      </ActivityDataProvider>,
      { path: '/energy', route: '/energy/:date?' },
    );
    const card = (await screen.findByRole('heading', { name: W.burned }, { timeout: 8000 })).closest(
      'section',
    )!;
    expect(card.querySelector('.lm-hero__live')!.textContent).toBe(energyText(soFar));
    expect(card.querySelector('footer')!.textContent).toContain(`By bedtime ~${energyText(total)} kcal`);
  });

  it('opens activities and retains their booked energy and ranges; the time chart keeps its table in info', async () => {
    setup();
    const chart = (await screen.findByRole('heading', { name: W.throughTheDay }, { timeout: 8000 })).closest(
      'section',
    )!;
    expect(
      within(chart).getByRole('img', { name: /^Energy through the day, estimated:/ }),
    ).toBeInTheDocument();
    expect(within(chart).queryByRole('button', { name: 'Table' })).toBeNull();
    fireEvent.click(within(chart).getByRole('button', { name: 'About Through the day' }));
    const info = await screen.findByRole('dialog', { name: 'Energy' });
    expect(within(info).getByRole('table')).toBeInTheDocument();
    fireEvent.click(within(info).getByRole('button', { name: /close/i }));
    const acts = screen.getByRole('heading', { name: W.activities }).closest('section')!;
    const activity = within(acts).getAllByRole('listitem')[0]!;
    expect(activity).toHaveTextContent(/Brisk walk07:05–07:50 · 45 minDetected, not counted yet/);
    expect(activity).toHaveTextContent(/~\d+ kcal/);
    fireEvent.click(within(acts).getByRole('button', { name: 'About Activities' }));
    const activityInfo = await screen.findByRole('dialog');
    const activityTable = within(activityInfo).getByRole('table');
    expect(activityTable).toHaveTextContent(/Likely range/);
    expect(within(activityTable).getByRole('row', { name: /Brisk walk/ })).toHaveTextContent(/\d+–\d+/);
    fireEvent.click(within(activityInfo).getByRole('button', { name: /close/i }));
    fireEvent.click(within(activity).getByRole('button'));
    expect(await screen.findByRole('dialog', { name: 'Brisk walk' })).toBeInTheDocument();
  });

  it('earlier dates use their whole day and the address keeps the date control selection', async () => {
    const { router } = setup();
    await screen.findByRole('heading', { name: W.burned }, { timeout: 8000 });
    const yesterday = addDays(FIXTURE_TODAY, -1);
    fireEvent.click(screen.getByRole('button', { name: /, choose dates$/ }));
    const cal = await screen.findByRole('dialog', { name: 'Choose dates' });
    fireEvent.click(within(cal).getByRole('button', { name: 'Previous month' }));
    fireEvent.click(
      within(within(cal).getByRole('grid')).getByRole('button', {
        name: new RegExp(`^${fmtDay(yesterday)}`),
      }),
    );
    await waitFor(() => expect(router.state.location.search).toBe(`?date=${yesterday}`));
    const card = (await screen.findByRole('heading', { name: W.burned })).closest('section')!;
    expect(within(card).getByRole('img', { name: /^Burned .* kcal, likely / })).toBeInTheDocument();
    expect(within(card).queryByRole('img', { name: /^Burned so far / })).toBeNull();
  });

  it.each(['week', 'month', 'year', 'range'])(
    'a %s period keeps total as hero, daily bars, average and complete component split',
    async (kind) => {
      const path =
        kind === 'range'
          ? `/energy?period=range&from=${addDays(FIXTURE_TODAY, -2)}&to=${FIXTURE_TODAY}`
          : `/energy?period=${kind}&date=${FIXTURE_TODAY}`;
      setup({ path });
      const card = (await screen.findByRole('heading', { name: W.periodTitle }, { timeout: 8000 })).closest(
        'section',
      )!;
      expect(within(card).getByRole('img', { name: /^Total burned .* kcal$/ })).toBeInTheDocument();
      expect(within(card).getByRole('img', { name: /^Energy burned by day, / })).toBeInTheDocument();
      expect(card.querySelector('[data-kind="avg"]')).toBeInTheDocument();
      expect(card.querySelector('[data-hl="true"]')).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Energy components' })).toHaveTextContent('Resting metabolism');
      expect(screen.getByRole('img', { name: /^Energy components by day, / })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'About What made up the burn' }));
      const info = await screen.findByRole('dialog', { name: 'What made up the burn' });
      for (const k of COMPONENT_ORDER) expect(within(info).getByRole('heading', { name: COMPONENT_LABEL[k] })).toBeInTheDocument();
      expect(within(info).getByText(/Mifflin–St Jeor/)).toHaveTextContent('82.4 kg');
    },
  );

  it('a custom range of one day includes the time-of-day chart', async () => {
    setup({ path: `/energy?period=range&from=${FIXTURE_TODAY}&to=${FIXTURE_TODAY}` });
    expect(
      await screen.findByRole('heading', { name: W.throughTheDay }, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Cumulative energy burned/ })).toBeInTheDocument();
  });

  it('legacy date links and future dates still resolve correctly', async () => {
    const yesterday = addDays(FIXTURE_TODAY, -1);
    const a = setup({ path: `/energy/${yesterday}` });
    await waitFor(() => expect(a.router.state.location.search).toBe(`?date=${yesterday}`));
    a.result.unmount();
    setup({ path: `/energy?date=${addDays(FIXTURE_TODAY, 2)}` });
    expect(await screen.findByRole('img', { name: /^Burned so far .* kcal, likely / })).toBeInTheDocument();
  });

  it('quiet mode contains words only and keeps the activity names', async () => {
    withSystemWrite(() => useSettingsStore.setState({ quietMode: true, quietModeSet: true }));
    setup({ quiet: true });
    const card = (await screen.findByText(W.quiet, {}, { timeout: 8000 })).closest('section')!;
    expect(within(card).getByText('Brisk walk')).toBeInTheDocument();
    expectWordsOnly(card);
    expect(screen.queryByRole('heading', { name: W.burned })).toBeNull();
  });
});
