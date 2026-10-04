/**
 * The single command registry (SUITE_SPEC §1.2): `defineCommand()` returns the definition unchanged and registers it
 * at module load. Ids are unique; redefining one (HMR) replaces it.
 */
import type { TSchema } from './schema';
import type { CommandDef, CommandError, CommandId } from './types';

const registry = new Map<CommandId, CommandDef>();

export function defineCommand<I extends TSchema, O extends TSchema>(def: CommandDef<I, O>): CommandDef<I, O> {
  if (def.perm === 'write' && !def.impact) throw new Error(`${def.id}: write commands declare an impact`);
  registry.set(def.id, def as unknown as CommandDef);
  return def;
}

export function getCommand(id: string): CommandDef | undefined {
  return registry.get(id as CommandId);
}

/** Every registered command, sorted by id. */
export function allCommands(): CommandDef[] {
  return Array.from(registry.values()).sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const commandRegistry: ReadonlyMap<CommandId, CommandDef> = registry;

/** Throw from an executor to return a typed error (`{ ok: false, error }`). */
export class CommandFailure extends Error {
  constructor(readonly error: CommandError) {
    super(error.message);
    this.name = 'CommandFailure';
  }
}

export function fail(code: CommandError['code'], message: string, detail?: CommandError['detail']): never {
  throw new CommandFailure({ code, message, ...(detail ? { detail } : {}) });
}

/** Executor of a stub command: the id and schemas are fixed; the owner fills in the behaviour. */
export function notImplemented(owner: string): () => never {
  return () => fail('precondition_failed', "This isn't available in this version of Vitals yet.", { precondition: 'implemented', owner, retryable: false });
}
