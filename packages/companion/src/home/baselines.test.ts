// @vitest-environment node
/** Baselines (energy SPEC §S2.5, A.1.1): the gates at 6 and 7 nights, circular clock means, floors, ΔT, learning. */
import { describe, expect, it } from 'vitest';
import { circularClock, computeBaselines, type NightSummary } from './baselines.ts';
import { addDays } from './gaugeDerive.ts';

const DATE = '2026-10-20';
const night = (daysBefore: number, o: Partial<NightSummary> = {}): NightSummary => ({
  wakingDate: addDays(DATE, -daysBefore), onsetMin: 23 * 60 + 10, wakeMin: 6 * 60 + 40, midpointMin: 2 * 60 + 55, tstLowerMin: 400, nightlyLowHr: 52, hrvMs: 45, skinTempC: 35.8, ...o,
});
const nights = (n: number, f: (i: number) => Partial<NightSummary> = () => ({})) => Array.from({ length: n }, (_, i) => night(i + 1, f(i)));

describe('baselines', () => {
  it('6 nights: every baseline is still learning ("night 6 of 7"); 7 nights over 6 days: ready', () => {
    const six = computeBaselines(DATE, nights(6));
    expect(six.learning).toEqual({ nights: 6, needed: 7, learning: true });
    expect(six.usualOnset).toMatchObject({ minutes: null, n: 6, ready: false, reason: 'learning' });
    expect(six.sleepLowHr).toMatchObject({ medianBpm: 52, n: 6, spanDays: 5, ready: false });
    expect(six.hrvBaseline).toMatchObject({ n: 6, ready: false });
    expect(six.tempBaseline).toMatchObject({ n: 6, ready: false, deltaC: null });
    const seven = computeBaselines(DATE, nights(7), night(0, { skinTempC: 36.4 }));
    expect(seven.learning).toEqual({ nights: 7, needed: 7, learning: false });
    expect(seven.usualOnset).toEqual({ minutes: 1390, clock: '23:10', R: 1, n: 7, ready: true });
    expect(seven.usualWake).toMatchObject({ clock: '06:40', ready: true });
    expect(seven.usualMidpoint).toMatchObject({ clock: '02:55', ready: true });
    expect(seven.sleepLowHr).toEqual({ medianBpm: 52, s: 3, n: 7, spanDays: 6, ready: true });
    expect(seven.hrvBaseline).toMatchObject({ medianMs: 45, lnMedian: 3.807, n: 7, spanDays: 6, ready: true });
    // the 10 % floor (ln 1.1 ≈ 0.095) beats ln(1 + 3/45) ≈ 0.065 and a zero IQR
    expect(seven.hrvBaseline.lnS).toBe(0.095);
    expect(seven.tempBaseline).toEqual({ medianC: 35.8, deltaC: 0.6, n: 7, spanDays: 6, ready: true });
  });

  it('excludes the night of the date itself and anything older than 28 days', () => {
    const xs = [...nights(7), night(0, { nightlyLowHr: 90 }), night(29, { nightlyLowHr: 90 }), night(15, { nightlyLowHr: 90 })];
    const b = computeBaselines(DATE, xs);
    expect(b.sleepLowHr).toMatchObject({ medianBpm: 52, n: 7 }); // 14-day window: night 15 is out too
    expect(b.usualOnset.n).toBe(8); // 28-day window: nights 1–7 and 15
  });

  it('7 nights within 5 days (naps or a re-sent night counted twice) do not open the gate', () => {
    const xs = [...nights(5), night(1), night(2)];
    expect(computeBaselines(DATE, xs).hrvBaseline).toMatchObject({ n: 7, spanDays: 4, ready: false });
  });

  it('a circular mean across midnight; dispersed times (R̄ < 0.3) are suppressed', () => {
    expect(circularClock([23 * 60 + 50, 10, 23 * 60 + 40, 20, 0, 23 * 60 + 55, 5])).toMatchObject({ clock: '00:00', ready: true });
    const spread = circularClock([0, 360, 720, 1080, 180, 540, 900]);
    expect(spread).toMatchObject({ minutes: null, ready: false, reason: 'dispersed' });
    expect(spread.R!).toBeLessThan(0.3);
  });

  it('the sleeping-low scale is max(IQR/1.349, 3 bpm); learning counts only nights with at least 180 min asleep', () => {
    const b = computeBaselines(DATE, nights(10, (i) => ({ nightlyLowHr: 46 + i * 2, tstLowerMin: i < 3 ? 120 : 400 })));
    // 46, 48, …, 64: P25 50.5, P75 59.5 (linear interpolation), IQR 9 → 9/1.349 = 6.7 bpm
    expect(b.sleepLowHr).toMatchObject({ medianBpm: 55, s: 6.7, n: 10 });
    expect(b.learning).toEqual({ nights: 7, needed: 7, learning: false });
  });
});
