/**
 * Living-plan assimilation (engine-pure): trend filter, balance correction, realised schedule, replay with anchors and
 * the correction, weekly check-in producing a confirmed day-stamped snapshot. docs/SUITE_SPEC.md §3.5,
 * docs/LIVING_PLAN.md; reviewed 2026-10-18 (C4, D5-03, D5-04, D5-07, D6-06). The blood-ketone observation model and its
 * personal concentration correction (D2-08) live with the ketone model (`model/ketones/observation.ts`).
 */
export {
  ASSIMILATION_PARAMS, ASSIMILATION_DEFAULTS, assimilationParams, assimilationParamsHash, estimatorIdentity, ESTIMATOR_STRATEGY, ESTIMATOR_VERSION, CORRECTION_STEP_PERIOD_DAYS,
  type AssimilationParams, type EstimatorIdentity,
} from './params';
export {
  runTrendFilter, smoothTrend, estimateDowOffsets, ewmaDisplay, mergeSameDay, countWeighIns, weighInContext, relativeObservationSd,
  observationVarianceKg2, boundedTransientSdKg,
  type WeighInObs, type TrendPoint, type TrendPrior, type TrendResult, type TrendFilterOptions, type TrendMeta,
} from './trendFilter';
export {
  estimateEnergyBias, mixDensity, mixDensityInfo, linearBalanceMeasurement, fitReplayResidual, fixedPriorPosterior, boundCorrection, weightedSlope,
  type EnergyBiasInput, type EnergyBiasEstimate, type BiasWindowPoint, type BalanceMeasurement,
} from './energyBias';
export { buildRealisedSchedule, type RealisedDay, type RealisedScheduleInput } from './realised';
export { runReplay, snapshotTissueKg, snapshotFatKg, REPLAY_SERIES, type ReplayInput, type ReplayOutput } from './replay';
export {
  runCheckIn, compositionTarget, offsetInForce,
  type CheckInInput, type CheckInOutput, type CheckInVerdict, type CompositionReadings, type CompositionReading, type CompositionUpdate,
  type CompositionSkipReason, type CompositionTargetInput, type CorrectionEntry, type IntakeDayEvidence, type IntakeEvidenceSummary,
} from './checkIn';
export { reanchorSnapshot, DEFAULT_ANCHOR_CONSTANTS } from './reanchor';
export {
  applyTissueAnchor, leanMassShare, intakeOffsetArray, offsetDayIntake, offsetAppliedOn, offsetLedger, anchorVatKg, CORRECTION_MECHANISM, CORRECTION_LAW_VERSION,
  type AnchorBusView, type AnchorConstants,
} from './runHooks';
