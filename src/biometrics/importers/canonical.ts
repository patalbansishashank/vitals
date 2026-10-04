/**
 * Canonical importer (`vitals.biometrics/1`): JSON (a BioBatch or an array of batches/records), JSONL (one BioRecord or
 * BioBatch per line) and a simple CSV. Provenance for CSV rows is channel 'file:canonical'. Large files stream line by
 * line (Blob.stream()). Structural validation happens in the ingest pipeline, not here; malformed JSON throws.
 *
 * CSV columns (header row required, names case-insensitive, extra columns ignored, one fact per row):
 *   kind        daily | spot | series | sleep
 *   metric      daily: a DailyRecord number field (steps, distance_m, active_kcal, total_kcal, resting_hr_bpm, hr_avg_bpm,
 *               hr_min_bpm, hr_max_bpm, spo2_avg_pct, spo2_min_pct, resp_rate_brpm, skin_temp_delta_c, skin_temp_c,
 *               body_temp_c) or hrv_rmssd_ms / hrv_sdnn_ms (night window)
 *               spot: a SpotMetric (weight_kg, body_fat_pct, bp_sys_mmhg, ...); series: a raw stream (hr, ibi, spo2, ...);
 *               sleep: ignored
 *   start       ISO-8601 instant; series sample time, spot time, sleep start (daily: optional)
 *   end         ISO-8601 instant; sleep end (optional)
 *   local_date  YYYY-MM-DD; required for daily rows, otherwise derived from start in tz_offset_s / the context zone
 *   tz_offset_s UTC offset seconds; optional, derived from start in the context zone when empty
 *   value       number (sleep: seconds asleep)
 *   unit        optional; converted to the canonical unit (e.g. km, kJ, degF, fraction)
 *   source      optional source label (source_app); default 'csv'
 *   context     optional; spot: fasting|morning|post_workout; series: sleep|rest|exercise|unknown; sleep: 'nap' = not main
 *   native_id   optional; makes the record id stable across edits (a higher `version` column replaces)
 *   version     optional integer, default 1
 * Daily rows of one (source, local_date) merge into one record; series rows of one (source, metric, local day) into one
 * series record. Workouts and sleep stages are not supported in CSV (use JSON).
 */
import { recordId } from '../core/hash';
import { normaliseValue } from '../core/validate';
import { BIO_SCHEMA } from '../core/types';
import type {
  BioBatch, BioProvenance, BioRecord, BioStream, BiometricsImporter, DailyRecord, ImportContext, SeriesContext, SeriesRecord, SleepRecord, SpotRecord,
} from '../core/types';
import { batchRecords, isoUtc, localDateOf, makeBatch, readLines, readText, tzOffsetSeconds } from './util';

const BOM_RE = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const PRODUCER = { name: 'vitals-canonical-importer', version: '1' };
const BATCH_SIZE = 500;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isBatch = (x: unknown): x is BioBatch => isObj(x) && x.schema === BIO_SCHEMA && Array.isArray(x.records);
const isRecord = (x: unknown): x is BioRecord => isObj(x) && typeof x.kind === 'string' && typeof x.record_id === 'string';

export const canonicalImporter: BiometricsImporter = {
  id: 'canonical',
  label: 'Vitals canonical (JSON, JSONL, CSV)',
  accepts: {
    mime: ['application/json', 'application/x-ndjson', 'text/csv'],
    extensions: ['.json', '.jsonl', '.ndjson', '.csv'],
    sniff(head: Uint8Array): boolean {
      const t = new TextDecoder().decode(head).replace(BOM_RE, '').trimStart();
      if (/^kind\s*,/i.test(t)) return true;
      return (t.startsWith('{') || t.startsWith('[')) && (t.includes('vitals.biometrics/1') || /"kind"\s*:/.test(t));
    },
  },
  run(input: Blob, ctx: ImportContext): AsyncIterable<BioBatch> {
    return runCanonical(input, ctx);
  },
};

async function* runCanonical(input: Blob, ctx: ImportContext): AsyncGenerator<BioBatch> {
  const head = new TextDecoder().decode(new Uint8Array(await input.slice(0, 2048).arrayBuffer())).replace(BOM_RE, '').trimStart();
  if (/^kind\s*,/i.test(head)) {
    yield* csvBatches(input, ctx);
    return;
  }
  if (head.startsWith('[')) {
    yield* fromJsonValue(JSON.parse(await readText(input)) as unknown, ctx);
    ctx.onProgress(1);
    return;
  }
  // '{': JSONL if the first line is a complete object, otherwise one pretty-printed JSON document
  const firstLine = head.split('\n', 1)[0]!.trim();
  const isLines = ((): boolean => {
    try {
      return isObj(JSON.parse(firstLine));
    } catch {
      return false;
    }
  })();
  if (!isLines) {
    yield* fromJsonValue(JSON.parse(await readText(input)) as unknown, ctx);
    ctx.onProgress(1);
    return;
  }
  let pending: BioRecord[] = [];
  let bytes = 0;
  let n = 0;
  for await (const line of readLines(input, ctx.signal)) {
    n++;
    bytes += line.length + 1;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      throw new Error(`canonical JSONL: line ${n} is not valid JSON`);
    }
    if (isBatch(v)) {
      if (pending.length > 0) {
        yield makeBatch(pending, { producer: PRODUCER, tz: ctx.tz, exportedAt: ctx.now });
        pending = [];
      }
      yield v;
    } else if (isRecord(v)) {
      pending.push(v);
      if (pending.length >= BATCH_SIZE) {
        yield makeBatch(pending, { producer: PRODUCER, tz: ctx.tz, exportedAt: ctx.now });
        pending = [];
      }
    } else throw new Error(`canonical JSONL: line ${n} is neither a BioBatch nor a BioRecord`);
    if (n % 256 === 0 && input.size > 0) ctx.onProgress(Math.min(0.99, bytes / input.size));
  }
  if (pending.length > 0) yield makeBatch(pending, { producer: PRODUCER, tz: ctx.tz, exportedAt: ctx.now });
  ctx.onProgress(1);
}

function* fromJsonValue(v: unknown, ctx: ImportContext): Generator<BioBatch> {
  const items = Array.isArray(v) ? v : [v];
  let pending: BioRecord[] = [];
  const flush = (): BioBatch[] => {
    if (pending.length === 0) return [];
    const b = makeBatch(pending, { producer: PRODUCER, tz: ctx.tz, exportedAt: ctx.now });
    pending = [];
    return [b];
  };
  for (const it of items) {
    if (isBatch(it)) {
      yield* flush();
      yield it;
    } else if (isRecord(it)) pending.push(it);
    else throw new Error('canonical JSON: expected a BioBatch or BioRecord');
  }
  yield* flush();
}

// ---------------------------------------------------------------- CSV

/** Splits one CSV line (RFC 4180 quotes; no multi-line fields). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const DAILY_FIELDS = new Set([
  'steps', 'distance_m', 'active_kcal', 'total_kcal', 'resting_hr_bpm', 'hr_avg_bpm', 'hr_min_bpm', 'hr_max_bpm', 'spo2_avg_pct', 'spo2_min_pct',
  'resp_rate_brpm', 'skin_temp_delta_c', 'skin_temp_c', 'body_temp_c',
]);
const DAILY_STREAM: Record<string, string> = {
  distance_m: 'distance', active_kcal: 'active_kcal', total_kcal: 'active_kcal', spo2_avg_pct: 'spo2', spo2_min_pct: 'spo2',
  skin_temp_delta_c: 'skin_temp', skin_temp_c: 'skin_temp', body_temp_c: 'body_temp',
};
const SPOT_METRICS = new Set(['weight_kg', 'body_fat_pct', 'lean_mass_kg', 'waist_cm', 'bp_sys_mmhg', 'bp_dia_mmhg', 'glucose_mg_dl', 'body_temp_c', 'hr_bpm', 'spo2_pct', 'hrv_ms']);
const SERIES_CONTEXTS = new Set(['sleep', 'rest', 'exercise', 'unknown']);

function provFor(source: string, kind: 'automatic' | 'manual', ctx: ImportContext): BioProvenance {
  return {
    channel: 'file:canonical', source_app: source, recording_method: kind, modality: kind === 'manual' ? 'self_reported' : 'sensed', ingested_at: ctx.now,
  };
}

async function* csvBatches(input: Blob, ctx: ImportContext): AsyncGenerator<BioBatch> {
  let header: string[] | null = null;
  const daily = new Map<string, DailyRecord>();
  const series = new Map<string, { rec: SeriesRecord; t0: number; pts: Array<{ t: number; v: number; q: number }> }>();
  const direct: BioRecord[] = [];
  let lineNo = 0;
  let bytes = 0;

  for await (const line of readLines(input, ctx.signal)) {
    lineNo++;
    bytes += line.length + 1;
    if (!header) {
      header = splitCsvLine(line).map((h) => h.trim().toLowerCase());
      continue;
    }
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    const fail = (m: string): never => {
      throw new Error(`canonical CSV line ${lineNo}: ${m}`);
    };
    const kind = (row.kind ?? '').toLowerCase();
    const source = row.source || 'csv';
    const version = row.version ? Number(row.version) : 1;
    if (!Number.isInteger(version)) fail('version must be an integer');
    const startMs = row.start ? Date.parse(row.start) : NaN;
    if (row.start && Number.isNaN(startMs)) fail(`start '${row.start}' is not ISO-8601`);
    const tzOff = row.tz_offset_s ? Number(row.tz_offset_s) : !Number.isNaN(startMs) ? tzOffsetSeconds(startMs, ctx.tz) : tzOffsetSeconds(Date.parse(ctx.now), ctx.tz);
    if (!Number.isFinite(tzOff)) fail('tz_offset_s must be a number');
    const localDate = row.local_date || (!Number.isNaN(startMs) ? localDateOf(startMs + (tzOff - tzOffsetSeconds(startMs, ctx.tz)) * 1000, ctx.tz) : '');
    const value = row.value === '' ? NaN : Number(row.value);
    const metric = row.metric ?? '';

    if (kind === 'daily') {
      if (!localDate) fail('daily row needs local_date');
      let v = value;
      if (!Number.isFinite(v)) fail('value must be a number');
      const key = `${source}\u0000${localDate}`;
      let rec = daily.get(key);
      if (!rec) {
        rec = {
          kind: 'daily', record_id: recordId({ source, kind: 'daily', metric: '', start: localDate, ...(row.native_id ? { nativeId: row.native_id } : {}) }), version,
          time: { tz_offset_s: tzOff, local_date: localDate }, provenance: provFor(source, 'automatic', ctx), quality: { validation: 'measured', confidence: null, flags: [] },
        };
        daily.set(key, rec);
      }
      if (metric === 'hrv_rmssd_ms' || metric === 'hrv_sdnn_ms') {
        rec.hrv = { metric: metric === 'hrv_rmssd_ms' ? 'rmssd' : 'sdnn', value_ms: v, window: 'night' };
      } else if (DAILY_FIELDS.has(metric)) {
        const stream = DAILY_STREAM[metric];
        if (row.unit && stream) {
          const c = normaliseValue(stream, row.unit, v);
          if (c === null) fail(`unit '${row.unit}' invalid for ${metric}`);
          v = c as number;
        }
        (rec as unknown as Record<string, number>)[metric] = v;
      } else fail(`unknown daily metric '${metric}'`);
    } else if (kind === 'spot') {
      if (!SPOT_METRICS.has(metric)) fail(`unknown spot metric '${metric}'`);
      if (Number.isNaN(startMs)) fail('spot row needs start');
      if (!Number.isFinite(value)) fail('value must be a number');
      const at = isoUtc(startMs);
      const spot: SpotRecord = {
        kind: 'spot', record_id: recordId({ source, kind: 'spot', metric, start: at, ...(row.native_id ? { nativeId: row.native_id } : {}) }), version,
        time: { at, tz_offset_s: tzOff, local_date: localDate }, provenance: provFor(source, 'manual', ctx),
        quality: { validation: 'self_reported', confidence: null, flags: [] }, metric: metric as SpotRecord['metric'], value,
        ...(['fasting', 'morning', 'post_workout'].includes(row.context ?? '') ? { context: row.context as NonNullable<SpotRecord['context']> } : {}),
      };
      direct.push(spot);
    } else if (kind === 'series') {
      if (!metric) fail('series row needs metric');
      if (Number.isNaN(startMs)) fail('series row needs start');
      if (!Number.isFinite(value)) fail('value must be a number');
      const key = `${source}\u0000${metric}\u0000${localDate}\u0000${tzOff}\u0000${row.unit ?? ''}`;
      let g = series.get(key);
      if (!g) {
        g = {
          t0: startMs, pts: [],
          rec: {
            kind: 'series', record_id: '', version, time: { tz_offset_s: tzOff, local_date: localDate }, provenance: provFor(source, 'automatic', ctx),
            quality: { validation: 'measured', confidence: null, flags: [] }, metric: metric as BioStream, unit: row.unit || 'unit', aggregation: 'sample',
            sampling: { mode: 'continuous' }, values: [],
            ...(SERIES_CONTEXTS.has(row.context ?? '') ? { context: row.context as SeriesContext } : {}),
          },
        };
        series.set(key, g);
      }
      g.pts.push({ t: startMs, v: value, q: 0 });
    } else if (kind === 'sleep') {
      if (Number.isNaN(startMs)) fail('sleep row needs start');
      if (!Number.isFinite(value)) fail('value (asleep seconds) must be a number');
      const endMs = row.end ? Date.parse(row.end) : NaN;
      const start = isoUtc(startMs);
      const sleep: SleepRecord = {
        kind: 'sleep', record_id: recordId({ source, kind: 'sleep', start, ...(row.native_id ? { nativeId: row.native_id } : {}) }), version,
        time: { start, ...(Number.isNaN(endMs) ? {} : { end: isoUtc(endMs) }), tz_offset_s: tzOff, local_date: row.local_date || (Number.isNaN(endMs) ? localDate : localDateOf(endMs, ctx.tz)) },
        provenance: provFor(source, 'automatic', ctx), quality: { validation: 'measured', confidence: null, flags: [] },
        is_main: (row.context ?? '').toLowerCase() !== 'nap', asleep_s: value,
      };
      direct.push(sleep);
    } else fail(`unknown kind '${row.kind ?? ''}'`);
    if (lineNo % 512 === 0 && input.size > 0) ctx.onProgress(Math.min(0.99, bytes / input.size));
  }

  const records: BioRecord[] = [...direct, ...daily.values()];
  for (const g of series.values()) {
    g.pts.sort((a, b) => a.t - b.t);
    const t0 = g.pts[0]!.t;
    const start = isoUtc(t0);
    g.rec.time.start = start;
    g.rec.record_id = recordId({ source: g.rec.provenance.source_app ?? 'csv', kind: 'series', metric: g.rec.metric, start });
    g.rec.t_offset_s = g.pts.map((p) => (p.t - t0) / 1000);
    g.rec.values = g.pts.map((p) => p.v);
    records.push(g.rec);
  }
  for await (const recs of batchRecords(records, BATCH_SIZE)) yield makeBatch(recs, { producer: PRODUCER, tz: ctx.tz, exportedAt: ctx.now });
  ctx.onProgress(1);
}
