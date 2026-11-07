/**
 * Drift (docs/SUITE_SPEC.md §3.8; D5-02): a goal's trend against the forecast band of the same observable (operator and
 * sample time matched: the scale trend against the scale forecast; a water-adjusted estimate is never compared with a
 * scale band), classified ahead / on track / behind only at confirmed check-in decisions, with hysteresis (the state
 * changes only after two consecutive confirmed decisions agree). A daily read is shown but never advances the sequence,
 * and replaying the same decision id counts once.
 *
 * Classification rule (documented, provisional, to be calibrated on held-out check-ins): a read is 'clear' only when the
 * trend's own interval (± `DRIFT_CLEAR_Z` trend SDs) stays on one side of every band edge; otherwise it is 'unclear', which
 * never changes the state and breaks a run. The band itself is the forecast's P10–P90 range of its declared semantics
 * (legacy: a parameter-sensitivity range of unvalidated coverage, never an 80 % prediction interval). (D8-02) Ahead/behind
 * is therefore a position against a sensitivity range, never a calibrated probability: a forecast without stochastic
 * members (`bandMeta.method` 'none', or a zero-width band) has no range to read against and every read is 'unclear'; no
 * goal-date SD is derived from the range (that would treat it as a Gaussian prediction interval).
 *
 * Causes are not inferred (D5-02): the logs cannot separate intake error from expenditure, so no causal shares and no
 * "your body burns…" statement. The report keeps the observed logged intake difference (quantitative days only) and the
 * unexplained balance/model residual (a predictive correction, not measured expenditure). One short status word per goal,
 * one action, no red. Pure.
 */
import type { MetricId } from '@/engine';
import type { BandMeta, StatusValue } from '@/lib/bodyContracts';
import type { OperatorId } from '@/lib/measurementOperators';
import { addDays, daysBetween } from './dates';
import type { DriftGoal, DriftReport, DriftState, Id, LocalDate } from './types';

/** Shift (days) from which a goal-date change is shown, and confirmed check-ins outside the band needed to move it. */
export const GOAL_DATE_MIN_SHIFT_D = 3;
export const CHECKINS_TO_CHANGE = 2;
/**
 * Width of the trend's own interval used to call a read clear, in trend SDs (two-sided 80 %, matching the band's nominal
 * P10–P90 convention). A provisional engineering rule, not a calibrated decision threshold.
 */
export const DRIFT_CLEAR_Z = 1.2816;

/** One classified read: a state, or 'unclear' when the trend's uncertainty straddles a band edge. */
export type DriftRead = DriftState | 'unclear';

/** Raw position of a value against the band: which state it argues for. */
export function rawDriftState(value: number, band: { p10: number; p90: number }, better: 'down' | 'up'): DriftState {
  if (value < band.p10) return better === 'down' ? 'ahead' : 'behind';
  if (value > band.p90) return better === 'down' ? 'behind' : 'ahead';
  return 'onTrack';
}

/** Classify a trend against a band with the trend's own uncertainty (see the module comment). */
export function classifyDrift(trend: { value: number; sd: number }, band: { p10: number; p90: number }, better: 'down' | 'up', z: number = DRIFT_CLEAR_Z): { raw: DriftState; read: DriftRead; certainty: 'clear' | 'unclear' } {
  const raw = rawDriftState(trend.value, band, better);
  const sd = Number.isFinite(trend.sd) && trend.sd > 0 ? trend.sd : 0;
  const lo = trend.value - z * sd;
  const hi = trend.value + z * sd;
  const clear = trend.value < band.p10 ? hi < band.p10 : trend.value > band.p90 ? lo > band.p90 : lo >= band.p10 && hi <= band.p90;
  return { raw, read: clear ? raw : 'unclear', certainty: clear ? 'clear' : 'unclear' };
}

/**
 * Hysteresis over confirmed decisions (oldest first): start on track; switch to a new state only when the last two reads
 * both argue for it ('unclear' never does and breaks a run). Returns the state and how many reads in a row were outside.
 */
export function hysteresisState(raw: readonly DriftRead[]): { state: DriftState; checkInsOutside: number } {
  let state: DriftState = 'onTrack';
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k]!;
    if (r === 'unclear' || r === state) continue;
    if (k >= CHECKINS_TO_CHANGE - 1 && raw.slice(k - CHECKINS_TO_CHANGE + 1, k + 1).every((x) => x === r)) state = r;
  }
  let outside = 0;
  const last = raw[raw.length - 1];
  for (let k = raw.length - 1; k >= 0 && raw[k] !== 'onTrack' && raw[k] !== 'unclear' && raw[k] === last; k--) outside++;
  return { state, checkInsOutside: outside };
}

/** A confirmed check-in's classification (its id makes a replayed or re-rendered decision count once). */
export interface DriftDecision {
  id: Id;
  read: DriftRead;
}

export interface DriftGoalInput {
  goal: number;
  metric: MetricId;
  target: number | null;
  /** Which direction is progress for this goal. */
  better: 'down' | 'up';
  /** Today's trend in the goal's operator (the daily read: shown, never a decision). */
  trend: { value: number; sd: number };
  /** Forecast for the day in the same operator: P10, P50, P90 (version in force). */
  band: { p10: number; p50: number; p90: number };
  /** Confirmed check-in decisions, oldest first; duplicates by id count once. */
  decisions?: readonly DriftDecision[];
  /** Legacy: reads of earlier check-ins without ids (oldest first), used only when `decisions` is absent. */
  previous?: readonly DriftRead[];
  /** Goal-date P50 before (adopted version) and now (current forecast), with the current range; null when unknown. */
  goalDate?: { before: LocalDate | null; after: LocalDate | null; range: [LocalDate, LocalDate] | null };
  /** Operator both trend and band are expressed in. */
  operator?: OperatorId;
  /** Observed mean logged intake minus prescription on quantitative days (not a cause). */
  loggedIntakeDiff?: DriftGoal['loggedIntakeDiff'];
  /** Unexplained balance/model residual, kcal/day (a predictive correction, not measured expenditure). */
  residual?: StatusValue;
  /** (D8-02) What the band is (absent = legacy: a parameter-sensitivity range of unvalidated coverage). */
  bandMeta?: BandMeta;
}

/**
 * (D8-02) Whether a forecast band can be read against at all: a band made from stochastic members or a declared fallback
 * range, with positive width. A nominal-only forecast ('none', zero draws) or a zero-width band is not a range.
 */
export function bandIsReadable(band: { p10: number; p90: number }, meta?: BandMeta): boolean {
  if (meta && (meta.method === 'none' || (meta.method === 'draws' && meta.draws <= 0 && meta.version > 0))) return false;
  return Number.isFinite(band.p10) && Number.isFinite(band.p90) && band.p90 > band.p10;
}

const STATE_WORD: Record<DriftState, string> = { onTrack: 'On track', ahead: 'Ahead', behind: 'Behind' };

export function driftGoal(i: DriftGoalInput): DriftGoal {
  const seen = new Set<string>();
  const ids: Id[] = [];
  const seq: DriftRead[] = [];
  for (const d of i.decisions ?? []) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    ids.push(d.id);
    seq.push(d.read);
  }
  if (!i.decisions && i.previous) seq.push(...i.previous);
  // (D8-02) without a readable range no read is a decision: the state stays as it was and the goal reads Unclear
  const readable = bandIsReadable(i.band, i.bandMeta);
  const { state, checkInsOutside } = hysteresisState(readable ? seq : seq.map(() => 'unclear' as const));
  const last = readable ? seq[seq.length - 1] : 'unclear';
  const certainty: 'clear' | 'unclear' = last === undefined || last === 'unclear' ? 'unclear' : 'clear';
  let goalDate: DriftGoal['goalDate'] = { range: i.goalDate?.range ?? null, shiftDays: null, shiftSd: null };
  if (i.goalDate?.before && i.goalDate.after) {
    const shift = daysBetween(i.goalDate.before, i.goalDate.after);
    const range = i.goalDate.range;
    if (Math.abs(shift) >= GOAL_DATE_MIN_SHIFT_D && last !== undefined && last !== 'onTrack' && last !== 'unclear' && checkInsOutside >= CHECKINS_TO_CHANGE) goalDate = { range, shiftDays: shift, shiftSd: null };
  }
  return {
    goal: i.goal,
    metric: i.metric,
    target: i.target,
    trend: i.trend,
    band: { p10: i.band.p10, p90: i.band.p90 },
    state,
    checkInsOutside,
    goalDate,
    causes: [],
    action: state === 'behind' && certainty === 'clear' ? 'replan' : 'keepGoing',
    text: certainty === 'unclear' ? 'Unclear' : STATE_WORD[state],
    ...(i.operator ? { operator: i.operator } : {}),
    certainty,
    ...(i.loggedIntakeDiff !== undefined ? { loggedIntakeDiff: i.loggedIntakeDiff } : {}),
    ...(i.residual ? { residual: i.residual } : {}),
    decisionIds: ids,
  };
}

export function driftReport(asOf: LocalDate, goals: readonly DriftGoalInput[]): DriftReport {
  return { asOf, goals: goals.map(driftGoal) };
}

/** Display a goal-date range: whole weeks when the range is wider than two weeks (R11 §2.2). */
export function goalDateRangeText(range: [LocalDate, LocalDate] | null): { from: LocalDate; to: LocalDate; roundedToWeeks: boolean } | null {
  if (!range) return null;
  const w = daysBetween(range[0], range[1]);
  if (w <= 14) return { from: range[0], to: range[1], roundedToWeeks: false };
  return { from: range[0], to: addDays(range[0], Math.round(w / 7) * 7), roundedToWeeks: true };
}
