// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BioRecord, DailyRecord, SeriesRecord, SleepRecord, SpotRecord, WorkoutRecord } from '../../core/types';
import { healthAutoExportImporter } from '../healthAutoExport';

const ctx = () => ({ tz: 'Europe/Berlin', now: '2026-10-01T00:00:00.000Z', signal: new AbortController().signal, onProgress: () => {} });
async function run(obj: unknown): Promise<BioRecord[]> {
  const out: BioRecord[] = [];
  for await (const b of healthAutoExportImporter.run(new Blob([JSON.stringify(obj)]), ctx())) out.push(...b.records);
  return out;
}
const W = 'Apple Watch';
const fixture = {
  data: {
    metrics: [
      { name: 'heart_rate', units: 'count/min', data: [
        { date: '2026-09-29 08:00:00 +0200', Min: 58, Avg: 62, Max: 70, source: W },
        { date: '2026-09-29 08:01:00 +0200', Min: 60, Avg: 66, Max: 90, source: W },
      ] },
      { name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-09-29 00:00:00 +0200', qty: 52, source: W }] },
      { name: 'heart_rate_variability', units: 'ms', data: [{ date: '2026-09-29 03:00:00 +0200', qty: 40, source: W }, { date: '2026-09-29 04:00:00 +0200', qty: 50, source: W }] },
      { name: 'blood_oxygen_saturation', units: '%', data: [{ date: '2026-09-29 03:10:00 +0200', qty: 0.97, source: W }, { date: '2026-09-29 03:20:00 +0200', qty: 94, source: W }] },
      { name: 'respiratory_rate', units: 'count/min', data: [{ date: '2026-09-29 03:30:00 +0200', qty: 15, source: W }] },
      { name: 'step_count', units: 'count', data: [{ date: '2026-09-29 09:00:00 +0200', qty: 300, source: 'iPhone' }, { date: '2026-09-29 09:01:00 +0200', qty: 200, source: 'iPhone' }] },
      { name: 'active_energy', units: 'kJ', data: [{ date: '2026-09-29 09:00:00 +0200', qty: 41.84, source: W }] },
      // daily aggregate: midnight stamps -> daily only
      { name: 'walking_running_distance', units: 'mi', data: [{ date: '2026-09-28 00:00:00 +0200', qty: 1, source: 'iPhone' }] },
      { name: 'vo2_max', units: 'ml/(kg·min)', data: [{ date: '2026-09-29 12:00:00 +0200', qty: 43.1, source: W }] },
      { name: 'weight_body_mass', units: 'lb', data: [{ date: '2026-09-29 07:00:00 +0200', qty: 176.37, source: 'Scale' }] },
      { name: 'body_fat_percentage', units: '%', data: [{ date: '2026-09-29 07:00:00 +0200', qty: 21.5, source: 'Scale' }] },
      { name: 'apple_sleeping_wrist_temperature', units: 'degF', data: [{ date: '2026-09-29 03:40:00 +0200', qty: 95.9, source: W }] },
      { name: 'sleep_analysis', units: 'hr', data: [
        { date: '2026-09-29 00:00:00 +0200', sleepStart: '2026-09-28 23:15:00 +0200', sleepEnd: '2026-09-29 06:45:00 +0200', inBedStart: '2026-09-28 23:00:00 +0200', inBedEnd: '2026-09-29 07:00:00 +0200', core: 4, deep: 1, rem: 1.5, awake: 0.5, asleep: 0, totalSleep: 6.5, inBed: 8, source: W },
      ] },
      { name: 'something_else', units: 'x', data: [{ date: '2026-09-29 00:00:00 +0200', qty: 1 }] },
    ],
    workouts: [
      { id: 'W-1', name: 'Outdoor Run', start: '2026-09-29 18:00:00 +0200', end: '2026-09-29 18:30:00 +0200', duration: 1800, distance: { qty: 5, units: 'km' }, activeEnergyBurned: { qty: 300, units: 'kcal' },
        heartRateData: [{ date: '2026-09-29 18:05:00 +0200', Min: 120, Avg: 140, Max: 150 }, { date: '2026-09-29 18:15:00 +0200', Min: 130, Avg: 160, Max: 178 }] },
    ],
  },
};

describe('health auto export importer', () => {
  it('maps metrics and workouts', async () => {
    const recs = await run(fixture);
    const series = recs.filter((r): r is SeriesRecord => r.kind === 'series');
    const sm = (m: string): SeriesRecord => series.find((s) => s.metric === m)!;
    expect(sm('hr').aggregation).toBe('avg');
    expect(sm('hr').values).toEqual([62, 66]);
    expect(sm('spo2').values).toEqual([97, 94]);
    expect(sm('steps').values).toEqual([300, 200]);
    expect(sm('active_kcal').values[0]).toBeCloseTo(10, 6);
    expect(sm('skin_temp').values[0]).toBeCloseTo(35.5, 1);
    expect(series.find((s) => s.metric === 'distance')).toBeUndefined();
    expect(sm('hr').provenance).toMatchObject({ channel: 'file:health_auto_export', device: { type: 'watch', tier: 'B' } });

    const daily = recs.filter((r): r is DailyRecord => r.kind === 'daily');
    const w = daily.find((d) => d.resting_hr_bpm !== undefined)!;
    expect(w.resting_hr_bpm).toBe(52);
    expect(w.hrv).toMatchObject({ metric: 'sdnn', value_ms: 45, n: 2 });
    expect(w.quality.flags).toContain('apple_sdnn');
    expect(w.hr_min_bpm).toBe(58);
    expect(w.hr_max_bpm).toBe(90);
    expect(w.spo2_avg_pct).toBe(95.5);
    expect(daily.find((d) => d.steps === 500)).toBeTruthy();
    const dist = daily.find((d) => d.distance_m !== undefined && d.time.local_date === '2026-09-28')!;
    expect(dist.distance_m).toBeCloseTo(1609.34, 2);
    expect(daily.find((d) => d.vo2max)!.vo2max!.method).toBe('vendor_estimate');

    const spots = recs.filter((r): r is SpotRecord => r.kind === 'spot');
    expect(spots.find((s) => s.metric === 'weight_kg')!.value).toBeCloseTo(80, 2);
    expect(spots.find((s) => s.metric === 'body_fat_pct')!.value).toBe(21.5);

    const sleeps = recs.filter((r): r is SleepRecord => r.kind === 'sleep');
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toMatchObject({ is_main: true, asleep_s: 23400, in_bed_s: 28800, light_s: 14400, deep_s: 3600, rem_s: 5400, awake_s: 1800, efficiency_pct: 81.3 });
    expect(sleeps[0]!.time.local_date).toBe('2026-09-29');

    const wk = recs.filter((r): r is WorkoutRecord => r.kind === 'workout');
    expect(wk[0]).toMatchObject({ exercise_type: 'outdoor_run', active_duration_s: 1800, distance_m: 5000, active_kcal: 300, hr_avg_bpm: 150, hr_max_bpm: 178 });
    expect(wk[0]!.provenance.native_id).toBe('W-1');
  });

  it('builds sessions from unaggregated sleep and is idempotent', async () => {
    const f = { data: { metrics: [{ name: 'sleep_analysis', units: 'hr', data: [
      { startDate: '2026-09-28 23:00:00 +0200', endDate: '2026-09-29 01:00:00 +0200', qty: 2, value: 'Core', source: W },
      { startDate: '2026-09-29 01:00:00 +0200', endDate: '2026-09-29 01:20:00 +0200', qty: 0.33, value: 'Awake', source: W },
      { startDate: '2026-09-29 01:20:00 +0200', endDate: '2026-09-29 02:20:00 +0200', qty: 1, value: 'REM', source: W },
      { startDate: '2026-09-29 05:00:00 +0200', endDate: '2026-09-29 05:30:00 +0200', qty: 0.5, value: 'Asleep', source: W },
    ] }] } };
    const a = await run(f);
    const b = await run(f);
    const sl = a.filter((r): r is SleepRecord => r.kind === 'sleep');
    expect(sl).toHaveLength(2);
    expect(sl.find((s) => s.is_main)).toMatchObject({ asleep_s: 3 * 3600, rem_s: 3600, light_s: 7200, waso_s: 1200 });
    expect(a.map((r) => r.record_id)).toEqual(b.map((r) => r.record_id));
  });

  it('rejects other JSON and sniffs', async () => {
    await expect(run({ foo: 1 })).rejects.toThrow(/Health Auto Export/);
    expect(healthAutoExportImporter.accepts.sniff(new TextEncoder().encode('{"data":{"metrics":[{"name":"x"'))).toBe(true);
    expect(healthAutoExportImporter.accepts.sniff(new TextEncoder().encode('{"specversion":"1.0","metrics":'))).toBe(false);
  });
});
