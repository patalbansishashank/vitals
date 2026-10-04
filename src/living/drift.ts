/**
 * Drift (docs/SUITE_SPEC.md §3.8; R11 §2.2): the filtered trend against the forecast's 80 % band (P10–P90 for the day,
 * from the last adopted version) — ahead / on track / behind with hysteresis (the state changes only after two consecutive
 * check-ins agree on it), the goal date as a range moved only when the shift is ≥ 3 days and the trend was outside the
 * band at two check-ins running, and the cause split (adherence, expenditure correction, water noise). One action per
 * verdict, no red, self-compassionate copy. Pure.
 */
import type { MetricId } from '@/engine';
import { addDays, daysBetween } from './dates';
import type { DriftGoal, DriftReport, DriftState, LocalDate } from './types';

/** Shift (days) from which a goal-date change is shown, and check-ins outside the band needed to move it. */
export const GOAL_DATE_MIN_SHIFT_D = 3;
export const CHECKINS_TO_CHANGE = 2;
/** Share above which the text names adherence as the main cause. */
export const ADHERENCE_DOMINANT_SHARE = 0.6;

/** Raw position of a value against the band: which state it argues for. */
export function rawDriftState(value: number, band: { p10: number; p90: number }, better: 'down' | 'up'): DriftState {
  if (value < band.p10) return better === 'down' ? 'ahead' : 'behind';
  if (value > band.p90) return better === 'down' ? 'behind' : 'ahead';
  return 'onTrack';
}

/**
 * Hysteresis over the check-in sequence (oldest first): start on track; switch to a new state only when the last two
 * check-ins both argue for it. Returns the current state and how many check-ins in a row were outside the band.
 */
export function hysteresisState(raw: readonly DriftState[]): { state: DriftState; checkInsOutside: number } {
  let state: DriftState = 'onTrack';
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k]!;
    if (r !== state && k >= CHECKINS_TO_CHANGE - 1 && raw.slice(k - CHECKINS_TO_CHANGE + 1, k + 1).every((x) => x === r)) state = r;
  }
  let outside = 0;
  for (let k = raw.length - 1; k >= 0 && raw[k] !== 'onTrack' && raw[k] === raw[raw.length - 1]; k--) outside++;
  return { state, checkInsOutside: outside };
}

export interface DriftCauseInputs {
  /** Days the gap built over (since the version's forecast start). */
  days: number;
  /** Mean logged minus prescribed intake over those days, kcal/d (+ = ate more), from known intake days. */
  intakeExcessKcal: number;
  /** Energy-balance correction δ in force (+ = the body stores more than modelled), kcal/d. */
  deltaKcal: number;
  /** Energy density of the engine's mix, kcal/kg. */
  rhoKcalPerKg: number;
}

/** Split a weight gap (trend − forecast P50, kg) into adherence, expenditure and water-noise shares. */
export function driftCauses(gapKg: number, c: DriftCauseInputs): DriftGoal['causes'] {
  const adh = (c.intakeExcessKcal * c.days) / c.rhoKcalPerKg;
  const exp = (c.deltaKcal * c.days) / c.rhoKcalPerKg;
  const water = gapKg - adh - exp;
  const tot = Math.abs(adh) + Math.abs(exp) + Math.abs(water);
  if (!(tot > 0)) return [];
  const share = (x: number): number => Math.abs(x) / tot;
  const kcal = Math.round(Math.abs(c.deltaKcal) / 10) * 10;
  return [
    { cause: 'adherence' as const, share: share(adh), text: adh >= 0 ? 'Eating a little more than planned on logged days.' : 'Eating a little less than planned on logged days.' },
    { cause: 'expenditure' as const, share: share(exp), text: c.deltaKcal < 0 ? `Your body is burning about ${kcal} kcal a day more than assumed; the plan has been updated.` : `Your body is burning about ${kcal} kcal a day less than assumed; the plan has been updated.` },
    { cause: 'waterNoise' as const, share: share(water), text: 'Day-to-day water and glycogen swings.' },
  ].sort((a, b) => b.share - a.share);
}

export interface DriftGoalInput {
  goal: number;
  metric: MetricId;
  target: number | null;
  /** Which direction is progress for this goal. */
  better: 'down' | 'up';
  trend: { value: number; sd: number };
  /** Forecast for the day: P10, P50, P90 (last adopted version). */
  band: { p10: number; p50: number; p90: number };
  /** Raw states of the previous check-ins (oldest first), not including today. */
  previous: readonly DriftState[];
  /** Goal-date P50 before (adopted version) and now (current forecast), with the current range; null when unknown. */
  goalDate?: { before: LocalDate | null; after: LocalDate | null; range: [LocalDate, LocalDate] | null };
  causes?: DriftCauseInputs;
}

function verdictText(state: DriftState, causes: DriftGoal['causes']): { action: DriftGoal['action']; text: string } {
  if (state === 'onTrack') return { action: 'keepGoing', text: 'On track. Keep going.' };
  if (state === 'ahead') return { action: 'keepGoing', text: 'Ahead of the plan. Keep going at this pace.' };
  const adh = causes.find((c) => c.cause === 'adherence');
  if (adh && adh.share > ADHERENCE_DOMINANT_SHARE) return { action: 'easeOptions', text: 'A bit behind, mostly from the days that went differently. An easier version may fit better.' };
  const exp = causes.find((c) => c.cause === 'expenditure');
  if (exp && exp.share >= (adh?.share ?? 0)) return { action: 'replan', text: `A bit behind while you were on plan. ${exp.text}` };
  return { action: 'replan', text: 'A bit behind. A fresh plan from where you are now can close the gap.' };
}

export function driftGoal(i: DriftGoalInput): DriftGoal {
  const raw = rawDriftState(i.trend.value, i.band, i.better);
  const { state, checkInsOutside } = hysteresisState([...i.previous, raw]);
  const causes = i.causes ? driftCauses(i.trend.value - i.band.p50, i.causes) : [];
  let goalDate: DriftGoal['goalDate'] = { range: i.goalDate?.range ?? null, shiftDays: null, shiftSd: null };
  if (i.goalDate?.before && i.goalDate.after) {
    const shift = daysBetween(i.goalDate.before, i.goalDate.after);
    const range = i.goalDate.range;
    const sd = range ? Math.max(1, daysBetween(range[0], range[1]) / 2.563) : null;
    if (Math.abs(shift) >= GOAL_DATE_MIN_SHIFT_D && raw !== 'onTrack' && checkInsOutside >= CHECKINS_TO_CHANGE) goalDate = { range, shiftDays: shift, shiftSd: sd };
  }
  const v = verdictText(state, causes);
  return {
    goal: i.goal,
    metric: i.metric,
    target: i.target,
    trend: i.trend,
    band: { p10: i.band.p10, p90: i.band.p90 },
    state,
    checkInsOutside,
    goalDate,
    causes,
    action: v.action,
    text: v.text,
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
