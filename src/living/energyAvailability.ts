/**
 * Energy-availability exposure over calendar days (D4-04; C1, C3, C6): a ledger, not a diagnosis.
 *
 *   EA_d      = (EI_d − EEE_net,d) / FFM_d                          kcal/kg FFM/day, a 24-hour day, unclipped (may be < 0)
 *   EA_window = Σ_d (EI_d − EEE_net,d) / Σ_d FFM_d                  over the actual calendar days of the window
 *
 * EEE_net is exercise-only energy above the resting baseline (never TDEE; the resting component is not subtracted twice).
 * FFM_d is the engine's metabolically active FFM (FFM0 + ΔLT) at the day's end sample, or a measured value. Every calendar
 * day counts — fast days, refeeds and rest days included — so the window value is an FFM-weighted daily mean, not the
 * arithmetic mean of daily EAs when FFM changes. The legacy eating-day statistic (non-fast days only) is a different
 * estimand and keeps its own name (`eatingDayEa`).
 *
 * Unknown intake is incomplete exposure, never a zero or a reassuring number: a window with an unknown day has no value
 * (status partial: the known days are reported as coverage, a lower bound only when every unknown is a partial log).
 * The reference 30 kcal/kg FFM/day is the existing precautionary design policy, not a universal safe/unsafe boundary;
 * below-reference counts are descriptive. Neither EA ≥ 30 nor EA < 30 decides anything alone: a concern the person flagged
 * stays a review whatever the number says, and no fast is banned from this number.
 */
import { statusValue, type ChannelCoverage, type StatusValue } from '@/lib/bodyContracts';
import { repeatedCalendarEaPolicy } from '@/engine/model/safety/constraints';
import { defaultSafetyConstants } from '@/engine/model/safety/params';
import { compareDates, daysBetween } from './dates';
import type { LocalDate } from './types';

/** The existing precautionary policy reference (a design policy; not a calibrated individual threshold). */
export const EA_POLICY_REFERENCE = { value: 30, unit: 'kcal/kg FFM/day', basis: 'precautionaryPolicy' } as const;
/** Default reporting windows (design choices). */
export const EA_WINDOWS = [7, 28] as const;

const UNIT = 'kcal/kg FFM/day';
const DETAILS = 'energy-availability';

/** One calendar day of the exposure ledger. */
export interface EaLedgerDay {
  date: LocalDate;
  /** Observed intake, kcal (null = unknown); with partial coverage it is the known part (a lower bound). */
  eiKcal: number | null;
  eiCoverage: ChannelCoverage;
  /**
   * Exercise energy above rest, kcal: the day's complete session expenditure (complete or confirmed-zero exercise coverage
   * with every logged cost stated; confirmed zero = 0), else null (A1-057: an absent prescription or an empty log set never
   * proves a zero-exercise day; a logged session without a stated cost is null too).
   */
  eeeNetKcal: number | null;
  /** Independent exercise coverage. Absent is unknown, even when a finite logged-bout sum exists. */
  exerciseCoverage?: ChannelCoverage;
  exerciseScope?: 'actualDay' | 'coveredSessions' | 'prescribedScenario' | 'unknown';
  knownEeeNetKcal?: number;
  exerciseProvenance?: 'loggedSessions' | 'explicitDayCoverage' | 'prescribedScenario' | 'unknown';
  /** Finite upper bound on ALL actual-day exercise, when explicitly supported. */
  exerciseUpperBoundKcal?: number;
  /** FFM at the day's sample, kg (null = unknown) and its basis. */
  ffmKg: number | null;
  ffmBasis: 'measured' | 'model' | 'unknown';
  /** A prescribed or realised fast covers the day (it stays in the calendar exposure). */
  fastDay: boolean;
}

/** Covered sessions is the existing practical logging scope, not a claim that extra exercise was excluded. */
function exerciseCovered(d: EaLedgerDay): boolean {
  const supportedScope = d.exerciseScope === 'actualDay' || d.exerciseScope === 'coveredSessions' || d.exerciseScope === 'prescribedScenario';
  return supportedScope && (d.exerciseCoverage === 'complete' || d.exerciseCoverage === 'confirmedZero');
}

/** Derived exposure/cache semantics; raw observations and prescriptions are unchanged. */
export const CALENDAR_EA_VERSION = 2;

/** The day's EA when every term is known (complete or confirmed-zero intake), else null; negative values are kept. */
export function dailyEa(d: EaLedgerDay): number | null {
  const ei = d.eiCoverage === 'confirmedZero' ? 0 : d.eiCoverage === 'complete' ? d.eiKcal : null;
  if (!exerciseCovered(d) || ei === null || !Number.isFinite(ei) || d.eeeNetKcal === null || !Number.isFinite(d.eeeNetKcal) || d.eeeNetKcal < 0 || d.ffmKg === null || !Number.isFinite(d.ffmKg) || !(d.ffmKg > 0) || d.ffmBasis === 'unknown') return null;
  return (ei - d.eeeNetKcal) / d.ffmKg;
}

export interface CalendarEa {
  windowDays: number;
  /** Calendar days of the window that exist in the ledger, and how many have every term known. */
  days: number;
  covered: number;
  ea: StatusValue;
  /** Σ(EI − EEE) and Σ FFM over the window when every day is known (kcal; kg·days). */
  numeratorKcal: number | null;
  ffmKgDays: number | null;
  /** With partial-intake days only (no unknown day): the known part's window EA, a lower bound. */
  lowerBound?: number;
  /** Known days below the policy reference, and the longest run of consecutive known days below it (descriptive). */
  belowReferenceDays: number;
  longestBelowReferenceRun: number;
  version: number;
  /** Independent channel coverage and declared conditional scope, retained through document consumers. */
  intakeCoveredDays: number;
  exerciseCoveredDays: number;
  exerciseScopes: string[];
  assumptions: string[];
}

/**
 * Calendar EA over the `windowDays` days ending at `asOf` (inclusive), over the ledger days that exist (a young plan reports
 * the days available; `days` says how many). An unknown day is never zero-padded: the window then has no value.
 */
export function calendarEnergyAvailability(ledger: readonly EaLedgerDay[], asOf: LocalDate, windowDays: number): CalendarEa {
  const inWindow = ledger.filter((d) => compareDates(d.date, asOf) <= 0 && daysBetween(d.date, asOf) < windowDays).sort((a, b) => compareDates(a.date, b.date));
  let num = 0;
  let den = 0;
  let lbNum = 0;
  let lbDen = 0;
  let covered = 0;
  let unknown = 0;
  let partialOnly = true;
  let below = 0;
  let run = 0;
  let longest = 0;
  let basis: 'measured' | 'model' = 'measured';
  let exerciseIncomplete = false;
  let previousDate: LocalDate | null = null;
  for (const d of inWindow) {
    if (previousDate && daysBetween(previousDate, d.date) !== 1) run = 0;
    previousDate = d.date;
    const ea = dailyEa(d);
    if (ea !== null) {
      covered++;
      num += ea * d.ffmKg!;
      den += d.ffmKg!;
      lbNum += ea * d.ffmKg!;
      lbDen += d.ffmKg!;
      if (d.ffmBasis !== 'measured') basis = 'model';
      if (ea < EA_POLICY_REFERENCE.value) {
        below++;
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
      continue;
    }
    run = 0;
    unknown++;
    if (!exerciseCovered(d)) exerciseIncomplete = true;
    const boundedExercise = exerciseCovered(d) ? d.eeeNetKcal : d.exerciseUpperBoundKcal;
    const lowerKnown = d.eiCoverage === 'partial' && d.eiKcal !== null && Number.isFinite(d.eiKcal) && boundedExercise !== null && boundedExercise !== undefined && Number.isFinite(boundedExercise) && boundedExercise >= 0 && d.ffmKg !== null && Number.isFinite(d.ffmKg) && d.ffmKg > 0 && d.ffmBasis !== 'unknown';
    if (lowerKnown) {
      lbNum += d.eiKcal! - boundedExercise!;
      lbDen += d.ffmKg!;
    } else partialOnly = false;
  }
  const scopes = [...new Set(inWindow.map((d) => d.exerciseScope ?? 'unknown'))];
  const conditionalExercise = scopes.includes('coveredSessions') || scopes.includes('prescribedScenario');
  const base = { version: CALENDAR_EA_VERSION, intakeCoveredDays: inWindow.filter((d) => d.eiCoverage === 'complete' || d.eiCoverage === 'confirmedZero').length, exerciseCoveredDays: inWindow.filter(exerciseCovered).length, exerciseScopes: scopes, assumptions: scopes.includes('coveredSessions') ? ['coveredSessions:noAdditionalExerciseAssumption'] : scopes.includes('prescribedScenario') ? ['prescribedExerciseScenario'] : [], windowDays, days: inWindow.length, covered, belowReferenceDays: below, longestBelowReferenceRun: longest };
  if (inWindow.length === 0) return { ...base, ea: statusValue({ status: 'unknown', unit: UNIT, reasonCode: 'noLedgerDays', detailsRef: DETAILS }), numeratorKcal: null, ffmKgDays: null };
  if (unknown === 0) {
    return {
      ...base,
      ea: statusValue({ status: basis === 'measured' && !conditionalExercise ? 'estimated' : 'scenario', value: num / den, unit: UNIT, reasonCode: conditionalExercise ? 'coveredExerciseScenario' : basis === 'measured' ? 'measuredFfm' : 'modelFfm', detailsRef: DETAILS }),
      numeratorKcal: num,
      ffmKgDays: den,
    };
  }
  return {
    ...base,
    ea: statusValue({ status: 'partial', unit: UNIT, reasonCode: partialOnly ? 'intakeLowerBoundOnly' : exerciseIncomplete ? 'exerciseIncomplete' : 'intakeIncomplete', detailsRef: DETAILS }),
    numeratorKcal: null,
    ffmKgDays: null,
    ...(partialOnly && lbDen > 0 ? { lowerBound: lbNum / lbDen } : {}),
  };
}

/**
 * The legacy eating-day statistic under its own name: the FFM-weighted EA of the non-fast days in the window (a conditional
 * statistic, never a calendar exposure and never evidence of safety).
 */
export function eatingDayEa(ledger: readonly EaLedgerDay[], asOf: LocalDate, windowDays: number): StatusValue {
  const eating = ledger.filter((d) => !d.fastDay);
  const r = calendarEnergyAvailability(eating, asOf, windowDays);
  return { ...r.ea, reasonCode: `eatingDay:${r.ea.reasonCode}` };
}

/** Shared repeated-pattern review over elapsed calendar windows; a young or gapped window is never eligible. */
export function repeatedCalendarEaReview(ledger: readonly EaLedgerDay[], asOf: LocalDate) {
  const sorted = [...ledger].filter((d) => compareDates(d.date, asOf) <= 0).sort((a, b) => compareDates(a.date, b.date));
  const start = sorted[0]?.date;
  const windows = sorted.map((d) => {
    const w = calendarEnergyAvailability(sorted, d.date, 7);
    const fullCalendar = w.days === 7 && sorted.some((x) => daysBetween(x.date, d.date) === 6);
    return { day: start ? daysBetween(start, d.date) : 0, ea7: fullCalendar ? w.ea.value ?? null : null, coverage7: fullCalendar ? w.covered : 0 };
  });
  return { ...repeatedCalendarEaPolicy(windows, { ...(start ? { atDay: daysBetween(start, asOf) } : {}) }), version: CALENDAR_EA_VERSION, reference: EA_POLICY_REFERENCE, windowDays: 7, cautionDays: defaultSafetyConstants().eaCautionDays, persistenceComparator: 'strictlyGreater' as const };
}
