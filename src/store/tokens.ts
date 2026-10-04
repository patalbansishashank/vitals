/**
 * Write tokens (SUITE_SPEC §1.1, §2.4). Only four writers exist: commands (minted by the dispatcher per ChangeSet),
 * the sync engine, the one-time migration and derive jobs. A token is valid only if it was minted here and not revoked;
 * command tokens are revoked when their ChangeSet commits.
 */
import { WriteOutsideCommand, type Id, type WriteToken, type WriteTokenKind } from './types';

const live = new WeakSet<object>();

export function mintWriteToken(kind: WriteTokenKind, options: { changeSetId?: Id; label?: string } = {}): WriteToken {
  const token = Object.freeze({ kind, ...options }) as unknown as WriteToken;
  live.add(token);
  return token;
}

export function revokeWriteToken(token: WriteToken): void {
  live.delete(token);
}

export function isValidWriteToken(token: unknown): token is WriteToken {
  return typeof token === 'object' && token !== null && live.has(token);
}

/** 'strict' throws (dev, test); 'log' rejects and logs (production). */
export type StrictMode = 'strict' | 'log';

export function defaultStrictMode(): StrictMode {
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string; PROD?: boolean } }).env;
  if (!env) return 'strict';
  return env.PROD && env.MODE !== 'test' ? 'log' : 'strict';
}

export function rejectWrite(what: string, mode: StrictMode): never {
  const err = new WriteOutsideCommand(what);
  if (mode === 'log') console.error(err);
  throw err;
}
