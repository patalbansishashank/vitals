// Package V4e (energy SPEC §V4.6, A.3.7): the Progress activity cards — weekly Heart Points against 150 and 300, the
// engine's WHO moderate-equivalent minutes, energy out against intake, fused steps, sleeping low HR and HRV — and their
// states: absent without data (unknown is never zero), quiet mode, table twins and the text alternatives.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ProgressPage from '../ProgressPage';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { setProgressActuals, type ProgressDayActual } from '../v3Adapter';
import { setProgressGauge, type ProgressGauge } from '../data/gauge';
import {
  cardioStimulus,
  demoActualsAdapter,
  demoBaselines,
  demoGauge,
  demoStepDays,
  demoSleep,
} from '../__fixtures__/activity';
import {
  energyBalance,
  energyRows,
  nightRows,
  pointsStanding,
  pointsWeeks,
  recentMedian,
  stepsRows,
  trailingMean,
  usualBands,
  usualWord,
  weekOf,
  weekStarts,
  whoWeek,
} from '../activityModel';
import { goalProgress } from '../model';
import { laneDomain, thinLabels } from '../components/LaneChart';
import { resetHeartSettings, updateHeartSettings } from '@/features/settings/heart/v3Adapter';
import { useSettingsStore } from '@/state/settingsStore';

const offline: ProgressGauge = {
  steps: async () => null,
  sleep: async () => null,
  baselines: async () => null,
};

const day = (date: string, o: Partial<ProgressDayActual> = {}): ProgressDayActual => ({
  date,
  heartPoints: null,
  sessionStimuli: [],
  energyOut: null,
  intakeKcal: null,
  ...o,
});

afterEach(() => {
  cleanup();
  setProgressActuals(null);
  setProgressGauge(null);
  resetHeartSettings();
  act(() => useSettingsStore.getState().set({ weekStart: 'monday', energyUnit: 'kcal' }));
});

describe('activity model', () => {
  it('groups weeks by the week start setting', () => {
    // 2026-10-01 is a Thursday
    expect(weekOf('2026-10-01', 'monday')).toBe('2026-09-28');
    expect(weekOf('2026-10-01', 'sunday')).toBe('2026-09-27');
    expect(weekOf('2026-09-27', 'sunday')).toBe('2026-09-27');
    expect(weekStarts('2026-10-01', 3, 'monday')).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
  });

  it('sums Heart Points by week; a week with no covered day is null, never 0; the current week counts its elapsed days', () => {
    const a = [
      day('2026-09-21', { heartPoints: 40 }),
      day('2026-09-23', { heartPoints: 22.5 }),
      day('2026-09-29', { heartPoints: 0 }),
      day('2026-09-30', { heartPoints: 31 }),
    ];
    const w = pointsWeeks(a, '2026-10-01', 'monday', 3);
    expect(w.map((x) => x.points)).toEqual([null, 62.5, 31]);
    expect(w[2]).toMatchObject({ current: true, daysElapsed: 4, daysWithData: 2 });
    expect(w[1]).toMatchObject({ current: false, daysElapsed: 7 });
    expect([null, 149.9, 150, 299, 300].map((x) => pointsStanding(x))).toEqual([
      'unknown',
      'under',
      'goal',
      'goal',
      'upper',
    ]);
  });

  it('WHO minutes come from the engine (M + 2V); unclassified minutes make a range, not a guess', () => {
    const known = whoWeek(
      [
        day('2026-09-29', { sessionStimuli: [cardioStimulus(40, 30)] }),
        day('2026-09-30', { sessionStimuli: [cardioStimulus(30, 20)] }),
      ],
      '2026-09-28',
      '2026-10-04',
    );
    expect(known.minutes).toBeCloseTo(40 + 30 + 2 * (30 + 20), 6);
    expect(known.reference).toBe('met');
    const unknown = whoWeek(
      [day('2026-09-29', { sessionStimuli: [cardioStimulus(40, 0, 30)] })],
      '2026-09-28',
      '2026-10-04',
    );
    expect(unknown.minutes).toBeNull();
    expect(unknown.range[0]).toBeCloseTo(40, 6);
    expect(unknown.range[1]).toBeGreaterThan(unknown.range[0]);
    expect(whoWeek([], '2026-09-28', '2026-10-04').sessions).toBe(0);
  });

  it('WHO minutes: a week with no logged session is unknown, not 0 min; sessions count without any ring data', () => {
    const none = whoWeek([day('2026-09-29')], '2026-09-28', '2026-10-04');
    expect(none).toMatchObject({ minutes: null, sessions: 0 });
    const logged = whoWeek(
      [day('2026-09-29', { heartPoints: null, sessionStimuli: [cardioStimulus(40, 0)] })],
      '2026-09-28',
      '2026-10-04',
    );
    expect(logged).toMatchObject({ minutes: 40, sessions: 1 });
  });

  it('"under 150" is not claimed from a week with days that have no data', () => {
    expect(pointsStanding(40, { daysWithData: 1, daysElapsed: 7 })).toBe('partial');
    expect(pointsStanding(40, { daysWithData: 7, daysElapsed: 7 })).toBe('under');
    expect(pointsStanding(160, { daysWithData: 1, daysElapsed: 7 })).toBe('goal');
  });

  it('steps: a day with no placed minute and no placed steps is a gap under "located" (the ring total is not placed), and under "at least" only a headline above 0 draws', () => {
    const cov = (eitherMin: number) => ({ ringMin: 0, phoneMin: 0, eitherMin, unknownMin: 1440 - eitherMin });
    const days = [
      {
        date: '2026-09-29',
        located: 0,
        ringDailyTotal: 4200,
        ringResidual: 4200,
        phoneDailyTotal: null,
        headline: 4200,
        headlinePolicy: 'atLeast' as const,
        coverage: cov(0),
      },
      {
        date: '2026-09-30',
        located: 0,
        ringDailyTotal: 0,
        ringResidual: 0,
        phoneDailyTotal: null,
        headline: 0,
        headlinePolicy: 'atLeast' as const,
        coverage: cov(0),
      },
      {
        date: '2026-10-01',
        located: 0,
        ringDailyTotal: 0,
        ringResidual: 0,
        phoneDailyTotal: 0,
        headline: 0,
        headlinePolicy: 'atLeast' as const,
        coverage: cov(600),
      },
    ];
    expect(stepsRows(days, '2026-09-29', '2026-10-01', 'located').map((r) => r.steps)).toEqual([
      null,
      null,
      0,
    ]);
    expect(stepsRows(days, '2026-09-29', '2026-10-01', 'atLeast').map((r) => r.steps)).toEqual([
      4200,
      null,
      0,
    ]);
  });

  it('energy balance uses only days that carry both numbers, and needs three', () => {
    const env = (k: number) => ({ kcal: k, envelope: { lo: k - 300, hi: k + 300 } });
    const rows = energyRows(
      [
        day('2026-09-28', { energyOut: env(2500), intakeKcal: 2000 }),
        day('2026-09-29', { energyOut: env(2600) }),
        day('2026-09-30', { energyOut: env(2400), intakeKcal: 2200 }),
      ],
      '2026-09-28',
      '2026-09-30',
    );
    expect(rows[1]).toMatchObject({ out: 2600, intake: null });
    expect(energyBalance(rows)).toBeNull();
    const more = energyRows(
      [
        day('2026-09-27', { energyOut: env(2500), intakeKcal: 2100 }),
        day('2026-09-28', { energyOut: env(2500), intakeKcal: 2000 }),
        day('2026-09-30', { energyOut: env(2400), intakeKcal: 2200 }),
      ],
      '2026-09-27',
      '2026-09-30',
    );
    const b = energyBalance(more)!;
    expect(b.days).toBe(3);
    expect(b.intakeMean).toBeCloseTo(2100, 6);
    expect(b.balanceLo).toBeCloseTo(2100 - (2466.667 + 300), 2);
  });

  it('steps: the headline policy (D3), "at least" days marked, a day without coverage is a gap, a 7-day mean needs 4 days', () => {
    const days = demoStepDays('2026-10-01', 28);
    const atLeast = stepsRows(days, '2026-09-04', '2026-10-01', 'atLeast');
    const located = stepsRows(days, '2026-09-04', '2026-10-01', 'located');
    const gap = atLeast.find((r) => r.steps === null)!;
    expect(gap).toBeDefined();
    expect(days.find((d) => d.date === gap.date)!.coverage.eitherMin).toBe(0);
    const marked = atLeast.filter((r) => r.atLeast);
    expect(marked.length).toBeGreaterThan(0);
    for (const r of marked) expect(r.steps).toBeGreaterThan(located.find((x) => x.date === r.date)!.steps!);
    expect(located.some((r) => r.atLeast)).toBe(false);
    expect(atLeast[2]!.mean7).toBeNull();
    expect(trailingMean([1, null, 3, 5, 7])).toBe(4);
  });

  it('nights: the main session per waking date; the usual words and bands follow A.1.2', () => {
    const s = demoSleep('2026-09-04', '2026-10-01');
    const rows = nightRows(s.sessions, '2026-09-04', '2026-10-01');
    expect(rows).toHaveLength(28);
    expect(rows.some((r) => r.lowHr === null)).toBe(true);
    const bands = usualBands(demoBaselines('2026-10-01'));
    expect(bands.lowHr).toMatchObject({ median: 53, lo: 50, hi: 56 });
    expect(bands.hrv!.lo).toBeCloseTo(41.4, 6); // max(3 ms, 10 % of 46)
    expect([49, 53, 57].map((v) => usualWord(v, bands.lowHr))).toEqual([
      'Below usual',
      'Near usual',
      'Above usual',
    ]);
    expect(
      usualBands(demoBaselines('2026-10-01', { sleepLowHr: { median: 53, s: 3, n: 5, spanDays: 6 } })).lowHr,
    ).toBeNull();
    expect(
      recentMedian(
        rows.map((r) => ({ ...r, lowHr: null })),
        'lowHr',
      ),
    ).toBeNull();
  });

  it('the weight strip measures progress toward the goal in its direction, never negative', () => {
    expect(goalProgress({ first: 90, now: 88 }, 84)).toEqual({ done: 2, total: 6, change: -2, target: -6 });
    expect(goalProgress({ first: 90, now: 91 }, 84)!.done).toBe(0);
    expect(goalProgress({ first: 70, now: 71 }, 74)!.done).toBe(1);
    expect(goalProgress({ first: 90, now: 88 }, null)).toBeNull();
  });

  it('lanes: bars start at zero and clear the reference lines; colliding labels thin out from the end', () => {
    expect(
      laneDomain(
        [{ id: 'p', kind: 'bars', values: [120, 210], hue: 'x' }],
        [{ value: 300, label: '300', kind: 'ref' }],
      ),
    ).toEqual([0, 400]);
    expect(thinLabels(['10 Aug', '17 Aug', '24 Aug', '31 Aug'], 30)).toEqual([
      null,
      '17 Aug',
      null,
      '31 Aug',
    ]);
    expect(thinLabels(['10 Aug', null, '24 Aug'], 60)).toEqual(['10 Aug', null, '24 Aug']);
  });
});

describe('Progress activity cards', () => {
  beforeEach(() => {
    setProgressActuals(demoActualsAdapter(FIXTURE_TODAY));
    setProgressGauge(demoGauge());
  });

  it('are absent while the living plan has no realised history and the server has no data (no zeros drawn)', async () => {
    setProgressActuals(null);
    setProgressGauge(offline);
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await screen.findByRole('heading', { level: 2, name: 'Adherence' });
    await act(async () => undefined);
    for (const name of ['Heart Points', 'Energy out and intake', 'Steps', 'Overnight'])
      expect(screen.queryByRole('heading', { level: 2, name })).toBeNull();
  });

  it('Heart Points keeps Fit points and WHO minutes distinct, with a partial current week', async () => {
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const card = (await screen.findByRole('heading', { level: 2, name: 'Heart Points' })).closest('section')!;
    expect(card.textContent).toMatch(/day 4 of 7 · Fit-compatible estimate/);
    expect(card.textContent).toMatch(/WHO min/);
    expect(card.querySelectorAll('.lv-lane__bar')).toHaveLength(8);
    expect(card.querySelectorAll('.lv-lane__bar[data-outline]')).toHaveLength(1);
    expect(card.querySelectorAll('.lv-lane__ref')).toHaveLength(1);
    expect(Array.from(card.querySelectorAll('.lmc-lv-tick')).map((n) => n.textContent)).toContain('150');
    await userEvent.click(within(card).getByRole('button', { name: 'About Heart Points' }));
    const panel = await screen.findByRole('dialog', { name: 'Heart Points' });
    expect(panel.textContent).toMatch(/WHO/);
    expect(panel.textContent).toMatch(/300/);
    expect(within(panel).getByRole('region', { name: 'Heart Points table' })).toBeInTheDocument();
  });

  it('WHO minutes remain without ring points; missing sessions remain unknown', async () => {
    setProgressActuals({
      progressActuals: (from, to) =>
        demoActualsAdapter(FIXTURE_TODAY)
          .progressActuals(from, to)
          ?.map((a) => ({ ...a, heartPoints: null })) ?? null,
    });
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const card = (await screen.findByRole('heading', { name: 'Heart Points' })).closest('section')!;
    expect(card.textContent).toMatch(/WHO min/);
    expect(card.querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/no data/i);
    cleanup();
    setProgressActuals({
      progressActuals: (from, to) =>
        demoActualsAdapter(FIXTURE_TODAY)
          .progressActuals(from, to)
          ?.map((a) => ({ ...a, sessionStimuli: [] })) ?? null,
    });
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const none = (await screen.findByRole('heading', { name: 'Heart Points' })).closest('section')!;
    expect(none.textContent).toMatch(/WHO min —/);
    expect(none.textContent).not.toMatch(/WHO min 0/);
  });

  it('steps: the fusion is asked with the D1 preference and sole-gait rule', async () => {
    const bodies: unknown[] = [];
    setProgressGauge({
      ...demoGauge(),
      stepsFuse: async (body) => {
        bodies.push(body);
        return demoGauge().steps(body.from, body.to);
      },
    });
    await act(() => updateHeartSettings({ stepsPreference: ['phone', 'ring'], soleSustainedGait: false }));
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    await screen.findByRole('heading', { level: 2, name: 'Steps' });
    expect(bodies[0]).toMatchObject({
      preference: { stepsPreference: ['phone', 'ring'], soleSustainedGait: false },
    });
  });

  it('table twins open from the information key and T, with the current window and CSV', async () => {
    const user = userEvent.setup();
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const card = (await screen.findByRole('heading', { name: 'Steps' })).closest('section')!;
    expect(within(card).queryByRole('button', { name: 'Table' })).toBeNull();
    fireEvent.keyDown(card.querySelector('[data-scrub]')!, { key: 't' });
    const panel = await screen.findByRole('dialog', { name: 'Steps' });
    const region = within(panel).getByRole('region', { name: 'Steps table' });
    expect(within(region).getAllByRole('row')).toHaveLength(29);
    expect(within(panel).getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    await user.click(within(card).getByRole('button', { name: 'About Steps' }));
    expect(await screen.findByRole('dialog', { name: 'Steps' })).toBeInTheDocument();
  });

  it('steps preserves the goal, at-least outlines and a keyboard-scrubbed hero', async () => {
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const card = (await screen.findByRole('heading', { name: 'Steps' })).closest('section')!;
    expect(card.querySelector('.lv-lane__ref')).toHaveAttribute('data-kind', 'goal');
    expect(card.querySelector('.lv-lane__ref')?.textContent).toMatch(/9,000/);
    expect(card.querySelectorAll('.lv-lane__bar[data-outline]').length).toBeGreaterThan(0);
    const plot = card.querySelector('[data-scrub]')!;
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(card.querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/Sep/);
    fireEvent.keyDown(plot, { key: 'End' });
    expect(card.querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/Oct/);
    cleanup();
    await act(() => updateHeartSettings({ stepsHeadline: 'located' }));
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const again = (await screen.findByRole('heading', { name: 'Steps' })).closest('section')!;
    expect(again.querySelectorAll('.lv-lane__bar[data-outline]')).toHaveLength(0);
  });

  it('overnight has a separate heart and HRV card, personal ranges and a forming-baseline state', async () => {
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const hr = (await screen.findByRole('heading', { name: 'Sleeping low HR' })).closest('section')!;
    const hrv = (await screen.findByRole('heading', { name: 'HRV' })).closest('section')!;
    expect(hr).toHaveAttribute('data-domain', 'heart');
    expect(hrv).toHaveAttribute('data-domain', 'recovery');
    for (const card of [hr, hrv]) {
      expect(card.querySelectorAll('.lm-hero')).toHaveLength(1);
      expect(card.querySelector('.lv-lane__usual')).toBeInTheDocument();
      expect(card.textContent).toMatch(/(Near|Below|Above) usual/);
    }
    cleanup();
    setProgressGauge(demoGauge({ baselines: { learning: { nights: 3, needed: 7, learning: true } } }));
    renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const learning = (await screen.findByRole('heading', { name: 'HRV' })).closest('section')!;
    expect(learning.textContent).toMatch(/Calibrating · night 3 of 7/);
    expect(learning.querySelector('.lv-lane__usual')).toBeNull();
  });

  it('energy uses the selected unit and quiet mode hides every reading across activity cards', async () => {
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    const { stub } = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const card = (await screen.findByRole('heading', { name: 'Energy out and intake' })).closest('section')!;
    expect(card.textContent).toMatch(/kJ\/day/);
    expect(card.textContent).not.toMatch(/kcal/);
    expect(card.textContent).toMatch(/Intake − burn · \d+ complete days/);
    await act(() => stub.actions.setQuietMode(true));
    for (const name of ['Energy out and intake', 'Steps', 'Heart Points', 'Sleeping low HR', 'HRV']) {
      const quiet = (await screen.findByRole('heading', { name })).closest('section')!;
      expect(quiet.querySelector('.lm-hero')?.textContent).not.toMatch(/\d/);
      expect(quiet.textContent).not.toMatch(/kcal|kJ|bpm|\bms\b|WHO min \d/);
      expect(quiet.querySelectorAll('.lv-lane .lmc-lv-tick')).toHaveLength(
        quiet.querySelectorAll('.lv-lane svg > text').length,
      );
      await userEvent.click(within(quiet).getByRole('button', { name: `About ${name}` }));
      const panel = await screen.findByRole('dialog');
      expect(panel.textContent).not.toMatch(/\d/);
      expect(within(panel).queryByRole('table')).toBeNull();
      await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    }
  });

  it('the Goal hero owns distance to goal; Weight has only the trend', async () => {
    const { result } = renderLiving(<ProgressPage />, { path: '/progress', route: 'progress' });
    const weight = (await screen.findByRole('heading', { name: 'Weight' })).closest('section')!;
    const goal = (await screen.findByRole('heading', { name: 'Goal' })).closest('section')!;
    expect(weight.querySelector('[role="meter"]')).toBeNull();
    expect(goal.querySelector('.lmz-track')).toBeInTheDocument();
    expect(result.container.querySelector('.lmv-tickstrip')).toBeNull();
  });
});
