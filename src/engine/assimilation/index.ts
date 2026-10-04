/**
 * Living-plan assimilation (engine-pure): trend filter, energy-balance bias, realised schedule, replay with anchors and
 * intake offset, weekly check-in producing a confirmed day-stamped snapshot. docs/SUITE_SPEC.md §3.5, docs/LIVING_PLAN.md.
 */
export { ASSIMILATION_PARAMS, ASSIMILATION_DEFAULTS, assimilationParams, type AssimilationParams } from './params';
export {
  runTrendFilter, smoothTrend, estimateDowOffsets, ewmaDisplay, mergeSameDay, countWeighIns,
  type WeighInObs, type TrendPoint, type TrendPrior, type TrendResult, type TrendFilterOptions,
} from './trendFilter';
export { estimateEnergyBias, mixDensity, type EnergyBiasInput, type EnergyBiasEstimate, type BiasWindowPoint } from './energyBias';
export { buildRealisedSchedule, type RealisedDay, type RealisedScheduleInput } from './realised';
export { runReplay, snapshotTissueKg, snapshotFatKg, REPLAY_SERIES, type ReplayInput, type ReplayOutput } from './replay';
export { runCheckIn, compositionTarget, type CheckInInput, type CheckInOutput, type CheckInVerdict, type CompositionReadings } from './checkIn';
export { reanchorSnapshot, DEFAULT_ANCHOR_CONSTANTS } from './reanchor';
export { applyTissueAnchor, leanMassShare, intakeOffsetArray, offsetDayIntake, type AnchorBusView, type AnchorConstants } from './runHooks';
