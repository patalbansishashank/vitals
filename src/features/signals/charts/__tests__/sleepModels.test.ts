import { describe, expect, it } from 'vitest';
import type { QualityFlag, ResolvedDay, SleepRecord, SleepStageName } from '@/biometrics/core/types';
import { periodWindow } from '../../models';
import {
  actoSpanH,
  classifySession,
  datesTouched,
  gapThresholdMs,
  laneScale,
  monthColumns,
  nightBuckets,
  nightColumns,
  sharePercents,
  sixToClock,
  sleepDay,
  sleepDayMap,
  sleepNight,
  sleepStats,
  spo2NormalPct,
  tempNormalC,
  valueIn,
  yCeiling,
} from '../sleepModels';

/* ---------------------------------------------------------------- fixtures (records at UTC+2) */
const OFF = 7200;
const prov = { channel: 'ble:jstyle2301' as const, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-10-01T00:00:00Z' };
const local = (s: string) => Date.parse(`${s}:00Z`) - OFF * 1000; // '2026-09-29T23:30' at UTC+2
const iso = (ms: number) => new Date(ms).toISOString();
const ASLEEP = new Set<SleepStageName>(['deep', 'light', 'rem', 'asleep_unspecified']);

function rec(bed: string, durMin: number, stages: Array<[SleepStageName, number, number]>, o: { asleepMin?: number; flags?: QualityFlag[]; isMain?: boolean; id?: string } = {}): SleepRecord {
  const s = local(bed), e = s + durMin * 60_000;
  const asleep = o.asleepMin ?? stages.filter(([st]) => ASLEEP.has(st)).reduce((a, [, x, y]) => a + y - x, 0);
  return {
    kind: 'sleep', record_id: o.id ?? `s-${bed}`, version: 1, is_main: o.isMain ?? true, asleep_s: asleep * 60,
    time: { start: iso(s), end: iso(e), tz_offset_s: OFF, local_date: new Date(e + OFF * 1000).toISOString().slice(0, 10) },
    provenance: prov, quality: { validation: 'vendor_proprietary', confidence: null, flags: o.flags ?? [] },
    stages: stages.map(([stage, a, b]) => ({ stage, start: iso(s + a * 60_000), end: iso(s + b * 60_000) })),
  };
}

function day(date: string, sleeps: SleepRecord[]): ResolvedDay {
  const mains = sleeps.filter((s) => s.is_main);
  const pool = mains.length ? mains : sleeps;
  return {
    localDate: date, sleeps, workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [],
    ...(pool.length ? { mainSleep: pool.reduce((a, b) => (b.asleep_s > a.asleep_s ? b : a)) } : {}),
  };
}

/** A staged night: 15 awake, then deep/light/REM and some unknown. */
const staged = (bed: string, extraUnknown = 0) =>
  rec(bed, 450 + extraUnknown, [['awake', 0, 15], ['deep', 15, 75], ['light', 75, 315], ['rem', 315, 405], ['unknown', 405, 405 + extraUnknown], ['awake', 405 + extraUnknown, 450 + extraUnknown]]);

describe('one night', () => {
  it('stacks deep, light, REM and unknown; unknown is never folded into light', () => {
    const n = sleepNight(staged('2026-09-28T23:30', 30));
    expect(n.date).toBe('2026-09-29');
    expect(n.stack).toEqual({ deep: 60, light: 240, rem: 90, unknown: 30 });
    expect(n.asleepMin).toBe(420);
    expect(n.awakeMin).toBe(60);
    expect(n.hasStages).toBe(true);
    expect(n.provisional).toBe(false);
  });

  it('a night with only unknown stages has no stage data and keeps every minute as unknown', () => {
    const n = sleepNight(rec('2026-09-28T23:30', 420, [['unknown', 0, 420]], { asleepMin: 0 }));
    expect(n.hasStages).toBe(false);
    expect(n.stack).toEqual({ deep: 0, light: 0, rem: 0, unknown: 420 });
    // the ring could not tell awake apart either: not recorded, not 0
    expect(n.awakeMin).toBeNull();
  });

  it('a night with no stage list (a corrected total) is all unknown, not light', () => {
    const n = sleepNight({ ...staged('2026-09-28T23:30'), stages: [], asleep_s: 400 * 60 });
    expect(n.stack).toEqual({ deep: 0, light: 0, rem: 0, unknown: 400 });
    expect(n.asleepMin).toBe(400);
    expect(n.hasStages).toBe(false);
  });

  it('reads the provisional flag', () => {
    expect(sleepNight(rec('2026-09-28T23:30', 60, [['light', 0, 60]], { flags: ['provisional_stages'] })).provisional).toBe(true);
  });

  it('a night without bed and wake times still counts, with no times', () => {
    const r = staged('2026-09-28T23:30');
    const n = sleepNight({ ...r, time: { tz_offset_s: OFF, local_date: '2026-09-29' }, stages: [], asleep_s: 360 * 60 });
    expect(n.model).toBeNull();
    expect(n.bed).toBeNull();
    expect(n.asleepMin).toBe(360);
  });
});

describe('naps and other sleep', () => {
  it('classifies by length and end time (after 09:00, before 21:00, under 3 h)', () => {
    const c = (a: string, b: string) => classifySession(local(a), local(b), OFF);
    expect(c('2026-09-29T14:10', '2026-09-29T14:40')).toBe('nap');
    expect(c('2026-09-29T20:00', '2026-09-29T20:50')).toBe('nap');
    expect(c('2026-09-29T08:00', '2026-09-29T09:00')).toBe('another'); // ends at 09:00, not after
    expect(c('2026-09-29T20:30', '2026-09-29T21:10')).toBe('another'); // ends after 21:00
    expect(c('2026-09-29T03:00', '2026-09-29T04:30')).toBe('another');
    expect(c('2026-09-29T12:00', '2026-09-29T15:30')).toBe('another'); // 3.5 h
  });

  it('keeps the main night and lists the others; never adds them to asleep', () => {
    const main = staged('2026-09-28T23:30');
    const nap = rec('2026-09-29T14:10', 30, [['light', 0, 30]], { isMain: false, id: 'nap' });
    const early = rec('2026-09-28T21:00', 60, [['light', 0, 60]], { isMain: false, id: 'early' });
    const d = sleepDay(day('2026-09-29', [early, main, nap]));
    expect(d.night?.asleepMin).toBe(390);
    expect(d.others.map((o) => [o.kind, o.minutes])).toEqual([['another', 60], ['nap', 30]]);
  });

  it('a lone afternoon nap is a nap, not the night', () => {
    const nap = rec('2026-09-29T14:10', 30, [['light', 0, 30]], { isMain: false });
    const d = sleepDay(day('2026-09-29', [nap]));
    expect(d.night).toBeNull();
    expect(d.others).toHaveLength(1);
    expect(d.others[0]!.kind).toBe('nap');
  });

  it('an unflagged overnight session (only unknown, nothing counted asleep) is still the night', () => {
    const r = rec('2026-09-28T23:30', 420, [['unknown', 0, 420]], { asleepMin: 0, isMain: false });
    expect(sleepDay(day('2026-09-29', [r])).night?.stack.unknown).toBe(420);
  });
});

describe('period stats', () => {
  const a = sleepNight(staged('2026-09-28T23:30', 30)); // 420 asleep, staged
  const b = sleepNight(rec('2026-09-29T23:50', 400, [['unknown', 0, 400]], { asleepMin: 0 })); // 400, only unknown
  const c = sleepNight(staged('2026-09-30T00:30')); // 390, staged

  it('averages skip missing nights', () => {
    const s = sleepStats([a, null, c, null], 4);
    expect(s.recorded).toBe(2);
    expect(s.slots).toBe(4);
    expect(s.avgAsleepMin).toBe(405);
  });

  it('stage shares use nights with stage data only', () => {
    const s = sleepStats([a, b], 2);
    expect(s.stagedNights).toBe(1);
    expect(s.shares!.unknown).toBeCloseTo(30 / 420);
    expect(s.shares!.deep).toBeCloseTo(60 / 420);
    expect(s.avgStageMin).toEqual({ deep: 60, light: 240, rem: 90, unknown: 30 });
    // the average asleep still counts the only-unknown night
    expect(s.avgAsleepMin).toBe(410);
  });

  it('no staged night: no shares', () => {
    expect(sleepStats([b], 1).shares).toBeNull();
  });

  it('median bed and wake across midnight', () => {
    const s = sleepStats([a, b, c], 3);
    expect(sixToClock(s.medianBed!)).toBe('23:50');
    expect(s.longest).toBe(a);
    expect(s.shortest).toBe(c);
  });

  it('share percents add up to 100', () => {
    const p = sharePercents({ deep: 1 / 3, light: 1 / 3, rem: 1 / 3, unknown: 0 });
    expect(p.deep + p.light + p.rem + p.unknown).toBe(100);
  });
});

describe('hours axis ceiling', () => {
  it('is the next whole hour, never a whole extra step', () => {
    expect(yCeiling(8 * 60 + 10)).toEqual({ ceilingH: 9, ticksH: [0, 2, 4, 6, 8] });
    expect(yCeiling(5 * 60, 8).ceilingH).toBe(9);
    expect(yCeiling(10 * 60).ceilingH).toBe(11);
  });

  it('hour ticks when the ceiling is 6 h or less', () => {
    expect(yCeiling(5 * 60)).toEqual({ ceilingH: 6, ticksH: [0, 1, 2, 3, 4, 5, 6] });
  });

  it('an empty period still has an axis', () => {
    expect(yCeiling(0).ceilingH).toBe(9);
  });
});

describe('columns', () => {
  it('week: future slots carry no night; missing slots are null', () => {
    const w = periodWindow('week', '2026-10-01', '2026-10-01');
    const cols = nightColumns(w, sleepDayMap([day('2026-09-29', [staged('2026-09-28T23:30')]), day('2026-10-03', [staged('2026-10-02T23:30')])]));
    expect(cols).toHaveLength(7);
    expect(cols.map((c) => (c.future ? 'f' : c.night ? 'n' : '-')).join('')).toBe('-n--fff');
  });

  it('year: months truncated at today, coverage per month, stub month with no nights', () => {
    const w = periodWindow('year', '2026-10-02', '2026-10-02');
    const byDate = sleepDayMap([
      day('2026-09-29', [staged('2026-09-28T23:30', 30)]),
      day('2026-09-30', [rec('2026-09-29T23:50', 400, [['unknown', 0, 400]], { asleepMin: 0 })]),
      day('2026-10-01', [staged('2026-09-30T23:30')]),
    ]);
    const m = monthColumns(w, byDate, '2026-10-02');
    expect(m).toHaveLength(12);
    const sep = m[8]!, oct = m[9]!, nov = m[10]!, aug = m[7]!;
    expect([sep.recorded, sep.days]).toEqual([2, 30]);
    expect([oct.recorded, oct.days]).toEqual([1, 2]);
    expect(nov.future).toBe(true);
    expect(aug.recorded).toBe(0);
    expect(aug.stack).toBeNull();
    // September: average asleep (410) split by the shares of the staged night only
    expect(sep.avgAsleepMin).toBe(410);
    expect(sep.stack!.unknown).toBeCloseTo((410 * 30) / 420);
    expect(Object.values(sep.stack!).reduce((x, y) => x + y, 0)).toBeCloseTo(410);
  });
});

describe('actogram span', () => {
  it('18:00 → 14:00, extended when a nap ends later', () => {
    const w = periodWindow('week', '2026-09-29', '2026-10-04');
    const base = nightColumns(w, sleepDayMap([day('2026-09-29', [staged('2026-09-28T23:30')])]));
    expect(actoSpanH(base)).toBe(20);
    const withNap = nightColumns(w, sleepDayMap([day('2026-09-29', [staged('2026-09-28T23:30'), rec('2026-09-29T14:10', 50, [['light', 0, 50]], { isMain: false, id: 'n' })])]));
    expect(actoSpanH(withNap)).toBe(24);
  });
});

describe('overnight lanes', () => {
  const n = sleepNight(staged('2026-09-28T23:30', 30));
  const x0 = n.bed! - 30 * 60_000, x1 = n.wake! + 30 * 60_000;

  it('5-minute buckets with the stage, mean or nearest value, nothing invented across gaps', () => {
    const hr = [0, 1, 2, 3, 4].map((i) => ({ t: n.bed! + 20 * 60_000 + i * 60_000, v: 50 + i }));
    const temp = [{ t: n.bed! + 22 * 60_000, v: 0.2 }];
    const b = nightBuckets(x0, x1, n, { hr, spo2: [], temp });
    expect(b[0]!.clock).toBe('23:00');
    expect(b[0]!.inNight).toBe(false);
    const at = b.find((x) => x.clock === '23:50')!;
    expect(at.inNight).toBe(true);
    expect(at.stage).toBe('deep');
    expect(at.hr).toBe(52);
    expect(at.temp).toBe(0.2);
    expect(at.spo2).toBeNull();
    // far from any reading: no value
    expect(b.find((x) => x.clock === '03:00')!.hr).toBeNull();
  });

  it('valueIn: mean inside, nearest within half, else null', () => {
    const p = [{ t: 0, v: 10 }, { t: 60_000, v: 20 }];
    expect(valueIn(p, 0, 120_000, 0)).toBe(15);
    expect(valueIn(p, 200_000, 300_000, 200_000)).toBe(20);
    expect(valueIn(p, 600_000, 900_000, 60_000)).toBeNull();
  });

  it('gap threshold is at least 20 minutes', () => {
    expect(gapThresholdMs([{ t: 0, v: 1 }, { t: 60_000, v: 1 }])).toBe(20 * 60_000);
    expect(gapThresholdMs([0, 1, 2].map((i) => ({ t: i * 30 * 60_000, v: 1 })))).toBe(90 * 60_000);
  });

  it('lane scale hugs the data and keeps ticks inside', () => {
    const s = laneScale([52, 61, 70]);
    expect(s.lo).toBeGreaterThan(40);
    expect(s.hi).toBeLessThan(80);
    expect(s.ticks.length).toBeGreaterThanOrEqual(2);
    expect(s.ticks.every((t) => t >= s.lo && t <= s.hi)).toBe(true);
    const z = laneScale([0.2, 0.4], { include: [0] });
    expect(z.lo).toBeLessThan(0);
  });

  it('dates the series window touches', () => {
    expect(datesTouched(x0, x1, OFF)).toEqual(['2026-09-28', '2026-09-29']);
  });
});

describe('normals', () => {
  it('temperature: the absolute baseline first, else the Heart tab rule: the median of nightly values (known from 14 nights)', () => {
    const bl = [{ metric: 'skin_temp', unit: '°C', mean: 34.1, lo: 33.9, hi: 34.3, nights: 20, forming: false }];
    expect(tempNormalC(bl, [])).toBe(34.1);
    const d = (date: string, v: number): ResolvedDay => ({ ...day(date, []), daily: { kind: 'daily', record_id: date, version: 1, time: { tz_offset_s: OFF, local_date: date }, provenance: prov, quality: { validation: 'measured', confidence: null, flags: [] }, skin_temp_c: v } });
    const nights = (n: number) => Array.from({ length: n }, (_, i) => d(`2026-09-${String(i + 1).padStart(2, '0')}`, 34 + (i % 3) * 0.2));
    expect(tempNormalC([], nights(13))).toBeNull();
    expect(tempNormalC(null, nights(14))).toBeCloseTo(34.2);
  });

  it('blood-oxygen normal only from 14 nights (bio.baselines, else the stored nights)', () => {
    expect(spo2NormalPct([{ metric: 'spo2', unit: '%', mean: 96, lo: 95, hi: 97, nights: 9, forming: true }], [])).toBeNull();
    expect(spo2NormalPct([{ metric: 'spo2', unit: '%', mean: 96, lo: 95, hi: 97, nights: 14, forming: false }], [])).toBe(96);
    const d = (date: string, v: number): ResolvedDay => ({ ...day(date, []), daily: { kind: 'daily', record_id: date, version: 1, time: { tz_offset_s: OFF, local_date: date }, provenance: prov, quality: { validation: 'measured', confidence: null, flags: [] }, spo2_avg_pct: v } });
    const nights = (n: number) => Array.from({ length: n }, (_, i) => d(`2026-09-${String(i + 1).padStart(2, '0')}`, 96 + (i % 2)));
    expect(spo2NormalPct(null, nights(13))).toBeNull();
    expect(spo2NormalPct([], nights(14))).toBeCloseTo(96.5);
  });
});
