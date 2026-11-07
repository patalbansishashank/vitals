/**
 * r069 D3: "For the number of steps it says 'Updated …', but the details graph isn't good enough. If I add a treadmill
 * workout manually, it doesn't show me the steps at that point in time; in the auto-detect review it was showing them."
 *
 * A reproduction of the owner's day (2026-10-29, originally Asia/Kolkata): a treadmill walk 14:08–14:53 the ring counted (~80 a
 * minute, the phone more), and a hand-logged treadmill desk 15:03–15:33 where both sources watched and counted 0 (hands
 * on the desk, the phone beside them), with sparse heart rate. Before r069 the sheet's minute chart switched to heart rate
 * without a word on a window of zeros, and "Log an activity" had no chart at all; now one model (`windowSteps`) and one
 * chart (`StepsWindowChart`) say what was counted, by whom, and why it is zero. The fixture uses the test user's device
 * zone, matching the timeline API's requested zone and the charts' device-local clocks; its wall times stay exact.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { GaugeTimeline } from '@/net/gauge';
import type { RingActivity } from '@/features/ring/activities';
import { expectWordsOnly } from '../../__tests__/wordsOnly';
import { binsTotal, lanesOfEvidence, lanesOfTimeline, lastCountedAt, stepsBins, windowSteps } from '../stepsTime';
import { StepsWindowChart, WINDOW_WORDS, windowStepsText } from '../StepsWindowChart';
import { STEPS_DAY_WORDS, StepsDayChart } from '../StepsDayChart';
import { dayMarks, marksOfRows } from '../ActivityLane';
import { laneTotal, stepsHours } from '../model';
import type { ReviewRow } from '@/living/activityCandidates';

const DATE = '2026-10-29';
const DEVICE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const START = Date.parse(`${DATE}T00:00:00`);
const N = 1440;
const at = (hh: number, mm = 0) => hh * 60 + mm;
const ms = (i: number) => START + i * 60_000;
const iso = (i: number) => new Date(ms(i)).toISOString();

function day(): GaugeTimeline {
  const ring: Array<number | null> = Array(N).fill(null);
  const phone: Array<number | null> = Array(N).fill(null);
  const selected: Array<number | null> = Array(N).fill(null);
  const source: Array<string | null> = Array(N).fill(null);
  const support: Array<'minute' | 'coarse' | null> = Array(N).fill(null);
  const bpm: Array<number | null> = Array(N).fill(null);
  // the treadmill walk: the ring ~80, the phone ~100; the ring counts (preference)
  for (let i = at(14, 8); i < at(14, 53); i++) [ring[i], phone[i], selected[i], source[i], support[i]] = [80, 100, 80, 'ring', 'minute'];
  // the treadmill desk: both sources on, both 0; heart rate every few minutes
  for (let i = at(15, 0); i < at(16, 24); i++) [ring[i], phone[i], selected[i], source[i], support[i]] = [0, 0, 0, i % 2 ? 'ring' : 'phone', 'minute'];
  for (let i = at(15, 5); i < at(15, 33); i += 5) bpm[i] = 92;
  // an unplaced phone counter span ending 09:30 (9 steps): counted in the 09:15 quarter, never spread
  return {
    date: DATE, tz: DEVICE_ZONE, start: iso(0), minutes: N,
    steps: {
      selected, source, ring, phone, support,
      coarse: [{ start: iso(at(9)), end: iso(at(9, 30)), steps: 9, lineage: 'phone', placed: false, parts: [{ at: iso(at(9, 29)), steps: 9 }] }],
    },
    hr: { bpm, supportedS: bpm.map((v) => (v === null ? null : 10)) },
    sleep: { stage: Array(N).fill(null) },
    sessions: [], hcExercise: [], acquisition: { ring: [], phone: [] },
  } as unknown as GaugeTimeline;
}

const walk = { start: ms(at(14, 8)), end: ms(at(14, 53)) };
const desk = { start: ms(at(15, 3)), end: ms(at(15, 33)) };

describe('r069 D3: the day in 15-minute bins', () => {
  it('the bins add up to the counted steps (unplaced coarse parts in the quarter they ended), unknown stays null', () => {
    const t = day();
    const bins = stepsBins(t);
    expect(bins).toHaveLength(96);
    expect(binsTotal(bins)).toBe(45 * 80 + 9);
    // the same total as the hour lanes (the panel's figures)
    expect(binsTotal(bins)).toBe(laneTotal(stepsHours(t), 'selected'));
    expect(bins[at(9, 15) / 15]!.steps).toBe(9);
    expect(bins[at(3) / 15]!.steps).toBeNull();
    // the desk's quarters are observed zeros, not unknown
    expect(bins[at(15, 15) / 15]!.steps).toBe(0);
  });

  it('"Updated" is the end of the last minute any source covered', () => {
    expect(lastCountedAt(day())).toBe(ms(at(16, 24)));
    const empty = { ...day(), steps: { ...day().steps, selected: Array(N).fill(null) } };
    expect(lastCountedAt(empty)).toBeNull();
  });
});

describe('r069 D3: an activity window', () => {
  it('a counted window says how many and by whom, with each source’s own count', () => {
    const m = windowSteps(walk, lanesOfTimeline(day()));
    expect(m.kind).toBe('steps');
    expect(m.inside).toMatchObject({ counted: 45 * 80, ring: 45 * 80, phone: 45 * 100, from: 'ring', coveredMin: 45, minutes: 45 });
    expect(m.from).toBe(walk.start - 15 * 60_000);
    expect(m.bars).toHaveLength(45 + 30);
    const w = windowStepsText(m, false);
    expect(w.head).toMatch(/^3,600 steps counted · ring$/);
    expect(w.detail).toMatch(/^Ring 3,600 · phone 4,500$/);
  });

  it('the hand-logged treadmill desk: zeros stay a steps chart and the sheet says why (never a silent switch to heart rate)', () => {
    const m = windowSteps(desk, lanesOfTimeline(day()));
    expect(m.kind).toBe('steps');
    expect(m.inside).toMatchObject({ counted: 0, ring: 0, phone: 0 });
    const w = windowStepsText(m, false);
    expect(w.head).toBe(WINDOW_WORDS.zero);
    expect(w.why).toBe(WINDOW_WORDS.zeroWhy);
    expect(w.detail).toBe('Ring 0 · phone 0');
  });

  it('heart rate stands in, named, only where no source covered the time', () => {
    const t = day();
    const noSteps = { ...t, steps: { ...t.steps, selected: Array(N).fill(null), ring: Array(N).fill(null), phone: Array(N).fill(null) } } as GaugeTimeline;
    const m = windowSteps(desk, lanesOfTimeline(noSteps));
    expect(m.kind).toBe('hr');
    expect(windowStepsText(m, false).head).toBe(WINDOW_WORDS.hrOnly);
    expect(windowSteps(desk, null).kind).toBe('none');
    expect(windowStepsText(windowSteps(desk, null), false).head).toBe(WINDOW_WORDS.noData);
  });

  it('the scrubbed window moves the counts, not the span; stored evidence has no source lanes', () => {
    const lanes = lanesOfTimeline(day());
    const m = windowSteps(walk, lanes, 15, { start: walk.start, end: walk.start + 10 * 60_000 });
    expect(m.from).toBe(walk.start - 15 * 60_000);
    expect(m.inside).toMatchObject({ counted: 800, minutes: 10 });
    const ev = lanesOfEvidence({ first: START, steps: day().steps.selected, hr: { bpm: day().hr.bpm } });
    expect(windowSteps(walk, ev).inside).toMatchObject({ counted: 3600, ring: null, phone: null });
  });

  it('the chart: gold bars inside the window, its words under them; quiet mode has no digits', () => {
    const m = windowSteps(desk, lanesOfTimeline(day()));
    const { container, unmount } = render(<StepsWindowChart model={m} range={desk} quiet={false} />);
    expect(container.querySelectorAll('.lv-asheet__bar[data-in]').length).toBe(30);
    expect(screen.getByRole('status')).toHaveTextContent(WINDOW_WORDS.zero);
    expect(screen.getByText(WINDOW_WORDS.zeroWhy)).toBeInTheDocument();
    unmount();
    const q = render(<StepsWindowChart model={windowSteps(walk, lanesOfTimeline(day()))} range={walk} quiet />);
    expect(q.getByRole('status')).toHaveTextContent(WINDOW_WORDS.quietSome);
    expectWordsOnly(q.container.firstElementChild as HTMLElement);
  });
});

describe('r069 D3: steps through the day with its activities', () => {
  const ring = (o: Partial<RingActivity>): RingActivity =>
    ({ id: 'x', status: 'approved', date: DATE, window: null, pauses: [], durationMin: 30, exerciseId: 'walk', grossKcal: null, aboveRestKcal: null, candidateKey: null, gaugeIds: [], sources: ['ring'], zones: null, rpeCr10: null, avgHr: null, ...o }) as RingActivity;

  it('marks every activity of the day, hand logs and ones to review included, oldest first', () => {
    const acts = {
      approved: [ring({ id: 'desk', window: desk, exerciseId: 'treadmill_desk_slow', sources: ['logged'] }), ring({ id: 'walk', window: walk, exerciseId: 'treadmill_walk' })],
      pending: [ring({ id: 'bike', status: 'pending', window: { start: ms(at(10, 34)), end: ms(at(10, 50)) }, exerciseId: 'stationary_bike' })],
    };
    const marks = dayMarks(acts, START, START + 86_400_000);
    expect(marks.map((m) => [m.id, !!m.pending, !!m.logged])).toEqual([
      ['bike', true, false],
      ['walk', false, false],
      ['desk', false, true],
    ]);
    // the day before is not on this axis
    expect(dayMarks({ approved: [ring({ window: { start: START - 7_200_000, end: START - 3_600_000 } })], pending: [] }, START, START + 86_400_000)).toEqual([]);
  });

  it('review rows as marks leave out the rejected and a log without a clock time', () => {
    const row = (o: Partial<ReviewRow>): ReviewRow => ({ id: 'r', status: 'approved', exerciseId: 'walk', startAt: iso(at(14, 8)), endAt: iso(at(14, 53)), sources: [], ...o }) as ReviewRow;
    const marks = marksOfRows([row({ id: 'a' }), row({ id: 'b', status: 'rejected' }), row({ id: 'c', timeUnknown: true })], START, START + 86_400_000);
    expect(marks.map((m) => [m.id, m.logged])).toEqual([['a', true]]);
  });

  it('the chart’s head is the total its bars add up to and the same "updated" time; the legend names each activity', () => {
    const t = day();
    const bins = stepsBins(t);
    const marks = dayMarks({ approved: [ring({ id: 'desk', window: desk, exerciseId: 'treadmill_desk_slow', sources: ['logged'] })], pending: [] }, START, START + 86_400_000);
    const { container } = render(
      <MemoryRouter>
        <StepsDayChart bins={bins} marks={marks} nowMs={ms(at(16, 30))} updatedAt={lastCountedAt(t)} headline={3800} quiet={false} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.lv-sday__head')!.textContent).toMatch(/^3,609 steps counted · updated 16:24$/);
    expect(screen.getByRole('img', { name: /^Steps through the day: 3,609 counted, most at 14:/ })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Activities' });
    expect(within(legend).getByText('15:03–15:33 · logged by hand')).toBeInTheDocument();
    // a headline above what is placed in time is said, never added to the bars
    expect(screen.getByText(STEPS_DAY_WORDS.noTime('191', '3,800'))).toBeInTheDocument();
  });

  it('quiet mode: words only, the activities by part of the day', () => {
    const marks = dayMarks({ approved: [ring({ id: 'walk', window: walk, exerciseId: 'treadmill_walk' })], pending: [] }, START, START + 86_400_000);
    const { container } = render(<StepsDayChart bins={stepsBins(day())} marks={marks} updatedAt={null} quiet />);
    expect(screen.getByText(STEPS_DAY_WORDS.quiet)).toBeInTheDocument();
    expectWordsOnly(container.firstElementChild as HTMLElement);
  });
});
