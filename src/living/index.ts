/**
 * The living plan (pure domain; docs/LIVING_PLAN.md, docs/SUITE_SPEC.md §3): lifecycle, calendar anchoring, prescription
 * freezing, daily log → LoggedDay, adherence score and trend, revealed adherence, drift, the Today contract, re-plan
 * triggers and requests, plan start, and the estimation loop over `@/engine/assimilation`. No React, no store, no clock:
 * E4's commands call these functions with documents and a clock/id port.
 */
export * from './types';
export * from './plannerContract';
export * from './dates';
export * from './calendar';
export * from './lifecycle';
export * from './prescription';
export * from './logs';
export * from './equivalence';
export * from './adherence';
export * from './occurrence';
export * from './fastIntervals';
export * from './loggedDay';
export * from './realisedHistory';
export * from './lifecycleSafety';
export * from './drift';
export * from './today';
export * from './replan';
export * from './edits';
export * from './start';
export * from './assimilate';
export * from './checkInLoop';
export * from './monitoring';
export * from './energyAvailability';
export * from './behaviorPaths';
export * from './projection';
export * from './gaugeImport';
export * from './todayReplay';
