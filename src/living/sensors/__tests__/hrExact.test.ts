// @vitest-environment node
/**
 * Codex core #11: exact HR zone time and Heart Points from the raw readings' own `hr-support/1` intervals
 * (`/v1/gauge/hr-intervals`), with the minute means only as the stated fallback.
 */
import { describe, expect, it } from 'vitest';
import { estimateFor, windowHrSegments, type WindowMinutes } from '../../activityCandidates';
import { freezeZoneBoundaries, hrProfile } from '../hrProfile';
import { heartPoints, minutePoints } from '../heartPoints';
import { HR_INTERVAL_MAX_MS, hrSegmentsFor, segmentsFromHrIntervals, segmentsFromTimeline, zoneTime, type HrIntervalReading } from '../hrZones';

const T0 = Date.UTC(2026, 9, 20, 6, 0, 0);
/** A 10-s workout reading at `sec` (its support ±5 s). */
const r10 = (sec: number, bpm: number): HrIntervalReading => ({ t: T0 + sec * 1000, bpm, nextT: T0 + (sec + 10) * 1000, start: T0 + (sec - 5) * 1000, end: T0 + (sec + 5) * 1000 });
/** The Codex scenario: 30 s at 110 bpm, then 30 s at 170, inside the minute [T0, T0 + 60 s). */
const scenario = [5, 15, 25].map((s) => r10(s, 110)).concat([35, 45, 55].map((s) => r10(s, 170)));
const b200 = freezeZoneBoundaries(hrProfile({ ageY: 40, hrMaxOverride: 200 }))!;
const window = { start: T0, end: T0 + 60_000 };

describe('segmentsFromHrIntervals', () => {
  it('one segment per supported reading, sorted and never overlapping; an undeclared cadence stands for no time', () => {
    const segs = segmentsFromHrIntervals([r10(15, 120), r10(5, 110), { t: T0 + 30_000, bpm: 90, nextT: null, start: null, end: null }, { ...r10(12, 130), start: T0 + 8_000, end: T0 + 16_000 }]);
    // the third reading's interval is trimmed where the earlier one ended
    expect(segs.map((g) => [(g.start - T0) / 1000, (g.end - T0) / 1000, g.bpm])).toEqual([[0, 10, 110], [10, 16, 130], [16, 20, 120]]);
  });

  it('never longer than 5 min, never past the next reading', () => {
    const long = segmentsFromHrIntervals([{ t: T0, bpm: 100, nextT: null, start: T0, end: T0 + 3_600_000 }]);
    expect(long[0]!.end - long[0]!.start).toBe(HR_INTERVAL_MAX_MS);
    const next = segmentsFromHrIntervals([{ t: T0, bpm: 100, nextT: T0 + 4_000, start: T0 - 5_000, end: T0 + 5_000 }]);
    expect(next[0]!.end).toBe(T0 + 4_000);
    expect(segmentsFromHrIntervals([{ t: T0, bpm: Number.NaN, nextT: null, start: T0, end: T0 + 1 }])).toEqual([]);
  });

  it('hrSegmentsFor: exact when the readings are there (even none), else the minute means, and says which', () => {
    const minutes = { first: T0, bpm: [140], supportedS: [60] };
    expect(hrSegmentsFor({ exact: segmentsFromHrIntervals(scenario), minutes }).source).toBe('samples');
    expect(hrSegmentsFor({ exact: [], minutes })).toEqual({ segments: [], source: 'samples' });
    expect(hrSegmentsFor({ exact: null, minutes })).toEqual({ segments: segmentsFromTimeline(T0, [140], [60]), source: 'minuteMeans' });
  });
});

describe('Codex #11: 30 s at 110 then 30 s at 170 (HRmax 200)', () => {
  it('exact: 30 s in Z1 and 30 s in Z4; the minute mean (140) would make it a minute of Z3', () => {
    const exact = zoneTime({ window, segments: segmentsFromHrIntervals(scenario), boundaries: b200, hrSource: 'samples' });
    expect(exact.zonesS).toEqual([30, 0, 0, 30, 0]);
    expect(exact.hrSource).toBe('samples');
    expect(exact.meanBpm).toBe(140);
    expect(exact.observedPeakBpm).toBe(170);
    const mean = zoneTime({ window, segments: segmentsFromTimeline(T0, [140], [60]), boundaries: b200, hrSource: 'minuteMeans' });
    expect(mean.zonesS).toEqual([0, 0, 60, 0, 0]);
    expect(mean.hrSource).toBe('minuteMeans');
  });

  it('Heart Points at age 40: 1.5 from the exact parts, 2 from the minute mean', () => {
    const parts = [{ bpm: 110, seconds: 30 }, { bpm: 170, seconds: 30 }];
    const m = { start: T0, asleep: false, activity: { met: null }, cadence: null };
    expect(minutePoints({ ...m, hr: { bpm: 140, supportedS: 60, parts } }, 205.8 - 0.685 * 40).points).toBeCloseTo(1.5, 10);
    expect(minutePoints({ ...m, hr: { bpm: 140, supportedS: 60 } }, 205.8 - 0.685 * 40).points).toBe(2);
    // parts never exceed the minute's eligible seconds
    expect(heartPoints({ ageY: 40, minutes: [{ ...m, seconds: 40, hr: { bpm: 140, supportedS: 60, parts } }] }).points).toBeCloseTo(0.5 + (10 / 60) * 2, 10);
  });

  it('the bout estimate uses the exact readings when the evidence has them, and names the source', () => {
    const person = { massKg: 80, ageY: 40, sex: 'male' as const, rmrKcalPerDay: 1800 };
    const means: WindowMinutes = { first: T0, steps: [null], hr: { bpm: [140], supportedS: [60] } };
    const exact: WindowMinutes = { ...means, hrExact: segmentsFromHrIntervals(scenario) };
    const a = estimateFor({ exerciseId: 'cycle_outdoor', window, person, minutes: exact, keytelEnabled: false })!;
    const b = estimateFor({ exerciseId: 'cycle_outdoor', window, person, minutes: means, keytelEnabled: false })!;
    expect(a.heartPoints).toBeCloseTo(1.5, 10);
    expect(a.hrSource).toBe('samples');
    expect(b.heartPoints).toBe(2);
    expect(b.hrSource).toBe('minuteMeans');
    expect(estimateFor({ exerciseId: 'cycle_outdoor', window, person, keytelEnabled: false })!.hrSource).toBeUndefined();
    expect(windowHrSegments(exact, window).source).toBe('samples');
    expect(windowHrSegments(null, window)).toEqual({ segments: [], source: null });
  });

  it('a paused part of the minute earns nothing from the exact readings', () => {
    const person = { massKg: 80, ageY: 40, sex: 'male' as const, rmrKcalPerDay: 1800 };
    const exact: WindowMinutes = { first: T0, steps: [null], hr: { bpm: [140], supportedS: [60] }, hrExact: segmentsFromHrIntervals(scenario) };
    // the 170-bpm half is paused: 30 s at 110 = 0.5 point
    const e = estimateFor({ exerciseId: 'cycle_outdoor', window, person, minutes: exact, keytelEnabled: false, pauses: [{ start: T0 + 30_000, end: T0 + 60_000 }] })!;
    expect(e.heartPoints).toBeCloseTo(0.5, 10);
  });
});
