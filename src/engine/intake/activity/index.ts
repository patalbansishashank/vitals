/**
 * Activity intake (plan/01-after-launch item 1, research R1; MODEL_SPEC §5.5): "what does a normal day look like" answers →
 * habitual steps, occupational/home/commute/recreational energy inside NEAT0, the baseline maintenance TDEE0 with its
 * drivers and its p10/p90 band. Pure functions; `core/resolveProfile` calls them once per profile.
 */
export { ACTIVITY_INTAKE_PARAMS, ACTIVITY_INTAKE_K, activityIntakeConstants, type ActivityIntakeK } from './params';
export { Z80, activityTerms, activityNumerator, assembleActivity, cappedNumerator, neatLevelOf, occupationPrior, resolveActivity, type ActivityTerms } from './resolveActivity';
