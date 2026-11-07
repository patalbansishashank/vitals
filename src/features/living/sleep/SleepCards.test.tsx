/**
 * r071: the Sleep cards on their own, over made-up nights: the states the fixture's night never reaches (a night too sparse to
 * draw, no night at all, a year, a night in two parts, a baseline still forming) and the quiet forms of the pictures.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { GaugeBaselines, GaugeSleepMetrics, GaugeSleepSession } from '@/features/ring/types';
import { NightCard } from './NightCard';
import { OvernightCard } from './OvernightCard';
import { SleepHistory } from './SleepHistory';
import { SleepHrCard } from './SleepHrCard';
import { TimingCard } from './TimingCard';
import { nightView, type NightView } from './model';

const metrics = (o: Partial<GaugeSleepMetrics> = {}): GaugeSleepMetrics =>
  ({
    version: 'sleep-metrics/1', K: 476, A: 21, U: 0, G: 85, tstLowerMin: 476, tstUpperMin: 476, incomplete: false, namedCoveragePct: 100, windowContinuityPct: 95, wasoMin: 27, wakeUps: 3, awakeningRuns: 3,
    leadingWakeMin: 12, onset: '2026-10-29T23:14:00+05:30', finalWake: '2026-10-30T07:37:00+05:30', midpoint: '2026-10-30T03:25:00+05:30', nightlyLowHrP10: 53, hrvNightlyMs: 70, skinTempNightC: 34.6,
    stageMinutes: { deep: 105, light: 278, rem: 93, asleepUnspecified: 0, awake: 27, unknown: 0, gap: 0 }, trace5min: [], ...o,
  }) as unknown as GaugeSleepMetrics;
const session = (o: Partial<GaugeSleepSession> = {}, m: Partial<GaugeSleepMetrics> = {}): GaugeSleepSession =>
  ({ wakingDate: '2026-10-30', start: '2026-10-29T23:10:00+05:30', end: '2026-10-30T07:40:00+05:30', inBedMinutes: 510, asleepMinutes: 476, minutes: { deep: 105, light: 278, rem: 93, awake: 27, unknown: 0 }, blocks: [], metrics: metrics(m), ...o }) as unknown as GaugeSleepSession;
const view = (o: Partial<GaugeSleepSession> = {}, m: Partial<GaugeSleepMetrics> = {}, baselines: GaugeBaselines | null = null): NightView => nightView({ session: session(o, m), baselines, plan: null });
const forming = { learning: { nights: 3, needed: 7, learning: true } } as unknown as GaugeBaselines;

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const night = (v: NightView, quiet = false, index: { value: number | null; legacy: boolean } | null = { value: 92, legacy: false }) => (
  <NightCard v={v} title="Last night" goalMin={480} goalSource="default" extra={[]} quiet={quiet} index={index} scoresHref="/ring/scores" />
);

describe('the night in two parts on the Last night card', () => {
  const part = (m: number) => `2026-10-30T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00+05:30`;
  const two = view(
    { start: '2026-10-29T22:11:00+05:30', end: part(6 * 60 + 30), asleepMinutes: 393, awakeBreaks: [{ start: part(2 * 60 + 4), end: part(3 * 60 + 13), minutes: 69 }] },
    { tstLowerMin: 393, tstUpperMin: 393, onset: '2026-10-29T22:27:00+05:30', finalWake: part(6 * 60 + 30), wasoMin: 74, stageMinutes: { deep: 97, light: 199, rem: 97, asleepUnspecified: 0, awake: 74, unknown: 0, gap: 16 } as GaugeSleepMetrics['stageMinutes'] },
  );

  it('says the break as a fact beside the whole night, the hours asleep the sum of the parts', () => {
    inRouter(night(two));
    expect(screen.getByText('Awake break 02:04–03:13 · 1 h 09')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '6 hours 33 minutes asleep', hidden: true })).toBeInTheDocument();
    // the stage bar counts the break as awake after sleep onset
    expect(screen.getByRole('img', { name: /awake 1 h 14$/ })).toBeInTheDocument();
  });

  it('quiet: one sentence, no figure', () => {
    const { container } = inRouter(night(two, true));
    expect(screen.getByText('Awake break in the night')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe('the Last night card states', () => {
  it('no Sleep index link while the index has no value; an older server\'s is labelled On-device (legacy)', () => {
    const { unmount } = inRouter(night(view(), false, { value: null, legacy: false }));
    expect(screen.queryByRole('link', { name: /Sleep index/ })).toBeNull();
    unmount();
    inRouter(night(view(), false, { value: 71, legacy: true }));
    expect(screen.getByRole('link', { name: 'Sleep index 71 · Good · On-device (legacy)' })).toHaveAttribute('href', '/ring/scores');
  });

  it('a night still learning the baseline says so with its dots, and the card says nothing it does not know', () => {
    inRouter(night(view({}, {}, forming)));
    expect(screen.getByText('Learning your baseline · night 3 of 7')).toBeInTheDocument();
  });

  it('an incomplete night says how much of it was named, and its hero is a range', () => {
    inRouter(night(view({}, { incomplete: true, tstLowerMin: 430, tstUpperMin: 460, namedCoveragePct: 82 })));
    expect(screen.getByText('Incomplete night: 82 % of the window named')).toBeInTheDocument();
    expect(screen.getByText('Between 7 h 10 and 7 h 40')).toBeInTheDocument();
  });
});

describe('Sleep heart rate', () => {
  const trace = Array.from({ length: 96 }, (_, i) => 60 - 6 * Math.sin((i / 95) * Math.PI));

  it('draws the night as one line with the number and its facts', () => {
    inRouter(<SleepHrCard v={view({}, { trace5min: trace, hrReadings: 101, avgSleepHr: 56, timeToLowMin: 310 })} baselines={null} quiet={false} />);
    expect(screen.getByRole('img', { name: /^Heart rate overnight, \d\d:\d\d to \d\d:\d\d: starts at/ })).toBeInTheDocument();
    expect(screen.getByText('Avg 56 bpm · 101 readings · Time to lowest 5 h 10', { selector: '.lm-overflow__item' })).toBeInTheDocument();
  });

  it('a night too sparse to draw says so, and draws no line that is not there', () => {
    inRouter(<SleepHrCard v={view({}, { trace5min: [60, 61, 59, 58, 57], tooFewHrReadings: true } as Partial<GaugeSleepMetrics>)} baselines={null} quiet={false} />);
    expect(screen.getByText('Too few readings overnight')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Heart rate overnight/ })).toBeNull();
  });

  it('a night with no readings at all says that', () => {
    inRouter(<SleepHrCard v={view({}, { trace5min: [] })} baselines={null} quiet={false} />);
    expect(screen.getByText('No heart rate overnight')).toBeInTheDocument();
  });

  it('while the baseline forms: a calibrating chip and no usual range in the foot', () => {
    inRouter(<SleepHrCard v={view({}, { trace5min: trace }, forming)} baselines={forming} quiet={false} />);
    expect(screen.getByText('Calibrating · night 3 of 7')).toBeInTheDocument();
    expect(screen.queryByText(/^Usual /)).toBeNull();
  });
});

describe('Timing and Overnight without an older server\'s metrics', () => {
  const bare = nightView({ session: { ...session(), metrics: undefined } as GaugeSleepSession, baselines: null, plan: null });
  it('draw nothing (the page shows the night and the history only)', () => {
    const t = inRouter(<TimingCard v={bare} baselines={null} date="2026-10-30" quiet={false} />);
    expect(t.container).toBeEmptyDOMElement();
    t.unmount();
    const o = inRouter(<OvernightCard v={bare} baselines={null} date="2026-10-30" quiet={false} />);
    expect(o.container).toBeEmptyDOMElement();
  });

  it('Timing with no usual window yet: the bar draws the night alone, no usual range in the foot', () => {
    inRouter(<TimingCard v={view()} baselines={null} date="2026-10-30" quiet={false} />);
    expect(screen.getByRole('img', { name: /^Sleep timing: \d\d:\d\d to \d\d:\d\d$/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Usual /)).toBeNull();
  });
});

describe('the history', () => {
  const dates = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse('2026-10-30T00:00:00Z') - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const hours = (n: number) => Array.from({ length: n }, (_, i) => (i % 5 === 4 ? null : 7 + Math.sin(i) / 2));

  it('a night\'s bar, the average night as the number, the goal in the foot', () => {
    inRouter(<SleepHistory title="Sleep · last four weeks" dates={dates(7)} hours={[7.5, 8, null, 6.5, 7, 9, 7.8]} outline={Array(7).fill(false)} goalMin={480} quiet={false} />);
    expect(screen.getByRole('img', { name: /^Time asleep, average 7 h 38$/ })).toBeInTheDocument();
    expect(screen.getByText('Avg · 6 of 7 nights')).toBeInTheDocument();
    expect(screen.getByText('Goal met 2 of 6 nights')).toBeInTheDocument();
    expect(screen.getByText('Goal 8 h')).toBeInTheDocument();
  });

  it('no night recorded: one line, no bars, no foot', () => {
    inRouter(<SleepHistory title="Time asleep" dates={dates(5)} hours={Array(5).fill(null)} outline={Array(5).fill(false)} goalMin={480} quiet={false} />);
    expect(screen.getByText('No nights recorded in these days.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/^Goal/)).toBeNull();
  });

  it('a year is the 7-day average as a line with the goal across, not 365 slivers', () => {
    const d = dates(120);
    inRouter(<SleepHistory title="Time asleep" dates={d} hours={hours(120)} outline={Array(120).fill(false)} lead={Array(6).fill(7.2)} goalMin={480} quiet={false} line />);
    expect(screen.getByRole('img', { name: /^Time asleep, 7-day average, / })).toBeInTheDocument();
    expect(document.querySelector('.lmz-bars')).toBeNull();
  });

  it('quiet: words, no figure, no picture', () => {
    const { container } = inRouter(<SleepHistory title="Sleep · last four weeks" dates={dates(28)} hours={hours(28)} outline={Array(28).fill(false)} goalMin={480} quiet />);
    expect(container.textContent).not.toMatch(/\d/);
    expect(within(container).queryByRole('img')).toBeNull();
    expect(container.textContent).toMatch(/nights? recorded/);
  });
});
