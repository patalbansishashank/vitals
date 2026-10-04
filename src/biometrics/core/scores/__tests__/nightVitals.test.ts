import { describe, expect, it } from 'vitest';
import { nightVitalsDefs, SPO2_ID, TEMP_ID } from '../nightVitals';
import { addDays } from '../util';
import { dates, mkDay, mkInput, mkPrior, mkSleep, ms, series } from '../__fixtures__/physio';

const spo2 = nightVitalsDefs.find((d) => d.scoreId === SPO2_ID)!;
const temp = nightVitalsDefs.find((d) => d.scoreId === TEMP_ID)!;
const D = '2026-09-20';
const pts = (date: string, vals: number[], stepMin = 10): Array<[number, number]> => vals.map((v, i) => [ms(date, '01:00') + i * stepMin * 60_000, v]);

describe('spo2.night', () => {
  it('mean, minimum, band; no flag on a normal night', () => {
    const r = spo2.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: series('spo2', pts(D, [96, 95, 97, 94])) }));
    expect(r.status).toBe('ok');
    expect(r.value).toBeCloseTo(95.5, 12);
    expect(r.detail).toMatchObject({ min_pct: 94, span_min: 30, prompt: null });
    expect(r.state).toBe('normal');
  });

  it('withheld under 30 min of samples', () => {
    expect(spo2.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: series('spo2', pts(D, [96, 95, 97])) })).status).toBe('withheld');
  });

  it('flags min < 88 % on ≥3 of 7 nights with a clinician prompt', () => {
    const prior = [1, 2].map((k) => mkPrior(SPO2_ID, addDays(D, -k), 93, { min_pct: 86, sourceKey: 'ring' }));
    const r = spo2.compute(mkInput(D, { days: [mkDay(D, mkSleep(D))], series: series('spo2', pts(D, [95, 87, 96, 95])), prior: { [SPO2_ID]: prior } }));
    expect(r.state).toBe('flag');
    expect(r.detail?.low_nights_7d).toBe(3);
    expect(String(r.detail?.prompt)).toMatch(/clinician/);
  });
});

describe('temp.deviation', () => {
  const hist = (n: number, c = 33) => dates(addDays(D, -n), n).map((d) => mkPrior(TEMP_ID, d, 0, { night_mean_c: c, sourceKey: 'ring', window: 'series_mean' }));
  const night = (vals: number[], tier: 'A' | 'C' = 'A') => mkInput(D, { days: [mkDay(D, mkSleep(D))], series: series('skin_temp', pts(D, vals), 'ring', tier) });

  it('deviation vs the 60-day median; elevated beyond the tier noise floor', () => {
    const r = temp.compute({ ...night([33.5, 33.6, 33.7]), prior: { [TEMP_ID]: hist(14) } });
    expect(r.value).toBeCloseTo(0.6, 10);
    expect(r.state).toBe('elevated');
    expect(r.band?.lo).toBeCloseTo(0.3, 10);
  });

  it('tier C: 0.45 °C is noise', () => {
    const r = temp.compute({ ...night([33.45, 33.45, 33.45], 'C'), prior: { [TEMP_ID]: hist(14) } });
    expect(r.state).toBe('within');
    expect(r.confidence).toBe('low');
  });

  it('insufficient baseline under 14 nights (still records the night mean)', () => {
    const r = temp.compute({ ...night([33.5, 33.6, 33.7]), prior: { [TEMP_ID]: hist(13) } });
    expect(r.status).toBe('insufficient_baseline');
    expect(r.detail?.night_mean_c).toBeCloseTo(33.6, 10);
  });
});
