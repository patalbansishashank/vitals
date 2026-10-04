/**
 * The person's supplements: taking vs on hand, dose rows, migration, planner and Coach mapping (SUITE_SPEC §13.2).
 * Pure (tier P).
 */
export * from './types';
export { toSectionV2, rowsFromV1Taking, timeOfDayOfClock, CLOCK_OF_TIME, sameRow } from './migrate';
export { supplementRecord, baseUnit, doseUnits, defaultDose, catalogueDoseLine, convertDose, validateDose, dailyAmount, FREE_TEXT_UNITS, type DoseIssue } from './dose';
export { newRow, setRowState, setRowDose, toggleTime, setTimes, upsertRow, removeRow, emptySection, presetState, rowsIn } from './state';
export { supplementPlannerInputs, suggestible, SUPPLEMENT_LEVERS, type SupplementLever, type SupplementPlannerInputs } from './planner';
export { supplementBriefing, supplementShortName, doseText, type SupplementBriefing } from './briefing';
export { supplementGrade } from './grade';
