/**
 * Personal hunger-rating calibration (D2-06, contracts C4/C6): anchors the uncalibrated Hunger Pressure Index (HPI) to the
 * person's own consistent 0–10 hunger ratings. This is the ONE shared, versioned provider: the engine API and the living
 * projection both call it (`calibrateHungerRatings`, `calibrateHungerPairs`), so eligibility, errors and status agree.
 *
 * - Eligible ratings: finite hunger in [0, 10], a valid occurrence day (integer ≥ 0 with a finite model HPI) and an explicit
 *   clock hour in [0, 24). Untimed ratings stay observations but never join a synthetic "no hour" group. Only ratings in
 *   ONE whole-hour clock bucket are used: the user's `fixedClockH`, or a documented deterministic training-only choice
 *   (forward chaining: the first whole hour to collect three eligible ratings, scanning whole days in order — ties: more
 *   ratings, then the lower hour; frozen block: the most common hour among the training days, ties → lower hour). Missing
 *   ratings are missing: never zero hunger. Fullness and craving stay separate constructs (counted, never merged), and
 *   observed item completion is not a rating at all.
 * - Model: h_pred = clip(a + b·HPI, 0, 10) with ridge regularisation λ = 1 on the training-standardised HPI slope (penalty
 *   λ·(b·sd_train)²; the context offset is not penalised) and the burden direction b ≥ 0 (a negative fit falls back to the
 *   person's mean, + offset), applied identically in every fit.
 * - Evaluation on strictly later WHOLE days, never same-day duplicates across train/test: forward chaining (default; each
 *   later day's ratings are predicted from all earlier days only) or a frozen later-day block (`heldOutFromDay`: fit on the
 *   earlier days, scored once on the later block). The held-out error on the 0–10 scale (n, MAE, RMSE) is compared with the
 *   personal-mean baseline under the same split (the mean of the earlier days' ratings). `calibrated` = an informative fit:
 *   held-out MAE strictly below the baseline's (a declared product criterion, not a universal statistical rule);
 *   otherwise `notInformative`; `insufficient` when the fit or the evaluation cannot be identified.
 * - An optional context offset (e.g. ketosis or a meal pattern) is chosen without touching the reported validation: in
 *   forward chaining each held-out day uses the offset only when it beat the plain fit on the EARLIER held-out days; in a
 *   frozen block the choice uses forward chaining inside the training days only. No universal ketosis magnitude is
 *   assumed and no endocrine mechanism (no hormone level) is identified.
 * - The personal-mean baseline stays available as its own labelled estimate (`hungerBaselineForecast`) whatever the HPI
 *   status: an uninformative index never makes the person's own ratings unavailable.
 * - The calibration records its version, evaluation design, training cutoff day and the clock hour it applies to; the
 *   residual band of a forecast is conditional with unvalidated coverage.
 *
 * Statistical minimums used here are identifiability minimums (two parameters need three training points; an error
 * comparison needs two held-out ratings), not physiological counts. Pure; no clock reads.
 */
import { statusValue, type StatusValue } from '@/lib/bodyContracts';

/** Version of the calibration semantics (C7): 2 = shared provider, whole-day splits, ridge slope, nested offset choice. */
export const HUNGER_CALIBRATION_VERSION = 2;

/** Ridge penalty on the training-standardised HPI slope (engineering default, documented above). */
export const HUNGER_RIDGE_LAMBDA = 1;

export interface HungerRating {
  /** Model day index the rating belongs to (aligned with `hpiByDay`). */
  readonly day: number;
  /** Clock hour the rating was made at, [0, 24); null/undefined = untimed (excluded). */
  readonly clockH?: number | null;
  /** Felt hunger 0–10; undefined = not rated (missing, not zero). */
  readonly hunger?: number;
  readonly fullness?: number;
  readonly craving?: number;
  /** Optional context label for a routine contrast (e.g. 'ketosis', 'fasting', 'usual'). */
  readonly context?: string;
  /** Model HPI paired with this rating (overrides `hpiByDay[day]`; used by pair-based callers). */
  readonly hpi?: number;
}

export interface HungerCalibrationOptions {
  /** The user-chosen fixed rating hour (whole hour); default = the documented training-only choice (module comment). */
  readonly fixedClockH?: number;
  /** Context label whose offset may be tested against the rest (chosen without touching the reported validation). */
  readonly offsetContext?: string;
  /**
   * Frozen later-day block: fit on days < heldOutFromDay, score once on days ≥ heldOutFromDay. Absent = forward chaining.
   */
  readonly heldOutFromDay?: number;
}

export type HungerCalibrationStatus = 'calibrated' | 'notInformative' | 'insufficient';

export interface HungerCalibration {
  readonly status: HungerCalibrationStatus;
  /** `HUNGER_CALIBRATION_VERSION` the result was computed under. */
  readonly version: number;
  readonly evaluation: 'forwardChaining' | 'frozenBlock';
  /** Why the status was reached (machine code; the info sheet words it). */
  readonly reasonCode: string;
  /** Clock hour the calibration applies to (forecasts at other hours are not calibrated); null = no eligible bucket. */
  readonly clockH: number | null;
  /** Last day of the ratings the reported fit (a, b, offset, baseline) was trained on; null when nothing was fitted. */
  readonly trainingCutoffDay: number | null;
  /** The reported fit (present when ≥ 3 training ratings). */
  readonly a?: number;
  readonly b?: number;
  /** Context offset (rating points) when the routine contrast improved held-out error. */
  readonly offset?: { readonly context: string; readonly value: number };
  /** Eligible ratings in the bucket (training + held out). */
  readonly n: number;
  /** Ratings predicted out of sample (strictly later whole days) and the number of such days. */
  readonly nHeldOut: number;
  readonly nHeldOutDays: number;
  /** Held-out mean absolute error of the HPI mapping and of the personal-mean baseline, rating points (0–10). */
  readonly heldOutMae?: number;
  readonly baselineMae?: number;
  readonly heldOutRmse?: number;
  readonly baselineRmse?: number;
  /** Personal mean rating at this clock hour over the training ratings (a labelled baseline estimate, any status). */
  readonly baselineMean?: number;
  readonly baselineN: number;
  /** Excluded or separate ratings: other clock hours, untimed, out of range; fullness/craving counts (never merged). */
  readonly excluded: { readonly otherTime: number; readonly untimed: number; readonly invalid: number };
  readonly fullnessN: number;
  readonly cravingN: number;
  /** Predictive coverage of the residual band is not validated. */
  readonly coverage: 'unvalidated';
}

/** Identifiability minimum: two parameters (a, b) need at least three points to leave a residual. */
const MIN_FIT = 3;
/** An error comparison needs at least two held-out ratings (a single residual has no spread). */
const MIN_HELD_OUT = 2;

const clip10 = (x: number): number => (x < 0 ? 0 : x > 10 ? 10 : x);

interface Pt {
  readonly x: number;
  readonly y: number;
  readonly c: number;
  readonly day: number;
}

interface Fit {
  a: number;
  b: number;
  c: number;
}

/** Ridge least squares a + b·x (+ c·ctx) with b ≥ 0 (λ on the standardised slope); a negative slope → mean (+ offset). */
function fit(pts: readonly Pt[], withOffset: boolean): Fit {
  const n = pts.length;
  let sx = 0;
  let sy = 0;
  let sc = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sc += p.c;
  }
  const mx = sx / n;
  const my = sy / n;
  const mc = sc / n;
  let sxx = 0;
  let scc = 0;
  let sxc = 0;
  let sxy = 0;
  let scy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dc = p.c - mc;
    const dy = p.y - my;
    sxx += dx * dx;
    scc += dc * dc;
    sxc += dx * dc;
    sxy += dx * dy;
    scy += dc * dy;
  }
  // λ on the slope of the standardised index z = (x − x̄)/sd, sd² = sxx/n: λ·bz² = λ·(sxx/n)·b²
  const sxxR = sxx * (1 + HUNGER_RIDGE_LAMBDA / n);
  const useC = withOffset && sc > 0 && sc < n;
  if (!useC) {
    const b = sxxR > 0 ? Math.max(0, sxy / sxxR) : 0;
    return { a: my - b * mx, b, c: 0 };
  }
  const det = sxxR * scc - sxc * sxc;
  let b = det > 0 ? (scc * sxy - sxc * scy) / det : 0;
  let c = det > 0 ? (sxxR * scy - sxc * sxy) / det : scc > 0 ? scy / scc : 0;
  if (b < 0) {
    b = 0;
    c = scc > 0 ? scy / scc : 0;
  }
  return { a: my - b * mx - c * mc, b, c };
}

const predict = (f: Fit, p: Pt): number => clip10(f.a + f.b * p.x + f.c * p.c);

function meanY(pts: readonly Pt[]): number {
  let m = 0;
  for (const p of pts) m += p.y;
  return m / pts.length;
}

function hasSpread(pts: readonly Pt[]): boolean {
  for (const p of pts) if (p.x !== pts[0]!.x) return true;
  return false;
}

/** Points grouped by whole day, days ascending (input order kept inside a day; grouping makes it irrelevant). */
function byDay(pts: readonly Pt[]): Pt[][] {
  const groups = new Map<number, Pt[]>();
  for (const p of pts) {
    let g = groups.get(p.day);
    if (!g) groups.set(p.day, (g = []));
    g.push(p);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((d) => groups.get(d)!);
}

interface Scores {
  ae: number;
  se: number;
  bae: number;
  bse: number;
  n: number;
  days: number;
}

const emptyScores = (): Scores => ({ ae: 0, se: 0, bae: 0, bse: 0, n: 0, days: 0 });

/**
 * Forward chaining over whole days: each day with ≥ MIN_FIT earlier ratings is predicted from the earlier days only.
 * With an offset context, a day uses the offset only when the offset's earlier held-out error beat the plain fit's
 * (nested choice: the reported error never selected its own predictor). Returns the scores and the final offset choice
 * (all held-out days compared), which governs forecasts only.
 */
function forwardChain(days: readonly Pt[][], offsetContext: boolean): { scores: Scores; useOffset: boolean } {
  const s = emptyScores();
  const train: Pt[] = [];
  let cumPlain = 0;
  let cumOff = 0;
  let compared = 0;
  for (const g of days) {
    if (train.length >= MIN_FIT) {
      const plain = fit(train, false);
      const off = offsetContext ? fit(train, true) : plain;
      const chosen = offsetContext && compared > 0 && cumOff < cumPlain ? off : plain;
      const base = meanY(train);
      for (const p of g) {
        const e = predict(chosen, p) - p.y;
        const be = base - p.y;
        s.ae += Math.abs(e);
        s.se += e * e;
        s.bae += Math.abs(be);
        s.bse += be * be;
        s.n++;
        if (offsetContext) {
          cumPlain += Math.abs(predict(plain, p) - p.y);
          cumOff += Math.abs(predict(off, p) - p.y);
        }
      }
      if (offsetContext) compared += g.length;
      s.days++;
    }
    for (const p of g) train.push(p);
  }
  return { scores: s, useOffset: offsetContext && compared > 0 && cumOff < cumPlain };
}

const valid10 = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x) && x >= 0 && x <= 10;
const validClock = (h: number | null | undefined): h is number => h !== undefined && h !== null && Number.isFinite(h) && h >= 0 && h < 24;

/** Most common whole hour of the ratings (ties → lower hour); null when none. */
function modeHour(rs: readonly HungerRating[]): number | null {
  const counts = new Map<number, number>();
  for (const r of rs) counts.set(Math.floor(r.clockH!), (counts.get(Math.floor(r.clockH!)) ?? 0) + 1);
  let best: number | null = null;
  let bestN = -1;
  for (const [h, c] of counts) if (c > bestN || (c === bestN && h < best!)) [best, bestN] = [h, c];
  return best;
}

/** Forward-chaining default bucket: the first whole hour to collect MIN_FIT ratings scanning whole days in order. */
function firstFilledHour(rs: readonly HungerRating[]): number | null {
  const sorted = [...rs].sort((p, q) => p.day - q.day);
  const counts = new Map<number, number>();
  let i = 0;
  while (i < sorted.length) {
    const day = sorted[i]!.day;
    for (; i < sorted.length && sorted[i]!.day === day; i++) {
      const h = Math.floor(sorted[i]!.clockH!);
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    let best: number | null = null;
    let bestN = -1;
    for (const [h, c] of counts) if (c >= MIN_FIT && (c > bestN || (c === bestN && h < best!))) [best, bestN] = [h, c];
    if (best !== null) return best;
  }
  return modeHour(rs);
}

/**
 * Calibrate the HPI to the person's fixed-time 0–10 hunger ratings (whole-day held-out evaluation; see the module
 * comment). `hpiByDay[d]` is the model HPI of day d (0–100); a rating's own `hpi` overrides it; ratings without a finite
 * HPI are invalid for the fit (still observations).
 */
export function calibrateHungerRatings(ratings: readonly HungerRating[], hpiByDay: ArrayLike<number>, opts: HungerCalibrationOptions = {}): HungerCalibration {
  let untimed = 0;
  let invalid = 0;
  let fullnessN = 0;
  let cravingN = 0;
  const timed: HungerRating[] = [];
  for (const r of ratings) {
    if (valid10(r.fullness)) fullnessN++;
    if (valid10(r.craving)) cravingN++;
    if (r.hunger === undefined) continue; // missing, not zero
    if (!valid10(r.hunger) || !Number.isInteger(r.day) || r.day < 0) {
      invalid++;
      continue;
    }
    if (r.clockH === undefined || r.clockH === null) {
      untimed++;
      continue;
    }
    if (!validClock(r.clockH)) {
      invalid++;
      continue;
    }
    timed.push(r);
  }
  const frozen = opts.heldOutFromDay !== undefined && Number.isFinite(opts.heldOutFromDay);
  const cutoff = frozen ? opts.heldOutFromDay! : Number.POSITIVE_INFINITY;
  let clockH: number | null = opts.fixedClockH !== undefined && validClock(opts.fixedClockH) ? Math.floor(opts.fixedClockH) : null;
  if (clockH === null) clockH = frozen ? modeHour(timed.filter((r) => r.day < cutoff)) : firstFilledHour(timed);
  let otherTime = 0;
  const pts: Pt[] = [];
  for (const r of timed) {
    if (Math.floor(r.clockH!) !== clockH) {
      otherTime++;
      continue;
    }
    const x = r.hpi !== undefined ? r.hpi : r.day < hpiByDay.length ? hpiByDay[r.day]! : Number.NaN;
    if (!Number.isFinite(x)) {
      invalid++;
      continue;
    }
    pts.push({ x, y: r.hunger!, c: opts.offsetContext !== undefined && r.context === opts.offsetContext ? 1 : 0, day: r.day });
  }
  pts.sort((p, q) => p.day - q.day);
  const train = frozen ? pts.filter((p) => p.day < cutoff) : pts;
  const held = frozen ? pts.filter((p) => p.day >= cutoff) : [];
  const common = {
    version: HUNGER_CALIBRATION_VERSION,
    evaluation: frozen ? ('frozenBlock' as const) : ('forwardChaining' as const),
    clockH,
    n: pts.length,
    baselineN: train.length,
    ...(train.length > 0 ? { baselineMean: meanY(train) } : {}),
    trainingCutoffDay: train.length > 0 ? train[train.length - 1]!.day : null,
    excluded: { otherTime, untimed, invalid },
    fullnessN,
    cravingN,
    coverage: 'unvalidated' as const,
  };
  const insufficient = (reasonCode: string, f: Fit | null, nHeldOut = 0, nHeldOutDays = 0): HungerCalibration => ({
    status: 'insufficient',
    reasonCode,
    nHeldOut,
    nHeldOutDays,
    ...common,
    ...(f ? { a: f.a, b: f.b } : {}),
  });
  const offsetCtx = opts.offsetContext !== undefined;
  const days = byDay(train);

  if (!frozen) {
    if (train.length < MIN_FIT) return insufficient(timed.length === 0 && untimed > 0 ? 'untimedRatingsOnly' : 'fewMatchedRatings', null);
    const { scores, useOffset } = forwardChain(days, offsetCtx);
    const f = fit(train, useOffset);
    if (scores.n < MIN_HELD_OUT) return insufficient('fewHeldOutRatings', f, scores.n, scores.days);
    if (!hasSpread(train)) return insufficient('indexConstant', f, scores.n, scores.days);
    return finish(f, useOffset, scores, common, opts.offsetContext);
  }

  // frozen later-day block: every choice (bucket, offset, fit) from the training days only; scored once on the block
  if (train.length < MIN_FIT) return insufficient(timed.length === 0 && untimed > 0 ? 'untimedRatingsOnly' : 'fewMatchedRatings', null, held.length, byDay(held).length);
  const useOffset = offsetCtx && forwardChain(days, true).useOffset;
  const f = fit(train, useOffset);
  const heldDays = byDay(held);
  if (held.length < MIN_HELD_OUT) return insufficient('fewHeldOutRatings', f, held.length, heldDays.length);
  if (!hasSpread(train)) return insufficient('indexConstant', f, held.length, heldDays.length);
  const base = meanY(train);
  const s = emptyScores();
  for (const p of held) {
    const e = predict(f, p) - p.y;
    const be = base - p.y;
    s.ae += Math.abs(e);
    s.se += e * e;
    s.bae += Math.abs(be);
    s.bse += be * be;
    s.n++;
  }
  s.days = heldDays.length;
  return finish(f, useOffset, s, common, opts.offsetContext);
}

function finish(
  f: Fit,
  useOffset: boolean,
  s: Scores,
  common: Omit<HungerCalibration, 'status' | 'reasonCode' | 'nHeldOut' | 'nHeldOutDays'>,
  offsetContext: string | undefined,
): HungerCalibration {
  const mae = s.ae / s.n;
  const base = s.bae / s.n;
  const informative = mae < base;
  return {
    status: informative ? 'calibrated' : 'notInformative',
    reasonCode: informative ? 'heldOutBeatsBaseline' : 'heldOutNotBetterThanBaseline',
    a: f.a,
    b: f.b,
    ...(useOffset && offsetContext !== undefined ? { offset: { context: offsetContext, value: f.c } } : {}),
    nHeldOut: s.n,
    nHeldOutDays: s.days,
    heldOutMae: mae,
    baselineMae: base,
    heldOutRmse: Math.sqrt(s.se / s.n),
    baselineRmse: Math.sqrt(s.bse / s.n),
    ...common,
  };
}

/** A rating paired with the model index of its day (the living projection's shape). */
export interface HungerIndexPair {
  readonly day: number;
  /** Entered hunger 0–10. */
  readonly rating: number;
  /** The model's hunger index (HPI 0–100) of that day. */
  readonly index: number;
  /** Clock hour the rating was made at; absent/null = untimed (never pooled into a synthetic hour). */
  readonly ratedAtClockH?: number | null;
  readonly context?: string;
}

/** The same provider for pair-shaped callers (living projection): identical eligibility, evaluation and status. */
export function calibrateHungerPairs(pairs: readonly HungerIndexPair[], opts: HungerCalibrationOptions = {}): HungerCalibration {
  return calibrateHungerRatings(
    pairs.map((p) => ({ day: p.day, hunger: p.rating, hpi: p.index, clockH: p.ratedAtClockH ?? null, ...(p.context !== undefined ? { context: p.context } : {}) })),
    [],
    opts,
  );
}

/** Uncalibrated burden word on the HPI's 0–100 scale (display convention: thirds of the index scale, not a rating). */
export type HungerBurden = 'low' | 'moderate' | 'high' | 'unknown';

export function hungerBurdenStatus(hpi: number): HungerBurden {
  if (!Number.isFinite(hpi)) return 'unknown';
  return hpi < 100 / 3 ? 'low' : hpi < 200 / 3 ? 'moderate' : 'high';
}

/**
 * Hunger forecast at the calibrated clock hour as a typed boundary value: a 0–10 range (prediction ± held-out RMSE,
 * a residual band with unvalidated coverage) only for an informative fit, otherwise the uncalibrated status (no invented
 * range). The person's mean rating stays available separately (`hungerBaselineForecast`).
 */
export function hungerForecast(hpi: number, cal: HungerCalibration, context?: string): StatusValue {
  if (cal.status !== 'calibrated' || cal.a === undefined || cal.b === undefined || cal.heldOutRmse === undefined || !Number.isFinite(hpi)) {
    return statusValue({ status: Number.isFinite(hpi) ? 'exploratory' : 'unknown', unit: '0–10', reasonCode: cal.status === 'calibrated' ? 'hpiUnknown' : `ratingCalibration:${cal.status}` });
  }
  const off = cal.offset && context === cal.offset.context ? cal.offset.value : 0;
  const v = clip10(cal.a + cal.b * hpi + off);
  return statusValue({
    status: 'estimated',
    value: v,
    range: [clip10(v - cal.heldOutRmse), clip10(v + cal.heldOutRmse)],
    unit: '0–10',
    uncertaintyKind: 'conditionalResidual',
    coverageStatus: 'unvalidated',
    reasonCode: 'personalRatingCalibration',
  });
}

/**
 * The person's own mean rating at the calibration's clock hour, as an explicitly labelled baseline estimate (no HPI, no
 * range): available whenever there are training ratings, whatever the HPI status. Unknown without ratings.
 */
export function hungerBaselineForecast(cal: HungerCalibration): StatusValue {
  if (cal.baselineMean === undefined || !(cal.baselineN > 0)) return statusValue({ status: 'unknown', unit: '0–10', reasonCode: 'noRatings' });
  return statusValue({ status: 'estimated', value: cal.baselineMean, unit: '0–10', uncertaintyKind: 'heuristic', coverageStatus: 'unvalidated', reasonCode: 'personalMeanBaseline' });
}
