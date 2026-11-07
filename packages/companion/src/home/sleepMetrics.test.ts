// @vitest-environment node
/**
 * `sleep-metrics/1` (energy SPEC §S2.4, A.1.1): goldens including the parity night (323 min asleep), unknown firmware,
 * a 5-min native epoch, an incomplete night, the trend at its 2, 5 and 10 bpm edges, an undeclared cadence; and through
 * `gauge_sleep`: midnight, a DST night and naps.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Sample } from './hrSupport.ts';
import { hr, INSTALL, lumenEvent, metric, sleepPacket } from './lumenFixtures.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';
import { hrTrendOf, sleepMetrics, type SleepInput, type Stage } from './sleepMetrics.ts';

const MIN = 60_000;
const S0 = Date.parse('2026-10-19T17:30:00Z'); // 23:00 in Kolkata
const at = (k: number) => S0 + k * MIN;
const seq = (...parts: Array<[Stage | null, number]>) => parts.flatMap(([s, n]) => Array.from({ length: n }, () => s));
const input = (stages: Array<Stage | null>, o: Partial<SleepInput> = {}): SleepInput => ({ startMs: S0, endMs: S0 + stages.length * MIN, stages, nativeEpochS: 60, hr: [], hrv: [], temp: [], spo2: [], ...o });
const samples = (from: number, to: number, everyMin: number, value: (k: number) => number, cadenceS: number | null = null): Sample[] =>
  Array.from({ length: Math.floor((to - from) / everyMin) }, (_, i) => ({ tMs: at(from + i * everyMin), value: value(i), cadenceS, id: `s${from + i * everyMin}` }));

/** The parity night: 12 min settling, 323 min asleep with two awake runs (6 and 3 min), 5 min awake at the end. */
const PARITY = seq(['awake', 12], ['light', 60], ['deep', 45], ['light', 40], ['awake', 6], ['rem', 30], ['light', 50], ['deep', 20], ['awake', 3], ['light', 38], ['rem', 40], ['awake', 5]);

describe('sleep-metrics/1 goldens', () => {
  it('the parity night: 323 min asleep, bounds, onset and final wake, continuity, wake-ups, settle time', () => {
    const m = sleepMetrics(input(PARITY));
    expect(PARITY.length).toBe(349);
    expect(m).toMatchObject({
      version: 'sleep-metrics/1', K: 323, A: 26, U: 0, G: 0, tstLowerMin: 323, tstUpperMin: 323,
      onsetMs: at(12), finalWakeMs: at(344), leadingWakeMin: 12, namedCoveragePct: 100, incomplete: false,
      windowContinuityPct: 97.3, wasoMin: 9, awakeningRuns: 2, wakeUps: 1, restorativeEstimatedMin: 135, restorativeSharePct: 41.8,
      stageMinutes: { deep: 65, light: 188, rem: 70, asleepUnspecified: 0, awake: 9, unknown: 0, gap: 0 },
      respRate: null, tossesTurns: null, sleepLatency: null, nativeEpochS: 60, coveragePct: 100,
    });
    expect(m.midpointMs).toBe(at(12) + (at(344) - at(12)) / 2);
    expect(m.reasons).toMatchObject({ respRate: 'unsupported', tossesTurns: 'unsupported', sleepLatency: 'unsupported' });
  });

  it('unknown firmware (every stage unknown) is never asleep: no onset, TST between 0 and the window', () => {
    const m = sleepMetrics(input(seq(['unknown', 420])));
    expect(m).toMatchObject({ K: 0, U: 420, tstLowerMin: 0, tstUpperMin: 420, onsetMs: null, finalWakeMs: null, windowContinuityPct: null, incomplete: true });
    expect(m.reasons.onset).toBe('noSleep');
  });

  it('an incomplete night (named coverage under 95 %) shows TST as bounds and no window continuity; gaps are kept apart from the bounds (K ≤ TST ≤ K + U)', () => {
    const m = sleepMetrics(input(seq(['light', 100], ['unknown', 20], [null, 10], ['deep', 100], ['awake', 5], ['light', 50])));
    expect(m).toMatchObject({ K: 250, A: 5, U: 20, G: 10, tstLowerMin: 250, tstUpperMin: 270, namedCoveragePct: 89.5, incomplete: true, windowContinuityPct: null });
    expect(m.reasons.windowContinuityPct).toBe('incomplete');
    expect(m.coveragePct).toBe(96.5);
  });

  it('a 5-min native epoch (stages expanded to minutes by Gauge) is carried through', () => {
    const fiveMin = seq(['light', 5], ['light', 5], ['deep', 5], ['awake', 5], ['rem', 5]);
    expect(sleepMetrics(input(fiveMin, { nativeEpochS: 300 }))).toMatchObject({ nativeEpochS: 300, K: 20, wakeUps: 1, onsetMs: at(0), finalWakeMs: at(25) });
  });

  it('an undeclared cadence: the sampled mean with n, the nightly low from 5-min bins, no time-weighted mean and no time to low', () => {
    const hrs = samples(12, 344, 5, (i) => (i < 44 ? 56 : 50));
    const m = sleepMetrics(input(PARITY, { hr: hrs }));
    expect(m.avgSleepHr).toBeNull();
    expect(m.reasons).toMatchObject({ avgSleepHr: 'cadenceUnknown', timeToLowMin: 'cadenceUnknown' });
    expect(m.sampledMeanSleepHr!.n).toBe(hrs.length - 2); // two readings fall in awake minutes
    expect(m.nightlyLowHrP10).toEqual({ bpm: 50, bins: m.sampledMeanSleepHr!.n });
    expect(m.trace5min[0]).toEqual({ startMs: at(12), bpm: 56, n: 1 });
    expect(m.tooFewHrReadings).toBe(false);
    expect(m.hrTrend).toEqual({ word: 'falling', magnitude: 'moderate', deltaBpm: -6 });
    // too few readings (n < 8) or too sparse (median gap over 20 min) never give a trend
    const sparse = sleepMetrics(input(PARITY, { hr: samples(12, 344, 30, () => 58) }));
    expect(sparse).toMatchObject({ tooFewHrReadings: true, hrTrend: null, hrMedianGapS: 1800 });
  });

  it('a declared 60-s cadence: the time-weighted mean over asleep support and the earliest lowest well-supported window', () => {
    // one reading at each minute's middle: each holds its minute exactly
    const hrs = samples(12, 344, 1, (i) => (i >= 100 && i < 110 ? 48 : 56), 60).map((x) => ({ ...x, tMs: x.tMs + 30_000 }));
    const m = sleepMetrics(input(PARITY, { hr: hrs }));
    expect(m.avgSleepHr).toBeCloseTo(56 - (8 * 10) / 323, 1);
    expect(m.avgSleepHrSupportedS).toBe(323 * 60);
    expect(m.timeToLowMin).toBe(100);
  });

  it('the trend at the 2, 5 and 10 bpm edges (median of the last third minus the middle third)', () => {
    const bins = (mid: number, last: number) => [...Array(3).fill(70), ...Array(3).fill(mid), ...Array(3).fill(last)];
    expect(hrTrendOf(bins(60, 61.9))).toEqual({ word: 'steady', magnitude: null, deltaBpm: 1.9 });
    expect(hrTrendOf(bins(60, 62))).toEqual({ word: 'rising', magnitude: 'slight', deltaBpm: 2 });
    expect(hrTrendOf(bins(60, 64.9))).toMatchObject({ magnitude: 'slight' });
    expect(hrTrendOf(bins(60, 65))).toEqual({ word: 'rising', magnitude: 'moderate', deltaBpm: 5 });
    expect(hrTrendOf(bins(60, 69.9))).toMatchObject({ magnitude: 'moderate' });
    expect(hrTrendOf(bins(60, 70))).toEqual({ word: 'rising', magnitude: 'strong', deltaBpm: 10 });
    expect(hrTrendOf(bins(60, 50))).toEqual({ word: 'falling', magnitude: 'strong', deltaBpm: -10 });
    expect(hrTrendOf(bins(60, 60).slice(1))).toBeNull(); // under 9 bins
  });

  it('HRV (≥ 5 readings; within-night change from 9), skin temperature (≥ 5), SpO2 (≥ 3; minutes below 90 % need a declared cadence)', () => {
    const hrv = samples(20, 340, 32, (i) => 40 + i); // 10 readings: 40..49
    const temp = samples(20, 340, 60, (i) => 35.5 + i * 0.1);
    const spo2 = [94, 89, 88, 96].map((v, i) => ({ tMs: at(40 + i * 5), value: v, cadenceS: null, id: `o${i}` }));
    const m = sleepMetrics(input(PARITY, { hrv, temp, spo2, firmware: ['2301.1.0.7'] }));
    expect(m.hrvNightlyMs).toEqual({ ms: 44.5, n: 10, firmware: ['2301.1.0.7'] });
    expect(m.hrvWithinNightMs).toBe(6.5); // median(46..49) 47.5 − median(40..42) 41
    expect(m.skinTempNightC).toEqual({ c: 35.7, n: 5 });
    expect(m.spo2Night).toEqual({ meanPct: 91.8, minPct: 88, count: 4 });
    expect(m.minutesBelow90).toBeNull();
    expect(m.reasons.minutesBelow90).toBe('cadenceUnknown');
    const declared = sleepMetrics(input(PARITY, { spo2: spo2.map((x) => ({ ...x, cadenceS: 300 })) }));
    expect(declared.minutesBelow90).toBe(10);
    expect(sleepMetrics(input(PARITY, { hrv: hrv.slice(0, 4) })).hrvNightlyMs).toBeNull();
  });
});

// --- through gauge_sleep: the bouts, the waking day, midnight, DST, naps

const dirs: string[] = [];
let store: LumenStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const open = () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'sleep-metrics-'));
  dirs.push(dir);
  return (store = openLumenStore(join(dir, 'lumen.db')));
};
const stageNames = (xs: Array<Stage | null>) => xs.map((s) => s ?? 'unknown');

describe('gauge_sleep metrics', () => {
  it('a night across midnight with a nap: the primary bout and the nap, each with metrics; onset and wake in the person\'s zone', async () => {
    const s = open();
    const nap = seq(['awake', 5], ['light', 25]);
    s.ingest(INSTALL, [
      sleepPacket('2026-10-19T17:30:00Z', stageNames(PARITY), { complete: true }),
      sleepPacket('2026-10-20T08:30:00Z', stageNames(nap)),
      ...samples(12, 344, 5, () => 55).map((x) => hr(new Date(x.tMs).toISOString(), x.value)),
      ...Array.from({ length: 6 }, (_, i) => metric('hrv', 'ms', new Date(at(30 + i * 40)).toISOString(), 40 + i)),
    ]);
    const r = await lumenToolSet(() => s, 'Asia/Kolkata', () => Date.parse('2026-10-20T12:00:00Z')).call('gauge_sleep', { from: '2026-10-20', to: '2026-10-20' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- read field by field
    const data = r.data as Record<string, any>;
    expect(data.sessions.map((x: { kind: string; start: string }) => [x.kind, x.start])).toEqual([['primary', '2026-10-19T23:00:00+05:30'], ['nap', '2026-10-20T14:00:00+05:30']]);
    const night = data.sessions[0];
    expect(night).toMatchObject({ recordedWindowMinutes: 349, inBedMinutes: 349, asleepMinutes: 323 });
    expect(night.metrics).toMatchObject({ onset: '2026-10-19T23:12:00+05:30', finalWake: '2026-10-20T04:44:00+05:30', tstLowerMin: 323, sampledMeanSleepHr: { bpm: 55 }, hrvNightlyMs: { ms: 42.5, n: 6 } });
    expect(night.metrics.statuses.onset).toBe('inferred');
    expect(data.sessions[1].metrics).toMatchObject({ K: 25, leadingWakeMin: 5 });
    expect(data.inputsHash).toMatch(/^sha256:/);
  });

  it('a DST night (New York falls back on 2026-11-01): the window counts real minutes; the offsets change across it', async () => {
    const s = open();
    // 23:00 EDT on 31 October → 07:00 EST: 9 real hours
    const night = seq(['awake', 10], ['light', 520], ['awake', 10]);
    s.ingest(INSTALL, [sleepPacket('2026-11-01T03:00:00Z', stageNames(night), { complete: true })]);
    const r = await lumenToolSet(() => s, 'America/New_York', () => Date.parse('2026-11-01T15:00:00Z')).call('gauge_sleep', { from: '2026-11-01', to: '2026-11-01' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- read field by field
    const n = (r.data as Record<string, any>).sessions[0];
    expect(n).toMatchObject({ wakingDate: '2026-11-01', start: '2026-10-31T23:00:00-04:00', end: '2026-11-01T07:00:00-05:00', recordedWindowMinutes: 540 });
    expect(n.metrics).toMatchObject({ onset: '2026-10-31T23:10:00-04:00', finalWake: '2026-11-01T06:50:00-05:00', tstLowerMin: 520 });
  });

  it('a 5-min native epoch packet from GA (stages per minute, native_epoch_s 300) carries nativeEpochS', async () => {
    const s = open();
    const e = lumenEvent('sleep/timeline', 'sleep_timeline', 'health.sleep.timeline.updated', '2026-10-19T17:30:00Z', {
      sample_interval_minutes: 1, complete_session: true, stages: stageNames(seq(['light', 120], ['deep', 60])), native_epoch_s: 300, stage_codes_raw: [1, 2], provenance: 'device_classified',
    });
    expect(s.ingest(INSTALL, [e]).accepted).toBe(1);
    const r = await lumenToolSet(() => s, 'Asia/Kolkata').call('gauge_sleep', { from: '2026-10-20', to: '2026-10-20' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- read field by field
    expect((r.data as Record<string, any>).sessions[0].metrics).toMatchObject({ nativeEpochS: 300, K: 180 });
  });
});

describe('codex-core #15: TST upper bound', () => {
  it('two asleep minutes, one unknown and two with no packet: K = 2, upper = K + U = 3 (the gap stays apart)', () => {
    const m = sleepMetrics(input(seq(['light', 2], ['unknown', 1], [null, 2], ['light', 0])));
    expect(m).toMatchObject({ K: 2, U: 1, G: 2, tstLowerMin: 2, tstUpperMin: 3 });
  });
});

// (r071) a night the ring recorded in parts: the wake break between them is awake after sleep onset
describe('wake breaks between the parts of a night', () => {
  const brk = (from: number, to: number) => ({ startMs: at(from), endMs: at(to) });

  it('the break is awake after onset (WASO, wake-ups, named coverage, continuity) and still a gap in the ring\'s coverage; unnamed it was an incomplete night', () => {
    const stages = seq(['light', 100], [null, 70], ['light', 100]);
    const m = sleepMetrics(input(stages, { breaks: [brk(100, 170)] }));
    expect(m).toMatchObject({
      K: 200, A: 0, U: 0, G: 70, tstLowerMin: 200, tstUpperMin: 200, onsetMs: at(0), finalWakeMs: at(270), coveragePct: 74.1,
      wasoMin: 70, awakeningRuns: 1, wakeUps: 1, namedCoveragePct: 100, incomplete: false, windowContinuityPct: 74.1,
      stageMinutes: { light: 200, awake: 70, gap: 0 },
    });
    const without = sleepMetrics(input(stages));
    expect(without).toMatchObject({ G: 70, wasoMin: 0, wakeUps: 0, namedCoveragePct: 74.1, incomplete: true, windowContinuityPct: null, stageMinutes: { awake: 0, gap: 70 } });
  });

  it('a break beside named awake minutes is one wake run', () => {
    const m = sleepMetrics(input(seq(['light', 60], ['awake', 3], [null, 90], ['awake', 2], ['light', 60]), { breaks: [brk(63, 153)] }));
    expect(m).toMatchObject({ K: 120, wasoMin: 95, awakeningRuns: 1, wakeUps: 1, stageMinutes: { awake: 95, gap: 0 } });
  });

  it('a gap that is not a break stays a gap, in the same night', () => {
    const m = sleepMetrics(input(seq(['light', 50], [null, 10], ['light', 50], [null, 70], ['light', 50]), { breaks: [brk(110, 180)] }));
    expect(m).toMatchObject({ K: 150, G: 80, wasoMin: 70, stageMinutes: { awake: 70, gap: 10 }, namedCoveragePct: 95.7, incomplete: false });
  });

  it('a break after the last asleep minute is not wake after sleep onset', () => {
    const m = sleepMetrics(input(seq(['light', 60], ['awake', 5], [null, 60], ['awake', 10]), { breaks: [brk(65, 125)] }));
    expect(m).toMatchObject({ K: 60, finalWakeMs: at(60), wasoMin: 0, awakeningRuns: 0, wakeUps: 0 });
  });

  it('the readings of a break stay out of the night\'s heart rate, HRV, skin temperature and SpO2; its heart rate is a hole in the trace', () => {
    const stages = seq(['light', 100], [null, 70], ['light', 100]);
    const inBreak = (k: number) => k >= 100 && k < 170;
    const hrs = samples(0, 270, 5, (i) => (inBreak(i * 5) ? 90 : 56));
    const hrv = samples(0, 270, 30, (i) => (inBreak(i * 30) ? 20 : 50));
    const temp = samples(0, 270, 30, (i) => (inBreak(i * 30) ? 37.5 : 36));
    const spo2 = samples(0, 270, 30, (i) => (inBreak(i * 30) ? 92 : 97));
    const m = sleepMetrics(input(stages, { hr: hrs, hrv, temp, spo2, breaks: [brk(100, 170)] }));
    expect(m.sampledMeanSleepHr).toEqual({ bpm: 56, n: 40 });
    expect(m.hrReadings).toBe(40);
    expect(m.nightlyLowHrP10).toMatchObject({ bpm: 56 });
    expect(m.hrvNightlyMs).toMatchObject({ ms: 50, n: 7 });
    expect(m.skinTempNightC).toEqual({ c: 36, n: 7 });
    expect(m.spo2Night).toEqual({ meanPct: 97, minPct: 97, count: 7 });
    const hole = m.trace5min.filter((b) => b.startMs >= at(100) && b.startMs < at(170));
    expect(hole).toHaveLength(14);
    expect(hole.every((b) => b.bpm === null && b.n === 0)).toBe(true);
    // the same readings without the break: its 90 bpm and 20 ms are in the night's window, as any gap's readings are
    const plain = sleepMetrics(input(stages, { hr: hrs, hrv, temp, spo2 }));
    expect(plain.hrReadings).toBe(54);
    expect(plain.hrvNightlyMs).toMatchObject({ n: 9 });
    expect(plain.trace5min.filter((b) => b.startMs >= at(100) && b.startMs < at(170)).every((b) => b.bpm === 90)).toBe(true);
  });
});
