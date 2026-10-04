/**
 * Health Auto Export (iOS app by HealthyApps) JSON importer, channel 'file:health_auto_export' (tier H).
 *
 * Assumed layout: the app's documented JSON export ("Health Auto Export - JSON+CSV", REST API / Automations export format,
 * help.healthyapps.dev "Data Structure" page; v2). The exact field set is NOT verified against a live export:
 *   { "data": { "metrics": [ { "name": "heart_rate", "units": "count/min",
 *                              "data": [ { "date": "2024-01-15 08:30:00 +0100", "qty": 61, "source": "Apple Watch" } ] } ],
 *               "workouts": [ { "id", "name", "start", "end", "duration" (s), "distance": {qty, units},
 *                               "activeEnergyBurned": {qty, units}, "avgHeartRate": {qty, units}, "maxHeartRate": {qty, units},
 *                               "heartRateData": [ { "date", "Min", "Avg", "Max", "units", "source" } ] } ] } }
 * Points carry `qty`, or `Min`/`Avg`/`Max` (heart_rate). `source` may join several sources with '|'. sleep_analysis comes
 * aggregated ({date, sleepStart, sleepEnd, inBedStart, inBedEnd, asleep|totalSleep, core, deep, rem, awake, inBed}, hours) or
 * unaggregated ({startDate, endDate, qty (hours), value: 'Core'|'Deep'|'REM'|'Awake'|'Asleep'|'In Bed'}). A bare array of
 * points or a top-level {metrics, workouts} are accepted too. Dates are Apple style 'YYYY-MM-DD HH:MM:SS +HHMM' (ISO also
 * accepted; a date without offset is read in the importer's zone).
 * A metric whose points are all at 00:00:00 is a daily aggregate: it becomes daily fields only, no series.
 * HRV in this app is Apple SDNN: daily hrv {metric:'sdnn'} + flag 'apple_sdnn'. SpO2 percent or fraction (<= 1 -> x100).
 * Memory is proportional to the file (JSON.parse); records are emitted in bounded batches.
 */
import { recordId, sha256Hex } from '../core/hash';
import { isoAt, parseStamp, qualityOf } from '../core/importKit';
import type { ParsedStamp } from '../core/importKit';
import type { BioBatch, BioRecord, BiometricsImporter, ImportContext, SleepRecord, SleepStageName, SpotMetric, WorkoutRecord } from '../core/types';
import { BIO_SCHEMA } from '../core/types';
import { parseHkDevice } from './appleHealth';
import { RecordAccumulator, Sessionizer, chunkRecords } from './recordKit';
import type { Src } from './recordKit';
import { readText, tzOffsetSeconds } from './util';

export const HAE_PRODUCER = { name: 'vitals-importer-health-auto-export', version: '1' } as const;
const BATCH_SIZE = 500;
const CHANNEL = 'file:health_auto_export' as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const numOf = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const strOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const qtyOf = (v: unknown): { qty: number; units: string } | null => {
  if (isObj(v)) return Number.isFinite(numOf(v.qty)) ? { qty: numOf(v.qty), units: strOf(v.units) ?? '' } : null;
  return Number.isFinite(numOf(v)) ? { qty: numOf(v), units: '' } : null;
};

const lengthM = (v: number, u: string): number => (u === 'km' ? v * 1000 : u === 'mi' ? v * 1609.344 : u === 'ft' ? v * 0.3048 : u === 'yd' ? v * 0.9144 : v);
const kcalOf = (v: number, u: string): number => (/^kj$/i.test(u) ? v / 4.184 : v);
const massKg = (v: number, u: string): number => (u === 'lb' ? v * 0.45359237 : u === 'g' ? v / 1000 : v);
const tempC = (v: number, u: string): number => (/f/i.test(u) ? ((v - 32) * 5) / 9 : v);
const pct = (v: number): number => (v <= 1 ? v * 100 : v);
const snake = (s: string): string => s.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();

const SLEEP_VALUE: Record<string, SleepStageName> = {
  core: 'light', light: 'light', deep: 'deep', rem: 'rem', awake: 'awake', asleep: 'asleep_unspecified', unspecified: 'asleep_unspecified',
  'in bed': 'awake_in_bed', inbed: 'awake_in_bed',
};

class HaeReader {
  private readonly acc: RecordAccumulator;
  private readonly sessions: Sessionizer;
  private readonly srcs = new Map<string, Src>();
  constructor(private readonly tz: string, ingestedAt: string) {
    this.acc = new RecordAccumulator({ channel: CHANNEL, ingestedAt });
    this.sessions = new Sessionizer(this.acc);
  }

  drain(final = false): BioRecord[] {
    if (final) this.sessions.finish();
    return this.acc.drain(final);
  }

  private stamp(s: unknown): ParsedStamp | null {
    if (typeof s !== 'string') return null;
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s.trim())) return parseStamp(s);
    const guess = parseStamp(s, 0);
    if (!guess) return null;
    return parseStamp(s, tzOffsetSeconds(guess.t, this.tz));
  }

  private src(source: unknown): Src {
    const name = strOf(source) ?? 'Health Auto Export';
    let s = this.srcs.get(name);
    if (!s) {
      const device = parseHkDevice(undefined, name);
      this.srcs.set(name, (s = { key: name, sourceApp: name, device }));
    }
    return s;
  }

  private spot(src: Src, metric: SpotMetric, value: number, st: ParsedStamp, key: string): void {
    const nativeId = sha256Hex(`${key}|${src.key}|${isoAt(st.t)}|${value}`).slice(0, 32);
    this.acc.push({
      kind: 'spot', metric, value: Math.round(value * 1000) / 1000,
      record_id: recordId({ source: this.acc.sourceKey(src), nativeId }), version: 1,
      time: { at: isoAt(st.t), tz_offset_s: st.offsetS, local_date: st.localDate },
      provenance: this.acc.prov(src, { native_id: nativeId }),
      quality: qualityOf('measured'),
    });
  }

  metric(m: unknown): void {
    if (!isObj(m)) return;
    const name = snake(strOf(m.name) ?? '');
    const units = strOf(m.units) ?? '';
    const pts = Array.isArray(m.data) ? m.data.filter(isObj) : [];
    if (name === 'sleep_analysis') return this.sleep(pts);
    const stamps = pts.map((p) => this.stamp(p.date ?? p.startDate));
    const dailyOnly = stamps.length > 0 && stamps.every((s) => s?.midnight === true);
    pts.forEach((p, i) => {
      const st = stamps[i];
      if (!st) return;
      const src = this.src(p.source);
      const day = (): ReturnType<RecordAccumulator['day']> => this.acc.day(src, st.localDate, st.offsetS);
      const put = (stream: Parameters<RecordAccumulator['sample']>[1], u: string, agg: 'sample' | 'sum' | 'avg', v: number): void => {
        if (!dailyOnly) this.acc.sample(src, stream, u, agg, 'import', st.t, st.offsetS, st.localDate, v);
      };
      const qty = numOf(p.qty);
      switch (name) {
        case 'heart_rate': {
          const avg = Number.isFinite(numOf(p.Avg ?? p.avg)) ? numOf(p.Avg ?? p.avg) : qty;
          if (!Number.isFinite(avg)) return;
          put('hr', 'bpm', Number.isFinite(qty) ? 'sample' : 'avg', avg);
          day().addHr(avg);
          const mn = numOf(p.Min ?? p.min), mx = numOf(p.Max ?? p.max);
          if (Number.isFinite(mn) && Number.isFinite(mx)) day().widenHr(mn, mx);
          return;
        }
        case 'resting_heart_rate': if (Number.isFinite(qty)) day().setResting(qty); return;
        case 'heart_rate_variability': if (Number.isFinite(qty)) day().addHrv(qty); return;
        case 'blood_oxygen_saturation': { if (!Number.isFinite(qty)) return; const v = pct(qty); put('spo2', '%', 'sample', v); day().addSpo2(v); return; }
        case 'respiratory_rate': if (Number.isFinite(qty)) { put('resp_rate', 'brpm', 'sample', qty); day().addResp(qty); } return;
        case 'step_count': if (Number.isFinite(qty)) { put('steps', 'count', 'sum', qty); day().sumSteps(qty); } return;
        case 'active_energy': case 'active_energy_burned': {
          if (!Number.isFinite(qty)) return;
          const k = kcalOf(qty, units);
          put('active_kcal', 'kcal', 'sum', k);
          day().sumKcal(k);
          return;
        }
        case 'walking_running_distance': { if (!Number.isFinite(qty)) return; const d = lengthM(qty, units); put('distance', 'm', 'sum', d); day().sumDistance(d); return; }
        case 'vo2_max': if (Number.isFinite(qty)) this.acc.day(src, st.localDate, st.offsetS, 'vo2').setVo2(qty, 'vendor_estimate'); return;
        case 'apple_sleeping_wrist_temperature': { if (!Number.isFinite(qty)) return; const c = tempC(qty, units); put('skin_temp', 'degC', 'sample', c); day().addSkin(c); return; }
        case 'body_temperature': if (Number.isFinite(qty)) this.spot(src, 'body_temp_c', tempC(qty, units), st, name); return;
        case 'weight_body_mass': if (Number.isFinite(qty)) this.spot(src, 'weight_kg', massKg(qty, units), st, name); return;
        case 'lean_body_mass': if (Number.isFinite(qty)) this.spot(src, 'lean_mass_kg', massKg(qty, units), st, name); return;
        case 'body_fat_percentage': if (Number.isFinite(qty)) this.spot(src, 'body_fat_pct', pct(qty), st, name); return;
        case 'waist_circumference': if (Number.isFinite(qty)) this.spot(src, 'waist_cm', units === 'in' ? qty * 2.54 : units === 'm' ? qty * 100 : qty, st, name); return;
        default: return;
      }
    });
  }

  private sleep(pts: Obj[]): void {
    for (const p of pts) {
      const src = this.src(p.source);
      if (typeof p.value === 'string') {
        // unaggregated stage interval
        const a = this.stamp(p.startDate ?? p.start ?? p.date);
        const b = this.stamp(p.endDate ?? p.end);
        const stage = SLEEP_VALUE[p.value.trim().toLowerCase()];
        if (a && b && stage) this.sessions.add(src, { s: a.t, e: b.t, stage }, b.offsetS);
        continue;
      }
      const end = this.stamp(p.sleepEnd ?? p.inBedEnd ?? p.date);
      const start = this.stamp(p.sleepStart ?? p.inBedStart);
      if (!end || !start) continue;
      const h = (k: string): number | undefined => (Number.isFinite(numOf(p[k])) ? Math.round(numOf(p[k]) * 3600) : undefined);
      const light = h('core'), deep = h('deep'), rem = h('rem'), awake = h('awake'), inBed = h('inBed');
      const staged = (light ?? 0) + (deep ?? 0) + (rem ?? 0);
      const asleep = h('totalSleep') ?? h('asleep') ?? staged;
      const rec: SleepRecord = {
        kind: 'sleep',
        record_id: recordId({ source: this.acc.sourceKey(src), kind: 'sleep', metric: 'night', start: isoAt(start.t) }),
        version: 1,
        time: { start: isoAt(start.t), end: isoAt(end.t), tz_offset_s: end.offsetS, local_date: end.localDate },
        provenance: this.acc.prov(src),
        quality: qualityOf('measured'),
        is_main: true,
        asleep_s: asleep,
        ...(inBed !== undefined ? { in_bed_s: inBed } : {}),
        ...(awake !== undefined ? { awake_s: awake } : {}),
        ...(light !== undefined ? { light_s: light } : {}),
        ...(deep !== undefined ? { deep_s: deep } : {}),
        ...(rem !== undefined ? { rem_s: rem } : {}),
        ...(inBed ? { efficiency_pct: Math.round((asleep / inBed) * 1000) / 10 } : {}),
      };
      this.acc.push(rec);
    }
  }

  workouts(list: unknown[]): void {
    for (const w of list) {
      if (!isObj(w)) continue;
      const a = this.stamp(w.start);
      const b = this.stamp(w.end);
      if (!a || !b) continue;
      const src = this.src(w.source);
      const name = strOf(w.name) ?? 'workout';
      const native = strOf(w.id) ?? sha256Hex(`workout|${name}|${isoAt(a.t)}|${isoAt(b.t)}`).slice(0, 32);
      const dist = qtyOf(w.distance ?? w.totalDistance);
      const en = qtyOf(w.activeEnergyBurned ?? w.activeEnergy);
      let avg = qtyOf(w.avgHeartRate)?.qty;
      let max = qtyOf(w.maxHeartRate)?.qty;
      if (Array.isArray(w.heartRateData) && (avg === undefined || max === undefined)) {
        const hr = w.heartRateData.filter(isObj);
        const avgs = hr.map((x) => numOf(x.Avg ?? x.avg ?? x.qty)).filter(Number.isFinite);
        const maxs = hr.map((x) => numOf(x.Max ?? x.max ?? x.qty)).filter(Number.isFinite);
        if (avg === undefined && avgs.length) avg = avgs.reduce((x, y) => x + y, 0) / avgs.length;
        if (max === undefined && maxs.length) max = Math.max(...maxs);
      }
      const dur = numOf(w.duration);
      const rec: WorkoutRecord = {
        kind: 'workout',
        record_id: recordId({ source: this.acc.sourceKey(src), nativeId: native }),
        version: 1,
        time: { start: isoAt(a.t), end: isoAt(b.t), tz_offset_s: a.offsetS, local_date: a.localDate },
        provenance: this.acc.prov(src, { native_id: native, recording_method: 'active' }),
        quality: qualityOf('measured'),
        exercise_type: snake(name) || 'other',
        native_type: name,
        active_duration_s: Math.round(Number.isFinite(dur) ? dur : (b.t - a.t) / 1000),
        ...(dist ? { distance_m: Math.round(lengthM(dist.qty, dist.units) * 10) / 10 } : {}),
        ...(en ? { active_kcal: Math.round(kcalOf(en.qty, en.units) * 10) / 10 } : {}),
        ...(avg !== undefined ? { hr_avg_bpm: Math.round(avg * 10) / 10 } : {}),
        ...(max !== undefined ? { hr_max_bpm: max } : {}),
      };
      this.acc.push(rec);
    }
  }
}

function sniffHae(head: Uint8Array): boolean {
  const t = new TextDecoder().decode(head.subarray(0, 8192));
  return /^\s*\{/.test(t) && /"(metrics|workouts)"\s*:/.test(t) && !t.includes('"specversion"');
}

async function* runHae(input: Blob, ctx: ImportContext): AsyncGenerator<BioBatch> {
  let root: unknown;
  try {
    root = JSON.parse(await readText(input));
  } catch (e) {
    throw new Error(`Health Auto Export file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const data = isObj(root) && isObj(root.data) ? root.data : root;
  const metrics = isObj(data) && Array.isArray(data.metrics) ? data.metrics : [];
  const workouts = isObj(data) && Array.isArray(data.workouts) ? data.workouts : [];
  if (metrics.length === 0 && workouts.length === 0) throw new Error('no "data.metrics" or "data.workouts" found: not a Health Auto Export JSON');
  const r = new HaeReader(ctx.tz, ctx.now);
  const mk = (records: BioRecord[]): BioBatch => ({ schema: BIO_SCHEMA, producer: HAE_PRODUCER, exported_at: ctx.now, tz: ctx.tz, records });
  let i = 0;
  const total = metrics.length + 1;
  for (const m of metrics) {
    ctx.signal.throwIfAborted();
    r.metric(m);
    ctx.onProgress(Math.min(0.99, ++i / total));
    for (const recs of chunkRecords(r.drain(), BATCH_SIZE)) yield mk(recs);
  }
  r.workouts(workouts);
  for (const recs of chunkRecords(r.drain(true), BATCH_SIZE)) yield mk(recs);
  ctx.onProgress(1);
}

export const healthAutoExportImporter: BiometricsImporter = {
  id: 'health_auto_export',
  label: 'Health Auto Export (JSON)',
  accepts: { mime: ['application/json'], extensions: ['.json'], sniff: sniffHae },
  run: runHae,
};
