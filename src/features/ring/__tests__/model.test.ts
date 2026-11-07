import {
  BANDS,
  GAUGE_EMITTED_KEYS,
  INDEX_KEYS,
  METRICS,
  SCORE_KEYS,
  ageText,
  brainStage,
  circularSpreadMin,
  clockOfMinutes,
  dailyValues,
  decodePolyline,
  distanceParts,
  elevatedMinutes,
  hasGaugeData,
  historyData,
  legacyZoneText,
  mainSession,
  minutesText,
  paceText,
  readingAge,
  referenceRows,
  routePath,
  signed,
  sleepBand,
  statusOf,
  baselineReady,
  hrvZ,
  tempDelta,
  stressSegments,
  syncedText,
  trailingMean,
  unitOf,
  valueText,
  type PersonalBaselines,
} from '../model';
import { encodePolyline } from '../fixtures';
import type { GaugeAvailability, GaugeSleepSession, GaugeWorkout } from '../types';

const metric = { units: 'metric' } as const;
const MIN = 60_000;

const baseline = (over: Partial<NonNullable<PersonalBaselines>> = {}): PersonalBaselines => ({
  hrvBaseline: { median: Math.log(72), s: 0.12, medianMs: 72, n: 21, spanDays: 27 },
  tempBaseline: { median: 34.6, n: 21, spanDays: 27, deltaT: 0.1 },
  learning: { nights: 21, needed: 7, learning: false },
  ...over,
});

describe('Ring model', () => {
  it('picks Gauge’s brain stage from the share of the limit (count 0 is always healthy)', () => {
    expect(brainStage(0, 30).name).toBe('Healthy');
    expect(brainStage(8, 30).name).toBe('Greying');
    expect(brainStage(15, 30).name).toBe('Wilted');
    expect(brainStage(23, 30).name).toBe('Cracked');
    expect(brainStage(45, 30).name).toBe('Rotting');
    expect(brainStage(46, 30).name).toBe('Fully rotten');
    expect(brainStage(30, null).name).toBe('Rotting');
  });

  it('gives fixed-band readings Gauge’s word, lower bound inclusive (stress bands of A.1.3 #26)', () => {
    expect(statusOf('hr', 49).word).toBe('Low');
    expect(statusOf('hr', 50).word).toBe('Normal');
    expect(statusOf('hr', 120)).toEqual({ word: 'High', severity: 'danger' });
    expect(statusOf('spo2', 94).word).toBe('Slightly low');
    expect(statusOf('stress', 25).word).toBe('Calm');
    expect(statusOf('stress', 26).word).toBe('Normal');
    expect(statusOf('stress', 51).word).toBe('Elevated');
    expect(statusOf('stress', 76).word).toBe('High');
  });

  it('reads HRV and skin temperature against S2’s nightly baselines, and says Calibrating until they exist (A.2 #5)', () => {
    expect(statusOf('hrv', 70, null).word).toBe('Calibrating · night 0 of 7');
    expect(statusOf('hrv', 70, baseline({ learning: { nights: 3, needed: 7, learning: true } })).word).toBe('Calibrating · night 3 of 7');
    expect(statusOf('hrv', 70, baseline()).word).toBe('Near usual');
    expect(statusOf('hrv', 55, baseline())).toEqual({ word: 'Below usual', severity: 'caution' });
    expect(statusOf('hrv', 90, baseline()).word).toBe('Above usual');
    expect(statusOf('temp', 34.8, baseline()).word).toBe('Near usual');
    expect(statusOf('temp', 35.2, baseline())).toEqual({ word: 'Above usual', severity: 'caution' });
    expect(statusOf('temp', 34.0, baseline()).word).toBe('Below usual');
  });

  it('gates each comparison on that metric’s own baseline readiness, not only on sleep learning (Codex UI #10)', () => {
    // ten sleep nights, but only three valid temperature nights: no "Near usual"
    const b = baseline({ learning: { nights: 10, needed: 7, learning: false }, tempBaseline: { median: 34.6, n: 3, spanDays: 4, deltaT: null, ready: false } });
    expect(statusOf('temp', 34.7, b)).toEqual({ word: 'Calibrating · night 3 of 7', severity: 'info' });
    expect(tempDelta(34.7, b)).toBeNull();
    const h = baseline({ hrvBaseline: { median: Math.log(72), s: 0.12, medianMs: 72, n: 5, spanDays: 5, ready: false } });
    expect(statusOf('hrv', 70, h).word).toBe('Calibrating · night 5 of 7');
    expect(hrvZ(70, h)).toBeNull();
    expect(baselineReady('hrv', baseline())).toBe(true);
    // (Claude UI P3-6) learning over, no HRV baseline at all: not "night 7 of 7"
    expect(statusOf('hrv', 70, baseline({ hrvBaseline: null })).word).toBe('No usual value yet');
  });

  it('HRV caution is the 10 % / 3 ms rule of A.1.2, not one standard deviation (Codex UI #12)', () => {
    // usual 100 ms, log spread 0.2: 88 ms is within 1 SD but 12 ms (> 10 ms) below usual
    const b = baseline({ hrvBaseline: { median: Math.log(100), s: 0.2, medianMs: 100, n: 21, spanDays: 27 } });
    expect(statusOf('hrv', 88, b)).toEqual({ word: 'Below usual', severity: 'caution' });
    expect(statusOf('hrv', 91, b).word).toBe('Near usual');
    // a low baseline: the 3 ms floor
    const lo = baseline({ hrvBaseline: { median: Math.log(20), s: 0.2, medianMs: 20, n: 21, spanDays: 27 } });
    expect(statusOf('hrv', 17.5, lo).word).toBe('Near usual');
    expect(statusOf('hrv', 16.5, lo).word).toBe('Below usual');
  });

  it('names stress a ring index, never "/ 100" (A.2 #8), and offers no breathing rate, glucose or blood pressure (A.2 #6)', () => {
    expect(unitOf('stress', metric)).toBe('ring index');
    expect(Object.keys(METRICS).sort()).toEqual(['hr', 'hrv', 'spo2', 'stress', 'temp']);
    expect(referenceRows('stress', metric).map((r) => `${r.word}: ${r.range}`)).toEqual(['Calm: under 26 ring index', 'Normal: 26–50 ring index', 'Elevated: 51–75 ring index', 'High: 76 ring index and over']);
    expect(referenceRows('hr', metric)[1]!.range).toBe('50–90 bpm');
    expect(referenceRows('hrv', metric)).toEqual([]);
  });

  it('lists only insight keys Gauge emits; cardio_load is gone (A.2 #1)', () => {
    const emitted = new Set<string>(GAUGE_EMITTED_KEYS);
    for (const k of [...SCORE_KEYS, ...INDEX_KEYS]) expect(emitted.has(k.key), k.key).toBe(true);
    expect(INDEX_KEYS.map((k) => k.key)).not.toContain('cardio_load');
    expect(INDEX_KEYS.find((k) => k.key === 'workout_load')!.label).toBe('Last workout load');
  });

  it('works out a reading’s age and the stale rule: min(6 h, max(30 min, 3 × the median gap)), 6 h without a gap', () => {
    const now = Date.parse('2026-10-27T12:00:00');
    const at = (min: number) => new Date(now - min * MIN).toISOString();
    expect(readingAge(at(3), 600, now)).toMatchObject({ text: '3 min ago', stale: false });
    // 10-min cadence: stale past 30 min
    expect(readingAge(at(31), 600, now)!.stale).toBe(true);
    // 30-min cadence: stale past 90 min
    expect(readingAge(at(80), 1800, now)!.stale).toBe(false);
    expect(readingAge(at(91), 1800, now)!.stale).toBe(true);
    // a sparse metric (3 h cadence) caps at 6 h
    expect(readingAge(at(359), 10_800, now)!.stale).toBe(false);
    expect(readingAge(at(361), 10_800, now)!.stale).toBe(true);
    expect(readingAge(at(300), null, now)!.stale).toBe(false);
    expect(readingAge(null, 600, now)).toBeNull();
    expect(ageText(now - 30_000, now)).toBe('just now');
    expect(ageText(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ageText(Date.parse('2026-10-26T08:00:00'), now)).toBe('yesterday');
    expect(ageText(Date.parse('2026-10-24T08:00:00'), now)).toBe('3 days ago');
  });

  it('builds the stress day strip: each reading owns up to 1.5 median gaps, equal neighbours merge, gaps stay open', () => {
    const t0 = Date.parse('2026-10-27T00:00:00');
    const pts = [
      { t: t0, v: 20 },
      { t: t0 + 30 * MIN, v: 22 },
      { t: t0 + 60 * MIN, v: 60 },
      { t: t0 + 90 * MIN, v: 80 },
      // a three-hour gap: the last reading owns only 45 min
      { t: t0 + 270 * MIN, v: 30 },
    ];
    const segs = stressSegments(pts, t0, t0 + 86_400_000);
    expect(segs.map((s) => [(s.from - t0) / MIN, (s.to - t0) / MIN, s.state])).toEqual([
      [0, 60, 0],
      [60, 90, 2],
      [90, 135, 3],
      [270, 315, 1],
    ]);
    expect(elevatedMinutes(segs)).toBe(75);
    expect(BANDS.stress!.map((b) => b.word)).toEqual(['Calm', 'Normal', 'Elevated', 'High']);
  });

  it('converts to the person’s units and writes durations, clocks and signed values', () => {
    expect(valueText('temp', 34, { units: 'imperial' })).toBe('93.2');
    expect(distanceParts(6120, 'metric')).toEqual({ value: '6.12', unit: 'km' });
    expect(paceText(2580, 6120, 'metric')).toEqual({ value: '7:02', unit: '/km' });
    expect(minutesText(476)).toBe('7 h 56');
    expect(clockOfMinutes(1385)).toBe('23:05');
    expect(clockOfMinutes(-10)).toBe('23:50');
    expect(Math.round(circularSpreadMin(0.98)!)).toBe(46);
    expect(signed(-3)).toBe('−3');
    expect(signed(2)).toBe('+2');
    expect(signed(0.02, 1)).toBe('0.0');
  });

  it('says how fresh the data is', () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    expect(syncedText('2026-10-27T09:56:00Z', now)).toBe('Synced 4 min ago');
    expect(syncedText(null, now)).toBe('Not synced yet');
  });

  it('decodes Gauge’s encoded polyline and fits it in a box, north up', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    const pts: Array<[number, number]> = [
      [12.97, 77.59],
      [12.98, 77.6],
      [12.99, 77.59],
    ];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
    expect(routePath(pts, 200, 100, 10)!.end[1]).toBeLessThan(routePath(pts, 200, 100, 10)!.start[1]);
  });

  it('builds the score-history data', () => {
    expect(trailingMean([1, NaN, 3], 7)).toEqual([1, 1, 2]);
    const values = Array.from({ length: 40 }, (_, i) => 50 + (i % 5));
    const h = historyData({ startDate: '2026-09-01', values, unit: 'ms', decimals: 0, category: 'recovery', lead: 28, normal: true });
    expect(h.days).toBe(12);
    expect(h.normal?.lo.every(Number.isFinite)).toBe(true);
    expect(dailyValues([{ date: '2026-09-02', start: '', count: 3, mean: 61 }], '2026-09-01', '2026-09-03').map(String)).toEqual(['NaN', '61', 'NaN']);
  });

  it('picks the night of a waking day, bands an index, and keeps Gauge’s own zones to one legacy line (A.2 #9)', () => {
    const s = (asleep: number) => ({ wakingDate: '2026-10-27', asleepMinutes: asleep }) as GaugeSleepSession;
    expect(mainSession([s(40), s(410)], '2026-10-27')!.asleepMinutes).toBe(410);
    expect([85, 70, 55, 54].map(sleepBand)).toEqual(['Excellent', 'Good', 'Fair', 'Needs work']);
    expect(legacyZoneText({ zones: { rest: 0, fat_burn: 300, cardio: 1500, peak: 720, max: 60 } } as unknown as GaugeWorkout)).toBe('On-device (legacy, 220 − age): 43 min in zones, 13 min at 80 % and over');
    expect(legacyZoneText({ zones: null } as unknown as GaugeWorkout)).toBeNull();
  });

  it('tells an empty server from one with Gauge data', () => {
    const a = { categories: [], shortVideoDays: 0, workoutSessions: 0 } as unknown as GaugeAvailability;
    expect(hasGaugeData(a)).toBe(false);
    expect(hasGaugeData({ ...a, shortVideoDays: 3 })).toBe(true);
  });
});
