import { describe, expect, it } from 'vitest';
import { hrvDefs, hrvStatus, LN_ID, rejectArtefacts, rmssdFromIbi, STATUS_ID, STRAIN_ID } from '../hrv';
import { addDays } from '../util';
import { mkDay, mkInput, mkPrior, mkSleep, ms, rng, series } from '../__fixtures__/physio';

const [lnDef, statusDef, strainDef] = [hrvDefs.find((d) => d.scoreId === LN_ID)!, hrvDefs.find((d) => d.scoreId === STATUS_ID)!, hrvDefs.find((d) => d.scoreId === STRAIN_ID)!];
const D = '2026-09-20';

function ibi(minutes: number, start = ms(D, '01:00')) {
  const pts: Array<[number, number]> = [];
  let t = start;
  for (let i = 0; t < start + minutes * 60_000; i++) {
    const rr = i % 2 ? 1040 : 1000;
    pts.push([t, rr]);
    t += rr;
  }
  return pts;
}

describe('IBI → RMSSD', () => {
  it('alternating 1000/1040 ms gives RMSSD 40 per window', () => {
    const r = rmssdFromIbi(ibi(30).map(([t, value]) => ({ t, value })), ms(D, '01:00'));
    expect(r?.rmssd).toBeCloseTo(40, 10);
    expect(r?.windows).toBe(6);
  });

  it('rejects out-of-range and >20 % local deviations without breaking the difference chain', () => {
    expect(rejectArtefacts([1000, 1010, 3000, 990, 1000, 1500, 1005, 1000])).toEqual([false, false, true, false, false, true, false, false]);
    const pts = ibi(30).map(([t, value]) => ({ t, value }));
    pts[100] = { ...pts[100]!, value: 250 };
    expect(rmssdFromIbi(pts, ms(D, '01:00'))?.rmssd).toBeCloseTo(40, 10);
  });
});

describe('hrv.ln_rmssd_night', () => {
  it('uses IBI when present', () => {
    const r = lnDef.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: series('ibi', ibi(30)) }));
    expect(r.status).toBe('ok');
    expect(r.value).toBeCloseTo(Math.log(40), 10);
    expect(r.detail).toMatchObject({ window: 'ibi_5min_mean', sourceKey: 'ring' });
    expect(r.band?.lo).toBeCloseTo(Math.log(28), 10);
  });

  it('falls back to source RMSSD; never converts SDNN', () => {
    const s = mkSleep(D);
    s.night = { hrv: { metric: 'rmssd', value_ms: 50 } };
    expect(lnDef.compute(mkInput(D, { days: [mkDay(D, s)] })).value).toBeCloseTo(Math.log(50), 10);
    const a = mkSleep(D);
    a.night = { hrv: { metric: 'sdnn', value_ms: 50 } };
    const r = lnDef.compute(mkInput(D, { days: [mkDay(D, a)] }));
    expect(r.status).toBe('withheld');
    expect(r.reason).toMatch(/SDNN/);
  });

  it('tier C / vendor HRV is within-person only: no band, low confidence', () => {
    const s = mkSleep(D, { tier: 'C' });
    s.night = { hrv: { metric: 'vendor', value_ms: 40 } };
    const r = lnDef.compute(mkInput(D, { days: [mkDay(D, s)] }));
    expect(r.band).toBeUndefined();
    expect(r.confidence).toBe('low');
    expect(r.detail?.within_person_only).toBe(true);
  });
});

describe('hrv.status', () => {
  it('worked example: below, not borderline', () => {
    const base = Array.from({ length: 14 }, (_, i) => (i % 2 ? 4.2 : 4.0));
    const s = hrvStatus([3.9, 3.9, 3.9], base);
    expect(s.mu).toBeCloseTo(4.1, 12);
    expect(s.sigma).toBeCloseTo(0.1 * Math.sqrt(14 / 13), 12);
    expect(s.lo).toBeCloseTo(4.1 - 0.05 * Math.sqrt(14 / 13), 12);
    expect(s.state).toBe('below');
    expect(s.borderline).toBe(false);
    expect(hrvStatus([4.05, 4.05, 4.05], base).borderline).toBe(true);
  });

  const prior = (vals: Array<[number, number]>) => vals.map(([k, v]) => mkPrior(LN_ID, addDays(D, -k), v, { sourceKey: 'ring', window: 'summary_sleep', tier: 'A' }));
  const nightly = (k: number) => (k % 2 ? 4.2 : 4.0);

  it('uses prior nightly values of the same source/window; gates on 3-in-7 and 14 baseline', () => {
    const hist: Array<[number, number]> = [...[0, 1, 2].map((k) => [k, 3.9] as [number, number]), ...Array.from({ length: 20 }, (_, i) => [i + 7, nightly(i)] as [number, number])];
    const r = statusDef.compute(mkInput(D, { prior: { [LN_ID]: prior(hist) } }));
    expect(r.status).toBe('ok');
    expect(r.state).toBe('below');
    expect(r.value).toBeCloseTo(3.9, 12);
    expect(r.confidence).toBe('low'); // < 60 days of baseline
    const few = statusDef.compute(mkInput(D, { prior: { [LN_ID]: prior(hist.slice(0, 3 + 13)) } }));
    expect(few.status).toBe('insufficient_baseline');
    expect(statusDef.compute(mkInput(D, { prior: { [LN_ID]: prior(hist.slice(1)) } })).status).toBe('withheld');
  });

  it('strain_accumulating: rising CV_7 with falling 7-day mean after a stable history', () => {
    const rand = rng(3);
    const hist: Array<[number, number]> = [];
    for (let k = 7; k < 70; k++) hist.push([k, 4.2 + (rand() - 0.5) * 0.04]);
    [3.6, 4.3, 3.5, 4.2, 3.4, 4.1, 3.5].forEach((v, k) => hist.push([k, v]));
    const r = strainDef.compute(mkInput(D, { prior: { [LN_ID]: prior(hist) } }));
    expect(r.status).toBe('ok');
    expect(r.state).toBe('strain_accumulating');
    const calm: Array<[number, number]> = hist.filter(([k]) => k >= 7).concat([0, 1, 2, 3, 4, 5, 6].map((k) => [k, 4.2] as [number, number]));
    expect(strainDef.compute(mkInput(D, { prior: { [LN_ID]: prior(calm) } })).state).toBe('none');
    expect(strainDef.compute(mkInput(D, { prior: { [LN_ID]: prior(hist.filter(([k]) => k < 20)) } })).status).toBe('insufficient_baseline');
  });
});
