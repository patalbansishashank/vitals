import { describe, expect, it } from 'vitest';
import { autonomicDefs, baselineStats, logistic100, personalDeviation } from '../autonomic';
import { LN_ID } from '../hrv';
import { RHR_ID } from '../rhr';
import { addDays } from '../util';
import { mkInput, mkPrior } from '../__fixtures__/physio';

const def = autonomicDefs[0]!;
const D = '2026-09-20';

function priors(n: number, tonight: { rmssd: number; rhr: number }) {
  const hrv = [];
  const rhr = [];
  for (let k = 1; k <= n; k++) {
    hrv.push(mkPrior(LN_ID, addDays(D, -k), Math.log(50), { rmssd_ms: 50, sourceKey: 'ring', window: 'summary_sleep' }));
    rhr.push(mkPrior(RHR_ID, addDays(D, -k), 55, { sourceKey: 'ring' }));
  }
  hrv.push(mkPrior(LN_ID, D, Math.log(tonight.rmssd), { rmssd_ms: tonight.rmssd, sourceKey: 'ring', window: 'summary_sleep' }));
  rhr.push(mkPrior(RHR_ID, D, tonight.rhr, { sourceKey: 'ring' }));
  return { [LN_ID]: hrv, [RHR_ID]: rhr };
}

describe('autonomic.deviation', () => {
  it('worked: flat baseline uses scale floors (HRV 5 ms, RHR 3 bpm)', () => {
    const r = def.compute(mkInput(D, { prior: priors(10, { rmssd: 40, rhr: 58 }) }));
    expect(r.status).toBe('ok');
    expect(r.detail?.z_hrv).toBeCloseTo(-2, 12);
    expect(r.detail?.z_rhr).toBeCloseTo(1, 12);
    expect(r.detail?.ard).toBeCloseTo(1.6, 12);
    expect(r.value).toBeCloseTo(100 / (1 + Math.exp(-1.92)), 10);
    expect(r.confidence).toBe('low');
  });

  it('usual night = 50', () => {
    expect(def.compute(mkInput(D, { prior: priors(10, { rmssd: 50, rhr: 55 }) })).value).toBeCloseTo(50, 12);
  });

  it('insufficient baseline under 7 nights; withheld without tonight', () => {
    expect(def.compute(mkInput(D, { prior: priors(5, { rmssd: 40, rhr: 58 }) })).status).toBe('insufficient_baseline');
    expect(def.compute(mkInput(D)).status).toBe('withheld');
  });

  it('robust deviation and clipping', () => {
    const b = baselineStats([1, 2, 3, 4, 5, 6, 7, 8, 9].map((v, i) => ({ date: addDays(D, -i - 1), value: v })));
    expect(b).toMatchObject({ median: 5, p25: 3, p75: 7, n: 9, spanDays: 8 });
    expect(personalDeviation(5 + 4 / 1.349, b, 1)).toBeCloseTo(1, 12);
    expect(personalDeviation(100, b, 1)).toBe(3);
    expect(logistic100(10)).toBeCloseTo(logistic100(3), 12);
  });
});
