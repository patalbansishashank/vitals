/**
 * Stub detection (WP-V), PER MODULE. A module counts as a STUB when it declares no parameters: MODEL_SPEC §0.4 makes every
 * physiological constant a `ParamDef`, and every stub in `src/engine/model/<module>/index.ts` has `params: []`. The check is
 * evaluated on the live registry every time, so a module flips from stub to real the moment its folder is implemented.
 *
 * Gating policy: a scenario gates (its `[M]` assertions run and can fail CI) once every module in its `requires` list is
 * implemented (`scenarioReady`); until then its assertions are SKIPPED (`it.skipIf`) but the scenario still runs and still
 * appears in the printed table. Invariants that do not depend on physiology (identities, determinism, flux agreement) never wait.
 *
 * Environment override ENGINE_VALIDATION (read without Node typings; the app tsconfig does not load @types/node):
 *   complete  gate only when ALL sixteen modules are implemented (whole-engine acceptance)
 *   force     treat every module as implemented (gating assertions run for real; expect failures)
 *   skip      treat every module as a stub (report only)
 */
import { MODULES } from '../../core/moduleRegistry';
import type { AnyEngineModule } from '../../types/module';
import type { ModuleId } from '../../types/signals';

/** True when the module has not been implemented yet (declares no `ParamDef`). */
export function isStubModule(m: AnyEngineModule): boolean {
  return m.params.length === 0;
}

/** Ids of all stub modules in the registry order. */
export function stubModules(modules: readonly AnyEngineModule[] = MODULES): ModuleId[] {
  return modules.filter(isStubModule).map((m) => m.id);
}

/** Module ids in registry order. */
export const ALL_MODULES: readonly ModuleId[] = MODULES.map((m) => m.id);

/**
 * Module sets a scenario needs before its assertions are meaningful.
 *  CORE      — energy balance, tissue partition, glycogen/water and scale weight (BWP-comparable physics)
 *  FASTING   — CORE + the zero-intake regime, ketones and the hormones that read them
 *  TRAINING  — CORE + resistance-training accretion/retention
 *  FULL      — every module (cross-module targets: appetite, cardiometabolic, wellbeing, safety, cellular)
 */
export const REQUIRES = {
  CORE: ['moderators', 'activity', 'intake', 'energy', 'fuel', 'composition', 'water'],
  FASTING: ['moderators', 'activity', 'intake', 'energy', 'fuel', 'composition', 'water', 'fasting', 'ketones', 'hormones'],
  TRAINING: ['moderators', 'activity', 'intake', 'energy', 'fuel', 'composition', 'water', 'muscle'],
  FULL: ALL_MODULES,
} as const satisfies Record<string, readonly ModuleId[]>;

export type RequiresKey = keyof typeof REQUIRES;

export type ValidationMode = 'per-module' | 'complete' | 'force' | 'skip';

/** Reads ENGINE_VALIDATION (see the file header). */
export function validationMode(): ValidationMode {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const v = g.process?.env?.ENGINE_VALIDATION;
  return v === 'complete' || v === 'force' || v === 'skip' ? v : 'per-module';
}

/** Stub modules among `required` (all modules when omitted). */
export function missingModules(required: readonly ModuleId[] = ALL_MODULES, modules: readonly AnyEngineModule[] = MODULES): ModuleId[] {
  const stubs = new Set(stubModules(modules));
  return required.filter((id) => stubs.has(id));
}

/** True when every one of the sixteen modules is implemented (honours ENGINE_VALIDATION=force|skip). */
export function engineIsComplete(modules: readonly AnyEngineModule[] = MODULES): boolean {
  const mode = validationMode();
  if (mode === 'force') return true;
  if (mode === 'skip') return false;
  return stubModules(modules).length === 0;
}

/**
 * True when a scenario that needs `required` may gate: each of those modules is implemented (per-module, the default), or
 * the whole engine is (ENGINE_VALIDATION=complete). Drives `it.skipIf(!scenarioReady(sc.requires))`.
 */
export function scenarioReady(required: readonly ModuleId[], modules: readonly AnyEngineModule[] = MODULES): boolean {
  const mode = validationMode();
  if (mode === 'force') return true;
  if (mode === 'skip') return false;
  if (mode === 'complete') return stubModules(modules).length === 0;
  return missingModules(required, modules).length === 0;
}

/** One-line human summary for report headers. */
export function readinessSummary(modules: readonly AnyEngineModule[] = MODULES): string {
  const stubs = stubModules(modules);
  const mode = validationMode();
  const head = stubs.length === 0 ? 'engine complete: all 16 modules implemented' : `engine INCOMPLETE: ${stubs.length} stub module(s): ${stubs.join(', ')}`;
  return mode === 'per-module' ? head : `${head} [ENGINE_VALIDATION=${mode}]`;
}
