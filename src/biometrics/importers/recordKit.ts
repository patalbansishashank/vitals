/**
 * Streaming record accumulator shared by the Apple Health and Health Auto Export importers (tier H, no DOM).
 * Series samples are buffered per (source, stream, local day, offset, aggregation, origin, unit) and flushed as bounded
 * series records; per-day aggregates (steps, distance, energy, HR stats, resting HR, HRV, SpO2, ...) are kept as small
 * accumulators (O(days x sources)) and emitted at the end. Everything else (sleep, workouts, spots) is pushed as-is.
 */
import { recordId, sha256Hex } from '../core/hash';
import { buildSleepRecord, isoAt, provenanceOf, qualityOf } from '../core/importKit';
import type { StageSeg } from '../core/importKit';
import type { BioChannel, BioProvenance, BioRecord, BioStream, DailyRecord, QualityFlag, SampleOrigin, SeriesRecord, SleepRecord } from '../core/types';

export interface Src {
  /** Stable key (source name + device) used in record ids. */
  key: string;
  sourceApp?: string;
  device?: BioProvenance['device'];
  /** User-entered (not sensed). */
  manual?: boolean;
}

export interface AccOptions {
  channel: BioChannel;
  ingestedAt: string;
  /** Series samples buffered before every open bucket is flushed. */
  maxBufferedSamples?: number;
}

interface Bucket {
  src: Src;
  stream: BioStream;
  unit: string;
  agg: SeriesRecord['aggregation'];
  origin: SampleOrigin;
  offsetS: number;
  date: string;
  flags: Set<QualityFlag>;
  pts: Array<[number, number]>;
}

interface Stat { sum: number; n: number; min: number; max: number }
const newStat = (): Stat => ({ sum: 0, n: 0, min: Infinity, max: -Infinity });
const addStat = (s: Stat, v: number): void => { s.sum += v; s.n++; if (v < s.min) s.min = v; if (v > s.max) s.max = v; };
const r2 = (v: number): number => Math.round(v * 100) / 100;

export class DayAcc {
  count = 0;
  steps?: number;
  distance?: number;
  kcal?: number;
  hr = newStat();
  resting?: number;
  hrv = newStat();
  spo2 = newStat();
  resp = newStat();
  skin = newStat();
  body = newStat();
  vo2?: number;
  vo2Method: 'vendor_estimate' | 'derived' = 'vendor_estimate';
  flags = new Set<QualityFlag>();
  constructor(readonly src: Src, readonly date: string, readonly offsetS: number, readonly part: 'main' | 'vo2') {}
  sumSteps(v: number): void { this.steps = (this.steps ?? 0) + v; this.count++; }
  sumDistance(v: number): void { this.distance = (this.distance ?? 0) + v; this.count++; }
  sumKcal(v: number): void { this.kcal = (this.kcal ?? 0) + v; this.count++; }
  addHr(v: number): void { addStat(this.hr, v); this.count++; }
  /** Widens the day's HR min/max without changing the mean (aggregated sources that report Min/Avg/Max). */
  widenHr(min: number, max: number): void { this.hr.min = Math.min(this.hr.min, min); this.hr.max = Math.max(this.hr.max, max); }
  setResting(v: number): void { this.resting = v; this.count++; }
  addHrv(v: number): void { addStat(this.hrv, v); this.count++; }
  addSpo2(v: number): void { addStat(this.spo2, v); this.count++; }
  addResp(v: number): void { addStat(this.resp, v); this.count++; }
  addSkin(v: number): void { addStat(this.skin, v); this.count++; }
  addBody(v: number): void { addStat(this.body, v); this.count++; }
  setVo2(v: number, m: 'vendor_estimate' | 'derived' = 'vendor_estimate'): void { this.vo2 = v; this.vo2Method = m; this.count++; }
}

export class RecordAccumulator {
  private readonly buckets = new Map<string, Bucket>();
  private readonly days = new Map<string, DayAcc>();
  private out: BioRecord[] = [];
  private buffered = 0;
  private readonly limit: number;

  constructor(private readonly o: AccOptions) {
    this.limit = o.maxBufferedSamples ?? 20000;
  }

  prov(src: Src, p: Partial<BioProvenance> = {}): BioProvenance {
    return provenanceOf(this.o.channel, this.o.ingestedAt, {
      ...(src.sourceApp ? { source_app: src.sourceApp } : {}),
      ...(src.device ? { device: src.device } : {}),
      recording_method: src.manual ? 'manual' : 'automatic',
      modality: src.manual ? 'self_reported' : 'sensed',
      ...p,
    });
  }

  sourceKey(src: Src): string {
    return `${this.o.channel}:${src.key}`;
  }

  push(rec: BioRecord): void {
    this.out.push(rec);
  }

  sample(src: Src, stream: BioStream, unit: string, agg: SeriesRecord['aggregation'], origin: SampleOrigin, t: number, offsetS: number, date: string, value: number, flags: QualityFlag[] = []): void {
    const key = `${src.key}|${stream}|${date}|${offsetS}|${agg}|${origin}|${unit}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { src, stream, unit, agg, origin, offsetS, date, flags: new Set(), pts: [] }));
    for (const f of flags) b.flags.add(f);
    b.pts.push([t, value]);
    this.buffered++;
  }

  day(src: Src, date: string, offsetS: number, part: 'main' | 'vo2' = 'main'): DayAcc {
    const key = `${src.key}|${date}|${part}`;
    let d = this.days.get(key);
    if (!d) this.days.set(key, (d = new DayAcc(src, date, offsetS, part)));
    return d;
  }

  /** Records ready to emit. Series buckets are flushed when the buffer limit is hit or when `final`; days only when `final`. */
  drain(final = false): BioRecord[] {
    if (final || this.buffered >= this.limit) this.flushSeries();
    if (final) this.flushDays();
    const r = this.out;
    this.out = [];
    return r;
  }

  private flushSeries(): void {
    for (const b of this.buckets.values()) b.pts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const list = [...this.buckets.values()].sort((a, b) => a.pts[0]![0] - b.pts[0]![0] || (a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : a.src.key < b.src.key ? -1 : 1));
    this.buckets.clear();
    this.buffered = 0;
    for (const b of list) {
      const pts = b.pts.filter((p, i) => i === 0 || p[0] !== b.pts[i - 1]![0] || p[1] !== b.pts[i - 1]![1]);
      const t0 = pts[0]![0];
      const vendor = b.stream.startsWith('vendor:');
      this.out.push({
        kind: 'series',
        record_id: recordId({ source: `${this.sourceKey(b.src)}:${b.origin}:${b.agg}:${b.unit}`, kind: 'series', metric: b.stream, start: isoAt(t0) }),
        version: 1,
        time: { start: isoAt(t0), end: isoAt(pts[pts.length - 1]![0]), tz_offset_s: b.offsetS, local_date: b.date },
        provenance: this.prov(b.src, { recording_method: b.src.manual ? 'manual' : b.origin === 'spot' ? 'active' : 'automatic' }),
        quality: qualityOf(vendor ? 'vendor_proprietary' : b.src.manual ? 'self_reported' : 'measured', [...b.flags]),
        metric: b.stream,
        unit: b.unit,
        aggregation: b.agg,
        sampling: { mode: 'event', ...(b.src.device ? { device_tier: b.src.device.tier } : {}) },
        t_offset_s: pts.map((p) => Math.round((p[0] - t0) / 1000)),
        values: pts.map((p) => p[1]),
      });
    }
  }

  private flushDays(): void {
    const list = [...this.days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.src.key < b.src.key ? -1 : 1));
    this.days.clear();
    for (const d of list) {
      const rec: DailyRecord = {
        kind: 'daily',
        record_id: recordId({ source: this.sourceKey(d.src), kind: 'daily', metric: d.part, start: d.date }),
        // more samples for the same day (a later, fuller export) must supersede: the contributing-sample count only grows
        version: Math.max(1, d.count),
        time: { tz_offset_s: d.offsetS, local_date: d.date },
        provenance: this.prov(d.src),
        quality: qualityOf(d.part === 'vo2' ? 'estimated' : 'measured', [...d.flags]),
      };
      if (d.part === 'vo2') {
        if (d.vo2 === undefined) continue;
        rec.vo2max = { ml_kg_min: r2(d.vo2), method: d.vo2Method };
        rec.quality.flags = [...new Set<QualityFlag>([...rec.quality.flags, 'estimated_vo2'])].sort();
      } else {
        if (d.steps !== undefined) rec.steps = Math.round(d.steps);
        if (d.distance !== undefined) rec.distance_m = r2(d.distance);
        if (d.kcal !== undefined) rec.active_kcal = r2(d.kcal);
        if (d.hr.n > 0) { rec.hr_avg_bpm = r2(d.hr.sum / d.hr.n); rec.hr_min_bpm = d.hr.min; rec.hr_max_bpm = d.hr.max; }
        if (d.resting !== undefined) rec.resting_hr_bpm = d.resting;
        if (d.hrv.n > 0) {
          rec.hrv = { metric: 'sdnn', value_ms: r2(d.hrv.sum / d.hrv.n), window: 'spot', n: d.hrv.n };
          rec.quality.flags = [...new Set<QualityFlag>([...rec.quality.flags, 'apple_sdnn'])].sort();
        }
        if (d.spo2.n > 0) { rec.spo2_avg_pct = r2(d.spo2.sum / d.spo2.n); rec.spo2_min_pct = d.spo2.min; }
        if (d.resp.n > 0) rec.resp_rate_brpm = r2(d.resp.sum / d.resp.n);
        if (d.skin.n > 0) rec.skin_temp_c = r2(d.skin.sum / d.skin.n);
        if (d.body.n > 0) rec.body_temp_c = r2(d.body.sum / d.body.n);
        if (Object.keys(rec).length <= 6) continue;
      }
      this.out.push(rec);
    }
  }
}

/** Splits a record list into batches of at most `size`. */
export function* chunkRecords(recs: BioRecord[], size: number): Generator<BioRecord[]> {
  for (let i = 0; i < recs.length; i += size) yield recs.slice(i, i + size);
}

export const SESSION_GAP_MS = 2 * 3600 * 1000;

interface OpenSession { src: Src; segs: StageSeg[]; end: number; offsetS: number }

/** Groups stage intervals per source into sleep sessions (a gap > 2 h splits) and marks the longest session per source and
 * wake date as main. Sessions are summarised as soon as they close; the summaries wait for `finish()`. */
export class Sessionizer {
  private readonly open = new Map<string, OpenSession>();
  private readonly done: SleepRecord[] = [];
  constructor(private readonly acc: RecordAccumulator, private readonly gapMs = SESSION_GAP_MS) {}

  add(src: Src, g: StageSeg, offsetS: number): void {
    if (g.e <= g.s) return;
    const cur = this.open.get(src.key);
    if (cur && g.s - cur.end > this.gapMs) {
      this.close(cur);
      this.open.delete(src.key);
    }
    let s = this.open.get(src.key);
    if (!s) this.open.set(src.key, (s = { src, segs: [], end: -Infinity, offsetS }));
    s.segs.push(g);
    s.end = Math.max(s.end, g.e);
    s.offsetS = offsetS;
  }

  private close(s: OpenSession): void {
    const first = Math.min(...s.segs.map((g) => g.s));
    const nativeId = sha256Hex(`sleep|${s.src.key}|${isoAt(first)}|${isoAt(s.end)}`).slice(0, 32);
    const rec = buildSleepRecord({
      segs: s.segs, offsetS: s.offsetS, sourceKey: this.acc.sourceKey(s.src), nativeId,
      provenance: this.acc.prov(s.src), quality: qualityOf(s.src.manual ? 'self_reported' : 'measured'), isMain: false,
    });
    if (rec) this.done.push(rec);
  }

  /** Closes open sessions, marks main sessions and pushes every sleep record to the accumulator. */
  finish(): void {
    for (const s of this.open.values()) this.close(s);
    this.open.clear();
    const best = new Map<string, SleepRecord>();
    for (const rec of this.done) {
      const k = `${rec.provenance.source_app ?? ''}|${rec.provenance.device?.model ?? ''}|${rec.time.local_date}`;
      const b = best.get(k);
      if (!b || rec.asleep_s > b.asleep_s) best.set(k, rec);
    }
    for (const b of best.values()) if (b.asleep_s > 0) b.is_main = true;
    this.done.sort((x, y) => (x.time.start! < y.time.start! ? -1 : 1));
    for (const rec of this.done) this.acc.push(rec);
    this.done.length = 0;
  }
}
