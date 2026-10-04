/**
 * Planner domain layer (MODEL_SPEC §10; WP-P). See README.md in this folder for the public API.
 */
export * from './types';
export { runDomainPlanner, ablationsFor, isGoalMetric, keepTolerance, skeletonFasts, fastPhrase, equalEnergyFastTwins, type PlannerOptions } from './planner';
export { estimateTargets, targetReach, fastestSafeRoute, beyondSafetyLimits, routeKind, clearReachCache, ROUTE_MAX_WEEKS, type SafeRoute } from './reach';
export { EvaluatorHost, buildVariant, variantKey, type EvalVariant, type HostInit, type VariantProblem } from './evaluatorHost';
export { compileRequest, withHorizon, fastingGate, FASTING_SERVED, HORIZON_MIN_DAYS, HORIZON_MAX_DAYS, MAX_GOALS, HUNGER_TOLERANCE, type FastingGate, type PlanningContext, type ResolvedGoal } from './context';
export { fastingKind, usesFast, longestFastH } from './fastMath';
export { rivalVerdict, fastingVerdict, FAST_COMPARE, type RivalPlan, type OptionSide } from './fastingExplain';
export { compileSafetyCaps, fastAllowed, tierForHours, HC, type SafetyCaps, type FastTier } from './safety';
export { BLOCKS, BLOCK_IDS, PHASE_BLOCKS, SEQUENCING, LIBRARY_VERSION, type BlockDef, type BlockId, type SafetyTier } from './registry/blocks';
export { LEVERS, LEVER_INDEX, SCHEDULE_FIELDS, checkLeverRegistry, lever, type LeverDef, type LeverConstraint, type ParamSpec } from './registry/levers';
export { enumerateStructures, makeStructure, transferGenome, mutateStructure, OVERLAY_HOSTS, type SkeletonStructure, type PlanSkeleton, type GeneSpec } from './skeleton';
export { decodePlan, baselineSchedule, encodeValues, roundGenome, gridStep, plannedKcal, type DecodedPlan, type DecodedPhase, type Lifestyle } from './decode';
export { repairSchedule, zeroSpans } from './repair';
export { validatePlan, type ValidationResult } from './validate';
export { EnginePlanModel, MARGIN_IDS, EA_FLOOR, eaFloorMargin, stateMargins, regulariserOf, type MarginId } from './model';
export { buildGoals, goalEligibleMetrics, goalSeries, goalValue, type GoalBinding, type BuiltGoals } from './goalSpecs';
export { descriptors, features, complexityCounts, FEATURE_SCHEMA } from './features';
export { stubModules, physiologyReady } from './physiology';
export { ruleText, RULE_TEXT } from './explain';
export * from './replanTypes';
export { replan, toActivePlan, toActivePlanFromScenario, anchorToStart, freezeTargets, futureSpacingViolation, loadChange, churnDistance, ReplanEvaluatorHost, REPLAN, type ReplanOptions, type ReplanEvalInit, type ReplanProblemSpec } from './replan';
export { computePlanSensitivities, benefitRetained, projectRealistic, realisticSchedule, expectedCredit, floorWeights, ForwardModel, ADHERENCE_PRIOR, ITEM_WEIGHT_FLOOR, type RealisticProjection, type SensitivityOptions } from './sensitivities';
export { equipmentEnvelope, equipmentFor, equipmentSetsCap, equipmentRegionCap, equipmentHeavyOk, purchaseBurden, toShoppingItemV2, PURCHASE_BURDEN_PER_ITEM, type EquipmentBounds, type EquipmentForOptions, type EquipmentForResult, type GoalDeltaFn } from './equipment';
