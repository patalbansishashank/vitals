import { describe, expect, it } from 'vitest';
import {
  bandPath,
  isoWeekday,
  linePath,
  linePathWithBreaks,
  placeLabels,
  quietScoreWord,
  scoreSummary,
  scoreTableRows,
  spokenDateRange,
  trendDomain,
  trendHeight,
  trendLayout,
  trendReadoutText,
  trendSummary,
  trendTableCSV,
  trendTableRows,
  trendToChartData,
} from '../trend';
import { scoreFixture, trendFixture } from './fixtures';

const THIN = ' ';

describe('trend scales', () => {
  it('hugs the data (bands, dots, trend) with 10 % padding and leaves a far goal out on Today', () => {
    const d = trendDomain(trendFixture(), 'today');
    // extent: as-prescribed p10 82.49 … realistic p90 84.5 → span 2.01, pad 0.201
    expect(d.lo).toBeCloseTo(82.289, 3);
    expect(d.hi).toBeCloseTo(84.701, 3);
    expect(d.goal).toBe('below');
    expect(trendDomain(trendFixture(), 'checkin').goal).toBe('below');
  });

  it('includes the goal only on size progress', () => {
    const d = trendDomain(trendFixture(), 'progress');
    expect(d.lo).toBeCloseTo(79, 6);
    expect(d.hi).toBeCloseTo(85, 6);
    expect(d.goal).toBe('inside');
  });

  it('never rounds the domain outward; ticks are 2–3 nice values inside it', () => {
    const L = trendLayout(trendFixture(), 'today', 400);
    expect(L.ticks.ticks.length).toBeGreaterThanOrEqual(2);
    expect(L.ticks.ticks.length).toBeLessThanOrEqual(3);
    for (const t of L.ticks.ticks) {
      expect(t).toBeGreaterThanOrEqual(L.lo);
      expect(t).toBeLessThanOrEqual(L.hi);
    }
  });

  it('maps today index → x inside the data area, right of the printed tick column', () => {
    const L = trendLayout(trendFixture(), 'today', 400);
    expect(L.px0).toBe(26); // 26 px tick column under 500 px wide
    expect(trendLayout(trendFixture(), 'today', 800).px0).toBe(32);
    expect(L.X(13)).toBeCloseTo(26 + 13.5 * (366 / 14), 6);
    expect(L.X(13)).toBeLessThanOrEqual(L.px1);
    expect(L.X(0)).toBeGreaterThan(L.px0);
    expect(L.dayAt(L.X(13))).toBe(13);
    expect(L.dayAt(-50)).toBe(0);
    expect(L.dayAt(9999)).toBe(13);
  });

  it('quiet mode drops the tick column', () => {
    expect(trendLayout(trendFixture(), 'today', 400, { quiet: true }).px0).toBe(4);
  });

  it('sizes: today 64–96 (88), progress 240 / 180 under 640 px, check-in 160', () => {
    expect(trendHeight('today', 375)).toBe(88);
    expect(trendHeight('today', 375, 120)).toBe(96);
    expect(trendHeight('today', 375, 40)).toBe(64);
    expect(trendHeight('progress', 600)).toBe(180);
    expect(trendHeight('progress', 1024)).toBe(240);
    expect(trendHeight('checkin', 375)).toBe(160);
  });

  it('labels days in short windows counting back from today, Mondays in long ones', () => {
    const short = trendLayout(trendFixture({ goalDateRange: undefined }), 'checkin', 1200);
    expect(short.xTicks.some((t) => t.day === 13 && t.label === '1 Oct')).toBe(true);
    const long = trendLayout(trendFixture({ startDate: '2026-10-01', days: 84, trend: [], weighIns: [], realistic: undefined, asPrescribed: undefined }), 'progress', 900);
    expect(long.xTicks.length).toBeGreaterThan(2);
    for (const t of long.xTicks) expect(isoWeekday(addDays('2026-10-01', t.day))).toBe(0); // Mondays
    expect(long.xTicks[0]!.label).toBe('5 Oct');
  });

  it('draws the goal-date range as a bracket, clipped with an arrow, or as an edge arrow beyond the window', () => {
    const today = trendLayout(trendFixture(), 'today', 400);
    expect(today.bracket?.outside).toBe('after');
    expect(today.bracketRowY).toBeNull();
    const base = { startDate: '2026-10-01', trend: [], weighIns: [], realistic: undefined, asPrescribed: undefined, todayIndex: 0 };
    const inside = trendLayout(trendFixture({ ...base, days: 100 }), 'progress', 900);
    expect(inside.bracket?.outside).toBeNull();
    expect(inside.bracket?.clipRight).toBe(false);
    expect(inside.bracket!.x0).toBeCloseTo(inside.px0 + 81 * inside.slot, 6);
    expect(inside.bracketRowY).not.toBeNull();
    const clipped = trendLayout(trendFixture({ ...base, days: 85 }), 'progress', 900);
    expect(clipped.bracket?.clipRight).toBe(true);
    expect(clipped.bracket!.x1).toBe(clipped.px1);
  });

  it('places engraved labels greedily: right of the mark, else left, else dropped — never overprinted', () => {
    const placed = placeLabels(
      [
        { x: 100, text: 'estimate reset' },
        { x: 120, text: 'paused' },
        { x: 395, text: 'v3' },
        { x: 20, text: 'v2' },
      ],
      10,
      400,
    );
    expect(placed[3]).toEqual({ x: 23, anchor: 'start', show: true });
    expect(placed[0]).toEqual({ x: 103, anchor: 'start', show: true });
    expect(placed[1]!.show).toBe(false); // would overprint "estimate reset"
    expect(placed[2]).toEqual({ x: 392, anchor: 'end', show: true }); // flipped at the right edge
  });

  it('paths break at NaN and close bands per finite run', () => {
    const X = (i: number) => i * 10;
    const Y = (v: number) => v;
    expect(linePath([1, NaN, 2, 3], X, Y)).toBe('M0.0,1.0h0.01M20.0,2.0L30.0,3.0');
    expect(bandPath([1, 1, NaN, 1, 1], [2, 2, NaN, 2, 2], X, Y).match(/Z/g)?.length).toBe(2);
    const br = linePathWithBreaks([1, 2, 3, 4], [2], X, Y);
    expect(br.solid).toBe('M0.0,1.0L10.0,2.0M20.0,3.0L30.0,4.0');
    expect(br.joins).toEqual([{ x1: 10, y1: 2, x2: 20, y2: 3 }]);
  });
});

function addDays(iso: string, n: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

describe('trendSummary', () => {
  it('reads the trend, today’s expected range, weigh-ins and the goal date', () => {
    expect(trendSummary(trendFixture())).toBe(
      'Weight trend 83.1 kilograms, expected today 82.8 to 83.6; 9 weigh-ins in the last 14 days; goal date likely 21 to 30 December.',
    );
  });

  it('counts flagged weigh-ins as kept, never removed', () => {
    const data = trendFixture();
    data.weighIns[7]!.flagged = true;
    expect(trendSummary(data)).toContain('9 weigh-ins in the last 14 days, 1 marked unusual and kept;');
  });

  it('quiet mode keeps the shape and drops the weights', () => {
    const s = trendSummary(trendFixture(), { quiet: true });
    expect(s).toBe('Weight trend going down, numbers hidden; 9 weigh-ins in the last 14 days; goal date likely 21 to 30 December.');
    expect(s).not.toMatch(/\d+\.\d/);
  });

  it('says when there is no trend yet', () => {
    expect(trendSummary(trendFixture({ trend: Array.from({ length: 14 }, () => NaN), goalDateRange: undefined, weighIns: [{ day: 13, value: 84 }] }))).toBe(
      'Weight trend not available yet; 1 weigh-in in the last 14 days.',
    );
  });

  it('readout line: trend with its spread and today’s expected range', () => {
    expect(trendReadoutText(trendFixture())).toBe(`trend 83.1${THIN}kg (±0.3) · expected today 82.8–83.6`);
    expect(trendReadoutText(trendFixture(), true)).toBe('trend going down');
  });

  it('spells date ranges across months and years', () => {
    expect(spokenDateRange('2026-11-28', '2026-12-03')).toBe('28 November to 3 December');
    expect(spokenDateRange('2026-12-28', '2027-01-03')).toBe('28 December 2026 to 3 January 2027');
  });
});

describe('trendTableRows', () => {
  const data = trendFixture({
    events: [
      { day: 4, kind: 'version', label: 'v2' },
      { day: 6, kind: 'pause', label: 'paused', endDay: 7 },
    ],
  });
  data.weighIns[7]!.flagged = true; // day 12
  const rows = trendTableRows(data);

  it('has one row per day: date · weigh-in · trend · expected range · event', () => {
    expect(rows).toHaveLength(14);
    expect(rows[0]!.label).toBe('Fri 18 Sep');
    const today = rows[13]!;
    expect(today.isToday).toBe(true);
    expect(today.label).toBe('Thu 1 Oct');
    expect(today.weighIn).toBeCloseTo(83.29, 6);
    expect(today.trend).toBeCloseTo(83.09, 6);
    expect(today.expectedLo).toBeCloseTo(82.79, 6);
    expect(today.expectedHi).toBeCloseTo(83.59, 6);
    expect(rows[2]!.weighIn).toBeNull();
    expect(rows[12]!.flagged).toBe(true);
  });

  it('puts events on their days, pauses on every paused day', () => {
    expect(rows[4]!.event).toBe('v2');
    expect(rows[6]!.event).toBe('paused');
    expect(rows[7]!.event).toBe('paused');
    expect(rows[8]!.event).toBe('');
  });

  it('exports plain CSV', () => {
    const csv = trendTableCSV(rows, 'kg', 1).trim().split('\n');
    expect(csv[0]).toBe('date,weigh-in (kg),unusual,trend (kg),expected low,expected high,event');
    expect(csv[14]).toBe('2026-10-01,83.3,,83.1,82.8,83.6,');
    expect(csv[13]).toBe('2026-09-30,83.4,yes,83.2,82.9,83.7,');
  });
});

describe('trendToChartData', () => {
  it('maps weigh-ins, trend and both forecasts onto the module’s ChartData', () => {
    const cd = trendToChartData(trendFixture({ events: [{ day: 4, kind: 'version', label: 'v2' }] }));
    expect(cd.time).toEqual({ startDate: '2026-09-18', days: 14 });
    expect(cd.series.map((s) => s.id)).toEqual(['weigh_in', 'weight_trend', 'forecast_realistic', 'forecast_as_prescribed']);
    const [weigh, trend, real, presc] = cd.series;
    expect(Number.isNaN(weigh!.daily.values[2]!)).toBe(true);
    expect(weigh!.daily.values[0]).toBeCloseTo(84.2, 4);
    expect(trend!.daily.values[13]).toBeCloseTo(83.09, 4);
    expect(real!.daily.band!.lo[13]).toBeCloseTo(82.79, 4);
    expect(presc!.daily.band!.hi[0]).toBeCloseTo(83.9, 4);
    expect(cd.events).toEqual([{ day: 4, type: 'note', label: 'v2' }]);
  });
});

describe('score history helpers', () => {
  it('summarises the mean, the normal range, nights, versions and device changes', () => {
    const s = scoreSummary(scoreFixture(), 'Heart-rate variability');
    expect(s).toMatch(/^Heart-rate variability, 7-day mean \d+ milliseconds on 20 October, your normal range 38 to 47;/);
    expect(s).toContain('26 of 28 nights recorded');
    expect(s).toContain('v1.3 from 20 Oct');
    expect(s).toContain('new ring on 3 October');
  });

  it('table rows carry notes on their nights', () => {
    const rows = scoreTableRows(scoreFixture());
    expect(rows[10]!.note).toBe('new ring');
    expect(rows[27]!.note).toBe('v1.3 from 20 Oct');
    expect(rows[4]!.night).toBeNull();
    expect(rows[3]!.normalLo).toBeNull();
    expect(rows[6]!.normalLo).toBe(38);
  });
});

describe('quiet vocabulary', () => {
  it('follows the dial’s words', () => {
    expect([85, 84, 60, 59, 30, 29].map((v) => quietScoreWord(v))).toEqual(['as planned', 'mostly', 'mostly', 'partly', 'partly', 'a little']);
    expect(quietScoreWord(null)).toBe('not enough logged');
    expect(quietScoreWord(null, 'not logged')).toBe('not logged');
  });
});
