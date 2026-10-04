/**
 * Apple Health `export.xml` / `export.zip` importer (channel 'file:apple_health'; tier H).
 *
 * Streams the file through a SAX-style tokenizer (xmlStream.ts) in bounded batches; memory is independent of file size
 * apart from O(days x sources) daily accumulators and O(nights) sleep summaries (both held until end of file).
 * Apple dates are 'YYYY-MM-DD HH:MM:SS +HHMM'; the offset and local date are taken from the string.
 *
 * Mapping (HKQuantityTypeIdentifier*): HeartRate -> hr series + daily hr stats; RestingHeartRate -> daily resting_hr_bpm;
 * HeartRateVariabilitySDNN -> daily hrv {metric:'sdnn'} + flag 'apple_sdnn' (never converted to RMSSD); OxygenSaturation ->
 * spo2 series + daily (Apple stores a fraction 0..1 with unit '%': x100; values already > 1 are kept); RespiratoryRate ->
 * resp_rate; AppleSleepingWristTemperature -> skin_temp; BodyTemperature -> spot; StepCount / DistanceWalkingRunning /
 * ActiveEnergyBurned -> 'sum' series + daily sums; VO2Max -> daily vo2max {method:'vendor_estimate'} + 'estimated_vo2';
 * BodyMass / BodyFatPercentage (fraction -> %) / LeanBodyMass / WaistCircumference / BloodPressure{Systolic,Diastolic} /
 * BloodGlucose (mmol/L x 18.016 -> mg/dL) -> spot. HKCategoryTypeIdentifierSleepAnalysis -> sleep sessions per source
 * (InBed -> awake_in_bed, Asleep/AsleepUnspecified -> asleep_unspecified, AsleepCore -> light, AsleepDeep -> deep,
 * AsleepREM -> rem, Awake -> awake; a gap > 2 h starts a new session; is_main = longest asleep per source and wake date).
 * <Workout> -> workout records (HR avg/max from WorkoutStatistics when present).
 *
 * Device tier heuristic (R9 §3 tiers; Apple documents no per-record tier): device/source mentions "Watch" -> watch, tier B;
 * "Oura" -> ring, tier B; anything else (iPhone, third-party apps and scales, manual entry) -> phone, tier C.
 * Only Records that are direct children of HealthData are read (Correlation children duplicate them).
 * native_id = sha256(type|sourceName|startDate|endDate|value)[0..32].
 */
import { recordId, sha256Hex } from '../core/hash';
import { isoAt, parseStamp, qualityOf } from '../core/importKit';
import type { BioBatch, BioProvenance, BioRecord, BiometricsImporter, ImportContext, SleepStageName, SpotMetric, WorkoutRecord } from '../core/types';
import { BIO_SCHEMA } from '../core/types';
import { RecordAccumulator, Sessionizer, chunkRecords } from './recordKit';
import type { Src } from './recordKit';
import { XmlTokenizer, textChunks } from './xmlStream';
import type { XmlHandler } from './xmlStream';
import { listZipEntries, openZipEntry } from './zipStream';

export const APPLE_PRODUCER = { name: 'vitals-importer-apple-health', version: '1' } as const;
const BATCH_SIZE = 500;
const CHANNEL = 'file:apple_health' as const;

const SLEEP_STAGE: Record<string, SleepStageName> = {
  InBed: 'awake_in_bed', Asleep: 'asleep_unspecified', AsleepUnspecified: 'asleep_unspecified', AsleepCore: 'light', AsleepDeep: 'deep', AsleepREM: 'rem', Awake: 'awake',
};

/** 'HKDevice: 0x.., name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch6,2, software:9.0' fields. */
export function parseHkDevice(raw: string | undefined, sourceName: string): BioProvenance['device'] {
  const f: Record<string, string> = {};
  if (raw) for (const m of raw.matchAll(/(name|manufacturer|model|hardware|software):(.*?)(?=, (?:name|manufacturer|model|hardware|software|localIdentifier|FDA|UDI)\w*:|>|$)/g)) f[m[1]!] = m[2]!.trim();
  const hay = `${f.name ?? ''} ${f.model ?? ''} ${sourceName}`;
  const type = /oura/i.test(hay) ? 'ring' : /watch/i.test(hay) ? 'watch' : 'phone';
  const tier = type === 'phone' ? 'C' : 'B';
  return {
    type, tier,
    ...(f.manufacturer ? { manufacturer: f.manufacturer } : {}),
    ...((f.hardware ?? f.model ?? f.name) ? { model: (f.hardware ?? f.model ?? f.name)! } : {}),
    ...(f.software ? { firmware: f.software } : {}),
  };
}

const num = (s: string | undefined): number => (s === undefined || s === '' ? NaN : Number(s));
const strip = (t: string, prefix: string): string => (t.startsWith(prefix) ? t.slice(prefix.length) : t);
const lengthM = (v: number, u: string): number => (u === 'km' ? v * 1000 : u === 'mi' ? v * 1609.344 : u === 'ft' ? v * 0.3048 : u === 'yd' ? v * 0.9144 : v);
const kcalOf = (v: number, u: string): number => (u === 'kJ' ? v / 4.184 : v);
const massKg = (v: number, u: string): number => (u === 'lb' ? v * 0.45359237 : u === 'g' ? v / 1000 : u === 'st' ? v * 6.35029318 : v);
const tempC = (v: number, u: string): number => (u === 'degF' || u === '°F' ? ((v - 32) * 5) / 9 : v);
const pct = (v: number): number => (v <= 1 ? v * 100 : v);
const durationS = (v: number, u: string | undefined): number => (u === 'min' ? v * 60 : u === 'hr' || u === 'h' ? v * 3600 : v);
const snake = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase();

class AppleParser implements XmlHandler {
  private depth = 0;
  private rec: { attrs: Record<string, string>; manual: boolean } | null = null;
  private wk: { attrs: Record<string, string>; stats: Array<Record<string, string>> } | null = null;
  private readonly srcs = new Map<string, Src>();
  private readonly sessions: Sessionizer;
  exportDate: string | undefined;
  records = 0;

  constructor(private readonly acc: RecordAccumulator) {
    this.sessions = new Sessionizer(acc);
  }

  open(name: string, attrs: Record<string, string>): void {
    if (this.depth === 1) {
      if (name === 'Record') this.rec = { attrs, manual: false };
      else if (name === 'Workout') this.wk = { attrs, stats: [] };
      else if (name === 'ExportDate') this.exportDate = attrs.value;
    } else if (this.depth === 2) {
      if (name === 'MetadataEntry' && this.rec && attrs.key === 'HKWasUserEntered' && attrs.value === '1') this.rec.manual = true;
      else if (name === 'WorkoutStatistics' && this.wk) this.wk.stats.push(attrs);
    }
    this.depth++;
  }

  close(name: string): void {
    this.depth--;
    if (this.depth !== 1) return;
    if (name === 'Record' && this.rec) {
      const r = this.rec;
      this.rec = null;
      this.record(r.attrs, r.manual);
    } else if (name === 'Workout' && this.wk) {
      const w = this.wk;
      this.wk = null;
      this.workout(w.attrs, w.stats);
    }
  }

  private src(attrs: Record<string, string>, manual: boolean): Src {
    const sourceName = attrs.sourceName ?? 'unknown';
    const k = `${sourceName}|${attrs.device ?? ''}|${manual ? 'm' : ''}`;
    let s = this.srcs.get(k);
    if (!s) {
      const device = parseHkDevice(attrs.device, sourceName);
      this.srcs.set(k, (s = { key: `${sourceName}|${device?.model ?? ''}${manual ? '|manual' : ''}`, sourceApp: sourceName, device, manual }));
    }
    return s;
  }

  private spot(src: Src, metric: SpotMetric, value: number, st: { t: number; offsetS: number; date: string }, nativeId: string): void {
    this.acc.push({
      kind: 'spot', metric, value: Math.round(value * 1000) / 1000,
      record_id: recordId({ source: this.acc.sourceKey(src), nativeId }),
      version: 1,
      time: { at: isoAt(st.t), tz_offset_s: st.offsetS, local_date: st.date },
      provenance: this.acc.prov(src, { native_id: nativeId, recording_method: src.manual ? 'manual' : 'automatic' }),
      quality: qualityOf(src.manual ? 'self_reported' : 'measured'),
    });
  }

  private record(a: Record<string, string>, manual: boolean): void {
    this.records++;
    const type = a.type;
    if (!type) return;
    const s0 = parseStamp(a.startDate ?? '');
    if (!s0) return;
    const src = this.src(a, manual);
    if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
      const e = parseStamp(a.endDate ?? '');
      const stage = SLEEP_STAGE[strip(a.value ?? '', 'HKCategoryValueSleepAnalysis')];
      if (e && stage) this.sessions.add(src, { s: s0.t, e: e.t, stage }, e.offsetS);
      return;
    }
    if (!type.startsWith('HKQuantityTypeIdentifier')) return;
    const v = num(a.value);
    if (!Number.isFinite(v)) return;
    const unit = a.unit ?? '';
    const st = { t: s0.t, offsetS: s0.offsetS, date: s0.localDate };
    const day = (): ReturnType<RecordAccumulator['day']> => this.acc.day(src, st.date, st.offsetS);
    const nativeId = (): string => sha256Hex(`${type}|${a.sourceName ?? ''}|${a.startDate}|${a.endDate ?? ''}|${a.value}`).slice(0, 32);
    const put = (stream: Parameters<RecordAccumulator['sample']>[1], u: string, agg: 'sample' | 'sum', value: number): void =>
      this.acc.sample(src, stream, u, agg, 'import', st.t, st.offsetS, st.date, value);
    switch (strip(type, 'HKQuantityTypeIdentifier')) {
      case 'HeartRate': put('hr', 'bpm', 'sample', v); day().addHr(v); break;
      case 'RestingHeartRate': day().setResting(v); break;
      case 'HeartRateVariabilitySDNN': day().addHrv(v); break;
      case 'OxygenSaturation': { const p = pct(v); put('spo2', '%', 'sample', p); day().addSpo2(p); break; }
      case 'RespiratoryRate': put('resp_rate', 'brpm', 'sample', v); day().addResp(v); break;
      case 'AppleSleepingWristTemperature': { const c = tempC(v, unit); put('skin_temp', 'degC', 'sample', c); day().addSkin(c); break; }
      case 'BodyTemperature': this.spot(src, 'body_temp_c', tempC(v, unit), st, nativeId()); break;
      case 'StepCount': put('steps', 'count', 'sum', v); day().sumSteps(v); break;
      case 'DistanceWalkingRunning': { const m = lengthM(v, unit); put('distance', 'm', 'sum', m); day().sumDistance(m); break; }
      case 'ActiveEnergyBurned': { const k = kcalOf(v, unit); put('active_kcal', 'kcal', 'sum', k); day().sumKcal(k); break; }
      case 'VO2Max': this.acc.day(src, st.date, st.offsetS, 'vo2').setVo2(v, 'vendor_estimate'); break;
      case 'BodyMass': this.spot(src, 'weight_kg', massKg(v, unit), st, nativeId()); break;
      case 'LeanBodyMass': this.spot(src, 'lean_mass_kg', massKg(v, unit), st, nativeId()); break;
      case 'BodyFatPercentage': this.spot(src, 'body_fat_pct', pct(v), st, nativeId()); break;
      case 'WaistCircumference': this.spot(src, 'waist_cm', unit === 'in' ? v * 2.54 : unit === 'm' ? v * 100 : v, st, nativeId()); break;
      case 'BloodPressureSystolic': this.spot(src, 'bp_sys_mmhg', v, st, nativeId()); break;
      case 'BloodPressureDiastolic': this.spot(src, 'bp_dia_mmhg', v, st, nativeId()); break;
      case 'BloodGlucose': this.spot(src, 'glucose_mg_dl', /mmol/i.test(unit) ? v * 18.016 : v, st, nativeId()); break;
      default: break;
    }
  }

  private workout(a: Record<string, string>, stats: Array<Record<string, string>>): void {
    const s0 = parseStamp(a.startDate ?? '');
    const e0 = parseStamp(a.endDate ?? '');
    if (!s0 || !e0) return;
    const src = this.src(a, false);
    const stat = (id: string): Record<string, string> | undefined => stats.find((x) => x.type === `HKQuantityTypeIdentifier${id}`);
    let dur = num(a.duration);
    dur = Number.isFinite(dur) ? durationS(dur, a.durationUnit) : (e0.t - s0.t) / 1000;
    let dist = num(a.totalDistance);
    if (Number.isFinite(dist)) dist = lengthM(dist, a.totalDistanceUnit ?? 'km');
    else {
      dist = NaN;
      for (const id of ['DistanceWalkingRunning', 'DistanceCycling', 'DistanceSwimming']) {
        const d = stat(id);
        if (d && Number.isFinite(num(d.sum))) { dist = lengthM(num(d.sum), d.unit ?? 'm'); break; }
      }
    }
    let kcal = num(a.totalEnergyBurned);
    if (Number.isFinite(kcal)) kcal = kcalOf(kcal, a.totalEnergyBurnedUnit ?? 'kcal');
    else {
      const d = stat('ActiveEnergyBurned');
      kcal = d && Number.isFinite(num(d.sum)) ? kcalOf(num(d.sum), d.unit ?? 'kcal') : NaN;
    }
    const hr = stat('HeartRate');
    const native = a.workoutActivityType ?? '';
    const nativeId = sha256Hex(`workout|${native}|${a.sourceName ?? ''}|${a.startDate}|${a.endDate}`).slice(0, 32);
    const w: WorkoutRecord = {
      kind: 'workout',
      record_id: recordId({ source: this.acc.sourceKey(src), nativeId }),
      version: 1,
      time: { start: isoAt(s0.t), end: isoAt(e0.t), tz_offset_s: s0.offsetS, local_date: s0.localDate },
      provenance: this.acc.prov(src, { native_id: nativeId, recording_method: 'active' }),
      quality: qualityOf('measured'),
      exercise_type: snake(strip(native, 'HKWorkoutActivityType')) || 'other',
      native_type: native,
      active_duration_s: Math.round(dur),
      ...(Number.isFinite(dist) ? { distance_m: Math.round(dist * 10) / 10 } : {}),
      ...(Number.isFinite(kcal) ? { active_kcal: Math.round(kcal * 10) / 10 } : {}),
      ...(hr && Number.isFinite(num(hr.average)) ? { hr_avg_bpm: Math.round(num(hr.average) * 10) / 10 } : {}),
      ...(hr && Number.isFinite(num(hr.maximum)) ? { hr_max_bpm: num(hr.maximum) } : {}),
    };
    this.acc.push(w);
  }

  /** Called once at end of file: closes sleep sessions and marks the longest per source and wake date as main. */
  finish(): void {
    this.sessions.finish();
  }
}

function sniffApple(head: Uint8Array): boolean {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return true;
  const t = new TextDecoder().decode(head.subarray(0, 4096));
  return t.includes('<HealthData');
}

export const appleHealthImporter: BiometricsImporter = {
  id: 'apple_health',
  label: 'Apple Health export (export.xml / export.zip)',
  accepts: { mime: ['application/zip', 'application/xml', 'text/xml'], extensions: ['.zip', '.xml'], sniff: sniffApple },
  run(input: Blob, ctx: ImportContext): AsyncIterable<BioBatch> {
    return runApple(input, ctx);
  },
};

async function* runApple(input: Blob, ctx: ImportContext): AsyncGenerator<BioBatch> {
  const head = new Uint8Array(await input.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  let stream: ReadableStream<Uint8Array>;
  let total = Math.max(1, input.size);
  if (isZip) {
    const entries = await listZipEntries(input);
    const e = entries.find((x) => /(^|\/)export\.xml$/.test(x.name));
    if (!e) throw new Error('export.xml not found in the ZIP (is this an Apple Health export?)');
    stream = await openZipEntry(input, e);
    total = Math.max(1, e.size);
  } else stream = input.stream() as ReadableStream<Uint8Array>;

  const acc = new RecordAccumulator({ channel: CHANNEL, ingestedAt: ctx.now });
  const parser = new AppleParser(acc);
  const tok = new XmlTokenizer(parser);
  const mk = (records: BioRecord[]): BioBatch => ({
    schema: BIO_SCHEMA, producer: APPLE_PRODUCER, exported_at: stampToIso(parser.exportDate) ?? ctx.now, tz: ctx.tz, records,
  });
  for await (const { text, bytes } of textChunks(stream, ctx.signal)) {
    tok.push(text);
    ctx.onProgress(Math.min(0.99, bytes / total));
    for (const recs of chunkRecords(acc.drain(), BATCH_SIZE)) yield mk(recs);
  }
  parser.finish();
  for (const recs of chunkRecords(acc.drain(true), BATCH_SIZE)) yield mk(recs);
  ctx.onProgress(1);
}

function stampToIso(s: string | undefined): string | undefined {
  const p = s ? parseStamp(s) : null;
  return p ? isoAt(p.t) : undefined;
}

