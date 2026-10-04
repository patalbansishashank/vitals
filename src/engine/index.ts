export * from './types';
export { simulate, simulateEnsemble, runEngine, compileSchedule, resolveProfile } from './simulate';
/** "Training as usual" (DayTemplate.habitualTraining): the profile's habitual sessions by weekday, as the burn-in uses them. */
export { habitualSessionsFor, habitualWeekPrograms } from './core/compileSchedule';
export { plan } from './planner';
export type { PlanOption, PlanRequest } from './planner';
export { MODULES, MODULE_ORDER, checkWiring } from './core/moduleRegistry';
export { buildModelParams, sampleParams } from './core/paramsRegistry';
/** Input defaults and 09 §4.1 resistance-training presets (UI shows the engine's own default values). */
export { DEFAULTS, RT_PRESETS, RT_STYLE_MET } from './core/defaults';
