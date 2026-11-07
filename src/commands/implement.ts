/**
 * Executors for commands whose ids and schemas another module declared as stubs (`./defs/_shared.ts` `stub()`):
 * `implement(id, execute)` replaces the stub's executor and clears its `notImplemented` marker, keeping the id, schemas,
 * permission, surfaces, undo and idempotency exactly as declared. Ids that are not registered are skipped (returns false).
 *
 * Domain executor modules (`./sync`, `./bio`, `./catalogue`, `./ai`) call this at module load; `./index.ts` imports them
 * after every `./defs/*` module. Heavy dependencies (Evolu, importers, the figure asset …) are imported lazily inside the
 * executors so the bus stays in the main chunk without them.
 */
import { defineCommand, getCommand } from './registry';
import type { CommandContext, CommandDef } from './types';

export type Executor<I = never> = (ctx: CommandContext, input: I) => unknown;

const implemented = new Map<string, string>();
/**
 * (0.6.5) Executors whose stub was not registered yet. Module evaluation order is the bundler's: a screen importing a
 * helper from an executor module (e.g. `commands/living/activity`) can evaluate it before `./defs/*` declared the stub.
 * The executor used to be dropped silently, so the stub kept answering "not available in this version" in the
 * production build (Approve, Approve all, Log) while tests, which import `@/commands` first, passed.
 */
/** What an implementing module adds to the stub's definition when it installs (living writes add `serial`). */
export type DefPatch = (def: CommandDef) => Partial<CommandDef>;

const pending = new Map<string, { execute: Executor<never>; by: string; patch?: DefPatch }>();

function install(def: CommandDef, execute: Executor<never>, by: string, patch?: DefPatch): void {
  const { notImplemented: _stub, ...rest } = def;
  void _stub;
  defineCommand({
    ...rest,
    ...(patch ? patch(def) : {}),
    execute: execute as unknown as CommandDef['execute'],
  } as CommandDef);
  implemented.set(def.id, by);
}

/**
 * Replace a stub's executor. `by` names the implementing module (reported by `implementedBy`). When the id is not
 * registered yet the executor waits and is installed the moment its stub is declared (`applyPendingImplementation`);
 * returns whether it was installed now.
 */
export function implement<I = never>(id: string, execute: Executor<I>, by = 'I1', patch?: DefPatch): boolean {
  const def = getCommand(id);
  if (!def) {
    pending.set(id, { execute: execute as Executor<never>, by, ...(patch ? { patch } : {}) });
    return false;
  }
  install(def, execute as Executor<never>, by, patch);
  return true;
}

/** Called by `stub()` after it declares an id: installs an executor that arrived first. */
export function applyPendingImplementation(id: string): void {
  const p = pending.get(id);
  const def = getCommand(id);
  if (!p || !def) return;
  pending.delete(id);
  install(def, p.execute, p.by, p.patch);
}

/** Ids implemented before their stub that are still waiting (tests: should be empty once `@/commands` loaded). */
export function pendingImplementations(): readonly string[] {
  return [...pending.keys()];
}

/** Ids whose stub executor a domain module replaced, with the implementing module (tests, `app.status`). */
export function implementedBy(): ReadonlyMap<string, string> {
  return implemented;
}
