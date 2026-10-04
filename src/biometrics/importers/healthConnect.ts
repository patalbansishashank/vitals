/**
 * Health Connect export importer (Android 16+ "Export" zip holding `health_connect_export.db`, or a JSON table dump of
 * it). Table and column names come from the AOSP HealthFitness module (docs/biometrics/sqlite-layouts.md lists which
 * are verified and which ASSUMED). Reads whole tables only, so the JSON dump path is equivalent to real SQLite.
 */
import { recordId } from '../core/hash';
import type {
  BioBatch, BioProvenance, BioQuality, BiometricsImporter, DailyRecord, DeviceType, DeviceTier, ImportContext, SeriesRecord,
  SleepRecord, SleepStageInterval, SleepStageName, SpotRecord, WorkoutRecord, BioRecord, BioStream,
} from '../core/types';
import { idText, num, openInput, rowReader, rows, sniffSqliteFamily, str } from './sqlite';
import type { SqlDatabase, SqlOpener, SqlRow } from './sqlite';
import { batchRecords, isoUtc, makeBatch, tzOffsetSeconds } from './util';

const CHANNEL = 'file:health_connect' as const;
const SOURCE = 'health_connect';

/** HC `SleepSessionRecord.STAGE_TYPE_*`. */
export const HC_STAGE_NAMES: Record<number, SleepStageName> = {
  0: 'unknown', 1: 'awake', 2: 'asleep_unspecified', 3: 'out_of_bed', 4: 'light', 5: 'deep', 6: 'rem', 7: 'awake_in_bed',
};

/** HC `ExerciseSessionRecord.EXERCISE_TYPE_*` (public API constants); unlisted types map to `other:<n>`. */
export const HC_EXERCISE_TYPES: Record<number, string> = {
  0: 'other', 2: 'badminton', 4: 'baseball', 5: 'basketball', 8: 'biking', 9: 'biking_stationary', 10: 'boot_camp', 11: 'boxing',
  13: 'calisthenics', 14: 'cricket', 16: 'dancing', 25: 'elliptical', 26: 'exercise_class', 27: 'fencing', 28: 'football_american',
  29: 'football_australian', 31: 'frisbee_disc', 32: 'golf', 33: 'guided_breathing', 34: 'gymnastics', 35: 'handball', 36: 'hiit',
  37: 'hiking', 38: 'ice_hockey', 39: 'ice_skating', 44: 'martial_arts', 46: 'paddling', 47: 'paragliding', 48: 'pilates',
  50: 'racquetball', 51: 'rock_climbing', 52: 'roller_hockey', 53: 'rowing', 54: 'rowing_machine', 55: 'rugby', 56: 'running',
  57: 'running_treadmill', 58: 'sailing', 59: 'scuba_diving', 60: 'skating', 61: 'skiing', 62: 'snowboarding', 63: 'snowshoeing',
  64: 'soccer', 65: 'softball', 66: 'squash', 68: 'stair_climbing', 69: 'stair_climbing_machine', 70: 'strength_training',
  71: 'stretching', 72: 'surfing', 73: 'swimming_open_water', 74: 'swimming_pool', 75: 'table_tennis', 76: 'tennis',
  78: 'volleyball', 79: 'walking', 80: 'water_polo', 81: 'weightlifting', 82: 'wheelchair', 83: 'yoga',
};

const RECORDING_METHODS = ['unknown', 'active', 'automatic', 'manual'] as const;
/** HC `Device.TYPE_*`: 0 unknown, 1 watch, 2 phone, 3 scale, 4 ring, 5 head_mounted, 6 fitness_band, 7 chest_strap, 8 smart_display. */
const DEVICE_TYPES: Record<number, DeviceType> = { 1: 'watch', 2: 'phone', 3: 'scale', 4: 'ring', 6: 'band', 7: 'strap' };

export interface HealthConnectOptions {
  /** SQLite opener (sql.js). Without it only JSON table dumps import. */
  openSqlite?: SqlOpener;
  /** Package-name prefixes of the owner's Lumen/Vitals Android app, which writes ring skin temperature as BodyTemperature. */
  lumenPackages?: string[];
  /** Unit of the energy columns. ASSUMED 'cal' (AOSP stores calories); set 'kcal' if a layout proves otherwise. */
  energyUnit?: 'cal' | 'kcal';
  /** Records per yielded batch. */
  batchSize?: number;
}

interface Meta {
  uuid?: string;
  app?: string;
  appName?: string;
  device?: BioProvenance['device'];
  deviceKey: string;
  rm: BioProvenance['recording_method'];
  modified?: number;
}

const tierFor = (t: DeviceType | undefined): DeviceTier => (t === 'strap' ? 'A' : t === 'ring' || t === 'watch' || t === 'band' || t === 'scale' ? 'B' : 'C');

function offsetOf(v: unknown, tz: string, ms: number): number {
  return num(v) ?? tzOffsetSeconds(ms, tz);
}
const dateAt = (ms: number, off: number): string => new Date(ms + off * 1000).toISOString().slice(0, 10);
const round = (x: number, d = 3): number => Math.round(x * 10 ** d) / 10 ** d;

export function createHealthConnectImporter(opts: HealthConnectOptions = {}): BiometricsImporter {
  const lumen = opts.lumenPackages ?? ['com.pulseloop'];
  const calDiv = (opts.energyUnit ?? 'cal') === 'cal' ? 1000 : 1;
  return {
    id: 'health_connect',
    label: 'Health Connect export',
    accepts: {
      mime: ['application/zip', 'application/vnd.sqlite3', 'application/x-sqlite3', 'application/json'],
      extensions: ['.zip', '.db', '.json'],
      sniff: sniffSqliteFamily,
    },
    needs: ['sqljs'],
    async *run(input: Blob, ctx: ImportContext): AsyncIterable<BioBatch> {
      const db = await openInput(input, opts.openSqlite, 'This Health Connect export');
      ctx.onProgress(0.05);
      const records = await mapHealthConnect(db, ctx, { lumen, calDiv });
      ctx.onProgress(0.9);
      for await (const chunk of batchRecords(records, opts.batchSize ?? 200)) {
        ctx.signal.throwIfAborted();
        yield makeBatch(chunk, { producer: { name: 'vitals/health_connect', version: '1' }, tz: ctx.tz, exportedAt: ctx.now });
      }
      ctx.onProgress(1);
    },
  };
}

interface MapOpts {
  lumen: string[];
  calDiv: number;
}

interface DailyAcc {
  meta: Meta;
  date: string;
  off: number;
  rms: Set<Meta['rm']>;
  n: number;
  steps?: number;
  dist?: number;
  act?: number;
  tot?: number;
  rhr: number[];
  hrv: number[];
  vo2?: { v: number; method: number };
}

/** Pure mapping of an opened Health Connect database to canonical records (exported for tests). */
export async function mapHealthConnect(db: SqlDatabase, ctx: Pick<ImportContext, 'tz' | 'now' | 'signal'>, o: MapOpts): Promise<BioRecord[]> {
  const out: BioRecord[] = [];
  const ingested = ctx.now;

  const apps = new Map<string, { pkg?: string; name?: string }>();
  for (const r of await rows(db, 'application_info_table')) {
    const g = rowReader(r);
    const id = idText(g('row_id'));
    if (id) apps.set(id, { pkg: str(g('package_name')), name: str(g('app_name')) });
  }
  const devices = new Map<string, NonNullable<BioProvenance['device']>>();
  for (const r of await rows(db, 'device_info_table')) {
    const g = rowReader(r);
    const id = idText(g('row_id'));
    if (!id) continue;
    const type = DEVICE_TYPES[num(g('device_type')) ?? 0] ?? 'manual';
    const manufacturer = str(g('manufacturer'));
    const model = str(g('model'));
    devices.set(id, { type, ...(manufacturer ? { manufacturer } : {}), ...(model ? { model } : {}), tier: tierFor(type === 'manual' ? undefined : type) });
  }

  const metaOf = (g: (n: string) => unknown): Meta => {
    const appId = idText(g('app_info_id'));
    const devId = idText(g('device_info_id'));
    const app = appId ? apps.get(appId) : undefined;
    const device = devId ? devices.get(devId) : undefined;
    const rmI = num(g('recording_method')) ?? 0;
    return {
      uuid: idText(g('uuid')),
      app: app?.pkg,
      appName: app?.name,
      device,
      deviceKey: `${appId ?? ''}|${devId ?? ''}`,
      rm: RECORDING_METHODS[rmI] ?? 'unknown',
      modified: num(g('last_modified_time')),
    };
  };
  const provOf = (m: Meta, nativeId: string | undefined, decoder?: string): BioProvenance => ({
    channel: CHANNEL,
    ...(m.app ? { source_app: m.app } : {}),
    ...(m.device ? { device: m.device } : {}),
    recording_method: m.rm,
    modality: m.rm === 'manual' ? 'self_reported' : 'sensed',
    ...(nativeId ? { native_id: nativeId } : {}),
    ...(m.modified ? { source_created_at: isoUtc(m.modified) } : {}),
    ingested_at: ingested,
    ...(decoder ? { decoder } : {}),
  });
  const qualityOf = (m: Meta, flags: BioQuality['flags'] = [], vendorState?: string): BioQuality => ({
    validation: m.rm === 'manual' ? 'self_reported' : 'measured',
    confidence: null,
    flags,
    ...(vendorState ? { vendor_state: vendorState } : {}),
  });

  // ---- series tables keyed by parent row_id
  const childrenOf = async (table: string): Promise<Map<string, SqlRow[]>> => {
    const m = new Map<string, SqlRow[]>();
    for (const r of await rows(db, table)) {
      const g = rowReader(r);
      const k = idText(g('parent_key') ?? g('parent_id'));
      if (!k) continue;
      let a = m.get(k);
      if (!a) m.set(k, (a = []));
      a.push(r);
    }
    return m;
  };

  const hrSamples: Array<{ t: number; v: number }> = [];

  /** One SeriesRecord per parent record from a child sample table. */
  const parentSeries = async (parentTable: string, childTable: string, valueCol: string, metric: BioStream, unit: string, valid: (v: number) => boolean, extra?: (g: (n: string) => unknown) => Partial<SeriesRecord>, collect?: Array<{ t: number; v: number }>): Promise<void> => {
    const kids = await childrenOf(childTable);
    for (const r of await rows(db, parentTable)) {
      const g = rowReader(r);
      const key = idText(g('row_id'));
      const startMs = num(g('start_time'));
      if (!key || startMs === undefined) continue;
      const samples = (kids.get(key) ?? [])
        .map((c) => {
          const cg = rowReader(c);
          return { t: num(cg('epoch_millis')), v: num(cg(valueCol)) };
        })
        .filter((s): s is { t: number; v: number } => s.t !== undefined && s.v !== undefined && valid(s.v))
        .sort((a, b) => a.t - b.t);
      if (samples.length === 0) continue;
      collect?.push(...samples);
      const t0 = Math.min(startMs, samples[0]!.t);
      const off = offsetOf(g('start_zone_offset'), ctx.tz, t0);
      const m = metaOf(g);
      const nativeId = m.uuid;
      out.push({
        kind: 'series',
        record_id: recordId({ source: SOURCE, nativeId: nativeId ? `${metric}:${nativeId}` : undefined, kind: 'series', metric, start: isoUtc(t0) }),
        version: 1,
        time: { start: isoUtc(t0), end: isoUtc(Math.max(num(g('end_time')) ?? 0, samples[samples.length - 1]!.t)), tz_offset_s: off, local_date: dateAt(t0, off) },
        provenance: provOf(m, nativeId),
        quality: qualityOf(m),
        metric,
        unit,
        aggregation: 'sample',
        sampling: { mode: 'periodic', device_tier: m.device?.tier ?? 'C' },
        t_offset_s: samples.map((s) => round((s.t - t0) / 1000)),
        values: samples.map((s) => s.v),
        ...extra?.(g),
      });
    }
  };

  await parentSeries('heart_rate_record_table', 'heart_rate_record_series_table', 'beats_per_minute', 'hr', 'bpm', (v) => v >= 20 && v <= 300, undefined, hrSamples);
  await parentSeries('skin_temperature_record_table', 'skin_temperature_delta_table', 'delta', 'skin_temp', 'degC_delta', (v) => Math.abs(v) < 20);
  ctx.signal.throwIfAborted();

  /** Instant samples grouped into one series per (app, device, method, local date). */
  const instantSeries = async (table: string, valueCol: string, metric: BioStream, unit: string, valid: (v: number) => boolean, filter?: (m: Meta) => boolean, decoder?: string, vendorState?: string): Promise<void> => {
    const groups = new Map<string, { meta: Meta; t0: number; off: number; date: string; s: Array<{ t: number; v: number }> }>();
    for (const r of await rows(db, table)) {
      const g = rowReader(r);
      const t = num(g('time'));
      const v = num(g(valueCol));
      if (t === undefined || v === undefined || !valid(v)) continue;
      const m = metaOf(g);
      if (filter && !filter(m)) continue;
      const off = offsetOf(g('zone_offset'), ctx.tz, t);
      const date = dateAt(t, off);
      const key = `${m.deviceKey}|${m.rm}|${date}`;
      let grp = groups.get(key);
      if (!grp) groups.set(key, (grp = { meta: m, t0: t, off, date, s: [] }));
      grp.s.push({ t, v });
      if (t < grp.t0) grp.t0 = t;
    }
    for (const [key, grp] of groups) {
      grp.s.sort((a, b) => a.t - b.t);
      const t0 = grp.s[0]!.t;
      out.push({
        kind: 'series',
        record_id: recordId({ source: SOURCE, nativeId: `${metric}|${grp.meta.app ?? ''}|${key}` }),
        version: grp.s.length,
        time: { start: isoUtc(t0), end: isoUtc(grp.s[grp.s.length - 1]!.t), tz_offset_s: grp.off, local_date: grp.date },
        provenance: provOf(grp.meta, undefined, decoder),
        quality: qualityOf(grp.meta, [], vendorState),
        metric,
        unit,
        aggregation: 'sample',
        sampling: { mode: 'event', device_tier: grp.meta.device?.tier ?? 'C' },
        t_offset_s: grp.s.map((s) => round((s.t - t0) / 1000)),
        values: grp.s.map((s) => s.v),
      });
    }
  };

  await instantSeries('oxygen_saturation_record_table', 'percentage', 'spo2', 'pct', (v) => v > 0 && v <= 100);
  await instantSeries('respiratory_rate_record_table', 'rate', 'resp_rate', 'brpm', (v) => v > 0 && v < 120);
  const isLumen = (m: Meta): boolean => !!m.app && o.lumen.some((p) => m.app!.startsWith(p));
  // Owner's Android app writes ring skin temperature as BodyTemperature (research-wearables.md): decode as skin_temp.
  await instantSeries('body_temperature_record_table', 'temperature', 'skin_temp', 'degC', (v) => v > 20 && v < 45, isLumen, 'health_connect/lumen_body_temp_as_skin@1', 'skin_temp_stored_as_body_temperature');

  // ---- body temperature by other apps, weight, body fat: spot records
  const spot = async (table: string, col: string, metric: SpotRecord['metric'], conv: (v: number) => number | undefined, filter?: (m: Meta) => boolean): Promise<void> => {
    for (const r of await rows(db, table)) {
      const g = rowReader(r);
      const t = num(g('time'));
      const raw = num(g(col));
      if (t === undefined || raw === undefined) continue;
      const v = conv(raw);
      if (v === undefined) continue;
      const m = metaOf(g);
      if (filter && !filter(m)) continue;
      const off = offsetOf(g('zone_offset'), ctx.tz, t);
      out.push({
        kind: 'spot',
        record_id: recordId({ source: SOURCE, nativeId: m.uuid ? `${metric}:${m.uuid}` : undefined, kind: 'spot', metric, start: isoUtc(t) }),
        version: 1,
        time: { at: isoUtc(t), tz_offset_s: off, local_date: dateAt(t, off) },
        provenance: provOf(m, m.uuid),
        quality: qualityOf(m),
        metric,
        value: round(v),
      });
    }
  };
  await spot('body_temperature_record_table', 'temperature', 'body_temp_c', (v) => (v > 20 && v < 45 ? v : undefined), (m) => !isLumen(m));
  // Weight: AOSP stores a REAL with the unit undocumented in the helper (ASSUMED grams); > 1000 is read as grams.
  await spot('weight_record_table', 'weight', 'weight_kg', (v) => { const kg = v > 1000 ? v / 1000 : v; return kg > 1 && kg < 700 ? kg : undefined; });
  await spot('body_fat_record_table', 'percentage', 'body_fat_pct', (v) => (v > 0 && v < 100 ? v : undefined));
  ctx.signal.throwIfAborted();

  // ---- daily aggregates per (app, device, local date)
  const daily = new Map<string, DailyAcc>();
  const dailyOf = (m: Meta, t: number, off: number): DailyAcc => {
    const date = dateAt(t, off);
    const key = `${m.deviceKey}|${date}`;
    let a = daily.get(key);
    if (!a) daily.set(key, (a = { meta: m, date, off, rms: new Set(), n: 0, rhr: [], hrv: [] }));
    a.rms.add(m.rm);
    a.n++;
    return a;
  };
  const intervalSum = async (table: string, col: string, conv: (v: number) => number, set: (a: DailyAcc, v: number) => void): Promise<void> => {
    for (const r of await rows(db, table)) {
      const g = rowReader(r);
      const t = num(g('start_time'));
      const v = num(g(col));
      if (t === undefined || v === undefined || v < 0) continue;
      set(dailyOf(metaOf(g), t, offsetOf(g('start_zone_offset'), ctx.tz, t)), conv(v));
    }
  };
  await intervalSum('steps_record_table', 'count', (v) => v, (a, v) => (a.steps = (a.steps ?? 0) + v));
  await intervalSum('distance_record_table', 'distance', (v) => v, (a, v) => (a.dist = (a.dist ?? 0) + v));
  await intervalSum('active_calories_burned_record_table', 'energy', (v) => v / o.calDiv, (a, v) => (a.act = (a.act ?? 0) + v));
  await intervalSum('total_calories_burned_record_table', 'energy', (v) => v / o.calDiv, (a, v) => (a.tot = (a.tot ?? 0) + v));
  const instantDaily = async (table: string, col: string, valid: (v: number) => boolean, push: (a: DailyAcc, v: number, r: (n: string) => unknown) => void): Promise<void> => {
    for (const r of await rows(db, table)) {
      const g = rowReader(r);
      const t = num(g('time'));
      const v = num(g(col));
      if (t === undefined || v === undefined || !valid(v)) continue;
      push(dailyOf(metaOf(g), t, offsetOf(g('zone_offset'), ctx.tz, t)), v, g);
    }
  };
  await instantDaily('resting_heart_rate_record_table', 'beats_per_minute', (v) => v >= 20 && v <= 200, (a, v) => a.rhr.push(v));
  await instantDaily('heart_rate_variability_rmssd_record_table', 'heart_rate_variability_millis', (v) => v > 0 && v < 500, (a, v) => a.hrv.push(v));
  await instantDaily('vo2_max_record_table', 'vo2_milliliters_per_minute_kilogram', (v) => v > 5 && v < 100, (a, v, g) => (a.vo2 = { v, method: num(g('measurement_method')) ?? 0 }));

  for (const [key, a] of daily) {
    const rm: Meta['rm'] = a.rms.size === 1 ? ([...a.rms][0] ?? 'unknown') : 'unknown';
    const meta: Meta = { ...a.meta, rm };
    const flags: BioQuality['flags'] = [];
    const rec: DailyRecord = {
      kind: 'daily',
      record_id: recordId({ source: SOURCE, nativeId: `daily|${a.meta.app ?? ''}|${key}` }),
      version: a.n,
      time: { tz_offset_s: a.off, local_date: a.date },
      provenance: provOf(meta, undefined),
      quality: qualityOf(meta, flags),
    };
    if (a.steps !== undefined) rec.steps = Math.round(a.steps);
    if (a.dist !== undefined) rec.distance_m = round(a.dist, 1);
    if (a.act !== undefined) rec.active_kcal = round(a.act, 1);
    if (a.tot !== undefined) rec.total_kcal = round(a.tot, 1);
    if (a.rhr.length) rec.resting_hr_bpm = round(a.rhr.reduce((s, v) => s + v, 0) / a.rhr.length, 1);
    if (a.hrv.length) rec.hrv = { metric: 'rmssd', value_ms: round(a.hrv.reduce((s, v) => s + v, 0) / a.hrv.length, 1), window: 'spot', n: a.hrv.length };
    if (a.vo2) {
      // HC Vo2MaxRecord.MEASUREMENT_METHOD_*: 1 metabolic cart, 2 heart-rate ratio, 3 Cooper, 4 multistage fitness, 5 Rockport, 6 other.
      const method = a.vo2.method === 1 ? 'lab' : a.vo2.method >= 3 && a.vo2.method <= 5 ? 'field_test' : a.vo2.method === 2 ? 'derived' : 'vendor_estimate';
      rec.vo2max = { ml_kg_min: round(a.vo2.v, 1), method };
      if (method !== 'lab') flags.push('estimated_vo2');
    }
    out.push(rec);
  }
  ctx.signal.throwIfAborted();

  // ---- sleep
  const stageRows = await childrenOf('sleep_stages_table');
  const sleeps: SleepRecord[] = [];
  for (const r of await rows(db, 'sleep_session_record_table')) {
    const g = rowReader(r);
    const key = idText(g('row_id'));
    const s0 = num(g('start_time'));
    const s1 = num(g('end_time'));
    if (s0 === undefined || s1 === undefined || s1 <= s0) continue;
    const m = metaOf(g);
    const off = offsetOf(g('end_zone_offset') ?? g('start_zone_offset'), ctx.tz, s1);
    const stages: SleepStageInterval[] = (key ? (stageRows.get(key) ?? []) : [])
      .map((c) => {
        const cg = rowReader(c);
        const a = num(cg('stage_start_time'));
        const b = num(cg('stage_end_time'));
        return a !== undefined && b !== undefined && b > a ? { a: Math.max(a, s0), b: Math.min(b, s1), stage: HC_STAGE_NAMES[num(cg('stage_type')) ?? 0] ?? 'unknown' } : undefined;
      })
      .filter((x): x is { a: number; b: number; stage: SleepStageName } => !!x && x.b > x.a)
      .sort((x, y) => x.a - y.a)
      .map((x) => ({ start: isoUtc(x.a), end: isoUtc(x.b), stage: x.stage }));
    const dur: Partial<Record<SleepStageName, number>> = {};
    let firstAsleep: number | undefined;
    let lastAsleep: number | undefined;
    const asleepSet = new Set<SleepStageName>(['light', 'deep', 'rem', 'asleep_unspecified']);
    for (const st of stages) {
      const a = Date.parse(st.start);
      const b = Date.parse(st.end);
      dur[st.stage] = (dur[st.stage] ?? 0) + (b - a) / 1000;
      if (asleepSet.has(st.stage)) {
        firstAsleep ??= a;
        lastAsleep = b;
      }
    }
    const total = (s1 - s0) / 1000;
    const hasStages = stages.length > 0;
    const asleep = hasStages ? (dur.light ?? 0) + (dur.deep ?? 0) + (dur.rem ?? 0) + (dur.asleep_unspecified ?? 0) : total;
    const awake = (dur.awake ?? 0) + (dur.awake_in_bed ?? 0);
    const inBed = total - (dur.out_of_bed ?? 0);
    let waso = 0;
    let awakenings = 0;
    if (firstAsleep !== undefined && lastAsleep !== undefined) {
      for (const st of stages) {
        const a = Date.parse(st.start);
        const b = Date.parse(st.end);
        if ((st.stage === 'awake' || st.stage === 'awake_in_bed') && a >= firstAsleep && b <= lastAsleep) {
          waso += (b - a) / 1000;
          awakenings++;
        }
      }
    }
    const rec: SleepRecord = {
      kind: 'sleep',
      record_id: recordId({ source: SOURCE, nativeId: m.uuid ? `sleep:${m.uuid}` : undefined, kind: 'sleep', metric: 'session', start: isoUtc(s0) }),
      version: 1,
      time: { start: isoUtc(s0), end: isoUtc(s1), tz_offset_s: off, local_date: dateAt(s1, off) },
      provenance: provOf(m, m.uuid),
      quality: qualityOf(m, hasStages ? ['provisional_stages'] : []),
      is_main: false,
      in_bed_s: Math.round(inBed),
      asleep_s: Math.round(asleep),
    };
    if (hasStages) {
      rec.awake_s = Math.round(awake);
      rec.light_s = Math.round(dur.light ?? 0);
      rec.deep_s = Math.round(dur.deep ?? 0);
      rec.rem_s = Math.round(dur.rem ?? 0);
      rec.unknown_s = Math.round(dur.unknown ?? 0);
      if (firstAsleep !== undefined) rec.latency_s = Math.round((firstAsleep - s0) / 1000);
      rec.waso_s = Math.round(waso);
      rec.awakenings = awakenings;
      rec.stages = stages;
    }
    if (inBed > 0) rec.efficiency_pct = round((asleep / inBed) * 100, 1);
    sleeps.push(rec);
  }
  // Main sleep = longest session per wake date (daytime naps lose).
  const best = new Map<string, SleepRecord>();
  for (const s of sleeps) {
    const cur = best.get(s.time.local_date);
    if (!cur || s.asleep_s > cur.asleep_s) best.set(s.time.local_date, s);
  }
  for (const s of best.values()) s.is_main = true;
  out.push(...sleeps);

  // ---- workouts
  const kcalSeries: Array<{ t: number; v: number }> = [];
  for (const r of await rows(db, 'active_calories_burned_record_table')) {
    const g = rowReader(r);
    const t = num(g('start_time'));
    const v = num(g('energy'));
    if (t !== undefined && v !== undefined) kcalSeries.push({ t, v: v / o.calDiv });
  }
  const distSeries: Array<{ t: number; v: number }> = [];
  for (const r of await rows(db, 'distance_record_table')) {
    const g = rowReader(r);
    const t = num(g('start_time'));
    const v = num(g('distance'));
    if (t !== undefined && v !== undefined) distSeries.push({ t, v });
  }
  hrSamples.sort((a, b) => a.t - b.t);
  for (const r of await rows(db, 'exercise_session_record_table')) {
    const g = rowReader(r);
    const s0 = num(g('start_time'));
    const s1 = num(g('end_time'));
    if (s0 === undefined || s1 === undefined || s1 <= s0) continue;
    const m = metaOf(g);
    const off = offsetOf(g('start_zone_offset'), ctx.tz, s0);
    const typeInt = num(g('exercise_type')) ?? 0;
    const hr = hrSamples.filter((s) => s.t >= s0 && s.t <= s1).map((s) => s.v);
    const within = (a: Array<{ t: number; v: number }>): number | undefined => {
      const xs = a.filter((x) => x.t >= s0 && x.t < s1);
      return xs.length ? xs.reduce((s, x) => s + x.v, 0) : undefined;
    };
    const w: WorkoutRecord = {
      kind: 'workout',
      record_id: recordId({ source: SOURCE, nativeId: m.uuid ? `workout:${m.uuid}` : undefined, kind: 'workout', metric: String(typeInt), start: isoUtc(s0) }),
      version: 1,
      time: { start: isoUtc(s0), end: isoUtc(s1), tz_offset_s: off, local_date: dateAt(s0, off) },
      provenance: provOf(m, m.uuid),
      quality: qualityOf(m),
      exercise_type: HC_EXERCISE_TYPES[typeInt] ?? `other:${typeInt}`,
      native_type: String(typeInt),
      // Pauses live in segment tables not read here, so this is elapsed time.
      active_duration_s: Math.round((s1 - s0) / 1000),
    };
    const title = str(g('title'));
    if (title) w.title = title;
    const d = within(distSeries);
    if (d !== undefined) w.distance_m = round(d, 1);
    const k = within(kcalSeries);
    if (k !== undefined) w.active_kcal = round(k, 1);
    if (hr.length) {
      w.hr_avg_bpm = round(hr.reduce((s, v) => s + v, 0) / hr.length, 1);
      w.hr_max_bpm = hr.reduce((x, y) => (y > x ? y : x), 0);
    }
    out.push(w);
  }
  return out;
}
