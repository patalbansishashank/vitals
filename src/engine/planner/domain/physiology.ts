/**
 * Stub detection. The physiology modules are implemented in parallel; until a module lands it runs as a stub with no
 * `ParamDef`s (MODEL_SPEC §11.3: every implemented module declares its constants). Planner results and end-to-end
 * tests use this to flag outputs that are placeholders.
 */
import { MODULES } from '../../core/moduleRegistry';
import type { AnyEngineModule } from '../../types/module';
import type { ModuleId } from '../../types/signals';

/** Module ids that still run as stubs (no parameters declared). */
export function stubModules(modules: readonly AnyEngineModule[] = MODULES): ModuleId[] {
  return modules.filter((m) => m.params.length === 0).map((m) => m.id);
}

/** True when every listed module is implemented (has parameters). */
export function physiologyReady(ids: readonly ModuleId[], modules: readonly AnyEngineModule[] = MODULES): boolean {
  const stubs = new Set(stubModules(modules));
  return ids.every((id) => !stubs.has(id));
}
