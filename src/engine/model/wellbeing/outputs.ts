/**
 * Output semantics of the wellbeing module (C6; D8-04, D8-05, D8-08, D8-09): status codes travel beside the finite numbers
 * the recorder needs, task/endpoint scopes are explicit, and research scenarios are never presented as personal forecasts.
 * Pure helpers for the core, adapters and tests; nothing here changes the simulation.
 */
import type { OutputStatus, UncertaintyKind } from '@/lib/bodyContracts';
import type { SeriesId } from '../../types/metrics';
import type { SeriesStatusMeta } from '../../types/result';
import type { WellbeingState } from './state';

/**
 * Status code of the raw daily EA exposure (state `eaRawStatus`): `unavailable` (no valid FFM denominator), `planned`
 * (a prescribed/scenario day), `logged` (intake and exercise covered by logs), `partial` (intake partly logged, or exercise
 * coverage missing), `asPlanned` (an as-planned replay estimate), `unknown` (intake not logged: never an observed zero).
 */
export const EA_STATUS = { unavailable: 0, planned: 1, logged: 2, partial: 3, asPlanned: 4, unknown: 5 } as const;
export type EaStatusName = keyof typeof EA_STATUS;

/**
 * Inline status of a raw EA code. A logged day is `estimated`, not `observed`: intake is observed, but the session EEE and
 * the FFM_act denominator are model quantities.
 */
export function eaStatusToOutput(code: number): OutputStatus {
  switch (code) {
    case EA_STATUS.planned:
      return 'scenario';
    case EA_STATUS.logged:
    case EA_STATUS.asPlanned:
      return 'estimated';
    case EA_STATUS.partial:
      return 'partial';
    case EA_STATUS.unknown:
      return 'unknown';
    default:
      return 'unavailable';
  }
}

/** Definition of the raw EA exposure (D8-04): numerator, denominator operator and unit, for the info sheet and hashes. */
export const EA_EXPOSURE_DEFINITION = {
  unit: 'kcal/kg FFM/d',
  numerator: 'reported metabolizable energy eaten (incl. carbohydrate during exercise, signed corrections) − net session EEE (session energy above own rest; steps, EPOC and lifestyle displacement excluded)',
  denominator: 'model FFM_act at the end of the day (Hall convention; not DXA fat-free mass)',
  clip: 'none (the bounded internal drive is a separate design operator)',
  invalidDenominator: 'unavailable (never replaced by 1 kg)',
  version: 1,
} as const;

/**
 * Raw daily EA, kcal/kg FFM/d, unclipped; null when the FFM denominator is not a valid positive mass or an input is not
 * finite (C6: unavailable, never a substituted denominator).
 */
export function rawEnergyAvailability(eiKcal: number, eeeNetKcal: number, ffmKg: number): number | null {
  if (!Number.isFinite(eiKcal) || !Number.isFinite(eeeNetKcal) || !Number.isFinite(ffmKg) || !(ffmKg > 0)) return null;
  return (eiKcal - eeeNetKcal) / ffmKg;
}

/**
 * Scope of the legacy endurance index (D8-09): Bergström's glycogen-limited cycling time to exhaustion near 75 % VO2max
 * (studied 71-82 %), driven by the daily-mean whole-muscle glycogen concentration, as % of the person's own baseline.
 * Not a race-time, time-trial, repeated-sprint or generic endurance prediction.
 */
export const ENDURANCE_INDEX_SCOPE = {
  task: 'cyclingTimeToExhaustion',
  modality: 'cycle',
  intensityFracVo2max: { reference: 0.75, studiedLow: 0.71, studiedHigh: 0.82 },
  outcome: 'timeToExhaustionRelativeToOwnBaseline',
  raceTimeConvertible: false,
  glycogenSource: 'dailyMeanWholeMuscleConcentration',
  status: 'exploratory',
  source: 'Bergström 1967 PMID 5584523 (n = 9); economy term Burke 2017/2021',
} as const;

export interface EnduranceTask {
  outcome: 'timeToExhaustion' | 'raceTime' | 'timeTrial' | 'repeatedSprint' | 'other';
  /** Fraction of VO2max of the task (unknown = undefined). */
  intensityFracVo2max?: number;
  modality?: 'cycle' | 'run' | 'walk' | 'swim' | 'row' | 'hiit' | 'other';
}

/**
 * Whether the exploratory index speaks to a task at all. Outside its scope the component is `unavailable` — no number,
 * neither a penalty nor an assurance of "no glycogen limitation" (local/repeated-work fuel limits stay unmodelled).
 */
export function enduranceTaskSupport(task: EnduranceTask): { status: 'exploratory' | 'unavailable'; reasonCode: string } {
  if (task.outcome !== 'timeToExhaustion') return { status: 'unavailable', reasonCode: 'outcomeNotTimeToExhaustion' };
  if (task.modality !== undefined && task.modality !== ENDURANCE_INDEX_SCOPE.modality) return { status: 'unavailable', reasonCode: 'modalityNotStudied' };
  const x = task.intensityFracVo2max;
  if (x === undefined || !Number.isFinite(x)) return { status: 'unavailable', reasonCode: 'intensityUnknown' };
  const s = ENDURANCE_INDEX_SCOPE.intensityFracVo2max;
  if (x < s.studiedLow || x > s.studiedHigh) return { status: 'unavailable', reasonCode: 'outsideStudiedIntensity' };
  return { status: 'exploratory', reasonCode: 'taskScopedResearchIndex' };
}

/** Scope of the legacy BMD research scenario (D8-05): no personal forecast, no optimiser or clearance role. */
export const BMD_RESEARCH_SCOPE = {
  status: 'exploratory',
  personalForecast: false,
  driver: 'persistent tissue loss (FM + FFM_act) as % of baseline weight; water, glycogen and gut content excluded',
  disabled: ['any-set resistance-training protection', 'calcium multiplier', 'automatic 240-day recovery on regain'],
  observation: 'site-specific DXA areal BMD g/cm² with date, device and the facility least significant change',
  source: 'Villareal 2006/2016; Zibellini 2015 (development studies, not independent validation)',
  /** No research prediction is enabled until independent site- and population-specific holdouts pass (none exist). */
  predictionsEnabled: false,
  validation: 'development studies only; independent site/population longitudinal holdouts required before enabling predictions',
} as const;

/** Per-series run status of the module's outputs (C6) from the final state; the core puts it on the recorder. */
export function wellbeingOutputStatus(s: Pick<WellbeingState, 'eaRawStatus'>): Partial<Record<SeriesId, SeriesStatusMeta>> {
  const ex = (reasonCode: string, uncertaintyKind: UncertaintyKind = 'heuristic'): SeriesStatusMeta => ({ status: 'exploratory', reasonCode, uncertaintyKind });
  const ea = eaStatusToOutput(s.eaRawStatus);
  return {
    energyAvailability: { status: ea, reasonCode: `eaExposure.${(Object.keys(EA_STATUS) as EaStatusName[]).find((k) => EA_STATUS[k] === s.eaRawStatus) ?? 'unavailable'}`, uncertaintyKind: ea === 'scenario' ? 'scenario' : 'none' },
    hipBmdChange: ex('researchScenarioNoPersonalForecast', 'scenario'),
    enduranceCapacity: ex('taskScopedTteResearchIndex', 'scenario'),
    micronutrientScore: ex('patternHeuristicNotIntake'),
    moodTier: ex('modelConcernFlagsNotObservedWellbeing'),
  };
}
