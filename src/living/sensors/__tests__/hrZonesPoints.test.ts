// @vitest-environment node
/** HR profile, zones and Heart Points (energy SPEC §V2.1-V2.3, Addendum A.1.2 #35-36). */
import { describe, expect, it } from 'vitest';
import { fitHrMax, heartPoints, minutePoints, weekPoints, weekPointsPace } from '../heartPoints';
import { freezeZoneBoundaries, hrProfile, suggestHrMaxRaise, sustainedPeakBpm, tanakaHrMax } from '../hrProfile';
import { dayZones, filteredPeakBpm, segmentsFromTimeline, zoneOf, zoneTime, zoneTimeTotalS } from '../hrZones';
import type { HrSegment } from '../types';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 20, 6, 0, 0);
const seg = (start: number, s: number, bpm: number): HrSegment => ({ start, end: start + s * 1000, bpm });
const run10s = (start: number, n: number, bpm: number | ((k: number) => number)): HrSegment[] =>
  Array.from({ length: n }, (_, k) => seg(start + k * 10_000, 10, typeof bpm === 'number' ? bpm : bpm(k)));

describe('hrProfile', () => {
  it('Tanaka by default; override wins; the sleeping low is never HRrest without the D6 opt-in', () => {
    const p = hrProfile({ ageY: 40, sleepingLowHr: 52 });
    expect(p.hrMax).toEqual({ bpm: 180, source: 'tanaka', sdBpm: 10 });
    expect(p.hrRest).toBeNull();
    expect(p.basis).toBe('pctMax');
    expect(p.sleepingLowHr).toBe(52);
    expect(hrProfile({ ageY: 40, hrMaxOverride: 191 }).hrMax!.source).toBe('override');
    const proxy = hrProfile({ ageY: 40, sleepingLowHr: 52, proxySleepLowOptIn: true });
    expect(proxy.hrRest).toEqual({ bpm: 52, source: 'proxySleepLow' });
    expect(proxy.basis).toBe('hrr');
    expect(proxy.wakingRest).toBe(false);
    expect(hrProfile({ ageY: 40, hrRestOverride: 64 }).wakingRest).toBe(true);
  });

  it('HRR only when the reserve is at least 40 bpm', () => {
    expect(hrProfile({ ageY: 40, hrMaxOverride: 100, hrRestOverride: 61 }).basis).toBe('pctMax');
    expect(hrProfile({ ageY: 40, hrMaxOverride: 100, hrRestOverride: 61 }).basisReason).toBe('reserveTooSmall');
    expect(hrProfile({ ageY: 40, hrMaxOverride: 100, hrRestOverride: 60 }).basis).toBe('hrr');
  });

  it('suggests an upward HRmax only from ≥ 3 quality bouts in 180 days, and never downward', () => {
    const p = hrProfile({ ageY: 40 }); // 180
    const now = T0;
    const bout = (id: string, daysAgo: number, peak: number, quality = true) => {
      const s = now - daysAgo * 86_400_000;
      return { id, window: { start: s, end: s + 10 * MIN }, quality, segments: run10s(s, 60, (k) => (k >= 20 && k < 24 ? peak : 150)) };
    };
    expect(suggestHrMaxRaise(p, [bout('a', 3, 186), bout('b', 10, 189)], now)).toBeNull();
    expect(suggestHrMaxRaise(p, [bout('a', 3, 186), bout('b', 10, 189), bout('c', 200, 190)], now)).toBeNull(); // too old
    expect(suggestHrMaxRaise(p, [bout('a', 3, 186), bout('b', 10, 189), bout('c', 20, 190, false)], now)).toBeNull(); // poor quality
    const s = suggestHrMaxRaise(p, [bout('a', 3, 186), bout('b', 10, 189), bout('c', 20, 190), bout('d', 30, 170)], now)!;
    expect(s.suggestedBpm).toBe(186);
    expect(s.needsConfirmation).toBe(true);
    expect(s.boutIds.sort()).toEqual(['a', 'b', 'c']);
    // a single 10-s spike is not a sustained 30 s
    expect(sustainedPeakBpm([...run10s(T0, 3, 150), seg(T0 + 30_000, 10, 199), ...run10s(T0 + 40_000, 3, 150)])).toBe(150);
  });
});

describe('hrZones', () => {
  const zb = freezeZoneBoundaries(hrProfile({ ageY: 40 }))!; // 180: edges 90, 108, 126, 144, 162, 180

  it('edge values belong to the zone above; Z5 includes 100 %; above is kept visible', () => {
    expect(zb.edgesBpm).toEqual([90, 108, 126, 144, 162, 180]);
    expect([89.9, 90, 108, 126, 144, 162, 180, 180.1].map((b) => zoneOf(b, zb))).toEqual([-1, 0, 1, 2, 3, 4, 4, 5]);
  });

  it('reconciles exactly: below50 + Z1..Z5 + above + unknown + paused = elapsed', () => {
    const w = { start: T0, end: T0 + 30 * MIN };
    const segs = [...run10s(T0, 30, 80), ...run10s(T0 + 5 * MIN, 90, 130), ...run10s(T0 + 20 * MIN, 12, 185)];
    const z = zoneTime({ window: w, pauses: [{ start: T0 + 15 * MIN, end: T0 + 18 * MIN }], segments: segs, boundaries: zb });
    expect(z.elapsedS).toBe(1800);
    expect(z.pausedS).toBe(180);
    expect(z.below50S).toBe(300);
    expect(z.zonesS[2]).toBe(900 - 180); // the pause removes 3 of the 15 min at 130
    expect(z.aboveEstimateS).toBe(120);
    expect(zoneTimeTotalS(z)).toBe(z.elapsedS);
    expect(z.unknownS).toBe(1800 - 180 - 300 - 720 - 120);
  });

  it('sparse HR gives no zone time (unknown), and duplicates never add coverage', () => {
    const w = { start: T0, end: T0 + 60 * MIN };
    // three isolated 5-min background readings with no declared support → S2 gives no supported segments
    const z = zoneTime({ window: w, segments: [], boundaries: zb });
    expect(z.zonesS).toEqual([0, 0, 0, 0, 0]);
    expect(z.unknownS).toBe(3600);
    const dup = run10s(T0, 6, 150);
    const z2 = zoneTime({ window: w, segments: [...dup, ...dup], boundaries: zb });
    expect(z2.zonesS[3]).toBe(60);
  });

  it('filtered peak ignores a one-sample spike', () => {
    const s = [...run10s(T0, 3, 150), seg(T0 + 30_000, 10, 205), ...run10s(T0 + 40_000, 3, 152)];
    expect(filteredPeakBpm(s)).toBe(152);
    expect(zoneTime({ window: { start: T0, end: T0 + MIN + 10_000 }, segments: s, boundaries: zb }).rawMaxBpm).toBe(205);
  });

  it('day zones: clipped at midnight, reconciling to the bout totals; pending only as "to review"', () => {
    const midnight = Date.UTC(2026, 9, 20, 18, 30); // local midnight in +05:30
    const day = { start: midnight - 24 * 3_600_000, end: midnight };
    const late = { id: 'late', status: 'approved' as const, window: { start: midnight - 20 * MIN, end: midnight + 20 * MIN }, segments: run10s(midnight - 20 * MIN, 240, 150), boundaries: zb };
    const am = { id: 'am', status: 'approved' as const, window: { start: day.start + 7 * 60 * MIN, end: day.start + 7 * 60 * MIN + 30 * MIN }, segments: run10s(day.start + 7 * 60 * MIN, 180, 120), boundaries: zb };
    const pend = { id: 'p', status: 'pending' as const, window: { start: day.start + 12 * 60 * MIN, end: day.start + 12 * 60 * MIN + 10 * MIN }, segments: run10s(day.start + 12 * 60 * MIN, 60, 170), boundaries: zb };
    const d = dayZones({ day, bouts: [late, am, pend] });
    expect(d.zonesMin[3]).toBeCloseTo(20, 9); // only the 20 min before midnight
    expect(d.zonesMin[1]).toBeCloseTo(30, 9);
    expect(d.z13Min).toBeCloseTo(30, 9);
    expect(d.z45Min).toBeCloseTo(20, 9);
    expect(d.toReview).toBeNull();
    const sumBouts = d.byBout.reduce((a, b) => a + b.zones.zonesS.reduce((x, y) => x + y, 0), 0) / 60;
    expect(d.zonesMin.reduce((a, b) => a + b, 0)).toBeCloseTo(sumBouts, 9);
    const next = dayZones({ day: { start: midnight, end: midnight + 24 * 3_600_000 }, bouts: [late] });
    expect(next.zonesMin[3]).toBeCloseTo(20, 9);
    const withOverlay = dayZones({ day, bouts: [late, am, pend], provisionalOverlay: true });
    expect(withOverlay.toReview!.zonesMin[4]).toBeCloseTo(10, 9);
    expect(withOverlay.zonesMin[4]).toBe(0);
    expect(d.label).toBe('from recorded activity');
  });

  it('timeline minute means become segments of their supported seconds', () => {
    const s = segmentsFromTimeline(T0, [120, null, 130], [60, 30, 20]);
    expect(s).toEqual([seg(T0, 60, 120), seg(T0 + 2 * MIN, 20, 130)]);
  });
});

describe('heartPoints (fit-points/1)', () => {
  const hrMax = fitHrMax(35); // 181.825

  it('uses Fit\'s own maximum, distinct from Tanaka', () => {
    expect(hrMax).toBeCloseTo(181.825, 9);
    expect(hrMax).not.toBeCloseTo(tanakaHrMax(35), 0);
  });

  it('60 s vigorous = 2; a 6.0 MET minute = 2; a 3.0 MET minute = 1', () => {
    expect(minutePoints({ start: 0, asleep: false, activity: { met: null }, cadence: null, hr: { bpm: 0.7 * hrMax, supportedS: 60 } }, hrMax).points).toBe(2);
    expect(minutePoints({ start: 0, asleep: false, activity: { met: 6.0 }, cadence: null }, hrMax).points).toBe(2);
    expect(minutePoints({ start: 0, asleep: false, activity: { met: 3.0 }, cadence: null }, hrMax).points).toBe(1);
    expect(minutePoints({ start: 0, asleep: false, activity: { met: 2.9 }, cadence: null }, hrMax).points).toBe(0);
  });

  it('one channel per sub-interval: HR seconds use HR, the rest the next channel; never added', () => {
    const r = minutePoints({ start: 0, asleep: false, activity: { met: 8 }, cadence: 0, hr: { bpm: 0.55 * hrMax, supportedS: 30 } }, hrMax);
    expect(r.channels).toEqual([
      { channel: 'hr', seconds: 30, rate: 1 },
      { channel: 'met', seconds: 30, rate: 2 },
    ]);
    expect(r.points).toBeCloseTo(1.5, 9);
    // HR present and eligible wins even when it reads low: the MET never tops it up for those seconds
    expect(minutePoints({ start: 0, asleep: false, activity: { met: 8 }, cadence: null, hr: { bpm: 70, supportedS: 60 } }, hrMax).points).toBe(0);
  });

  it('no points during sleep or for still minutes; cadence 130 is 2 only for a run gait', () => {
    expect(minutePoints({ start: 0, asleep: true, activity: { met: 8 }, cadence: 140, hr: { bpm: 170, supportedS: 60 } }, hrMax).points).toBe(0);
    expect(minutePoints({ start: 0, asleep: false, cadence: 0, hr: { bpm: 140, supportedS: 60 } }, hrMax).points).toBe(0);
    expect(minutePoints({ start: 0, asleep: false, cadence: 135, gait: 'walk' }, hrMax).points).toBe(1);
    expect(minutePoints({ start: 0, asleep: false, cadence: 135, gait: 'run' }, hrMax).points).toBe(2);
    expect(minutePoints({ start: 0, asleep: false, cadence: 99 }, hrMax).points).toBe(0);
  });

  it('counts eligible seconds/60 exactly; the week sums days; the pace scales to 7 days', () => {
    const hp = heartPoints({ ageY: 35, minutes: [{ start: 0, asleep: false, activity: { met: null }, cadence: null, hr: { bpm: 150, supportedS: 20 } }] });
    expect(hp.points).toBeCloseTo(20 / 60 * 2, 12);
    expect(weekPoints([{ points: 40 }, { points: 35.5 }])).toBe(75.5);
    expect(weekPointsPace(60, 2)).toBe(210);
    expect(weekPointsPace(60, 0)).toBeNull();
    expect(heartPoints({ ageY: null, minutes: [{ start: 0, asleep: false, activity: { met: 5 }, cadence: null, hr: { bpm: 150, supportedS: 60 } }] }).points).toBe(1);
  });
});
