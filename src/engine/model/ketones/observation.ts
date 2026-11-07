/**
 * Blood D-BHB observation model (D2-08, contracts C4/C6): how a ketone reading is compared with the ketone model, and the
 * only personal correction the comparison may support.
 *
 * - A timed capillary/venous blood D-BHB reading is a POINT concentration: it is compared with the model's instantaneous
 *   prediction at the sampling time (operator `bhbEndpoint`), never with the hourly-mean series `bhb`, and never with a
 *   daily mean. Hour-end endpoints are interpolated linearly within the hour; when only hour means exist, the point is
 *   reconstructed between hour midpoints and the result says so (`approximation`).
 * - An untimed (legacy) reading or one with only an interval never pretends to be an exact endpoint: it is compared with
 *   the model RANGE over the interval or day (`untimed`) — the extrema of the same point reconstruction inside that span
 *   (A1-060); a reversed, non-finite, out-of-path or not fully covered span abstains (`outsidePath`).
 * - Urine and breath ketones, acetoacetate/acetone and racemic (D+L) readings have no operator onto blood D-BHB: they stay
 *   observations with status `noOperator` / `unsupportedAnalyte`; nothing converts them.
 * - Readings are pooled only within one key (specimen · analyte · meter): meters, specimens and analytes (D- vs racemic
 *   BHB, acetoacetate) are not interchangeable observations. The diet/supplement context (fasting, ketogenic diet, ester,
 *   salt, MCT) is carried as a group inside the key: the model already accounts for it, so consistent residuals pool and
 *   conflicting ones are reported.
 * - Personal calibration fits at most ONE concentration scale (a log offset) per pooling key from repeated, timed,
 *   comparable readings, each stable observation id counted once (A1-061: replays never add evidence; an id with
 *   conflicting records abstains as `identityConflict`). A concentration cannot separate production, clearance, volume or adaptation (at steady state
 *   P = U(C) + Ren(C)), so no kinetic parameter is ever returned. Context groups that disagree beyond their combined
 *   standard error are reported as a structural discrepancy instead of being forced into one correction (no sex/age
 *   multiplier). The scale has unvalidated predictive coverage.
 *
 * Pure, allocation-light, no clock reads, no new physiological coefficients. Model readings never clear diabetes-
 * medication, symptom or ketone-alert rules (those read total measured/simulated BHB in the safety layer).
 */
import { statusValue, type StatusValue } from '@/lib/bodyContracts';
import { ketoneOperatorFor, type KetoneSpecimen, type OperatorId } from '@/lib/measurementOperators';

/** What the reading measured. Only `dBhb` maps onto the model's blood D-BHB. */
export type KetoneAnalyte = 'dBhb' | 'racemicBhb' | 'acetoacetate' | 'acetone' | 'unknown';

/** Supplement/diet context of a reading (pooling key and context group; never a correction factor by itself). */
export type KetoneReadingContext = 'none' | 'ketogenicDiet' | 'fasting' | 'ester' | 'salt' | 'mct' | 'mixed' | 'unknown';

/** When the sample was taken on the run's hour axis (hours since t = 0; an instant may be fractional). */
export type KetoneSampleTime =
  | { readonly kind: 'instant'; readonly hour: number }
  | { readonly kind: 'interval'; readonly fromHour: number; readonly toHour: number }
  | { readonly kind: 'unknown'; readonly day?: number };

export interface KetoneObservation {
  readonly id: string;
  readonly value: number;
  readonly unit: 'mmol/L' | 'mg/dL' | 'unknown';
  readonly specimen?: KetoneSpecimen;
  readonly analyte?: KetoneAnalyte;
  readonly time: KetoneSampleTime;
  readonly meter?: string;
  readonly context?: KetoneReadingContext;
}

/** The model path a reading is compared against: hour means `bhb` and, when recorded, hour-end endpoints. */
export interface KetoneModelPath {
  /** Hour-mean blood D-BHB of hour h (series `bhb`), mmol/L. */
  readonly hourlyMean: ArrayLike<number>;
  /** Blood D-BHB at the END of hour h (time h + 1), mmol/L (series `bhbEndpoint`). */
  readonly endpoint?: ArrayLike<number>;
  /** Blood D-BHB at t = 0 (start of hour 0), mmol/L. */
  readonly initial?: number;
}

export type KetonePredictionStatus = 'comparable' | 'untimed' | 'noOperator' | 'unsupportedAnalyte' | 'unsupportedUnit' | 'outsidePath';

export interface KetonePrediction {
  readonly status: KetonePredictionStatus;
  readonly operator: OperatorId | null;
  /** Predicted point concentration (status `comparable` only). */
  readonly predicted?: number;
  /** Model range over the interval/day (status `untimed`), mmol/L: extrema of the point reconstruction inside the span. */
  readonly range?: readonly [number, number];
  /** How the point (status `comparable`) or the range's points (status `untimed`) were reconstructed from the path. */
  readonly approximation?: 'hourEndLinear' | 'hourMeanMidpoint';
  /** The reading as a typed boundary value (observed with its unit, or the status word). */
  readonly reading: StatusValue;
}

/** Molar mass of β-hydroxybutyrate, g/mol (definition, for an mg/dL meter readout). */
export const BHB_G_PER_MOL = 104.1;

/** Reading in mmol/L, or NaN when the unit is unknown (never assumed). */
export function readingMmolL(o: Pick<KetoneObservation, 'value' | 'unit'>): number {
  if (!Number.isFinite(o.value) || o.value < 0) return Number.NaN;
  if (o.unit === 'mmol/L') return o.value;
  if (o.unit === 'mg/dL') return (10 * o.value) / BHB_G_PER_MOL; // mg/dL → mg/L → mmol/L
  return Number.NaN;
}

/** Pooling key: readings with different keys are never pooled into one likelihood or correction. */
export function ketonePoolKey(o: Pick<KetoneObservation, 'specimen' | 'analyte' | 'meter'>): string {
  return `${o.specimen ?? 'unknownSpecimen'}|${o.analyte ?? 'unknown'}|${o.meter ?? 'unknownMeter'}`;
}

const at = (x: ArrayLike<number>, i: number): number => (i >= 0 && i < x.length ? x[i]! : Number.NaN);

/** Point value at time τ (h since t = 0) from hour-end endpoints (linear within the hour; τ = h + 1 is endpoint[h]). */
function pointFromEndpoints(path: KetoneModelPath, tau: number): number {
  const ep = path.endpoint!;
  const h = Math.floor(tau);
  const f = tau - h;
  const start = h === 0 ? (path.initial ?? Number.NaN) : at(ep, h - 1);
  const end = at(ep, h);
  if (f === 0) return start;
  return start + (end - start) * f;
}

/** Point value at time τ reconstructed from hour means (linear between hour midpoints h + 0.5; flagged approximation). */
function pointFromMeans(path: KetoneModelPath, tau: number): number {
  const m = path.hourlyMean;
  const x = tau - 0.5;
  const h = Math.floor(x);
  if (h < 0) return at(m, 0);
  if (h >= m.length - 1) return at(m, m.length - 1);
  const f = x - h;
  return at(m, h) + (at(m, h + 1) - at(m, h)) * f;
}

/**
 * Which point reconstruction a reading over [fromHour, …] uses (D2-08): hour-end endpoints when they cover the path and,
 * for a span touching hour 0, the t = 0 value is known; otherwise the hour-mean midpoint fallback (an approximation).
 * The same convention is used over a whole interval, never mixed within one.
 */
function usesEndpoints(path: KetoneModelPath, fromHour: number): boolean {
  const n = path.hourlyMean.length;
  return path.endpoint !== undefined && path.endpoint.length >= n && (fromHour >= 1 || path.initial !== undefined);
}

/**
 * Model range over the occurrence interval [fromHour, toHour] (h since t = 0), or null when the interval is invalid
 * (non-finite, reversed, outside [0, horizon]) or the path has a non-finite value inside it (no silent partial coverage).
 * The range is the min/max of the SAME piecewise-linear point reconstruction an instant reading uses: its values at both
 * interval boundaries plus every knot strictly inside (integer endpoint times for `hourEndLinear`, hour midpoints h + 0.5
 * for `hourMeanMidpoint`); no value at a time outside the interval enters. A zero-length interval is its single point.
 */
function rangeOver(path: KetoneModelPath, fromHour: number, toHour: number): { range: readonly [number, number]; approximation: 'hourEndLinear' | 'hourMeanMidpoint' } | null {
  const n = path.hourlyMean.length;
  if (!(n > 0) || !Number.isFinite(fromHour) || !Number.isFinite(toHour)) return null;
  if (!(fromHour >= 0 && fromHour <= toHour && toHour <= n)) return null;
  const useEnd = usesEndpoints(path, fromHour);
  const point = useEnd ? pointFromEndpoints : pointFromMeans;
  let lo = Infinity;
  let hi = -Infinity;
  const take = (v: number): boolean => {
    if (!Number.isFinite(v)) return false;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    return true;
  };
  if (!take(point(path, fromHour)) || !take(point(path, toHour))) return null;
  if (useEnd) {
    // integer times t strictly inside: the reconstruction's value there is endpoint[t − 1]
    for (let t = Math.floor(fromHour) + 1; t < toHour; t++) if (!take(at(path.endpoint!, t - 1))) return null;
  } else {
    // hour midpoints h + 0.5 strictly inside: the reconstruction's value there is the hour mean
    for (let h = Math.max(0, Math.ceil(fromHour - 0.5)); h + 0.5 < toHour && h < n; h++) {
      if (h + 0.5 > fromHour && !take(at(path.hourlyMean, h))) return null;
    }
  }
  return lo <= hi ? { range: [lo, hi], approximation: useEnd ? 'hourEndLinear' : 'hourMeanMidpoint' } : null;
}

/**
 * Predict what a reading should be under the model path (operator `bhbEndpoint` for blood D-BHB). Statuses travel with
 * the numbers: only `comparable` carries a point prediction; an untimed reading gets the model range over its occurrence
 * interval or day (`untimed`, with the reconstruction it used); an invalid, reversed, non-finite or not fully covered span
 * is `outsidePath` (never clipped to a full-looking range); other specimens and analytes carry no operator. No production
 * consumer reads these yet (dormant W1 foundation).
 */
export function predictKetoneReading(o: KetoneObservation, path: KetoneModelPath): KetonePrediction {
  const mmol = readingMmolL(o);
  const reading = statusValue({ status: Number.isFinite(mmol) ? 'observed' : 'unknown', ...(Number.isFinite(mmol) ? { value: mmol } : {}), unit: 'mmol/L', reasonCode: Number.isFinite(mmol) ? 'ok' : 'unitUnknown' });
  const operator = ketoneOperatorFor(o.specimen);
  if (operator === null) return { status: 'noOperator', operator: null, reading };
  if ((o.analyte ?? 'dBhb') !== 'dBhb') return { status: 'unsupportedAnalyte', operator: null, reading };
  if (!Number.isFinite(mmol)) return { status: 'unsupportedUnit', operator, reading };
  const t = o.time;
  if (t.kind === 'instant') {
    const n = path.hourlyMean.length;
    if (!(t.hour >= 0 && t.hour <= n)) return { status: 'outsidePath', operator, reading };
    const useEnd = usesEndpoints(path, t.hour);
    const predicted = useEnd ? pointFromEndpoints(path, t.hour) : pointFromMeans(path, t.hour);
    if (!Number.isFinite(predicted)) return { status: 'outsidePath', operator, reading };
    return { status: 'comparable', operator, predicted, approximation: useEnd ? 'hourEndLinear' : 'hourMeanMidpoint', reading };
  }
  const span =
    t.kind === 'interval' ? ([t.fromHour, t.toHour] as const) : t.day !== undefined && Number.isInteger(t.day) ? ([24 * t.day, 24 * (t.day + 1)] as const) : null;
  if (span === null) return { status: 'outsidePath', operator, reading };
  const r = rangeOver(path, span[0], span[1]);
  return r ? { status: 'untimed', operator, range: r.range, approximation: r.approximation, reading } : { status: 'outsidePath', operator, reading };
}

// =====================================================================================================================
// personal concentration correction (one scale per pooling key)
// =====================================================================================================================

export interface KetoneCalibrationPair {
  readonly observation: KetoneObservation;
  readonly prediction: KetonePrediction;
}

/**
 * `identityConflict`: one stable observation id arrived with different payloads or predictions; the fit abstains (no scale)
 * until an effective version is resolved upstream, rather than counting both or choosing by input order.
 */
export type KetoneCorrectionStatus = 'estimated' | 'insufficient' | 'discrepant' | 'identityConflict';

export interface KetoneCorrection {
  readonly key: string;
  readonly status: KetoneCorrectionStatus;
  /**
   * The single correction: ln(observed/predicted) mean (status `estimated`); corrected = predicted·exp(logScale).
   * Never a production, clearance, volume or adaptation parameter.
   */
  readonly logScale?: number;
  /** Standard error of `logScale` (residual SD/√n). */
  readonly se?: number;
  /** Unique comparable observations (by stable id) in the key; duplicates of one id count once. */
  readonly n: number;
  /** Observation ids whose duplicate records disagree (status `identityConflict`), sorted. */
  readonly conflictIds?: readonly string[];
  /** Per context-group offsets when they conflict (status `discrepant`). */
  readonly groups?: ReadonlyArray<{ readonly context: KetoneReadingContext; readonly logScale: number; readonly se: number; readonly n: number }>;
  /** Predictive coverage of the corrected path is not validated. */
  readonly coverage: 'unvalidated';
}

function meanSe(xs: readonly number[]): { mean: number; se: number } {
  const n = xs.length;
  let m = 0;
  for (const x of xs) m += x;
  m /= n;
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  const sd = n > 1 ? Math.sqrt(v / (n - 1)) : Number.NaN;
  return { mean: m, se: sd / Math.sqrt(n) };
}

/** Canonical text of a pair (observation payload + prediction) for identity checks; key order fixed, numbers exact. */
function pairFingerprint(p: KetoneCalibrationPair): string {
  const o = p.observation;
  const t = o.time;
  const time = t.kind === 'instant' ? ['i', t.hour] : t.kind === 'interval' ? ['v', t.fromHour, t.toHour] : ['u', t.day ?? null];
  const q = p.prediction;
  const num = (x: number | undefined): string | null => (x === undefined ? null : Object.is(x, -0) ? '0' : String(x));
  return JSON.stringify([
    o.id,
    num(o.value),
    o.unit,
    o.specimen ?? null,
    o.analyte ?? null,
    time.map((x) => (typeof x === 'number' ? num(x) : x)),
    o.meter ?? null,
    o.context ?? null,
    q.status,
    q.operator,
    num(q.predicted),
    q.range ? [num(q.range[0]), num(q.range[1])] : null,
    q.approximation ?? null,
  ]);
}

/**
 * Canonicalize pairs by stable observation id (C1/C4 observation-once): identical duplicates of one id are one record;
 * an id whose records disagree is a conflict. Returns the effective records sorted by id and the conflicted ids with the
 * pooling keys their versions map to. Order-independent; the input is never modified.
 */
function canonicalPairs(pairs: readonly KetoneCalibrationPair[]): { unique: KetoneCalibrationPair[]; conflicts: Map<string, Set<string>> } {
  const byId = new Map<string, { pair: KetoneCalibrationPair; fp: string; keys: Set<string>; conflict: boolean }>();
  for (const p of pairs) {
    const id = p.observation.id;
    const fp = pairFingerprint(p);
    const key = ketonePoolKey(p.observation);
    const seen = byId.get(id);
    if (!seen) byId.set(id, { pair: p, fp, keys: new Set([key]), conflict: false });
    else {
      seen.keys.add(key);
      if (seen.fp !== fp) seen.conflict = true;
    }
  }
  const unique: KetoneCalibrationPair[] = [];
  const conflicts = new Map<string, Set<string>>();
  for (const id of [...byId.keys()].sort()) {
    const e = byId.get(id)!;
    if (e.conflict) conflicts.set(id, e.keys);
    else unique.push(e.pair);
  }
  return { unique, conflicts };
}

/**
 * Fit the personal concentration scale per pooling key from comparable, timed blood D-BHB pairs. Pairs are first
 * canonicalized by stable observation id: a replayed/duplicated record counts once, and an id whose records disagree makes
 * its key `identityConflict` (no scale) instead of being counted twice or resolved by input order. A single reading (or one
 * per group) cannot separate an offset from noise → `insufficient`. Context groups with ≥ 2 readings whose offsets differ
 * by more than twice their combined standard error → `discrepant` (shown, not resolved). Non-positive values are excluded
 * (a log scale needs a positive reading and prediction). Output and arithmetic are ordered by key/id, so the result does
 * not depend on input order. The single scale keeps its unvalidated coverage; no noise floor is added.
 */
export function fitKetoneCorrection(pairs: readonly KetoneCalibrationPair[]): KetoneCorrection[] {
  const { unique, conflicts } = canonicalPairs(pairs);
  const byKey = new Map<string, Array<{ r: number; context: KetoneReadingContext }>>();
  // identity handling first, then comparability: n, group n, mean and SE count unique effective observations only
  for (const p of unique) {
    if (p.prediction.status !== 'comparable') continue;
    const obs = readingMmolL(p.observation);
    const pred = p.prediction.predicted!;
    if (!(obs > 0) || !(pred > 0)) continue;
    const key = ketonePoolKey(p.observation);
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push({ r: Math.log(obs / pred), context: p.observation.context ?? 'unknown' });
  }
  const conflictByKey = new Map<string, string[]>();
  for (const [id, keys] of conflicts) {
    for (const key of keys) {
      let ids = conflictByKey.get(key);
      if (!ids) conflictByKey.set(key, (ids = []));
      ids.push(id);
    }
  }
  const out: KetoneCorrection[] = [];
  for (const key of [...new Set([...byKey.keys(), ...conflictByKey.keys()])].sort()) {
    const list = byKey.get(key) ?? [];
    const n = list.length;
    const conflictIds = conflictByKey.get(key);
    if (conflictIds) {
      out.push({ key, status: 'identityConflict', n, conflictIds: [...conflictIds].sort(), coverage: 'unvalidated' });
      continue;
    }
    if (n < 2) {
      out.push({ key, status: 'insufficient', n, coverage: 'unvalidated' });
      continue;
    }
    const groups = new Map<KetoneReadingContext, number[]>();
    for (const x of list) {
      let g = groups.get(x.context);
      if (!g) groups.set(x.context, (g = []));
      g.push(x.r);
    }
    const fitted = [...groups]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .filter(([, rs]) => rs.length >= 2)
      .map(([context, rs]) => ({ context, ...meanSe(rs), n: rs.length }));
    let conflict = false;
    for (let i = 0; i < fitted.length && !conflict; i++) {
      for (let j = i + 1; j < fitted.length; j++) {
        const a = fitted[i]!;
        const b = fitted[j]!;
        const se = Math.sqrt(a.se * a.se + b.se * b.se);
        if (Number.isFinite(se) && Math.abs(a.mean - b.mean) > 2 * se) {
          conflict = true;
          break;
        }
      }
    }
    if (conflict) {
      out.push({ key, status: 'discrepant', n, groups: fitted.map((g) => ({ context: g.context, logScale: g.mean, se: g.se, n: g.n })), coverage: 'unvalidated' });
      continue;
    }
    const all = meanSe(list.map((x) => x.r));
    out.push(Number.isFinite(all.se) ? { key, status: 'estimated', logScale: all.mean, se: all.se, n, coverage: 'unvalidated' } : { key, status: 'insufficient', n, coverage: 'unvalidated' });
  }
  return out;
}
