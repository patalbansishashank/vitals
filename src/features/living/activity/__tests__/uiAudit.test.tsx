/**
 * Regression tests of the UI audit findings fixed in Today and the activity screens (impl-audit/codex-ui.md): one or more
 * per finding, on the harness's day (the real V2/V3 functions) or on the pure models.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/state/settingsStore';
import { energyDay, type EnergyHour } from '@/living/sensors/energyDay';
import { freezeZoneBoundaries, hrProfile } from '@/living/sensors';
import type { ActivityCandidateDoc, ReviewRow } from '@/living/activityCandidates';
import type { TodayView } from '@/living';
import TodayPage from '../../today/TodayPage';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import {
  ActivityDataProvider,
  frozenZonesOf,
  heartPointsView,
  zonesFromSettings,
  type ActivityData,
} from '../data';
import { ActivitySheet } from '../ActivitySheet';
import { EnergyDayChart } from '../EnergyDayChart';
import { StepsSourceChart } from '../StepsSourceChart';
import { HrZoneChart } from '../HrZoneChart';
import { HeartPointsFill } from '../HeartPointsFill';
import { RecordBanner, recordingToShow, resetLocalRecording, workoutFailureWords } from '../RecordBanner';
import type { GaugeCommandView } from '@/state/gaugeCommands';
import { NoticesRegion } from '@/app/shell/notices';
import { addDays } from '@/living/dates';
import { reviewSheetModel } from '@/living/activityCandidates';
import { dayGroups, energyColumns, energySplit, laneTotal, planMatchText, stepsHours } from '../model';
import { intakeFigures } from '../../today/model';
import {
  candidatesFixture,
  commandsFixture,
  dayFixture,
  fixtureActivityData,
  timelineFixture,
  type Scene,
} from '../../today/__screens__/fixtures';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const NOW = Date.parse(`${FIXTURE_TODAY}T13:00:00`);
const H = 3_600_000;
const WALK = 'WALKAM00000000000000000001';

function fixture(scene: Scene = 'pending') {
  const f = dayFixture(FIXTURE_TODAY, NOW, scene);
  return fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
}

function today(scene: Scene = 'pending', data: ActivityData = fixture(scene)) {
  act(() =>
    useSettingsStore
      .getState()
      .set({ todayCards: ['energy', 'steps', 'heart-points', 'activities', 'plan'] }),
  );
  const spy = { edit: vi.spyOn(data, 'edit') };
  const h = renderLiving(
    <ActivityDataProvider value={data}>
      <TodayPage />
    </ActivityDataProvider>,
    { path: '/today', route: 'today' },
  );
  return { ...h, data, spy };
}

/** The activity sheet over the harness's data for one row (its review row as the sheet gets it). */
function sheetFor(data: ActivityData, id: string) {
  function Host() {
    const m = data.useReview(FIXTURE_TODAY, FIXTURE_TODAY);
    const row = [...m.rows, ...m.decided].find((r) => r.id === id) ?? null;
    return (
      <ActivitySheet
        row={row as ReviewRow | null}
        onClose={() => undefined}
        quiet={false}
        planned={[{ itemId: 'cardioSession:14:0', name: 'walk', startH: 7.5 }]}
      />
    );
  }
  return renderLiving(
    <ActivityDataProvider value={data}>
      <Host />
    </ActivityDataProvider>,
  );
}

// the Ring fixtures loop between 00:00 and 04:00: the wall clock is pinned to the harness's noon (time still runs)
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
});
afterAll(() => {
  vi.useRealTimers();
});

afterEach(() => {
  resetLocalRecording();
  act(() => useSettingsStore.getState().set({ energyUnit: 'kcal', todayCards: null }));
});

describe('#1 no weight on record', () => {
  it('reads "Needs weight" with a field to add one, never an estimate or a crash, and holds Save', async () => {
    const data = fixture('noweight');
    sheetFor(data, WALK);
    const sheet = await screen.findByRole('dialog', { name: 'Brisk walk' });
    // unchanged: the stored estimate stands (approving it books that)
    expect(within(sheet).getByText(/^Likely \d+–\d+$/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'End there' }));
    expect(within(sheet).getByText('Needs weight')).toBeInTheDocument();
    expect(within(sheet).queryByText(/^Likely \d+/)).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Add weight' })).toBeDisabled();
    expect(within(sheet).getByRole('spinbutton', { name: /Your weight/ })).toBeInTheDocument();
    const save = within(sheet).getByRole('button', { name: /^Save/ });
    expect(save.hasAttribute('disabled') || save.getAttribute('aria-disabled') === 'true').toBe(true);
  });
});

describe('#3 and #16 Save books what the sheet previews, including what was removed', () => {
  it('keeps the stated speed and grade with a new effort, and clears the plan link and the machine kcal', async () => {
    const data = fixture();
    const seen = (() => {
      let row: ReviewRow | null = null;
      function Probe() {
        row = data.useReview(FIXTURE_TODAY, FIXTURE_TODAY).rows.find((r) => r.id === WALK) ?? null;
        return null;
      }
      render(<Probe />);
      return row!;
    })();
    await data.edit({
      id: WALK,
      revision: seen.revision,
      exerciseId: 'treadmill_incline_walk',
      intensity: { class: 'moderate', speedKmh: 6, gradePct: 5 },
      asItemId: 'cardioSession:14:0',
      kcalOverride: 300,
    });
    const previews: unknown[] = [];
    const real = data.usePreview;
    data.usePreview = (id, draft) => {
      previews.push(draft);
      return real(id, draft);
    };
    const edit = vi.spyOn(data, 'edit');
    sheetFor(data, WALK);
    const sheet = await screen.findByRole('dialog', { name: /Treadmill/ });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Hard' }));
    fireEvent.click(within(sheet).getByRole('switch', { name: /This was my planned walk/ }));
    expect(within(sheet).getByRole('spinbutton', { name: /machine/i })).toHaveValue('300');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove the machine’s number' }));
    expect(within(sheet).getByRole('spinbutton', { name: /machine/i })).toHaveValue('');
    const last = previews.at(-1) as { intensity?: unknown; asItemId?: string; kcalOverride?: number };
    // the preview's decision is the one Save sends: full intensity, no link, no machine kcal
    expect(last.intensity).toEqual({ class: 'vigorous', speedKmh: 6, gradePct: 5 });
    expect(last.asItemId).toBeUndefined();
    expect(last.kcalOverride).toBeUndefined();
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: /^Save/ })));
    const input = edit.mock.calls[0]![0];
    expect(input.intensity).toEqual({ class: 'vigorous', speedKmh: 6, gradePct: 5 });
    expect([...(input.clear ?? [])].sort()).toEqual(['asItemId', 'kcalOverride']);
  });
});

describe('#2 zones of an activity', () => {
  const pending = {
    status: 'pending',
    entryId: null,
    sleepingLowHr: null,
  } as unknown as ActivityCandidateDoc;
  const approved = {
    status: 'approved',
    entryId: 'e1',
    sleepingLowHr: null,
  } as unknown as ActivityCandidateDoc;
  it('an approved one shows the boundaries frozen into its session entry, whatever the settings say now', () => {
    const frozen = freezeZoneBoundaries(hrProfile({ ageY: 38 }))!;
    expect(frozenZonesOf(approved, { kind: 'session', zones: frozen })).toBe(frozen);
    expect(frozenZonesOf(pending, { kind: 'session', zones: frozen })).toBeNull();
  });
  it('a pending one uses the current heart settings (a waking resting HR switches to the heart-rate reserve)', () => {
    const byAge = zonesFromSettings(38, null, null)!;
    const withRest = zonesFromSettings(
      38,
      { hrMaxOverride: null, hrRestOverride: 52, useSleepLowAsRest: false },
      null,
    )!;
    expect(byAge.basis).toBe('pctMax');
    expect(withRest.basis).toBe('hrr');
    expect(withRest.edgesBpm[0]).toBeGreaterThan(byAge.edgesBpm[0]);
    expect(
      zonesFromSettings(38, { hrMaxOverride: 200, hrRestOverride: null, useSleepLowAsRest: false }, null)!
        .edgesBpm[5],
    ).toBe(200);
  });
});

describe('#4 the energy chart draws the engine allocation', () => {
  it('keeps a bout’s exercise energy on the bout’s minutes (never re-split by state minutes)', () => {
    const start = Date.parse(`${FIXTURE_TODAY}T04:00:00`);
    const hours: EnergyHour[] = Array.from({ length: 24 }, (_, j) => ({
      start: start + j * H,
      rmr: 74,
      tef: 0,
      neat: 20,
      stepsEnergy: 0,
      exerciseEnergy: j === 5 ? 141 : 0,
      tdee: 74 + 20 + (j === 5 ? 141 : 0),
    }));
    const minutes = Array.from({ length: 24 * 60 }, () => ({
      sleep: 'none' as const,
      steps: 0,
      support: 'minute' as const,
    }));
    const bout = {
      id: 'b',
      window: { start: start + 5 * H, end: start + 5 * H + 20 * 60_000 },
      incrementalKcalPerMin: 7.05,
      envelope: null,
    };
    const day = energyDay({ hours, minutes, bouts: [bout] });
    const split = energySplit(energyColumns(day, start + 24 * H));
    expect(split.byState.exercise.kcal).toBeCloseTo(day.byState.exercise.kcal, 6);
    expect(split.byState.exercise.kcal).toBeGreaterThan(141);
    expect(split.byState.exercise.minutes).toBe(20);
  });
});

describe('#5 Heart Points from the shared day calculation', () => {
  it('keeps unknown days unknown and sums the known ones', () => {
    expect(heartPointsView(null, FIXTURE_TODAY)).toBeNull();
    expect(
      heartPointsView(
        [
          { date: '2026-10-26', heartPoints: null },
          { date: FIXTURE_TODAY, heartPoints: null },
        ],
        FIXTURE_TODAY,
      ),
    ).toEqual({ today: null, week: null });
    expect(
      heartPointsView(
        [
          { date: '2026-10-26', heartPoints: 34 },
          { date: FIXTURE_TODAY, heartPoints: 6.4 },
        ],
        FIXTURE_TODAY,
      ),
    ).toEqual({ today: 6.4, week: 40.4 });
  });
  it('reads "No readings" for a day without coverage, never 0', () => {
    render(<HeartPointsFill week={null} today={null} />);
    // (r068 V22) one line with the goal, no empty meter repeating it
    expect(screen.getByText(/^No readings today · goal 150 this week$/)).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText(/^0 today/)).toBeNull();
  });
  it('counts a covered brisk walk before it is approved (cadence minutes earn points on their own)', async () => {
    today('pending');
    const hp = await screen.findByRole('region', { name: 'Heart Points' });
    await waitFor(() => expect(hp).toHaveTextContent(/(?<!\d)([1-9]\d*) today/));
  });
  it('a no-device day shows no points as unknown', async () => {
    today('nodevice');
    expect(await screen.findByRole('region', { name: 'Heart Points' })).toHaveTextContent('No readings');
  });
});

describe('#6 and #13 steps by source', () => {
  const t = (phone: (number | null)[]) => ({
    date: FIXTURE_TODAY,
    start: `${FIXTURE_TODAY}T00:00:00.000Z`,
    minutes: 120,
    steps: {
      selected: Array(120).fill(40),
      source: Array(120).fill('ring'),
      ring: Array(120).fill(40),
      phone,
      support: Array(120).fill('minute'),
    },
  });
  it('a phone that gave no reading reads "No reading", in the lane and in words', () => {
    const hours = stepsHours(t(Array(120).fill(null)));
    expect(laneTotal(hours, 'phone')).toBeNull();
    render(<StepsSourceChart hours={hours} located={4800} />);
    expect(screen.getByRole('img', { name: /phone no reading/ })).toBeInTheDocument();
    expect(screen.getByText('No reading')).toBeInTheDocument();
  });
  it('has a table twin of the three lanes, hour by hour', () => {
    const hours = stepsHours(t(Array(120).fill(null)));
    render(<StepsSourceChart hours={hours} located={4800} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('region', { name: 'Steps by source table' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(/2,400—2,400/);
  });
});

describe('#13 and #22 the energy chart', () => {
  function chart() {
    const data = fixture();
    let view: ReturnType<ActivityData['useToday']> = null;
    function Probe() {
      view = data.useToday(FIXTURE_TODAY, true);
      return null;
    }
    render(<Probe />);
    return view!;
  }
  it('says the Active view in its own words', () => {
    const v = chart();
    render(<EnergyDayChart day={v.day!} nowMs={NOW} soFar={v.model.energy!.soFar} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Active' }));
    const img = screen.getByRole('img', {
      name: /^Active energy through the day, movement above your own rest, estimated: /,
    });
    expect(img.getAttribute('aria-label')).not.toMatch(/food digestion/);
  });
  it('has a table twin of every 15 min with its states', () => {
    const v = chart();
    render(<EnergyDayChart day={v.day!} nowMs={NOW} soFar={v.model.energy!.soFar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('region', { name: 'Energy through the day table' });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 96);
    expect(within(table).getAllByText('plan').length).toBeGreaterThan(0);
  });
});

describe('#7 unknown intake is not zero', () => {
  const view = (o: { kcal: number; protein: number; coverage?: TodayView['coverage']; meals?: number }) =>
    ({
      logged: {
        entries: Array.from({ length: o.meals ?? 0 }, () => ({ kind: 'meal' })),
        totals: { energyKcal: { value: o.kcal, sd: 0 }, proteinG: { value: o.protein, sd: 0 } },
      },
      coverage: o.coverage,
    }) as unknown as TodayView;
  it('nothing logged yet: no zero eaten', () => {
    expect(
      intakeFigures(
        view({
          kcal: 0,
          protein: 0,
          coverage: { energy: 'unknown', protein: 'unknown' } as TodayView['coverage'],
        }),
      ),
    ).toEqual({
      eaten: { kind: 'unknown', why: 'nothingLogged' },
      protein: { kind: 'unknown', why: 'nothingLogged' },
    });
  });
  it('an energy-only meal: protein unknown, not 0 g', () => {
    expect(
      intakeFigures(
        view({
          kcal: 450,
          protein: 0,
          meals: 1,
          coverage: { energy: 'partial', protein: 'partial' } as TodayView['coverage'],
        }),
      ).protein,
    ).toEqual({ kind: 'unknown', why: 'notInFood' });
  });
  it('every meal energy known, some protein not: a lower bound; a confirmed zero stays 0', () => {
    expect(
      intakeFigures(
        view({
          kcal: 900,
          protein: 30,
          meals: 2,
          coverage: { energy: 'complete', protein: 'partial' } as TodayView['coverage'],
        }),
      ).protein,
    ).toEqual({ kind: 'atLeast', value: 30 });
    expect(
      intakeFigures(
        view({
          kcal: 0,
          protein: 0,
          coverage: { energy: 'confirmedZero', protein: 'confirmedZero' } as TodayView['coverage'],
        }),
      ),
    ).toEqual({ eaten: { kind: 'value', value: 0 }, protein: { kind: 'value', value: 0 } });
  });
});

describe('#20 a recording Gauge reports idle', () => {
  const mine = {
    sessionId: 's1',
    status: 'recording' as const,
    type: 'walk',
    startedAt: '2026-10-27T07:00:00.000Z',
    learnedAt: Date.parse('2026-10-27T07:00:05.000Z'),
  };
  it('keeps this device’s copy until Gauge polls after it, then clears it', () => {
    expect(recordingToShow(null, null, mine).rec).toBe(mine);
    expect(recordingToShow(null, '2026-10-27T07:00:06.000Z', mine).rec).toBe(mine);
    expect(recordingToShow(null, '2026-10-27T07:20:00.000Z', mine)).toEqual({ rec: null, staleLocal: true });
  });
  it('Gauge’s own report wins', () => {
    const reported = {
      sessionId: 's2',
      status: 'recording' as const,
      type: 'run',
      startedAt: '2026-10-27T07:10:00.000Z',
    };
    expect(recordingToShow(reported, '2026-10-27T07:20:00.000Z', mine).rec).toMatchObject({
      sessionId: 's2',
    });
  });
});

describe('#21 and #24 the energy figures', () => {
  it('gives the Plan its own scenario range', async () => {
    today('pending');
    const energy = await screen.findByRole('region', { name: 'Energy' });
    fireEvent.click(within(energy).getByRole('button', { name: 'About Energy' }));
    const info = await screen.findByRole('dialog', { name: 'Energy' });
    const table = within(info).getByRole('region', { name: 'Energy figures table' });
    const plan = within(table).getByRole('row', { name: /Planned burn/ });
    expect(within(plan).getAllByRole('cell')[0]).toHaveTextContent(/^\d[\d,]*$/);
    expect(within(plan).getAllByRole('cell')[1]).toHaveTextContent(/^\d[\d,]*–\d[\d,]*$/);
  });
  it('follows the kJ preference', async () => {
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    today('pending');
    const energy = await screen.findByRole('region', { name: 'Energy' });
    expect(energy).toHaveTextContent(/\d[\d,]*kJLikely \d[\d,]*–\d[\d,]*/);
    expect(energy.textContent).not.toMatch(/kcal/);
    expect(screen.getByRole('region', { name: 'Today’s activities' }).textContent).toMatch(/~\d[\d,]*kJ/);
  });
});

describe('#23 time above the configured maximum', () => {
  it('is its own row, so the rows add up', () => {
    const first = Date.parse(`${FIXTURE_TODAY}T07:00:00`);
    const n = 30;
    const minutes = {
      first,
      steps: Array(n).fill(120),
      hr: { bpm: Array(n).fill(190), supportedS: Array(n).fill(60) },
    };
    const b = zonesFromSettings(
      38,
      { hrMaxOverride: 180, hrRestOverride: null, useSleepLowAsRest: false },
      null,
    );
    render(
      <HrZoneChart window={{ start: first, end: first + n * 60_000 }} minutes={minutes} boundaries={b} />,
    );
    expect(screen.getAllByText(/Above your maximum · over 180 bpm/).length).toBeGreaterThan(0);
  });
});

describe('Claude P2-7 the sleep page from Today', () => {
  it('the sleep row keeps logging controls without a duplicate details link', async () => {
    today('pending');
    fireEvent.click(await screen.findByRole('button', { name: /^Any time/ }));
    expect(await screen.findByRole('button', { name: /^Details for sleep/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sleep details' })).toBeNull();
  });
});

describe('Claude P2-3 workout failures in words', () => {
  it('an expired or refused workout command says why, not "Gauge couldn’t do it"', () => {
    expect(
      workoutFailureWords({
        id: 'c',
        type: 'workout.stop',
        state: 'expired',
        via: 'server',
      } as GaugeCommandView),
    ).toMatch(/didn’t answer/);
    expect(
      workoutFailureWords({
        id: 'c',
        type: 'workout.start',
        state: 'rejected',
        code: 'ring_disconnected',
        via: 'server',
      } as GaugeCommandView),
    ).toMatch(/ring isn’t connected/);
  });
});

describe('#27 day groups are headings', () => {
  it('Morning, Afternoon and Evening are real headings with their counts in the name', async () => {
    today('pending');
    const h = await screen.findAllByRole('heading', {
      level: 3,
      name: /^(Morning|Afternoon|Evening).*\d+ \/ \d+/,
    });
    expect(h.length).toBeGreaterThan(0);
    expect(within(h[0]!).getByRole('button')).toHaveAttribute('aria-expanded');
  });
});

// ------------------------------------------------------------------------------------------- the second (Claude) review
// (r070) the review sheet (held rows, "Both happened", other days) is gone: activities are counted automatically

describe('Claude P2-4 a recording key waiting on Gauge says so', () => {
  it('shows "Waiting for the phone" while Stop is pending', async () => {
    const f = dayFixture(FIXTURE_TODAY, NOW, 'recording');
    const data = fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
    render(
      <ActivityDataProvider value={data}>
        <NoticesRegion />
        <RecordBanner />
      </ActivityDataProvider>,
    );
    const banner = await screen.findByRole('region', { name: 'Notices' });
    await waitFor(() => expect(banner).toHaveTextContent(/Recording walk/));
    act(() => void fireEvent.click(within(banner).getByRole('button', { name: 'Stop' })));
    await waitFor(() =>
      expect(banner.querySelector('.lv-rec__wait')).toHaveTextContent(/Waiting for the phone|checked in/),
    );
  });
});

describe('Claude P2-14 and P2-16 steps on Today', () => {
  it('unknown steps read "No step data yet", never "No steps"', async () => {
    today('nodevice');
    const steps = await screen.findByRole('region', { name: 'Steps' });
    expect(steps).toHaveTextContent('No step data yet');
    expect(steps.textContent).not.toMatch(/No steps yet/);
  });
});

describe('Claude P2-17 day groups', () => {
  it('a skipped stop is answered, not done; a part folds on answers', () => {
    const rows = [
      { at: 7, s: 'skipped' },
      { at: 8, s: 'done' },
    ];
    const g = dayGroups(
      rows,
      (r) => r.s === 'done',
      13,
      (r) => r.s !== 'empty',
    )[0]!;
    expect(g.countText).toBe('1 of 2 done');
    expect(g.answered).toBe(2);
  });
  it('untimed stops have their own "Any time" heading', async () => {
    today('pending');
    expect(
      await screen.findByRole('heading', { level: 3, name: /^Any time\s*\d+ \/ \d+$/ }),
    ).toBeInTheDocument();
  });
});

describe('Claude P2-18 review minutes', () => {
  it('are the moving minutes of the window, pauses left out', () => {
    const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
    const c = candidatesFixture(f, timelineFixture(f)).find((r) => r.key === WALK)!;
    const paused = {
      ...c,
      pauses: [{ start: c.window.start + 10 * 60_000, end: c.window.start + 25 * 60_000 }],
    };
    expect(reviewSheetModel([paused], { from: FIXTURE_TODAY, to: FIXTURE_TODAY }).rows[0]!.minutes).toBe(30);
  });
});

describe('Claude P2-19 and P2-20 charts', () => {
  it('Today’s 24 h strip has its table in the info panel', async () => {
    today('pending');
    const strip = await screen.findByRole('img', { name: /^The planned day/ });
    expect(strip).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About Today' }));
    expect(await screen.findByRole('table', { name: 'Planned day' })).toBeInTheDocument();
  });
  it('draws the disagreement dot as a round mark, not a stretched circle', () => {
    const t = {
      date: FIXTURE_TODAY,
      start: `${FIXTURE_TODAY}T00:00:00.000Z`,
      minutes: 60,
      steps: {
        selected: Array(60).fill(50),
        source: Array(60).fill('ring'),
        ring: Array(60).fill(50),
        phone: Array(60).fill(20),
        support: Array(60).fill('minute'),
      },
    };
    const { container } = render(<StepsSourceChart hours={stepsHours(t)} located={3000} />);
    expect(container.querySelector('circle.lv-schart__dot')).toBeNull();
    expect(container.querySelectorAll('span.lv-schart__dot')).toHaveLength(1);
  });
});

describe('Claude P3-8 the plan-match hint', () => {
  it('never reads 07:60', () => {
    expect(
      planMatchText(
        { planMatch: { itemId: 'x', slotKey: 'x', startH: 7.999, deltaH: 0, sameFamily: true } },
        'walk',
      ),
    ).toBe('Looks like your planned walk at 08:00');
  });
});

describe('(0.6.5) a counted activity can be removed from its sheet', () => {
  it('Remove asks first, then rejects it (its session leaves the day); a pending row has no Remove', () => {
    const data = fixture('overplan');
    function Probe() {
      const r = data.useReview(addDays(FIXTURE_TODAY, -6), FIXTURE_TODAY);
      return (
        <p data-testid="ids">
          {JSON.stringify({
            decided: r.decided
              .filter((x) => x.status === 'approved' || x.status === 'edited')
              .map((x) => x.id),
            pending: r.rows.map((x) => x.id),
          })}
        </p>
      );
    }
    const probe = renderLiving(
      <ActivityDataProvider value={data}>
        <Probe />
      </ActivityDataProvider>,
    );
    const ids = JSON.parse(screen.getByTestId('ids').textContent!) as {
      decided: string[];
      pending: string[];
    };
    probe.result.unmount();
    expect(ids.decided.length).toBeGreaterThan(0);
    const reject = vi.spyOn(data, 'reject');
    const counted = sheetFor(data, ids.decided[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this activity' }));
    expect(screen.getByText('Remove it? It stops counting toward your day.')).toBeInTheDocument();
    expect(reject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(reject).toHaveBeenCalledWith(ids.decided[0]);
    counted.result.unmount();
    if (ids.pending[0]) {
      const pending = sheetFor(data, ids.pending[0]);
      expect(screen.queryByRole('button', { name: 'Remove this activity' })).toBeNull();
      pending.result.unmount();
    }
  });
});
