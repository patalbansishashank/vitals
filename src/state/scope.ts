/**
 * Write scopes and the strict-store guard (SUITE_SPEC §1.1 items 1 and 4).
 *
 * The Zustand stores are projections of the document store. Their persisted fields may change only inside a write
 * scope: a command executing (opened by the dispatcher), a merged remote change (`sync`), the one-time migration,
 * a derive/job writer, hydration from storage, or the rollback of a commit that failed. Anything else is a write outside a command: in dev and test it throws
 * `WriteOutsideCommand` (so an un-migrated control fails its own screen test); in production it is logged and still
 * applied (the user must never lose an edit to a guard).
 *
 * Ephemeral fields (simulation results, planner run progress, undo history, clipboard) are not user data and are not
 * guarded.
 */
import { defaultStrictMode, WriteOutsideCommand, type CollectionId, type WriteToken } from '@/store';

/**
 * Who is writing. `hydrate` and `dryRun` never reach the document store; neither does `rollback` (a failed commit puts the
 * projections back to what the documents still hold: the boot cache is rewritten, no document op is produced).
 */
export type ScopeKind = 'command' | 'sync' | 'migration' | 'derive' | 'hydrate' | 'dryRun' | 'system' | 'rollback';

export interface DocOpRecord {
  col: CollectionId;
  id: string;
  /** Body before (null = did not exist) and after (null = removed). For shared docs only the binding's fields. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Shared document (uiPrefs): only these fields belong to the writer. */
  fields?: readonly string[];
  /** Binding key that produced the op (projection writes) or undefined (direct Tx writes). */
  binding?: string;
  /** Direct transaction writes: `append` for append-only/immutable collections, `patch` for field patches. */
  kind?: 'put' | 'patch' | 'append' | 'remove';
}

export interface WriteScope {
  kind: ScopeKind;
  token?: WriteToken;
  changeSetId?: string;
  commandId?: string;
  label?: string;
  /** Document ops produced by projection writes inside this scope (collected by the bridge). */
  ops: DocOpRecord[];
}

let current: WriteScope | null = null;
export type GuardMode = 'strict' | 'log' | 'off';
let mode: GuardMode = defaultStrictMode() === 'strict' ? 'strict' : 'log';

export function currentScope(): WriteScope | null {
  return current;
}

export function createScope(kind: ScopeKind, init: Partial<Omit<WriteScope, 'kind' | 'ops'>> = {}): WriteScope {
  return { kind, ops: [], ...init };
}

/** Run `fn` inside `scope` (synchronous part; async executors re-enter with `ctx.write`). Nested scopes restore. */
export function runInScope<R>(scope: WriteScope, fn: () => R): R {
  const prev = current;
  current = scope;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/**
 * Test helpers and dev tools that seed or reset projections directly (`resetScheduleStore`, fixtures). The bridge
 * still writes the documents (with a migration token), so the store stays consistent with what tests set up.
 */
export function withSystemWrite<R>(fn: () => R, label = 'system'): R {
  return runInScope(createScope('system', { label }), fn);
}

/** Guard strictness: 'strict' throws, 'log' logs, 'off' (only for benchmarks). */
export function setGuardMode(next: GuardMode): GuardMode {
  const prev = mode;
  mode = next;
  return prev;
}
export function guardMode(): GuardMode {
  return mode;
}

/** Called by guarded stores before a persisted field changes. */
export function assertWritable(storeName: string, fields: readonly string[]): void {
  if (current || mode === 'off' || fields.length === 0) return;
  const err = new WriteOutsideCommand(`${storeName}: "${fields.join('", "')}" changed outside a command`);
  if (mode === 'strict') throw err;
  console.error(err);
}
