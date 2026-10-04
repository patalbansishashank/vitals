import { describe, expect, it } from 'vitest';
import { createGadgetbridgeImporter } from '../gadgetbridge';
import { createHealthConnectImporter } from '../healthConnect';
import { fromJsonDump, SqliteUnavailableError } from '../sqlite';
import type { SqlDatabase } from '../sqlite';
import type { BioBatch, BioRecord, ImportContext, SeriesRecord, SleepRecord } from '../../core/types';

const ctx: ImportContext = { tz: 'UTC', now: '2026-10-01T00:00:00.000Z', signal: new AbortController().signal, onProgress: () => {} };
const jsonBlob = (tables: Record<string, unknown[]>): Blob => new Blob([JSON.stringify({ tables })]);
async function collect(it: AsyncIterable<BioBatch>): Promise<BioRecord[]> {
  const o: BioRecord[] = [];
  for await (const b of it) o.push(...b.records);
  return o;
}
const T = (iso: string): number => Date.parse(iso);

function hcTables(): Record<string, unknown[]> {
  const d = '2026-09-20';
  return {
    application_info_table: [{ row_id: 1, package_name: 'com.example.ring', app_name: 'Ring' }, { row_id: 2, package_name: 'com.pulseloop', app_name: 'Lumen' }],
    device_info_table: [{ row_id: 1, manufacturer: 'Acme', model: 'R1', device_type: 4 }],
    heart_rate_record_table: [{ row_id: 10, uuid: 'abcd', start_time: T(`${d}T10:00:00Z`), end_time: T(`${d}T10:05:00Z`), start_zone_offset: 0, app_info_id: 1, device_info_id: 1, recording_method: 2 }],
    heart_rate_record_series_table: [
      { parent_key: 10, beats_per_minute: 60, epoch_millis: T(`${d}T10:00:00Z`) },
      { parent_key: 10, beats_per_minute: 0, epoch_millis: T(`${d}T10:01:00Z`) },
      { parent_key: 10, beats_per_minute: 400, epoch_millis: T(`${d}T10:02:00Z`) },
      { parent_key: 10, beats_per_minute: 70, epoch_millis: T(`${d}T10:03:00Z`) },
    ],
    steps_record_table: [
      { row_id: 1, start_time: T(`${d}T08:00:00Z`), end_time: T(`${d}T09:00:00Z`), start_zone_offset: 0, count: 1000, app_info_id: 1, device_info_id: 1, recording_method: 2 },
      { row_id: 2, start_time: T(`${d}T12:00:00Z`), end_time: T(`${d}T13:00:00Z`), start_zone_offset: 0, count: 500, app_info_id: 1, device_info_id: 1, recording_method: 2 },
    ],
    active_calories_burned_record_table: [{ row_id: 1, start_time: T(`${d}T08:00:00Z`), end_time: T(`${d}T09:00:00Z`), start_zone_offset: 0, energy: 200000, app_info_id: 1, device_info_id: 1, recording_method: 2 }],
    resting_heart_rate_record_table: [{ row_id: 1, time: T(`${d}T06:00:00Z`), zone_offset: 0, beats_per_minute: 52, app_info_id: 1, device_info_id: 1 }],
    heart_rate_variability_rmssd_record_table: [{ row_id: 1, time: T(`${d}T04:00:00Z`), zone_offset: 0, heart_rate_variability_millis: 48, app_info_id: 1, device_info_id: 1 }],
    oxygen_saturation_record_table: [{ row_id: 1, time: T(`${d}T03:00:00Z`), zone_offset: 0, percentage: 97, app_info_id: 1, device_info_id: 1, recording_method: 2 }],
    body_temperature_record_table: [
      { row_id: 1, time: T(`${d}T03:00:00Z`), zone_offset: 0, temperature: 33.4, app_info_id: 2 },
      { row_id: 2, time: T(`${d}T07:00:00Z`), zone_offset: 0, temperature: 36.7, app_info_id: 1, recording_method: 3 },
    ],
    weight_record_table: [{ row_id: 1, time: T(`${d}T07:30:00Z`), zone_offset: 0, weight: 80000, app_info_id: 1, recording_method: 3 }],
    sleep_session_record_table: [
      { row_id: 20, uuid: 's1', start_time: T('2026-09-19T22:00:00Z'), end_time: T('2026-09-20T06:00:00Z'), start_zone_offset: 0, end_zone_offset: 0, app_info_id: 1, device_info_id: 1, recording_method: 2 },
      { row_id: 21, uuid: 's2', start_time: T('2026-09-20T14:00:00Z'), end_time: T('2026-09-20T14:30:00Z'), start_zone_offset: 0, end_zone_offset: 0, app_info_id: 1 },
    ],
    sleep_stages_table: [
      { parent_id: 20, stage_start_time: T('2026-09-19T22:00:00Z'), stage_end_time: T('2026-09-19T22:30:00Z'), stage_type: 1 },
      { parent_id: 20, stage_start_time: T('2026-09-19T22:30:00Z'), stage_end_time: T('2026-09-20T00:30:00Z'), stage_type: 4 },
      { parent_id: 20, stage_start_time: T('2026-09-20T00:30:00Z'), stage_end_time: T('2026-09-20T01:00:00Z'), stage_type: 1 },
      { parent_id: 20, stage_start_time: T('2026-09-20T01:00:00Z'), stage_end_time: T('2026-09-20T03:00:00Z'), stage_type: 5 },
      { parent_id: 20, stage_start_time: T('2026-09-20T03:00:00Z'), stage_end_time: T('2026-09-20T06:00:00Z'), stage_type: 6 },
    ],
    exercise_session_record_table: [{ row_id: 30, uuid: 'w1', start_time: T(`${d}T17:00:00Z`), end_time: T(`${d}T17:45:00Z`), start_zone_offset: 0, exercise_type: 56, title: 'Run', app_info_id: 1, device_info_id: 1 }],
    vo2_max_record_table: [{ row_id: 1, time: T(`${d}T18:00:00Z`), zone_offset: 0, vo2_milliliters_per_minute_kilogram: 45.2, measurement_method: 6, app_info_id: 1 }],
  };
}

describe('fromJsonDump', () => {
  it('supports SELECT * and case-insensitive tables', async () => {
    const db = fromJsonDump({ tables: { Foo: [{ a: 1 }, { b: 2 }] } });
    expect(await db.tables()).toEqual(['Foo']);
    expect(await db.columns('foo')).toEqual(['a', 'b']);
    expect(await db.query('select * from "FOO";')).toHaveLength(2);
    await expect(db.query('SELECT a FROM Foo WHERE a=1')).rejects.toThrow();
    expect(() => fromJsonDump('{"x":1}')).toThrow();
  });
});

describe('Health Connect importer', () => {
  it('throws SqliteUnavailableError for a SQLite file without an opener', async () => {
    const bytes = new Uint8Array(100);
    bytes.set(new TextEncoder().encode('SQLite format 3\u0000'));
    const imp = createHealthConnectImporter();
    expect(imp.needs).toEqual(['sqljs']);
    await expect(collect(imp.run(new Blob([bytes]), ctx))).rejects.toBeInstanceOf(SqliteUnavailableError);
  });

  it('uses an injected opener for SQLite bytes', async () => {
    const bytes = new Uint8Array(100);
    bytes.set(new TextEncoder().encode('SQLite format 3\u0000'));
    const db: SqlDatabase = fromJsonDump({ tables: { steps_record_table: [{ start_time: T('2026-09-20T08:00:00Z'), start_zone_offset: 0, count: 42 }] } });
    const recs = await collect(createHealthConnectImporter({ openSqlite: () => Promise.resolve(db) }).run(new Blob([bytes]), ctx));
    expect(recs.find((r) => r.kind === 'daily')).toMatchObject({ steps: 42 });
  });

  it('maps tables to canonical records', async () => {
    const recs = await collect(createHealthConnectImporter().run(jsonBlob(hcTables()), ctx));
    const series = recs.filter((r): r is SeriesRecord => r.kind === 'series');
    const hr = series.find((s) => s.metric === 'hr')!;
    expect(hr.values).toEqual([60, 70]); // 0 and 400 dropped
    expect(hr.t_offset_s).toEqual([0, 180]);
    expect(hr.provenance).toMatchObject({ channel: 'file:health_connect', source_app: 'com.example.ring', recording_method: 'automatic', device: { type: 'ring', manufacturer: 'Acme', tier: 'B' } });
    expect(series.find((s) => s.metric === 'spo2')!.values).toEqual([97]);
    // Lumen app's BodyTemperature is skin temp; other app's is a spot body temp
    const skin = series.find((s) => s.metric === 'skin_temp')!;
    expect(skin.values).toEqual([33.4]);
    expect(skin.quality.vendor_state).toBe('skin_temp_stored_as_body_temperature');
    expect(recs.find((r) => r.kind === 'spot' && r.metric === 'body_temp_c')).toMatchObject({ value: 36.7, quality: { validation: 'self_reported' } });
    expect(recs.find((r) => r.kind === 'spot' && r.metric === 'weight_kg')).toMatchObject({ value: 80 });
    const daily = recs.find((r) => r.kind === 'daily' && r.steps !== undefined);
    expect(daily).toMatchObject({ steps: 1500, active_kcal: 200, resting_hr_bpm: 52, time: { local_date: '2026-09-20' } });
    expect(daily).toMatchObject({ hrv: { metric: 'rmssd', value_ms: 48 } });
    expect(recs.find((r) => r.kind === 'daily' && r.vo2max)).toMatchObject({ vo2max: { ml_kg_min: 45.2, method: 'vendor_estimate' } });
    const w = recs.find((r) => r.kind === 'workout')!;
    expect(w).toMatchObject({ exercise_type: 'running', active_duration_s: 2700, title: 'Run' });
  });

  it('maps sleep stages and picks the main session', async () => {
    const recs = await collect(createHealthConnectImporter().run(jsonBlob(hcTables()), ctx));
    const sleeps = recs.filter((r): r is SleepRecord => r.kind === 'sleep');
    const main = sleeps.find((s) => s.provenance.native_id === 's1')!;
    expect(main.is_main).toBe(true);
    expect(sleeps.find((s) => s.provenance.native_id === 's2')!.is_main).toBe(false);
    expect(main).toMatchObject({ light_s: 7200, deep_s: 7200, rem_s: 10800, awake_s: 3600, asleep_s: 25200, latency_s: 1800, waso_s: 1800, awakenings: 1, time: { local_date: '2026-09-20' } });
    expect(main.stages?.map((s) => s.stage)).toEqual(['awake', 'light', 'awake', 'deep', 'rem']);
  });

  it('is idempotent in record ids', async () => {
    const a = await collect(createHealthConnectImporter().run(jsonBlob(hcTables()), ctx));
    const b = await collect(createHealthConnectImporter().run(jsonBlob(hcTables()), { ...ctx, now: '2027-01-01T00:00:00.000Z' }));
    expect(b.map((r) => r.record_id)).toEqual(a.map((r) => r.record_id));
    expect(new Set(a.map((r) => r.record_id)).size).toBe(a.length);
  });
});

function gbTables(): Record<string, unknown[]> {
  const s = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
  return {
    DEVICE: [{ _id: 1, NAME: 'R02_1234', MANUFACTURER: 'Colmi', IDENTIFIER: 'AA:BB', TYPE: 99, TYPE_NAME: 'Colmi R02' }],
    COLMI_ACTIVITY_SAMPLE: [
      { TIMESTAMP: s('2026-09-20T10:00:00Z'), DEVICE_ID: 1, USER_ID: 1, STEPS: 100, HEART_RATE: 72, RAW_KIND: 1 },
      { TIMESTAMP: s('2026-09-20T10:15:00Z'), DEVICE_ID: 1, USER_ID: 1, STEPS: 50, HEART_RATE: 255, RAW_KIND: 1 },
      { TIMESTAMP: s('2026-09-20T10:30:00Z'), DEVICE_ID: 1, USER_ID: 1, STEPS: -1, HEART_RATE: 0, RAW_KIND: 1 },
    ],
    COLMI_HEART_RATE_SAMPLE: [{ TIMESTAMP: s('2026-09-20T10:00:00Z') * 1000, DEVICE_ID: 1, USER_ID: 1, HEART_RATE: 72 }, { TIMESTAMP: s('2026-09-20T10:05:00Z') * 1000, DEVICE_ID: 1, USER_ID: 1, HEART_RATE: 75 }],
    COLMI_SPO2_SAMPLE: [{ TIMESTAMP: s('2026-09-20T03:00:00Z') * 1000, DEVICE_ID: 1, SPO2: 96 }],
    COLMI_STRESS_SAMPLE: [{ TIMESTAMP: s('2026-09-20T11:00:00Z') * 1000, DEVICE_ID: 1, STRESS: 33 }],
    COLMI_HRV_VALUE_SAMPLE: [{ TIMESTAMP: s('2026-09-20T04:00:00Z') * 1000, DEVICE_ID: 1, VALUE: 55 }],
    COLMI_SLEEP_STAGE_SAMPLE: [
      { TIMESTAMP: s('2026-09-19T23:00:00Z') * 1000, DEVICE_ID: 1, DURATION: 120, STAGE: 1 },
      { TIMESTAMP: s('2026-09-20T01:00:00Z') * 1000, DEVICE_ID: 1, DURATION: 60, STAGE: 2 },
      { TIMESTAMP: s('2026-09-20T02:00:00Z') * 1000, DEVICE_ID: 1, DURATION: 30, STAGE: 4 },
      { TIMESTAMP: s('2026-09-20T02:30:00Z') * 1000, DEVICE_ID: 1, DURATION: 90, STAGE: 3 },
      { TIMESTAMP: s('2026-09-20T14:00:00Z') * 1000, DEVICE_ID: 1, DURATION: 20, STAGE: 1 },
    ],
    FOO_ACTIVITY_SAMPLE: [{ TIMESTAMP: s('2026-09-20T09:00:00Z'), DEVICE_ID: 7, STEPS: 10, HEART_RATE: 80 }],
  };
}

describe('Gadgetbridge importer', () => {
  it('needs an opener for SQLite files', async () => {
    const bytes = new Uint8Array(100);
    bytes.set(new TextEncoder().encode('SQLite format 3\u0000'));
    await expect(collect(createGadgetbridgeImporter().run(new Blob([bytes]), ctx))).rejects.toThrow(/JSON dump/);
  });

  it('maps Colmi and generic activity tables', async () => {
    const recs = await collect(createGadgetbridgeImporter().run(jsonBlob(gbTables()), ctx));
    const series = recs.filter((r): r is SeriesRecord => r.kind === 'series');
    const hr = series.find((s) => s.metric === 'hr' && s.provenance.device?.manufacturer === 'Colmi')!;
    expect(hr.values).toEqual([72, 75]); // 255 and 0 dropped, duplicate timestamp merged
    expect(hr.provenance).toMatchObject({ channel: 'file:gadgetbridge', device: { type: 'ring', tier: 'C' } });
    expect(series.find((s) => s.metric === 'vendor:stress')!.values).toEqual([33]);
    expect(series.find((s) => s.metric === 'hrv')!.quality.flags).toContain('hrv_vendor_defined');
    expect(series.find((s) => s.metric === 'spo2')!.values).toEqual([96]);
    const days = recs.filter((r) => r.kind === 'daily');
    expect(days.map((d) => (d as { steps?: number }).steps).sort()).toEqual([10, 150]);
    // generic table with unknown device still maps, tier C
    expect(series.find((s) => s.metric === 'hr' && !s.provenance.device?.manufacturer)).toMatchObject({ values: [80] });
  });

  it('builds sleep sessions from stage rows (gap splits, stage mapping)', async () => {
    const recs = await collect(createGadgetbridgeImporter().run(jsonBlob(gbTables()), ctx));
    const sleeps = recs.filter((r): r is SleepRecord => r.kind === 'sleep');
    expect(sleeps).toHaveLength(2);
    const main = sleeps.find((s) => s.is_main && s.asleep_s > 3600)!;
    expect(main).toMatchObject({ light_s: 7200, deep_s: 3600, awake_s: 1800, rem_s: 5400, latency_s: 0, awakenings: 1 });
    expect(main.stages?.map((s) => s.stage)).toEqual(['light', 'deep', 'awake', 'rem']);
  });

  it('is idempotent in record ids', async () => {
    const a = await collect(createGadgetbridgeImporter().run(jsonBlob(gbTables()), ctx));
    const b = await collect(createGadgetbridgeImporter().run(jsonBlob(gbTables()), { ...ctx, now: '2027-01-01T00:00:00.000Z' }));
    expect(b.map((r) => r.record_id)).toEqual(a.map((r) => r.record_id));
    expect(new Set(a.map((r) => r.record_id)).size).toBe(a.length);
  });
});
