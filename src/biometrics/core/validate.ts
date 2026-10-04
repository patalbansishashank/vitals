/**
 * Runtime validation and unit normalisation of canonical biometrics (tier P, pure).
 * Plausibility bounds are physiological sanity limits, not clinical thresholds: PROPOSED engineering values meant to
 * catch unit mistakes and sensor garbage. Out-of-range values are dropped with a warning and the record is flagged
 * 'out_of_range'; they are never clamped.
 */
import { BIO_SCHEMA } from './types';
import type { BioBatch, BioRecord, BioStream, QualityFlag, SeriesRecord } from './types';

// ---------------------------------------------------------------- unit normalisation

export const fractionToPct = (x: number): number => x * 100;
export const fahrenheitToC = (f: number): number => ((f - 32) * 5) / 9;
export const kjToKcal = (kj: number): number => kj / 4.184;
export const kmToM = (km: number): number => km * 1000;
export const milesToM = (mi: number): number => mi * 1609.344;
export const lbToKg = (lb: number): number => lb * 0.45359237;

/** Canonical unit per raw stream. */
export const CANONICAL_UNIT: Partial<Record<string, string>> = {
  hr: 'bpm', ibi: 'ms', hrv: 'ms', spo2: 'pct', skin_temp: 'degC', body_temp: 'degC', resp_rate: 'brpm', steps: 'count', distance: 'm', active_kcal: 'kcal',
};

/** Converts a value reported in `unit` for `metric` to the canonical unit; null when the unit is unknown for that metric. */
export function normaliseValue(metric: string, unit: string, v: number): number | null {
  const u = unit.trim().toLowerCase().replace('°', 'deg');
  switch (metric) {
    case 'spo2':
      if (['%', 'pct', 'percent'].includes(u)) return v;
      if (['fraction', 'ratio', '1', 'frac'].includes(u)) return fractionToPct(v);
      return null;
    case 'skin_temp':
    case 'body_temp':
      if (['degc', 'c', 'celsius'].includes(u)) return v;
      if (['degf', 'f', 'fahrenheit'].includes(u)) return fahrenheitToC(v);
      return null;
    case 'active_kcal':
      if (['kcal', 'kilocalorie', 'kilocalories', 'count'].includes(u)) return v;
      if (['kj', 'kilojoule', 'kilojoules'].includes(u)) return kjToKcal(v);
      return null;
    case 'distance':
      if (['m', 'meter', 'meters', 'metre'].includes(u)) return v;
      if (['km', 'kilometer', 'kilometers'].includes(u)) return kmToM(v);
      if (['mi', 'mile', 'miles'].includes(u)) return milesToM(v);
      return null;
    case 'ibi':
    case 'hrv':
      if (['ms', 'millisecond', 'milliseconds'].includes(u)) return v;
      if (['s', 'sec', 'second', 'seconds'].includes(u)) return v * 1000;
      return null;
    case 'hr':
      return ['bpm', 'count/min', '/min'].includes(u) ? v : null;
    case 'resp_rate':
      return ['brpm', 'bpm', 'count/min', '/min', 'breaths/min'].includes(u) ? v : null;
    default:
      return v;
  }
}

// ---------------------------------------------------------------- plausibility bounds (PROPOSED)

export const SERIES_RANGE: Partial<Record<string, [number, number]>> = {
  hr: [20, 250], ibi: [200, 3000], hrv: [1, 500], spo2: [50, 100], skin_temp: [20, 45], body_temp: [30, 45], resp_rate: [4, 60],
  steps: [0, 100_000], distance: [0, 1_000_000], active_kcal: [0, 20_000],
};

const DAILY_RANGE: Record<string, [number, number]> = {
  steps: [0, 200_000], distance_m: [0, 1_000_000], active_kcal: [0, 20_000], total_kcal: [0, 30_000],
  resting_hr_bpm: [20, 250], hr_avg_bpm: [20, 250], hr_min_bpm: [20, 250], hr_max_bpm: [20, 250],
  spo2_avg_pct: [50, 100], spo2_min_pct: [50, 100], resp_rate_brpm: [4, 60], skin_temp_delta_c: [-10, 10], skin_temp_c: [20, 45], body_temp_c: [30, 45],
};

const SPOT_RANGE: Record<string, [number, number]> = {
  weight_kg: [20, 500], body_fat_pct: [1, 80], lean_mass_kg: [5, 200], waist_cm: [30, 250], bp_sys_mmhg: [50, 280], bp_dia_mmhg: [30, 180],
  glucose_mg_dl: [20, 800], body_temp_c: [30, 45], hr_bpm: [20, 250], spo2_pct: [50, 100], hrv_ms: [1, 500],
};

const inRange = (v: unknown, r: [number, number] | undefined): boolean => typeof v === 'number' && Number.isFinite(v) && (!r || (v >= r[0] && v <= r[1]));

// ---------------------------------------------------------------- validation

export interface RecordCheck {
  /** Cleaned record (out-of-range fields removed, flagged), or null when structurally invalid. */
  record: BioRecord | null;
  warnings: string[];
  error?: string;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(['daily', 'sleep', 'workout', 'series', 'spot', 'device_profile']);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function flag(rec: BioRecord): void {
  if (!rec.quality.flags.includes('out_of_range' satisfies QualityFlag)) rec.quality.flags.push('out_of_range');
}

/** Validates one record (structure, then ranges). Never mutates the input; returns a cleaned deep copy. */
export function validateRecord(input: unknown): RecordCheck {
  if (!isObj(input)) return { record: null, warnings: [], error: 'record is not an object' };
  const bad = (error: string): RecordCheck => ({ record: null, warnings: [], error });
  const kind = input.kind;
  if (typeof kind !== 'string' || !KINDS.has(kind)) return bad(`unknown kind ${String(kind)}`);
  if (typeof input.record_id !== 'string' || input.record_id === '') return bad('record_id missing');
  if (!Number.isInteger(input.version) || (input.version as number) < 0) return bad('version must be a non-negative integer');
  const time = input.time;
  if (!isObj(time)) return bad('time missing');
  if (typeof time.local_date !== 'string' || !LOCAL_DATE.test(time.local_date) || Number.isNaN(Date.parse(`${time.local_date}T00:00:00Z`))) return bad('time.local_date invalid');
  if (!Number.isInteger(time.tz_offset_s) || Math.abs(time.tz_offset_s as number) > 18 * 3600) return bad('time.tz_offset_s invalid');
  for (const k of ['start', 'end', 'at'] as const) {
    if (time[k] !== undefined && (typeof time[k] !== 'string' || Number.isNaN(Date.parse(time[k])))) return bad(`time.${k} invalid`);
  }
  const prov = input.provenance;
  if (!isObj(prov) || typeof prov.channel !== 'string' || typeof prov.ingested_at !== 'string') return bad('provenance invalid');
  const q = input.quality;
  if (!isObj(q) || !Array.isArray(q.flags)) return bad('quality invalid');

  const rec = structuredClone(input) as unknown as BioRecord;
  const warnings: string[] = [];
  const drop = (field: string, v: unknown): void => {
    warnings.push(`${rec.record_id}: ${field}=${String(v)} out of range, dropped`);
    flag(rec);
  };

  switch (rec.kind) {
    case 'daily': {
      const r = rec as unknown as Record<string, unknown>;
      for (const [f, range] of Object.entries(DAILY_RANGE)) {
        if (r[f] === undefined) continue;
        if (!inRange(r[f], range)) {
          drop(f, r[f]);
          delete r[f];
        }
      }
      if (rec.hrv && !inRange(rec.hrv.value_ms, [1, 500])) {
        drop('hrv', rec.hrv.value_ms);
        delete rec.hrv;
      }
      if (rec.vo2max && !inRange(rec.vo2max.ml_kg_min, [5, 100])) {
        drop('vo2max', rec.vo2max.ml_kg_min);
        delete rec.vo2max;
      }
      break;
    }
    case 'sleep': {
      if (typeof rec.is_main !== 'boolean') return bad('sleep.is_main must be boolean');
      if (!isNum(rec.asleep_s) || rec.asleep_s < 0 || rec.asleep_s > 24 * 3600) return bad('sleep.asleep_s invalid');
      // A night that claims more sleep than the time it spans is inconsistent: the window (and its stages) win in
      // scoring, so say so in the import report rather than silently showing a much shorter night.
      if (rec.time.start && rec.time.end) {
        const spanS = (Date.parse(rec.time.end) - Date.parse(rec.time.start)) / 1000;
        if (spanS >= 0 && rec.asleep_s > spanS + 60) {
          warnings.push(`${rec.record_id}: asleep_s=${rec.asleep_s} is longer than the night's start–end (${Math.round(spanS)} s); the start–end and stages are used`);
        }
      }
      break;
    }
    case 'workout': {
      if (typeof rec.exercise_type !== 'string' || rec.exercise_type === '') return bad('workout.exercise_type missing');
      if (!isNum(rec.active_duration_s) || rec.active_duration_s < 0) return bad('workout.active_duration_s invalid');
      for (const f of ['hr_avg_bpm', 'hr_max_bpm'] as const) {
        const v = rec[f];
        if (v !== undefined && !inRange(v, [20, 250])) {
          drop(f, v);
          delete rec[f];
        }
      }
      break;
    }
    case 'spot': {
      if (typeof rec.metric !== 'string') return bad('spot.metric missing');
      if (!isNum(rec.value)) return bad('spot.value must be a finite number');
      if (!inRange(rec.value, SPOT_RANGE[rec.metric])) {
        drop(rec.metric, rec.value);
        return { record: null, warnings, error: `spot ${rec.metric} out of range` };
      }
      break;
    }
    case 'device_profile': {
      if (typeof rec.model !== 'string' || typeof rec.metric !== 'string') return bad('device_profile.model/metric missing');
      if (![rec.bias, rec.loa_lo, rec.loa_hi, rec.n_nights].every(isNum)) return bad('device_profile numbers invalid');
      break;
    }
    case 'series': {
      const res = validateSeries(rec, warnings);
      if (typeof res === 'string') return bad(res);
      if (res.dropped > 0) flag(rec);
      break;
    }
  }
  return { record: rec, warnings };
}

/** Series: structure, unit normalisation to canonical unit, plausibility filter. Mutates `rec` (already a copy). */
function validateSeries(rec: SeriesRecord, warnings: string[]): string | { dropped: number } {
  if (typeof rec.metric !== 'string' || !rec.metric) return 'series.metric missing';
  if (!Array.isArray(rec.values) || !rec.values.every((v) => typeof v === 'number')) return 'series.values must be a number array';
  if (typeof rec.time.start !== 'string') return 'series.time.start required';
  const n = rec.values.length;
  if (rec.t_offset_s !== undefined) {
    if (!Array.isArray(rec.t_offset_s) || rec.t_offset_s.length !== n || !rec.t_offset_s.every(isNum)) return 't_offset_s must match values length';
  } else if (n > 1 && !(isNum(rec.interval_s) && rec.interval_s > 0) && !(isNum(rec.sampling?.nominal_interval_s) && rec.sampling.nominal_interval_s > 0)) {
    return 'series without t_offset_s needs interval_s';
  }
  if (rec.quality_mask !== undefined && (!Array.isArray(rec.quality_mask) || rec.quality_mask.length !== n)) return 'quality_mask must match values length';
  if (typeof rec.unit !== 'string') return 'series.unit missing';
  const range = SERIES_RANGE[rec.metric];
  const step = isNum(rec.interval_s) && rec.interval_s > 0 ? rec.interval_s : (rec.sampling?.nominal_interval_s ?? 0);
  const keepV: number[] = [];
  const keepT: number[] = [];
  const keepQ: number[] = [];
  let dropped = 0;
  let unitBad = false;
  for (let i = 0; i < n; i++) {
    const raw = rec.values[i]!;
    const c = Number.isFinite(raw) ? normaliseValue(rec.metric, rec.unit, raw) : null;
    if (c === null && Number.isFinite(raw)) unitBad = true;
    if (c !== null && inRange(c, range)) {
      keepV.push(c);
      keepT.push(rec.t_offset_s ? rec.t_offset_s[i]! : i * step);
      if (rec.quality_mask) keepQ.push(rec.quality_mask[i]!);
    } else dropped++;
  }
  if (unitBad) return `unit '${rec.unit}' not valid for ${rec.metric}`;
  if (dropped > 0) warnings.push(`${rec.record_id}: ${dropped} of ${n} ${rec.metric} samples out of range, dropped`);
  const canon = CANONICAL_UNIT[rec.metric];
  if (canon) rec.unit = canon;
  rec.values = keepV;
  if (dropped > 0 || rec.t_offset_s) {
    rec.t_offset_s = keepT;
    delete rec.interval_s;
    if (rec.quality_mask) rec.quality_mask = keepQ;
    // wear intervals are offsets in seconds and stay valid after dropping samples
  }
  return { dropped };
}

export interface BatchCheck {
  batch: BioBatch | null;
  warnings: string[];
  /** Records rejected as structurally invalid (with reason). */
  rejected: string[];
}

/** Validates a whole batch; invalid records are rejected individually, valid ones are cleaned. */
export function validateBatch(input: unknown): BatchCheck {
  if (!isObj(input) || input.schema !== BIO_SCHEMA) return { batch: null, warnings: [], rejected: [`schema must be ${BIO_SCHEMA}`] };
  if (!Array.isArray(input.records)) return { batch: null, warnings: [], rejected: ['records must be an array'] };
  if (typeof input.tz !== 'string' || typeof input.exported_at !== 'string' || !isObj(input.producer)) {
    return { batch: null, warnings: [], rejected: ['batch header (producer, exported_at, tz) invalid'] };
  }
  const records: BioRecord[] = [];
  const warnings: string[] = [];
  const rejected: string[] = [];
  for (const [i, r] of input.records.entries()) {
    const c = validateRecord(r);
    warnings.push(...c.warnings);
    if (c.record) records.push(c.record);
    else rejected.push(`record ${i}: ${c.error ?? 'invalid'}`);
  }
  return { batch: { schema: BIO_SCHEMA, producer: input.producer as BioBatch['producer'], exported_at: input.exported_at, tz: input.tz, records }, warnings, rejected };
}

/** True for a stream name that is a known raw stream or a vendor stream. */
export function isBioStream(s: string): s is BioStream {
  return s.startsWith('vendor:') || Object.hasOwn(CANONICAL_UNIT, s) || ['motion', 'sleep_state', 'sleep_stage'].includes(s);
}
