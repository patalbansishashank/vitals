/**
 * Stub-aware test helpers: assertions that need real physiology run only when the listed modules are implemented
 * (they declare ParamDefs); otherwise they are skipped with the reason in the test name.
 */
import { it } from 'vitest';
import type { ModuleId } from '../../../types/signals';
import { physiologyReady, stubModules } from '../physiology';

export function itPhysio(modules: readonly ModuleId[]) {
  const ready = physiologyReady(modules);
  const missing = modules.filter((m) => stubModules().includes(m));
  return (name: string, fn: () => unknown, timeout?: number) =>
    ready ? it(name, fn, timeout) : it.skip(`${name} [needs real physiology: ${missing.join(', ')}]`, fn, timeout);
}
