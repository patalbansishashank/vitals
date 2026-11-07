/**
 * Forward-simulation entry points (docs/MODEL_SPEC.md §3, §8). The loop lives in core/loop.ts.
 *
 * Contract helpers (2026-10-18): `initialStateFingerprint` binds a run's initial state/history for safety certificates
 * (D4-03); `resolvedDayExposure` is the final resolved per-day exposure with coverage for constraint validation (D4-01).
 */
export { simulate, simulateEnsemble, runEngine, initialStateFingerprint } from './core/loop';
export { compileSchedule, resolvedDayExposure } from './core/compileSchedule';
export { resolveProfile } from './core/resolveProfile';
