import { describe, expect, it } from 'vitest';
import { metricScale } from '../scales';
import type { PersonalBaselines } from '../model';

const metric = { units: 'metric' } as const;
const imperial = { units: 'imperial' } as const;
const ready = (o: Partial<NonNullable<PersonalBaselines>> = {}): PersonalBaselines => ({
  hrvBaseline: { median: Math.log(62), s: 0.15, medianMs: 62, n: 28, spanDays: 28, ready: true },
  tempBaseline: { median: 34.2, n: 28, spanDays: 28, deltaT: null, ready: true },
  learning: { nights: 28, needed: 7, learning: false },
  ...o,
});
const forming: PersonalBaselines = { hrvBaseline: null, tempBaseline: null, learning: { nights: 3, needed: 7, learning: true } };

describe('metricScale (r071)', () => {
  it('heart rate, blood oxygen and stress read against their fixed bands, the band edges as ticks', () => {
    const hr = metricScale('hr', 74, null, metric);
    expect([hr.min, hr.max, hr.ticks, hr.unit, hr.state]).toEqual([40, 160, 'bands', 'bpm', 'normal']);
    expect(hr.bands.map((b) => b.word)).toEqual(['Low', 'Normal', 'Elevated', 'High']);
    expect(metricScale('spo2', 97, null, metric).bands.map((b) => b.from)).toEqual([-Infinity, 89, 93, 95]);
    expect(metricScale('stress', 44, null, metric).bands.map((b) => b.word)).toEqual(['Calm', 'Normal', 'Elevated', 'High']);
    expect(metricScale('stress', 44, null, metric).unit).toBe('ring index');
  });

  it('no reading is none, and a stale one says so', () => {
    expect(metricScale('hr', null, null, metric).state).toBe('none');
    expect(metricScale('hr', 74, null, metric, { stale: true }).state).toBe('stale');
  });

  it('HRV reads against the usual stretch from the baseline: median 62 ms, near usual within 10 %', () => {
    const s = metricScale('hrv', 70, ready(), metric);
    expect(s.state).toBe('normal');
    expect(s.usual![0]).toBeLessThan(62);
    expect(s.usual![1]).toBeGreaterThan(62);
    expect(s.min).toBeLessThan(s.usual![0]);
    expect(s.max).toBeGreaterThan(s.usual![1]);
    // the reading is always inside the scale
    expect(70).toBeGreaterThanOrEqual(s.min);
    expect(70).toBeLessThanOrEqual(s.max);
    expect(s.bands.map((b) => b.word)).toEqual(['Below usual', 'Near usual', 'Above usual']);
    // 62 − max(3, 6.2) = 55.8: the "near usual" edge is the status rule's, so the scale and the word cannot disagree
    expect(s.bands[1]!.from).toBeCloseTo(55.8, 1);
    expect(s.bands[2]!.from).toBeCloseTo(68.2, 1);
  });

  it('a baseline still forming is calibrating, with no usual stretch (never one that is not there)', () => {
    const s = metricScale('hrv', 70, forming, metric);
    expect(s.state).toBe('calibrating');
    expect(s.usual).toBeUndefined();
    expect(metricScale('temp', 34.6, forming, metric).state).toBe('calibrating');
    expect(metricScale('temp', 34.6, forming, metric).value).toBeNull();
  });

  it('skin temperature is the difference from the usual night, centred on zero with the 0.5 degree limits, in the person\'s unit', () => {
    const c = metricScale('temp', 34.6, ready(), metric);
    expect(c.value).toBe(0.4);
    expect(c.usual).toEqual([-0.5, 0.5]);
    expect([c.min, c.max]).toEqual([-1.5, 1.5]);
    expect(c.delta).toBe(true);
    const f = metricScale('temp', 34.6, ready(), imperial);
    expect(f.unit).toBe('°F');
    expect(f.value).toBe(0.7); // 0.4 °C is 0.72 °F: a difference, with no 32 offset
    expect(f.usual![1]).toBeCloseTo(0.9, 5);
  });
});
