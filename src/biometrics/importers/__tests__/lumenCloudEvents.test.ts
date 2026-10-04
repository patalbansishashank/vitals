// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BioRecord, DailyRecord, SeriesRecord, SleepRecord } from '../../core/types';
import { lumenCloudEventsImporter } from '../lumenCloudEvents';

const ctx = () => ({ tz: 'Europe/Berlin', now: '2026-10-01T00:00:00.000Z', signal: new AbortController().signal, onProgress: () => {} });
let n = 0;
const ev = (type: string, subject: string, observed: string, data: Record<string, unknown>, received = '2026-09-30T10:00:00Z'): string =>
  JSON.stringify({ specversion: '1.0', id: `pl-${String(++n).padStart(4, '0')}`, type, source: 'urn:pulseloop:installation:x', subject, time: observed, datacontenttype: 'application/json', data: { schema_version: 1, observed_at: observed, received_at: received, ...data } });
const metric = (m: string, v: number, unit: string, at: string, prov = 'device_history'): string => ev('health.metric.observed', m, at, { metric: m, value: v, unit, provenance: prov, quality: 'unverified' });

function build(): string {
  n = 0;
  return [
    metric('hr', 61, 'bpm', '2026-09-29T05:00:00Z'),
    metric('hr', 64, 'bpm', '2026-09-29T05:05:00Z'),
    metric('hr', 64, 'bpm', '2026-09-29T05:05:00Z'), // replayed duplicate sample
    metric('hr', 75, 'bpm', '2026-09-29T05:10:00Z', 'device_spot'),
    metric('spo2', 96, '%', '2026-09-29T01:00:00Z'),
    metric('temp', 34.2, '°C', '2026-09-29T01:30:00Z'),
    metric('hrv', 55, 'ms', '2026-09-29T01:40:00Z'),
    metric('stress', 30, '', '2026-09-29T01:50:00Z'),
    metric('glucose', 98, 'mg/dL', '2026-09-29T02:00:00Z', 'device_estimate'),
    ev('health.metric.observed', 'blood_pressure', '2026-09-29T02:10:00Z', { systolic: 120, diastolic: 80, unit: 'mmHg', provenance: 'device_estimate' }),
    metric('vo2max', 42, 'mL/kg/min', '2026-09-29T08:00:00Z'),
    ev('health.vendor_metric.observed', 'vendor.hrv_raw', '2026-09-29T01:40:00Z', { metric: 'hrv_raw', value: 100, unit: 'raw', provenance: 'device_history_estimate' }),
    ev('health.activity.bucket.observed', 'activity_bucket', '2026-09-29T06:00:00Z', { steps: 20, distance_m: 15, provenance: 'device_history' }),
    ev('health.activity.bucket.observed', 'activity_bucket', '2026-09-29T06:01:00Z', { steps: 30, distance_m: 22, provenance: 'device_history' }),
    ev('health.activity.updated', 'daily_activity', '2026-09-29T12:00:00Z', { steps: 4000, distance_m: 3000, calories_kcal: 200, active_minutes: 30 }, '2026-09-29T12:00:05Z'),
    ev('health.activity.updated', 'daily_activity', '2026-09-29T18:00:00Z', { steps: 9000, distance_m: 6800, calories_kcal: 380, active_minutes: 45 }, '2026-09-29T18:00:05Z'),
    ev('health.device.firmware.updated', 'firmware', '2026-09-29T00:00:00Z', { version: 'V0789' }),
    // incomplete then complete timeline of the same session start
    ev('health.sleep.timeline.updated', 'sleep_timeline', '2026-09-28T21:00:00Z', { sample_interval_minutes: 1, complete_session: false, stages: ['awake', 'awake', 'light', 'light', 'deep'] }),
    ev('health.sleep.timeline.updated', 'sleep_timeline', '2026-09-28T21:00:00Z', { sample_interval_minutes: 1, complete_session: true, stages: ['awake', 'awake', 'light', 'light', 'deep', 'rem', 'rem', 'unknown', 'light', 'awake', 'light'] }),
    ev('health.insight.updated', 'recovery_score', '2026-09-29T00:00:00Z', { insight: 'recovery_score', value: 71.04, unit: 'score', confidence: 'medium', algorithm_version: 'lumen-recovery-v4', inputs: { hrv_value: 55 }, note: 'x', provenance: 'locally_derived' }),
    ev('health.insight.updated', 'sleep_score', '2026-09-29T00:00:00Z', { insight: 'sleep_score', value: 80, unit: 'score', confidence: 'high', algorithm_version: 'lumen-sleep-v4', provenance: 'locally_derived' }),
    ev('health.insight.updated', 'activity_score', '2026-09-29T00:00:00Z', { insight: 'activity_score', value: 50, unit: 'score', confidence: 'high', algorithm_version: 'lumen-activity-v3' }),
    ev('health.device.battery.updated', 'battery', '2026-09-29T00:00:00Z', { percent: 80 }),
    'not json',
    '',
  ].join('\n');
}

async function run(text: string): Promise<BioRecord[]> {
  const out: BioRecord[] = [];
  for await (const b of lumenCloudEventsImporter.run(new Blob([text]), ctx())) out.push(...b.records);
  return out;
}

describe('lumen cloudevents importer', () => {
  it('maps every event type', async () => {
    const recs = await run(build());
    const series = recs.filter((r): r is SeriesRecord => r.kind === 'series');
    const sm = (m: string, mode?: string): SeriesRecord => series.find((s) => s.metric === m && (!mode || s.sampling.mode === mode))!;
    expect(sm('hr', 'periodic').values).toEqual([61, 64]);
    expect(sm('hr', 'spot').values).toEqual([75]);
    // the firmware event comes later in the file: stamps apply from their event on (as they do one message at a time)
    expect(sm('hr').provenance).toMatchObject({ channel: 'file:lumen_cloudevents', decoder: 'lumen-cloudevents/1.0', device: { tier: 'C' } });
    expect(sm('hr').provenance.device?.firmware).toBeUndefined();
    expect(sm('hr').time).toMatchObject({ tz_offset_s: 7200, local_date: '2026-09-29' });
    expect(sm('spo2').values).toEqual([96]);
    expect(sm('skin_temp').values).toEqual([34.2]);
    expect(sm('hrv').quality.flags).toContain('hrv_vendor_defined');
    expect(sm('hrv').quality.validation).toBe('vendor_proprietary');
    expect(sm('vendor:stress').values).toEqual([30]);
    expect(sm('vendor:glucose_estimate').values).toEqual([98]);
    expect(sm('vendor:bp_sys_estimate').values).toEqual([120]);
    expect(sm('vendor:bp_dia_estimate').values).toEqual([80]);
    expect(sm('vendor:hrv_raw').values).toEqual([100]);
    expect(sm('steps').values).toEqual([20, 30]);
    expect(sm('steps').aggregation).toBe('sum');
    expect(sm('distance').values).toEqual([15, 22]);

    const daily = recs.filter((r): r is DailyRecord => r.kind === 'daily');
    const act = daily.find((d) => d.steps !== undefined)!;
    expect(act).toMatchObject({ steps: 9000, distance_m: 6800 });
    expect(act.quality.vendor_state).toBe('kcal_unspecified=380');
    expect(act.active_min).toEqual({ light: 0, moderate: 45, vigorous: 0 });
    expect(act.active_kcal).toBeUndefined();
    expect(daily.filter((d) => d.steps !== undefined)).toHaveLength(1);
    const rec = daily.find((d) => d.vendor?.recovery !== undefined)!;
    expect(rec.vendor).toEqual({ recovery: 71 });
    expect(rec.provenance).toMatchObject({ modality: 'derived', algorithm: { name: 'lumen-recovery', version: 'v4' } });
    expect(rec.quality.confidence).toBe('medium');
    expect(rec.steps).toBeUndefined();
    expect(daily.find((d) => d.vendor?.sleep === 80)!.provenance.algorithm).toEqual({ name: 'lumen-sleep', version: 'v4' });
    expect(daily.find((d) => d.vo2max && d.provenance.modality === 'sensed')!.vo2max).toEqual({ ml_kg_min: 42, method: 'vendor_estimate' });
    expect(daily.some((d) => d.provenance.algorithm?.name === 'lumen-activity')).toBe(false);

    const sleeps = recs.filter((r): r is SleepRecord => r.kind === 'sleep');
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toMatchObject({ is_main: true, in_bed_s: 11 * 60, unknown_s: 60, rem_s: 120, deep_s: 60, light_s: 240, awake_s: 180, waso_s: 60, latency_s: 120 });
    expect(sleeps[0]!.quality.flags).not.toContain('provisional_stages');
    expect(sleeps[0]!.provenance.native_id).toBe('pl-0019');
    expect(sleeps[0]!.provenance.device?.firmware).toBe('V0789');
    expect(sleeps[0]!.time.local_date).toBe('2026-09-28');
  });

  it('keeps a provisional timeline when no complete one exists', async () => {
    n = 0;
    const t = ev('health.sleep.timeline.updated', 's', '2026-09-28T21:00:00Z', { sample_interval_minutes: 1, complete_session: false, stages: ['light', 'deep'] });
    const [s] = (await run(t)).filter((r): r is SleepRecord => r.kind === 'sleep');
    expect(s!.quality.flags).toContain('provisional_stages');
  });

  it('is idempotent and rejects other files', async () => {
    const a = await run(build());
    const b = await run(build());
    const key = (r: BioRecord[]): string[] => r.map((x) => `${x.kind}:${x.record_id}@${x.version}`).sort();
    expect(key(a)).toEqual(key(b));
    expect(new Set(key(a)).size).toBe(a.length);
    await expect(run('{"a":1}\n')).rejects.toThrow(/CloudEvents/);
    expect(lumenCloudEventsImporter.accepts.sniff(new TextEncoder().encode(build()))).toBe(true);
  });
});
