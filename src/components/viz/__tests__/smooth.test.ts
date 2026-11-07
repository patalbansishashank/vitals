/**
 * r064 VIZ: the display smoothing. The hypnogram's stage smoothing (Mixed absorbed, short gaps bridged, long gaps kept,
 * a minimum run length, raw totals untouched) and the signal smoother (gaps preserved, never interpolated across, robust
 * to spikes), plus the monotone path.
 */
import { describe, expect, it } from 'vitest';
import { bandPath, dataKey, medianSpacing, monotonePath, smoothExtremes, smoothSeries, smoothStages, smoothingFor, stageTimeline, stageTotals, type RawStageSpan } from '../smooth';

const MIN = 60_000;
const T0 = Date.parse('2026-10-27T23:00:00Z');
/** Spans from [state, minutes] pairs laid end to end from T0. */
function night(...parts: Array<[RawStageSpan['state'], number]>): RawStageSpan[] {
  let t = T0;
  return parts.map(([state, m]) => {
    const s = { from: t, to: t + m * MIN, state };
    t += m * MIN;
    return s;
  });
}
const AWAKE = 0;
const REM = 1;
const LIGHT = 2;
const DEEP = 3;
const minutes = (xs: Array<{ from: number; to: number }>) => xs.reduce((a, s) => a + (s.to - s.from) / MIN, 0);

describe('smoothStages: display only', () => {
  it('Mixed takes the majority stage of its neighbours', () => {
    const out = smoothStages(night([DEEP, 30], ['mixed', 3], [DEEP, 20], [LIGHT, 5]));
    expect(out.map((s) => s.state)).toEqual([DEEP, LIGHT]);
    expect(out[0]!.to - out[0]!.from).toBe(53 * MIN);
    // the majority inside the window wins, not the nearest neighbour
    const lean = smoothStages(night([LIGHT, 2], [REM, 30], ['mixed', 4], [LIGHT, 2], [REM, 30]), { minMs: 1 });
    expect(lean.map((s) => s.state)).not.toContain(null);
    expect(lean.find((s) => s.from <= T0 + 33 * MIN && s.to > T0 + 33 * MIN)!.state).toBe(REM);
  });

  it('bridges a short "no reading" hole from its neighbours, meeting in the middle', () => {
    const same = smoothStages(night([LIGHT, 30], [null, 10], [LIGHT, 30]));
    expect(same).toEqual([{ from: T0, to: T0 + 70 * MIN, state: LIGHT }]);
    const diff = smoothStages(night([LIGHT, 30], [null, 10], [DEEP, 30]));
    expect(diff).toEqual([
      { from: T0, to: T0 + 35 * MIN, state: LIGHT },
      { from: T0 + 35 * MIN, to: T0 + 70 * MIN, state: DEEP },
    ]);
  });

  it('keeps a long gap as one null span, never a stage', () => {
    const out = smoothStages(night([LIGHT, 30], [null, 40], [DEEP, 30]));
    expect(out.map((s) => s.state)).toEqual([LIGHT, null, DEEP]);
    expect(out[1]).toEqual({ from: T0 + 30 * MIN, to: T0 + 70 * MIN, state: null });
  });

  it('drops a short hole at the night edge and keeps a long one', () => {
    const spans = night([LIGHT, 30], [DEEP, 30]);
    expect(smoothStages(spans, { from: T0 - 5 * MIN, to: T0 + 60 * MIN })[0]!.from).toBe(T0);
    expect(smoothStages(spans, { from: T0 - 30 * MIN, to: T0 + 60 * MIN })[0]).toEqual({ from: T0 - 30 * MIN, to: T0, state: null });
  });

  it('folds runs shorter than the minimum into the longer neighbour', () => {
    const out = smoothStages(night([LIGHT, 20], [AWAKE, 2], [LIGHT, 3], [DEEP, 1], [DEEP, 25], [REM, 2], [LIGHT, 10]));
    expect(out.every((s) => s.to - s.from >= 4 * MIN)).toBe(true);
    expect(out.map((s) => s.state)).toEqual([LIGHT, DEEP, LIGHT]);
    // a raw run of exactly the minimum stays
    expect(smoothStages(night([LIGHT, 20], [REM, 4], [LIGHT, 20])).map((s) => s.state)).toEqual([LIGHT, REM, LIGHT]);
    // a short run alone between two long gaps has nothing to fold into: it stays (it is a reading)
    expect(smoothStages(night([null, 30], [REM, 2], [null, 30]), { from: T0, to: T0 + 62 * MIN }).map((s) => s.state)).toEqual([null, REM, null]);
  });

  it('draws only the four levels and long gaps', () => {
    const confetti: Array<[RawStageSpan['state'], number]> = [];
    const seq: RawStageSpan['state'][] = [LIGHT, DEEP, 'mixed', LIGHT, null, REM, AWAKE, LIGHT, 'mixed', DEEP];
    for (let i = 0; i < 300; i++) confetti.push([seq[(i * 7) % seq.length]!, 1 + (i % 3)]);
    const out = smoothStages(night(...confetti));
    expect(out.length).toBeLessThan(confetti.length / 4);
    for (const s of out) expect(s.state === null || [AWAKE, REM, LIGHT, DEEP].includes(s.state)).toBe(true);
    for (const s of out) if (s.state === null) expect(s.to - s.from).toBeGreaterThan(12 * MIN);
    // contiguous and covering the night
    for (let i = 1; i < out.length; i++) expect(out[i]!.from).toBe(out[i - 1]!.to);
  });

  it('leaves the raw spans and their totals unchanged (totals are always the raw ones)', () => {
    const spans = night([AWAKE, 12], [LIGHT, 8], [AWAKE, 2], [LIGHT, 7], [REM, 1], ['mixed', 2], [DEEP, 33], [null, 6], [DEEP, 9], [null, 40], [REM, 20]);
    const copy = JSON.parse(JSON.stringify(spans));
    const before = stageTotals(spans);
    smoothStages(spans);
    expect(spans).toEqual(copy);
    const after = stageTotals(spans);
    expect([...after]).toEqual([...before]);
    expect(before.get(DEEP)).toBe(42);
    expect(before.get('mixed')).toBe(2);
    expect(before.get('none')).toBe(46);
    expect(minutes(stageTimeline(spans))).toBe(140);
  });

  it('is fast on a long night of minute epochs', () => {
    const parts: Array<[RawStageSpan['state'], number]> = [];
    for (let i = 0; i < 3000; i++) parts.push([([LIGHT, DEEP, REM, AWAKE, 'mixed', null] as RawStageSpan['state'][])[(i * 13) % 6]!, 1]);
    const t = performance.now();
    smoothStages(night(...parts));
    expect(performance.now() - t).toBeLessThan(1500);
  });
});

describe('smoothSeries: display only', () => {
  const minuteStream = (fromMin: number, toMin: number, f: (m: number) => number) => {
    const out: Array<{ t: number; v: number }> = [];
    for (let m = fromMin; m < toMin; m++) out.push({ t: m * MIN, v: f(m) });
    return out;
  };

  it('preserves real gaps: no point is drawn inside a gap, never interpolated across hours', () => {
    const pts = [...minuteStream(0, 120, () => 60), ...minuteStream(300, 420, () => 90)];
    const o = smoothingFor({ span: 420 * MIN, px: 300, step: medianSpacing(pts.map((p) => p.t)) });
    const runs = smoothSeries(pts, o);
    expect(runs).toHaveLength(2);
    expect(runs.flat().some((p) => p.t > 120 * MIN && p.t < 300 * MIN)).toBe(false);
    expect(runs[0]!.at(-1)!.v).toBeCloseTo(60, 6);
    expect(runs[1]![0]!.v).toBeCloseTo(90, 6);
  });

  it('a short dropout stays one line; the gap rule is three steps or 2.5 buckets', () => {
    const pts = [...minuteStream(0, 60, () => 70), ...minuteStream(68, 120, () => 70)];
    expect(smoothSeries(pts, smoothingFor({ span: 24 * 60 * MIN, px: 300, step: MIN }))).toHaveLength(1);
    expect(smoothingFor({ span: 24 * 60 * MIN, px: 300, step: MIN })).toEqual({ bucket: 20 * MIN, gap: 50 * MIN });
    expect(smoothingFor({ span: 24, px: 700, step: 1 / 60, unitMs: 3_600_000 }).bucket).toBeCloseTo(10 / 60, 9);
  });

  it('is robust to spikes: a lone 140 in a 60s stream barely moves the line', () => {
    const pts = minuteStream(0, 240, (m) => (m === 100 || m === 101 ? 140 : m === 180 ? 20 : 60 + ((m * 7) % 5) - 2));
    const runs = smoothSeries(pts, smoothingFor({ span: 240 * MIN, px: 300, step: MIN }));
    const ex = smoothExtremes(runs)!;
    expect(ex.hi.v).toBeLessThan(64);
    expect(ex.lo.v).toBeGreaterThan(56);
    // even when the data is sparser than the bucket (one reading each), the rolling median takes the spike out
    const sparse = Array.from({ length: 30 }, (_, i) => ({ t: i * 10 * MIN, v: i === 15 ? 150 : 62 }));
    expect(smoothExtremes(smoothSeries(sparse, { bucket: 10 * MIN, gap: 30 * MIN }))!.hi.v).toBeLessThan(70);
  });

  it('keeps the band around the line and the shape of a real rise', () => {
    const pts = minuteStream(0, 360, (m) => (m < 180 ? 60 : 100) + ((m * 11) % 9) - 4);
    const runs = smoothSeries(pts, { bucket: 15 * MIN, gap: 45 * MIN });
    for (const p of runs.flat()) expect(p.lo <= p.v && p.v <= p.hi).toBe(true);
    expect(runs[0]![0]!.v).toBeLessThan(65);
    expect(runs[0]!.at(-1)!.v).toBeGreaterThan(95);
  });

  it('smooths a day of minute readings quickly', () => {
    const pts = minuteStream(0, 5000, (m) => 70 + 10 * Math.sin(m / 50) + ((m * 17) % 13) - 6);
    const t = performance.now();
    smoothSeries(pts, smoothingFor({ span: 5000 * MIN, px: 320, step: MIN }));
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('paths and keys', () => {
  it('the monotone cubic passes through every point and never overshoots a flat stretch', () => {
    const d = monotonePath([
      [0, 10],
      [10, 10],
      [20, 30],
      [30, 30],
    ]);
    expect(d.startsWith('M0.0,10.0C')).toBe(true);
    expect(d.endsWith('30.0,30.0')).toBe(true);
    // control points of the flat first segment stay at y = 10
    expect(d.split('C')[1]!.split(',').slice(0, 4).map(Number)).toEqual([3.3, 10, 6.7, 10]);
    expect(monotonePath([[1, 2]])).toBe('M1.0,2.0');
    expect(bandPath([[0, 1], [10, 2]], [[0, 5], [10, 6]])).toMatch(/Z$/);
  });

  it('the content key changes with the data, not with the array identity', () => {
    expect(dataKey([1, 2, 3])).toBe(dataKey([1, 2, 3]));
    expect(dataKey([1, 2, 3])).not.toBe(dataKey([1, 2, 4]));
    expect(dataKey([1, 2])).not.toBe(dataKey([1, 2, 0]));
  });
});

describe('displayDomain', () => {
  it('covers the band and the raw 5th–95th percentile, not a lone spike', async () => {
    const { displayDomain } = await import('../smooth');
    const raw = Array.from({ length: 100 }, (_, i) => (i === 50 ? 150 : 60 + (i % 10)));
    const runs = [[{ t: 0, v: 64, lo: 63, hi: 66, n: 1 }]];
    const [lo, hi] = displayDomain(runs, raw)!;
    expect(lo).toBeLessThanOrEqual(60.5);
    expect(hi).toBeGreaterThanOrEqual(68.5);
    expect(hi).toBeLessThan(100);
  });
});
