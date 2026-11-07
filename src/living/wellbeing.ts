/**
 * Observed wellbeing, hunger ratings and energy-availability exposure over the realised history (D2-06, D8-04, D8-09).
 * Pure readers of what the person entered, kept apart from model indices and from item completion:
 *
 *  - concern flags (persistent fatigue, performance decline, injury, menstrual change, poor recovery, dizziness) are the
 *    person's own statements: any flag in the window reads `review`, and it stays on screen whatever a model tier says.
 *    Ratings are shown as entered; no mood/fatigue cut-off is introduced and nothing here is a diagnosis;
 *  - hunger ratings 0–10 calibrate the model's hunger index personally through the one shared versioned provider
 *    (`calibrateHungerPairs`): each rating keeps its own entry's clock, one whole-hour bucket only (untimed ratings stay
 *    observations), scored on strictly later whole days against the personal-mean baseline. An uninformative or
 *    unidentifiable fit stays uncalibrated, the mean rating remaining its own labelled estimate (no probability of sticking
 *    with the plan exists anywhere);
 *  - raw energy availability = (intake ME − net-above-rest session energy) / FFM, kcal/kg FFM/day, unclipped, with the
 *    status its inputs allow: unlogged intake is unknown (never zero), a partial day is a lower bound, an unknown session
 *    cost is unknown, a model fat-free mass makes it a scenario and an invalid FFM is unavailable (never 1 kg). Policy
 *    reference values (45/30/15) belong to the shared safety contract, not to this reader.
 */
import { calibrateHungerPairs, type HungerCalibration as EngineHungerCalibration, type HungerCalibrationOptions } from '@/engine/model/appetite/ratingCalibration';
import { statusValue, type ChannelCoverage, type StatusValue } from '@/lib/bodyContracts';
import { daysBetween } from './dates';
import type { ObservedWellbeing } from './loggedDay';
import type { LocalDate, WellbeingConcern } from './types';

/** Window the concern summary looks back over, days (a display window, not a clinical duration criterion). */
export const WELLBEING_WINDOW_D = 14;

export interface WellbeingConcernSummary {
  concern: WellbeingConcern;
  /** Distinct days in the window the person flagged it. */
  days: number;
  lastDate: LocalDate;
  /** Flagged on more than one day, or flagged as persistent by the person. */
  persistent: boolean;
}

export interface WellbeingSummary {
  /** `review` when any concern was flagged in the window; `noFlag` when ratings were logged without one; `unknown` otherwise. */
  status: 'review' | 'noFlag' | 'unknown';
  concerns: WellbeingConcernSummary[];
  /** The latest entered rating of each scale in the window, with its date (unrated scales are absent, never zero). */
  latest: Partial<Record<'hunger' | 'fullness' | 'craving' | 'mood' | 'energy' | 'fatigue' | 'restfulness', { value: number; date: LocalDate }>>;
  daysRated: number;
}

/** Summary of the person's entered wellbeing over the `windowDays` days ending `asOf` (inclusive). */
export function wellbeingSummary(days: ReadonlyArray<{ date: LocalDate; observed: ObservedWellbeing | null }>, asOf: LocalDate, windowDays: number = WELLBEING_WINDOW_D): WellbeingSummary {
  const inWindow = days.filter((d) => d.observed && daysBetween(d.date, asOf) >= 0 && daysBetween(d.date, asOf) < windowDays).sort((a, b) => (a.date < b.date ? -1 : 1));
  const byConcern = new Map<WellbeingConcern, Set<LocalDate>>();
  const latest: WellbeingSummary['latest'] = {};
  for (const d of inWindow) {
    const o = d.observed!;
    for (const c of o.concerns) byConcern.set(c, (byConcern.get(c) ?? new Set()).add(d.date));
    for (const k of ['hunger', 'fullness', 'craving', 'mood', 'energy', 'fatigue', 'restfulness'] as const) if (o[k] !== undefined) latest[k] = { value: o[k]!, date: d.date };
  }
  const concerns: WellbeingConcernSummary[] = [...byConcern.entries()]
    .map(([concern, dates]) => {
      const sorted = [...dates].sort();
      return { concern, days: sorted.length, lastDate: sorted[sorted.length - 1]!, persistent: sorted.length > 1 || concern === 'persistentFatigue' };
    })
    .sort((a, b) => (a.concern < b.concern ? -1 : 1));
  return { status: concerns.length > 0 ? 'review' : inWindow.length > 0 ? 'noFlag' : 'unknown', concerns, latest, daysRated: inWindow.length };
}

// ------------------------------------------------------------------------------------------- hunger calibration (D2-06)
export interface HungerPair {
  day: number;
  /** Entered hunger 0–10. */
  rating: number;
  /** The model's hunger index on that day (uncalibrated burden index). */
  index: number;
  ratedAtClockH?: number;
}

/**
 * The living read of the ONE shared hunger-rating calibration provider (`calibrateHungerPairs`, engine appetite module,
 * versioned): the provider's result unchanged, plus the living field names (`ratedAtHour` = the clock bucket it applies
 * to, `train`/`heldOut` = ratings never / ever predicted out of sample). `calibrated` only for an informative fit (held-out
 * error below the personal-mean baseline on strictly later whole days); `notInformative` keeps the person's mean rating as
 * its own labelled estimate (`baselineMean`); untimed ratings never form a bucket.
 */
export type HungerCalibration = EngineHungerCalibration & {
  ratedAtHour: number | null;
  train: number;
  heldOut: number;
};

/** Personal calibration of the hunger index against the person's own fixed-time ratings (D2-06): the shared provider. */
export function calibrateHunger(pairs: readonly HungerPair[], opts: HungerCalibrationOptions = {}): HungerCalibration {
  const c = calibrateHungerPairs(pairs.map((p) => ({ day: p.day, rating: p.rating, index: p.index, ratedAtClockH: p.ratedAtClockH ?? null })), opts);
  return { ...c, ratedAtHour: c.clockH, train: Math.max(0, c.n - c.nHeldOut), heldOut: c.nHeldOut };
}

// ------------------------------------------------------------------------------------------- energy availability (D8-04)
export interface EnergyAvailabilityInput {
  /** Observed intake ME of the day, kcal (null = not observed). */
  intakeKcal: number | null;
  /** Day energy coverage (C1): only complete/confirmedZero give a value; partial gives a lower bound. */
  intakeCoverage: ChannelCoverage;
  /**
   * Net-above-rest energy of the day's intentional sessions, kcal: the day's COMPLETE session expenditure (complete or
   * confirmed-zero exercise coverage with every logged cost stated), else null. Never a zero for "nothing logged".
   */
  netSessionKcal: number | null;
  /** Exercise channel coverage (C1); absent = legacy callers (complete when `netSessionKcal` is a number). */
  exerciseCoverage?: ChannelCoverage;
  /** Known sum of the logged finite session costs, kcal (a lower bound of the day's expenditure); absent = 0. */
  knownSessionKcal?: number;
  /** Fat-free mass, kg, and where it came from (a measured operator vs the model's lean tissue). */
  ffmKg: number | null;
  ffmBasis: 'measured' | 'model' | 'unknown';
}

export interface EnergyAvailabilityRead {
  ea: StatusValue;
  /** Partial intake with COMPLETE exercise: the known part's EA, a lower bound (more intake can only raise it). */
  lowerBound?: number;
  /**
   * Complete intake with incomplete exercise: the EA if no exercise beyond the logged costs happened (the named
   * no-extra-exercise scenario). Unlogged exercise can only lower EA, so this is an upper bound, never the observed value.
   */
  upperBound?: number;
}

/**
 * Raw daily energy availability EA = (EI_ME − EEE_netAboveRest) / FFM, kcal/kg FFM/day, unclipped, with the status its
 * inputs allow (see the module comment): a single value only when intake AND exercise are complete (or confirmed zero);
 * partial intake gives a lower bound only when exercise is complete; complete intake with unknown or partial exercise gives
 * the no-extra-exercise upper bound; when both channels are partial no one-sided bound is claimed.
 */
export function rawEnergyAvailability(i: EnergyAvailabilityInput): EnergyAvailabilityRead {
  const unit = 'kcal/kg FFM/day';
  const detailsRef = 'energy-availability';
  if (i.ffmKg === null || !Number.isFinite(i.ffmKg) || i.ffmKg <= 0 || i.ffmBasis === 'unknown') return { ea: statusValue({ status: 'unavailable', unit, reasonCode: 'ffmUnavailable', detailsRef }) };
  const exCoverage = i.exerciseCoverage ?? (i.netSessionKcal !== null ? 'complete' : 'unknown');
  const exerciseComplete = (exCoverage === 'complete' || exCoverage === 'confirmedZero') && i.netSessionKcal !== null && Number.isFinite(i.netSessionKcal);
  const known = i.intakeCoverage === 'confirmedZero' ? 0 : i.intakeKcal;
  if (known === null || !Number.isFinite(known)) return { ea: statusValue({ status: 'unknown', unit, reasonCode: 'intakeNotObserved', detailsRef }) };
  const intakeComplete = i.intakeCoverage === 'complete' || i.intakeCoverage === 'confirmedZero';
  if (!exerciseComplete) {
    const knownEee = i.knownSessionKcal !== undefined && Number.isFinite(i.knownSessionKcal) ? Math.max(0, i.knownSessionKcal) : 0;
    const reasonCode = i.exerciseCoverage === undefined ? 'sessionCostUnknown' : exCoverage === 'complete' ? 'sessionCostUnknown' : 'exerciseIncomplete';
    return { ea: statusValue({ status: 'unknown', unit, reasonCode, detailsRef }), ...(intakeComplete ? { upperBound: (known - knownEee) / i.ffmKg } : {}) };
  }
  const ea = (known - i.netSessionKcal!) / i.ffmKg;
  if (i.intakeCoverage === 'partial') return { ea: statusValue({ status: 'partial', unit, reasonCode: 'intakeLowerBoundOnly', detailsRef }), lowerBound: ea };
  if (!intakeComplete) return { ea: statusValue({ status: 'unknown', unit, reasonCode: 'intakeNotObserved', detailsRef }) };
  return { ea: statusValue({ status: i.ffmBasis === 'measured' ? 'estimated' : 'scenario', value: ea, unit, reasonCode: i.ffmBasis === 'measured' ? 'measuredFfm' : 'modelFfm', detailsRef }) };
}
