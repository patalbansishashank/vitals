/** The widgets' small pictures as data: scaled 0..1, short, with gaps kept as gaps. */
import { describe, expect, it } from 'vitest';
import { WIDGET_SERIES_MAX } from '@/platform/widgets';
import { cumulativeBurn, downsample, hourlyBars, lineOf, scaleSeries, SERIES_MAX, stageSpans } from '../series';

const H = 3_600_000;
const day0 = Date.UTC(2026, 9, 28, 0, 0, 0);

describe('scaleSeries', () => {
  it('scales over the data’s own range, keeps gaps as null and puts a flat series in the middle', () => {
    expect(scaleSeries([10, 20, null, 30])).toEqual([0, 0.5, null, 1]);
    expect(scaleSeries([5, 5, 5])).toEqual([0.5, 0.5, 0.5]);
    expect(scaleSeries([null, null])).toEqual([null, null]);
  });

  it('keeps a pad off the frame and clamps to the given range', () => {
    expect(scaleSeries([0, 10], { pad: 0.1 })).toEqual([0.1, 0.9]);
    expect(scaleSeries([-5, 5, 50], { lo: 0, hi: 10 })).toEqual([0, 0.5, 1]);
  });
});

describe('downsample and lineOf', () => {
  it('averages buckets, never invents a reading for an empty one, and leaves a short series alone', () => {
    expect(downsample([1, 2, 3], 48)).toEqual([1, 2, 3]);
    expect(downsample([1, 3, null, null, 5, 7], 3)).toEqual([2, null, 6]);
    expect(downsample(Array.from({ length: 1440 }, (_, i) => i), SERIES_MAX)).toHaveLength(SERIES_MAX);
  });

  it('the latest reading goes into the bucket that holds it, also when it is a bucket’s first minute', () => {
    // 1000 minutes in 48 buckets: bucket 1 starts at minute 20. A lone reading at minute 20 is bucket 1's.
    const lone = Array.from({ length: 1000 }, (_, i) => (i === 20 ? 90 : i === 5 ? 60 : null));
    const s = lineOf(lone)!;
    expect(s.now).toBe(1);
    expect(s.y[1]).toBeCloseTo(0.9, 3);
    // the minute before is still bucket 0
    const before = lineOf(Array.from({ length: 1000 }, (_, i) => (i === 19 ? 90 : i === 5 ? 60 : null)))!;
    expect(before.now).toBe(0);
  });

  it('a line ends on the latest reading, whatever the bucket mean was', () => {
    const minutes = Array.from({ length: 600 }, (_, i) => (i < 590 ? 60 : i === 599 ? 100 : null));
    const s = lineOf(minutes)!;
    expect(s.y.length).toBeLessThanOrEqual(WIDGET_SERIES_MAX);
    expect(s.now).toBe(s.y.length - 1 - s.y.slice().reverse().findIndex((v) => v !== null));
    // the live end is the highest point, so it scales to the top of the padded frame
    expect(s.y[s.now!]).toBeCloseTo(0.9, 3);
    expect(lineOf([null, null])).toBeNull();
  });
});

describe('cumulativeBurn', () => {
  // 96 quarter hours, 20 kcal each: 1 920 kcal over the day, flat
  const bins = Array.from({ length: 96 }, (_, i) => ({ start: day0 + i * 15 * 60_000, kcal: 20 }));

  it('is the running total up to now, then its forecast from the live end, over the whole day', () => {
    const s = cumulativeBurn(bins, 15 * 60_000, day0 + 12 * H)!;
    expect(s.y).toHaveLength(SERIES_MAX);
    expect(s.ahead).toHaveLength(SERIES_MAX);
    const now = s.now!;
    // noon of a flat day: the middle
    expect(now).toBe(Math.round(0.5 * (SERIES_MAX - 1)));
    expect(s.y[now]).toBeCloseTo(now / (SERIES_MAX - 1), 2);
    expect(s.y[0]).toBe(0);
    expect(s.y[now + 1]).toBeNull();
    expect(s.ahead![now - 1]).toBeNull();
    // the forecast starts at the live end so the dotted tail joins the line, and ends at the day's likely total
    expect(s.ahead![now]).toBe(s.y[now]);
    expect(s.ahead![SERIES_MAX - 1]).toBe(1);
  });

  it('keeps the live end inside the day at midnight and after the last bin', () => {
    expect(cumulativeBurn(bins, 15 * 60_000, day0 - H)!.now).toBe(0);
    const late = cumulativeBurn(bins, 15 * 60_000, day0 + 30 * H)!;
    expect(late.now).toBe(SERIES_MAX - 1);
    expect(late.y[SERIES_MAX - 1]).toBe(1);
  });

  it('gives nothing without a burn to draw', () => {
    expect(cumulativeBurn([], 15 * 60_000, day0)).toBeNull();
    expect(cumulativeBurn(bins.map((b) => ({ ...b, kcal: 0 })), 15 * 60_000, day0)).toBeNull();
  });
});

describe('hourlyBars', () => {
  it('scales to the busiest hour, keeps an hour with no reading as a gap and marks the current hour', () => {
    const hours = [0, 500, 1000, null, 250, ...Array.from({ length: 19 }, () => null)];
    const s = hourlyBars(hours, 4)!;
    expect(s.y.slice(0, 5)).toEqual([0, 0.5, 1, null, 0.25]);
    expect(s.now).toBe(4);
    expect(hourlyBars(hours, 30)!.now).toBeNull();
    expect(hourlyBars([null, 0], 1)).toBeNull();
  });
});

describe('stageSpans', () => {
  const t0 = Date.UTC(2026, 9, 27, 23, 0, 0);
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const block = (a: number, b: number, stage: string) => ({ start: at(a), end: at(b), stage });

  it('gives the runs as positions inside the recorded window, with the app’s four levels', () => {
    const blocks = [block(0, 60, 'light'), block(60, 150, 'deep'), block(150, 240, 'rem'), block(240, 300, 'awake'), block(300, 480, 'light')];
    const spans = stageSpans(blocks, t0, t0 + 480 * 60_000);
    expect(spans.map((s) => s[2])).toEqual([2, 3, 1, 0, 2]);
    expect(spans[0]).toEqual([0, 0.125, 2]);
    expect(spans.at(-1)![1]).toBe(1);
    for (const [a, b] of spans) expect(a < b && a >= 0 && b <= 1).toBe(true);
  });

  it('folds a short run into its neighbour, bridges Mixed from the stages around it and leaves holes out', () => {
    const blocks = [block(0, 100, 'light'), block(100, 102, 'awake'), block(102, 200, 'light'), block(200, 230, 'asleepUnspecified'), block(230, 300, 'deep'), block(330, 480, 'deep')];
    const spans = stageSpans(blocks, t0, t0 + 480 * 60_000);
    // the two awake minutes fold away; the unstaged stretch takes a neighbour's stage; the gap 300-330 is no span
    expect(spans.every(([, , k]) => k !== 0)).toBe(true);
    expect(spans.some(([a, b]) => a < 300 / 480 && b > 330 / 480)).toBe(false);
  });

  it('a night with no named stage at all is one band at level 4, never drawn as a stage', () => {
    const spans = stageSpans([block(0, 480, 'asleepUnspecified')], t0, t0 + 480 * 60_000);
    expect(spans).toEqual([[0, 1, 4]]);
    expect(stageSpans([], t0, t0 + 1)).toEqual([]);
    expect(stageSpans([block(0, 10, 'light')], t0, t0)).toEqual([]);
  });
});
