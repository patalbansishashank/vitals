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

/** Replace a stub's executor. `by` names the implementing module (reported by `implementedBy`). */
export function implement<I = never>(id: string, execute: Executor<I>, by = 'I1'): boolean {
  const def = getCommand(id);
  if (!def) return false;
  const { notImplemented: _stub, ...rest } = def;
  void _stub;
  defineCommand({ ...rest, execute: execute as unknown as CommandDef['execute'] } as CommandDef);
  implemented.set(id, by);
  return true;
}

/** Ids whose stub executor a domain module replaced, with the implementing module (tests, `app.status`). */
export function implementedBy(): ReadonlyMap<string, string> {
  return implemented;
}
