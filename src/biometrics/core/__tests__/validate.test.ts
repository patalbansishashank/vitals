import { describe, expect, it } from 'vitest';
import { fahrenheitToC, fractionToPct, kjToKcal, kmToM, normaliseValue, validateBatch, validateRecord } from '../validate';
import { batch, daily, hrSeries, prov } from './factory';

describe('unit normalisation', () => {
  it('converts', () => {
    expect(fractionToPct(0.97)).toBeCloseTo(97);
    expect(fahrenheitToC(98.6)).toBeCloseTo(37, 5);
    expect(kjToKcal(418.4)).toBeCloseTo(100, 5);
    expect(kmToM(1.5)).toBe(1500);
    expect(normaliseValue('spo2', 'fraction', 0.95)).toBeCloseTo(95);
    expect(normaliseValue('skin_temp', '°F', 95)).toBeCloseTo(35);
    expect(normaliseValue('spo2', 'furlongs', 1)).toBeNull();
  });
});

describe('validateRecord', () => {
  it('drops out-of-range daily fields with a flag and warning', () => {
    const r = validateRecord(daily('a', '2026-03-10', { resting_hr_bpm: 400, spo2_avg_pct: 96, steps: 8000 }));
    expect(r.record).not.toBeNull();
    const d = r.record as ReturnType<typeof daily>;
    expect(d.resting_hr_bpm).toBeUndefined();
    expect(d.spo2_avg_pct).toBe(96);
    expect(d.quality.flags).toContain('out_of_range');
    expect(r.warnings).toHaveLength(1);
  });
  it('does not mutate its input', () => {
    const input = daily('a', '2026-03-10', { resting_hr_bpm: 400 });
    validateRecord(input);
    expect(input.resting_hr_bpm).toBe(400);
  });
  it('rejects structural problems', () => {
    expect(validateRecord({ kind: 'daily' }).error).toBeDefined();
    expect(validateRecord(daily('a', '2026-13-45')).record).toBeNull();
    expect(validateRecord({ ...daily('a', '2026-03-10'), kind: 'nope' }).record).toBeNull();
    expect(validateRecord({ ...hrSeries('s', '2026-03-10T00:00:00.000Z', [1, 2]), t_offset_s: [0] }).record).toBeNull();
    expect(validateRecord(hrSeries('s', '2026-03-10T00:00:00.000Z', [60, 61], 60, prov(), { unit: 'furlongs' })).error).toMatch(/unit/);
  });
  it('series: drops bad samples keeping time alignment, normalises units', () => {
    const r = validateRecord(hrSeries('s', '2026-03-10T00:00:00.000Z', [60, 300, 62, Number.NaN], 60));
    const s = r.record as ReturnType<typeof hrSeries>;
    expect(s.values).toEqual([60, 62]);
    expect(s.t_offset_s).toEqual([0, 120]);
    expect(s.interval_s).toBeUndefined();
    expect(s.quality.flags).toContain('out_of_range');
    const sp = validateRecord(hrSeries('x', '2026-03-10T00:00:00.000Z', [0.96, 0.9], 60, prov(), { metric: 'spo2', unit: 'fraction' })).record as ReturnType<typeof hrSeries>;
    expect(sp.unit).toBe('pct');
    expect(sp.values[0]).toBeCloseTo(96);
  });
  it('batch: rejects bad records individually', () => {
    const b = batch([daily('a', '2026-03-10', { steps: 5 }), { kind: 'daily' } as never]);
    const c = validateBatch(b);
    expect(c.batch?.records).toHaveLength(1);
    expect(c.rejected).toHaveLength(1);
    expect(validateBatch({ schema: 'x' }).batch).toBeNull();
  });
});
