import { describe, expect, it } from 'vitest';
import type { RingDecodedEvent } from '../ble/types';
import { mapEventsToBatch } from '../events';
import type { EventMapContext } from '../events';
import { flattenStages, parseStamp, sleepMetrics } from '../importKit';
import { SLEEP_COMPLETE, sleepVersion } from '../recordIds';

const T0 = Date.UTC(2026, 8, 29, 22, 0, 0); // 2026-09-30 00:00 at +02:00
const ctx: EventMapContext = {
  tz: 'Europe/Berlin', tzOffsetS: 7200, channel: 'ble:jstyle2301', device: { type: 'ring', model: 'J-Style 2301', tier: 'C' }, decoder: 'jstyle2301/V0789@1',
  firmware: 'V0789', producer: { name: 'vitals', version: '1' }, ingestedAt: '2026-10-01T00:00:00.000Z', exportedAt: '2026-10-01T00:00:00.000Z',
};
const events: RingDecodedEvent[] = [
  { type: 'sample', stream: 'hr', t: T0 + 300_000, value: 64, unit: 'bpm', origin: 'history' },
  { type: 'sample', stream: 'hr', t: T0, value: 61, unit: 'bpm', origin: 'history' },
  { type: 'sample', stream: 'hr', t: T0, value: 61, unit: 'bpm', origin: 'history' },
  { type: 'sample', stream: 'hr', t: T0 + 3_600_000, value: 80, unit: 'bpm', origin: 'live' },
  { type: 'sample', stream: 'hrv', t: T0, value: 52, unit: 'ms', origin: 'history' },
  { type: 'vendor', key: 'hrv_raw', t: T0, value: 100, unit: 'raw' },
  { type: 'sample', stream: 'spo2', t: T0 + 24 * 3_600_000, value: 97, unit: '%', origin: 'spot' }, // next local day
  { type: 'activityBucket', start: T0 + 6 * 3_600_000, durS: 60, steps: 20, distanceM: 15 },
  { type: 'activityBucket', start: T0 + 6 * 3_600_000 + 60_000, durS: 60, steps: 30 },
  { type: 'sleepEpochs', start: T0, epochS: 60, stages: ['awake', 'light', 'light', 'deep', 'rem', 'unknown', 'light'], rawCodes: [5, 2, 2, 1, 3, 0, 2], firmware: 'V0789', complete: false },
  { type: 'workout', start: T0 + 10 * 3_600_000, end: T0 + 10 * 3_600_000 + 1_800_000, kind: 'walk' },
  { type: 'status', key: 'battery', value: 80 },
];

describe('mapEventsToBatch', () => {
  it('golden structure', () => {
    const b = mapEventsToBatch(events, ctx);
    expect(b).toMatchObject({ schema: 'vitals.biometrics/1', tz: 'Europe/Berlin', exported_at: ctx.exportedAt, producer: ctx.producer });
    const view = b.records.map((r) => {
      if (r.kind === 'series') return `series ${r.metric} ${r.time.local_date} ${r.sampling.mode} ${r.aggregation} ${JSON.stringify(r.t_offset_s)} ${JSON.stringify(r.values)}`;
      if (r.kind === 'sleep') return `sleep ${r.time.local_date} main=${r.is_main} asleep=${r.asleep_s} in_bed=${r.in_bed_s} ${r.quality.flags.join(',')} ${r.quality.vendor_state}`;
      if (r.kind === 'daily') return `daily ${r.time.local_date} steps=${r.steps} dist=${r.distance_m} ${r.quality.flags.join(',')}`;
      if (r.kind === 'workout') return `workout ${r.exercise_type} ${r.active_duration_s}`;
      return r.kind;
    });
    expect(view).toEqual([
      'series hr 2026-09-30 periodic sample [0,300] [61,64]',
      'series hrv 2026-09-30 periodic sample [0] [52]',
      'series vendor:hrv_raw 2026-09-30 periodic sample [0] [100]',
      'series hr 2026-09-30 continuous sample [0] [80]',
      'series distance 2026-09-30 periodic sum [0] [15]',
      'series steps 2026-09-30 periodic sum [0,60] [20,30]',
      'series spo2 2026-10-01 spot sample [0] [97]',
      'sleep 2026-09-30 main=true asleep=300 in_bed=420 provisional_stages codes:5x1,2x2,1x1,3x1,0x1,2x1',
      'daily 2026-09-30 steps=50 dist=15 partial_day',
      'workout walk 1800',
    ]);
    const hrv = b.records.find((r) => r.kind === 'series' && r.metric === 'hrv')!;
    expect(hrv.quality).toMatchObject({ validation: 'vendor_proprietary', flags: ['hrv_vendor_defined'] });
    const sleep = b.records.find((r) => r.kind === 'sleep')!;
    expect(sleep.provenance).toMatchObject({ channel: 'ble:jstyle2301', decoder: 'jstyle2301/V0789@1', device: { firmware: 'V0789', tier: 'C' } });
    if (sleep.kind === 'sleep') {
      expect(sleep.stages!.map((s) => s.stage)).toEqual(['awake', 'light', 'deep', 'rem', 'unknown', 'light']);
      expect(sleep.latency_s).toBe(60);
    }
  });

  it('is deterministic and flags clock drift', () => {
    const a = mapEventsToBatch(events, ctx);
    const b = mapEventsToBatch([...events].reverse(), ctx);
    const key = (x: typeof a): string[] => x.records.map((r) => `${r.kind}:${r.record_id}`).sort();
    expect(key(a)).toEqual(key(b));
    expect(new Set(key(a)).size).toBe(a.records.length);
    expect(a.records.every((r) => !r.quality.flags.includes('clock_drift'))).toBe(true);
    expect(mapEventsToBatch(events, { ...ctx, clockOffsetS: 120 }).records.some((r) => r.quality.flags.includes('clock_drift'))).toBe(false);
    expect(mapEventsToBatch(events, { ...ctx, clockOffsetS: -121 }).records.every((r) => r.quality.flags.includes('clock_drift'))).toBe(true);
  });

  it('complete sleep is not provisional', () => {
    const e: RingDecodedEvent = { type: 'sleepEpochs', start: T0, epochS: 60, stages: ['light', 'deep'], rawCodes: [2, 1], firmware: 'x', complete: true };
    const r = mapEventsToBatch([e], ctx).records[0]!;
    expect(r.quality.flags).toEqual([]);
    // R20-ID-03: complete beats provisional, and a later read beats an earlier one
    expect(r.version).toBe(sleepVersion(true, Date.parse(ctx.ingestedAt) / 1000));
    expect(r.version).toBeGreaterThan(SLEEP_COMPLETE);
  });
});

describe('importKit', () => {
  it('parses stamps', () => {
    expect(parseStamp('2026-09-29 08:00:00 +0200')).toMatchObject({ t: Date.UTC(2026, 8, 29, 6), offsetS: 7200, localDate: '2026-09-29' });
    expect(parseStamp('2026-09-29T08:00:00-05:30')).toMatchObject({ offsetS: -19800 });
    expect(parseStamp('2026-09-29T08:00:00.250Z')!.t % 1000).toBe(250);
    expect(parseStamp('garbage')).toBeNull();
  });
  it('flattens overlaps by priority', () => {
    const m = (min: number): number => min * 60_000;
    const flat = flattenStages([
      { s: 0, e: m(60), stage: 'awake_in_bed' },
      { s: m(10), e: m(30), stage: 'light' },
      { s: m(30), e: m(40), stage: 'awake' },
    ]);
    expect(flat.map((g) => [g.s / 60000, g.e / 60000, g.stage])).toEqual([[0, 10, 'awake_in_bed'], [10, 30, 'light'], [30, 40, 'awake'], [40, 60, 'awake_in_bed']]);
    expect(sleepMetrics(flat)).toMatchObject({ in_bed_s: 3600, asleep_s: 1200, awake_s: 2400, waso_s: 0, awakenings: 0, latency_s: 600, efficiency_pct: 33.3 });
  });
});
