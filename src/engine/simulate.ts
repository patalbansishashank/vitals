/**
 * Forward-simulation entry points (docs/MODEL_SPEC.md §3, §8). The loop lives in core/loop.ts.
 */
export { simulate, simulateEnsemble, runEngine } from './core/loop';
export { compileSchedule } from './core/compileSchedule';
export { resolveProfile } from './core/resolveProfile';
