import { describe, expect, it } from 'vitest';
import { lowest5MinMean, nightSignalAverage, RHR_ID, rhrDefs } from '../rhr';
import { dates, mkDay, mkInput, mkPrior, mkSleep, ms, series } from '../__fixtures__/physio';

const def = rhrDefs[0]!;
const D = '2026-09-20';

function hrNight(values: number[], tier: 'A' | 'C' = 'A') {
  // one sample every 10 min from 00:00 on the wake date
  return series('hr', values.map((v, i) => [ms(D, '00:00') + i * 600_000, v]), 'ring', tier);
}

describe('hr.rhr_night', () => {
  it('worked mean over the main sleep with tier band', () => {
    const vals = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61];
    const r = def.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: hrNight(vals) }));
    expect(r.status).toBe('ok');
    expect(r.value).toBeCloseTo(55.5, 10);
    expect(r.band).toEqual({ lo: 52.5, hi: 58.5, level: 0.95 });
    expect(r.scope).toEqual({ kind: 'night', localDate: D });
    expect(r.confidence).toBe('high');
    expect(r.detail?.ns_avg_bpm).toBe(55); // trunc(666/12)=55
  });

  it('withholds below 12 samples and without a main sleep', () => {
    const r = def.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: hrNight(Array(11).fill(55)) }));
    expect(r.status).toBe('withheld');
    expect(r.value).toBeNull();
    expect(def.compute(mkInput(D, { days: [mkDay(D)], series: hrNight(Array(20).fill(55)) })).status).toBe('withheld');
  });

  it('tier C with < 24 samples widens to ±10', () => {
    const r = def.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: hrNight(Array(12).fill(60), 'C') }));
    expect(r.band).toEqual({ lo: 50, hi: 70, level: 0.95 });
    expect(r.confidence).toBe('low');
  });

  it('streaming-median trend from ≥7 prior nights of the same source', () => {
    const prior = dates('2026-09-10', 9).map((d, i) => mkPrior(RHR_ID, d, [50, 52, 54, 51, 53, 52, 52, 60, 49][i]!, { sourceKey: 'ring' }));
    const r = def.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: hrNight(Array(12).fill(58)), prior: { [RHR_ID]: prior } }));
    expect(r.detail?.baseline_median_bpm).toBe(52);
    expect(r.detail?.delta_bpm).toBe(6);
    const other = prior.map((p) => ({ ...p, detail: { sourceKey: 'watch' } }));
    const r2 = def.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: hrNight(Array(12).fill(58)), prior: { [RHR_ID]: other } }));
    expect(r2.detail?.delta_bpm).toBeNull();
  });

  it('NightSignal average truncates samples and the mean, drops step minutes and out-of-window samples', () => {
    const m = ms(D, '00:00');
    const hr = [
      { t: m - 60_000, value: 90 },
      { t: m + 60_000, value: 60.9 },
      { t: m + 120_000, value: 61.2 },
      { t: m + 180_000, value: 62 },
      { t: m + 240_000, value: 100 },
      { t: m + 7 * 3_600_000, value: 90 },
    ];
    expect(nightSignalAverage(hr, [{ t: m + 240_000, value: 12 }], m)).toBe(61);
    expect(nightSignalAverage([{ t: m, value: 60 }, { t: m + 1, value: 61 }], [], m)).toBe(60); // trunc(60.5)
    expect(nightSignalAverage([], [], m)).toBeNull();
  });

  it('lowest 5-min mean', () => {
    expect(lowest5MinMean([{ t: 0, value: 60 }, { t: 100_000, value: 62 }, { t: 300_000, value: 50 }, { t: 400_000, value: 54 }], 0)).toBe(52);
  });

  it('is deterministic', () => {
    const inp = () => mkInput(D, { days: [mkDay(D, mkSleep(D))], series: hrNight(Array(14).fill(57)) });
    expect(def.compute(inp())).toEqual(def.compute(inp()));
  });
});
