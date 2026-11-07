import { describe, expect, it } from 'vitest';
import { minutesText } from '@/features/ring/model';
import type { GaugeSleepMetrics, GaugeSleepSession } from '@/features/ring/types';
import type { GaugeBaselines } from '@/features/ring/types';
import {
  awakeBreakFacts,
  continuityShown,
  historySeries,
  historyStats,
  historyWords,
  hoursClock,
  hoursSpoken,
  hoursText,
  hrTrendFact,
  nightView,
  noRemMarked,
  restorativeFacts,
  sleepGoalFoot,
  sleepHrLine,
  stagesLine,
  timingTwin,
  timingWindows,
  usualLowHrRange,
  usualRangeText,
  vsPlanWords,
  vsUsualWords,
  wallOffset,
} from './model';

describe('the 4-week history as h:mm (Claude UI P3-11)', () => {
  it('writes hours as h:mm, never a decimal', () => {
    expect(hoursClock(7.5)).toBe('7:30');
    expect(hoursClock(476 / 60)).toBe('7:56');
    expect(hoursClock(8)).toBe('8:00');
    expect(hoursClock(0.75)).toBe('0:45');
    expect(hoursClock(7.999)).toBe('8:00');
    expect(hoursClock(NaN)).toBe('—');
  });

  it('speaks hours and minutes', () => {
    expect(hoursSpoken(476 / 60)).toBe('7 hours 56 minutes');
    expect(hoursSpoken(8)).toBe('8 hours');
    expect(hoursSpoken(1 + 1 / 60)).toBe('1 hour 1 minute');
    expect(hoursSpoken(0.75)).toBe('45 minutes');
  });
});

describe('historyWords (quiet mode: words only)', () => {
  const goal = 8 * 60;
  const words = (hours: number[]) => historyWords(hours, goal);

  it('says how many nights were recorded and how many reached the goal, in words', () => {
    const hours = Array.from({ length: 28 }, (_, i) => (i % 7 === 0 ? NaN : i % 2 === 0 ? 8.2 : 7));
    const w = words(hours);
    expect(w.caption).toBe('Most nights recorded');
    expect(w.line).toBe('About half the nights reached your sleep goal.');
  });

  it('covers every, few and none', () => {
    expect(words(Array(28).fill(8.5))).toEqual({ caption: 'Every night recorded', line: 'Every recorded night reached your sleep goal.' });
    expect(words([...Array(25).fill(NaN), 6, 6, 9])).toEqual({ caption: 'A few nights recorded', line: 'A few nights reached your sleep goal.' });
    expect(words(Array(28).fill(6))).toMatchObject({ line: 'No recorded night reached your sleep goal.' });
    expect(words(Array(28).fill(NaN))).toEqual({ caption: 'No nights recorded', line: 'Nothing to show yet.' });
  });

  it('a night exactly at the goal reached it', () => {
    expect(words([8]).line).toBe('Every recorded night reached your sleep goal.');
  });

  it('never prints a digit', () => {
    for (const hours of [Array(28).fill(8.5), Array(28).fill(NaN), [6, 7, 8, 9, NaN, NaN]]) {
      const w = words(hours);
      expect(`${w.caption} ${w.line}`).not.toMatch(/\d/);
    }
  });
});

describe('(r069) REM, and window continuity on an incomplete night', () => {
  // the night waking 2026-10-29: the ring's own codes had no REM in 384 minutes, 67 min of the window unrecorded
  const metrics = {
    version: 'sleep-metrics/1', K: 366, A: 55, U: 0, G: 67, tstLowerMin: 366, tstUpperMin: 366, incomplete: true, namedCoveragePct: 85.9,
    windowContinuityPct: null, wasoMin: 43, onset: '2026-10-28T22:08:00+05:30', finalWake: '2026-10-29T06:04:00+05:30',
    stageMinutes: { deep: 141, light: 225, rem: 0, asleepUnspecified: 0, awake: 43, unknown: 0 }, trace5min: [],
  } as unknown as GaugeSleepMetrics;
  const session = (m: GaugeSleepMetrics | undefined, rem = 0, source?: 'ring' | 'healthConnect') =>
    ({
      wakingDate: '2026-10-29', start: '2026-10-28T21:56:00+05:30', end: '2026-10-29T06:04:00+05:30', inBedMinutes: 488, asleepMinutes: 366 + rem,
      minutes: { deep: 141, light: 225, rem, awake: 55, unknown: 0 }, efficiencyPercent: null, blocks: [], ...(m ? { metrics: m } : {}), ...(source ? { source } : {}),
    }) as unknown as GaugeSleepSession;

  it('a staged night with no REM says the ring marked none, never "0 min"', () => {
    const v = nightView({ session: session(metrics), baselines: null, plan: null });
    const rem = v.stages.find((r) => r.id === 'rem')!;
    expect(rem.valueText).toBe('None marked');
    expect(rem.shareText).toBe('');
    expect(v.noRemNote).toBe('The ring marked no REM this night.');
    expect(stagesLine(v)).toBe('Deep 2 h 21 · Light 3 h 45 · No REM marked');
    expect(nightView({ session: session(undefined, 0, 'healthConnect'), baselines: null, plan: null }).noRemNote).toBe('No REM in this night’s stages.');
  });

  it('a night with REM shows it on the card line and in the stages', () => {
    const withRem = { ...metrics, stageMinutes: { ...metrics.stageMinutes!, rem: 93 } } as GaugeSleepMetrics;
    const v = nightView({ session: session(withRem, 93), baselines: null, plan: null });
    expect(v.noRemNote).toBeNull();
    expect(v.stages.find((r) => r.id === 'rem')!.valueText).toBe(minutesText(93));
    expect(stagesLine(v)).toBe(`Deep 2 h 21 · Light 3 h 45 · REM ${minutesText(93)}`);
    expect(noRemMarked({ deep: 0, light: 0, rem: 0 })).toBe(false);
  });

  it('an incomplete night shows continuity as bounds: unrecorded minutes awake, then asleep', () => {
    // window 22:08–06:04 = 476 min: 366 asleep, 43 awake, 67 unrecorded → 77 % to 91 %
    expect(continuityShown(metrics)).toEqual({ text: '77–91', range: true });
    expect(continuityShown({ ...metrics, windowContinuityPct: 89.6 })).toEqual({ text: '90', range: false });
    expect(continuityShown({ ...metrics, onset: null })).toBeNull();
    expect(continuityShown(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// r071: the Sleep tab's pure pieces

const NIGHT = {
  wakingDate: '2026-10-30', start: '2026-10-29T23:10:00+05:30', end: '2026-10-30T07:40:00+05:30', inBedMinutes: 510, asleepMinutes: 476,
  minutes: { deep: 105, light: 278, rem: 93, awake: 27, unknown: 0 }, efficiencyPercent: null, blocks: [],
} as unknown as GaugeSleepSession;
const NIGHT_METRICS = {
  version: 'sleep-metrics/1', K: 476, A: 21, U: 0, G: 85, tstLowerMin: 476, tstUpperMin: 476, incomplete: false, namedCoveragePct: 100, windowContinuityPct: 95, wasoMin: 27, wakeUps: 3,
  leadingWakeMin: 12, onset: '2026-10-29T23:14:00+05:30', finalWake: '2026-10-30T07:37:00+05:30', midpoint: '2026-10-30T03:25:00+05:30', nightlyLowHrP10: 53, restorativeEstimatedMin: 198,
  stageMinutes: { deep: 105, light: 278, rem: 93, asleepUnspecified: 0, awake: 27, unknown: 0, gap: 0 }, trace5min: [],
} as unknown as GaugeSleepMetrics;
const view = (session: Partial<GaugeSleepSession> = {}, m: Partial<GaugeSleepMetrics> = {}) => nightView({ session: { ...NIGHT, ...session, metrics: { ...NIGHT_METRICS, ...m } } as GaugeSleepSession, baselines: null, plan: null });
const usual = (minutes: number | null, o: { suppressed?: boolean } = {}) => ({ minutes, Rbar: 0.9, n: 28, ...(o.suppressed ? { suppressed: true } : {}) });
const baselines = (o: Partial<GaugeBaselines> = {}): GaugeBaselines =>
  ({ usualOnset: usual(22 * 60 + 56), usualWake: usual(6 * 60 + 39), usualMidpoint: usual(2 * 60 + 46), sleepLowHr: { median: 53, s: 3, n: 14, spanDays: 14, ready: true }, learning: { nights: 28, needed: 7, learning: false }, ...o }) as unknown as GaugeBaselines;

describe('the night in two parts: its awake breaks as facts', () => {
  const breaks = [{ start: '2026-10-30T02:04:00+05:30', end: '2026-10-30T03:13:00+05:30', minutes: 69 }];
  it('names each break by its clock and its length, never a figure in quiet mode', () => {
    expect(awakeBreakFacts({ awakeBreaks: breaks })).toEqual(['Awake break 02:04–03:13 · 1 h 09']);
    expect(awakeBreakFacts({ awakeBreaks: breaks }, true)).toEqual(['Awake break in the night']);
    expect(awakeBreakFacts({ awakeBreaks: [...breaks, { start: '2026-10-30T05:00:00+05:30', end: '2026-10-30T05:20:00+05:30', minutes: 20 }] }, true)).toEqual(['Awake breaks in the night']);
  });
  it('a night with no break says nothing', () => {
    expect(awakeBreakFacts({})).toEqual([]);
    expect(awakeBreakFacts({ awakeBreaks: [] })).toEqual([]);
  });
});

describe('restorative and goal facts', () => {
  it('deep and REM with their share of the sleep, marked as an estimate; none without the ring\'s estimate', () => {
    expect(restorativeFacts(view())).toEqual(['Deep + REM ~3 h 18', '42\u00a0%', 'Estimate']);
    expect(restorativeFacts(view({}, { restorativeEstimatedMin: undefined }))).toBeNull();
  });
  it('the goal in the foot: the V2 word, then "min short"; quiet a word with no figure', () => {
    const v = view();
    expect(sleepGoalFoot(v, 480, false)).toBe('4 min short');
    expect(sleepGoalFoot(v, 480, true)).toBe('Just short of the goal');
    expect(sleepGoalFoot({ joined: null, tstLower: 500 }, 480, false)).toBe('Goal met');
    expect(sleepGoalFoot({ joined: null, tstLower: 400 }, 480, false)).toBe('80 min short');
  });
});

describe('timing: the picture of the night against the usual window', () => {
  it('reads the offset an instant carries', () => {
    expect(wallOffset('2026-10-29T23:14:00+05:30')).toBe('+05:30');
    expect(wallOffset('2026-10-29T23:14:00+0530')).toBe('+05:30');
    expect(wallOffset('2026-10-29T17:44:00Z')).toBe('Z');
    expect(wallOffset('2026-10-29T23:14:00')).toBe('');
  });

  it('the axis runs 20:00 the evening before to 12:00 on the waking date, in the night\'s own offset, whatever the device\'s zone', () => {
    const w = timingWindows(view(), baselines());
    expect(w.axis).toEqual([Date.parse('2026-10-29T20:00:00+05:30'), Date.parse('2026-10-30T12:00:00+05:30')]);
    expect(w.actual).toEqual({ from: Date.parse('2026-10-29T23:14:00+05:30'), to: Date.parse('2026-10-30T07:37:00+05:30') });
    expect(w.midpoint).toBe(Date.parse('2026-10-30T03:25:00+05:30'));
  });

  it('the usual window: an onset after noon is the evening before, one after midnight is the waking date', () => {
    expect(timingWindows(view(), baselines()).usual).toEqual({ from: Date.parse('2026-10-29T22:56:00+05:30'), to: Date.parse('2026-10-30T06:39:00+05:30') });
    expect(timingWindows(view(), baselines({ usualOnset: usual(40) as GaugeBaselines['usualOnset'] })).usual).toEqual({ from: Date.parse('2026-10-30T00:40:00+05:30'), to: Date.parse('2026-10-30T06:39:00+05:30') });
  });

  it('no usual window while a baseline is missing or suppressed, or when it would end before it begins', () => {
    expect(timingWindows(view(), null).usual).toBeNull();
    expect(timingWindows(view(), baselines({ usualWake: usual(null) as GaugeBaselines['usualWake'] })).usual).toBeNull();
    expect(timingWindows(view(), baselines({ usualOnset: usual(22 * 60, { suppressed: true }) as GaugeBaselines['usualOnset'] })).usual).toBeNull();
    expect(timingWindows(view(), baselines({ usualOnset: usual(7 * 60) as GaugeBaselines['usualOnset'], usualWake: usual(6 * 60) as GaugeBaselines['usualWake'] })).usual).toBeNull();
  });

  it('a night without metrics has no window or midpoint', () => {
    const v = nightView({ session: NIGHT, baselines: null, plan: null });
    const w = timingWindows(v, baselines());
    expect([w.actual, w.midpoint]).toEqual([null, null]);
  });

  it('the usual window as the foot says it', () => {
    expect(usualRangeText(baselines())).toBe('22:56–06:39');
    expect(usualRangeText(baselines({ usualWake: usual(null) as GaugeBaselines['usualWake'] }))).toBe('asleep 22:56');
    expect(usualRangeText(baselines({ usualOnset: usual(null) as GaugeBaselines['usualOnset'] }))).toBe('up 06:39');
    expect(usualRangeText(null)).toBeNull();
  });

  it('the table: each moment against the usual clock, in the night\'s own wall clock', () => {
    const t = timingTwin(view(), baselines());
    expect(t.head).toEqual(['Moment', 'Last night', 'Usual']);
    expect(t.rows.slice(0, 3)).toEqual([['Fell asleep', '23:14', '22:56'], ['Woke', '07:37', '06:39'], ['Sleep midpoint', '03:25', '02:46']]);
    expect(t.rows.map((r) => r[0])).toEqual(['Fell asleep', 'Woke', 'Sleep midpoint', 'Settle time', 'Window continuity', 'Wake-ups']);
  });

  it('how far from usual and from the plan in words, with no figure', () => {
    expect([vsUsualWords(39), vsUsualWords(-20), vsUsualWords(3), vsUsualWords(null)]).toEqual(['Later than usual', 'Earlier than usual', 'Near usual', null]);
    expect([vsPlanWords(12), vsPlanWords(-8), vsPlanWords(0), vsPlanWords(null)]).toEqual(['Later than planned', 'Earlier than planned', 'As planned', null]);
  });
});

describe('the night\'s heart rate as a line', () => {
  const trace = Array.from({ length: 96 }, (_, i) => 62 - 6 * Math.sin((i / 95) * Math.PI) + (i === 60 ? -3 : 0));
  const withHr = () => view({ blocks: [{ stage: 'awake', start: '2026-10-30T02:00:00+05:30', end: '2026-10-30T02:15:00+05:30', minutes: 15 }] as GaugeSleepSession['blocks'] }, { trace5min: trace, hrTrend: { word: 'steady' } as GaugeSleepMetrics['hrTrend'] });

  it('points, awake stretches and the lowest bin as a labelled mark', () => {
    const l = sleepHrLine(withHr());
    expect(l.series).toHaveLength(96);
    expect(l.spans).toEqual([{ from: Date.parse('2026-10-30T02:00:00+05:30'), to: Date.parse('2026-10-30T02:15:00+05:30'), kind: 'awake' }]);
    expect(l.marks).toHaveLength(1);
    expect(l.marks[0]!.label).toMatch(/^Lowest \d+ · \d\d:\d\d$/);
    expect(l.marks[0]!.v).toBe(Math.min(...l.series.map((p) => p.v!)));
  });

  it('a sparse night has no mark, and its trend is a fact line', () => {
    const sparse = view({}, { trace5min: [60, 61, 59, 58, 57], tooFewHrReadings: true } as Partial<GaugeSleepMetrics>);
    expect(sleepHrLine(sparse).marks).toEqual([]);
    expect([hrTrendFact({ word: 'Steady' }), hrTrendFact({ word: 'Rising', magnitude: 'Slight' }), hrTrendFact({ word: 'Falling', magnitude: 'Strong' })]).toEqual([
      'Steady through the night',
      'Rising slightly toward morning',
      'Falling strongly toward morning',
    ]);
  });

  it('the usual sleeping low as a range, once its baseline is ready', () => {
    expect(usualLowHrRange(baselines())).toBe('50–56');
    expect(usualLowHrRange(baselines({ learning: { nights: 3, needed: 7, learning: true } }))).toBeNull();
    expect(usualLowHrRange(baselines({ sleepLowHr: { median: 53, s: 3, n: 4, spanDays: 4, ready: false } }))).toBeNull();
    expect(usualLowHrRange(null)).toBeNull();
  });
});

describe('the history: a bar a night, the average night, the goal', () => {
  const night = (waking: string, asleep: number, incomplete = false) =>
    ({ ...NIGHT, wakingDate: waking, asleepMinutes: asleep, metrics: { ...NIGHT_METRICS, tstLowerMin: asleep, incomplete } }) as unknown as GaugeSleepSession;

  it('hours asleep per day (the lower bound of an incomplete night, an outline), null where nothing was recorded: no bar, never a zero', () => {
    const h = historySeries([night('2026-10-28', 450), night('2026-10-30', 420, true)], '2026-10-28', '2026-10-30');
    expect(h.dates).toEqual(['2026-10-28', '2026-10-29', '2026-10-30']);
    expect(h.hours).toEqual([7.5, null, 7]);
    expect(h.outline).toEqual([false, false, true]);
  });

  it('the average night, the nights recorded, the nights at or above the goal and the last recorded night', () => {
    expect(historyStats([7.5, null, 8, 6, null], 480)).toEqual({ nights: 3, days: 5, meanHours: (7.5 + 8 + 6) / 3, met: 1, last: 3 });
    expect(historyStats([null, null], 480)).toEqual({ nights: 0, days: 2, meanHours: null, met: 0, last: null });
  });

  it('hours in the person\'s voice', () => {
    expect([hoursText(7.5), hoursText(476 / 60), hoursText(8), hoursText(0.75), hoursText(Number.NaN)]).toEqual(['7 h 30', '7 h 56', '8 h', '45 min', '—']);
  });
});
