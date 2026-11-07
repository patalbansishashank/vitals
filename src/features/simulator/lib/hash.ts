/**
 * Stable input hash for results caching and staleness: profile + schedule → 8 hex chars (FNV-1a over a
 * key-sorted JSON). Same inputs → same hash, independent of property order.
 *
 * C7 (2026-10-18): the hash also covers the engine version and the contract fingerprint (which versions the draw /
 * uncertainty semantics, D8-02), so a result computed under other engine semantics is never taken as current for the same
 * inputs. Only light constants are read here (this file is reachable from the stores); the parameter registry hash moves
 * with the engine version.
 */
import { fnv1a } from '@/engine/core/math';
import { ENGINE_VERSION } from '@/engine/core/defaults';
import { CONTRACT_FINGERPRINT } from '@/lib/bodyContracts';

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

export function stableStringify(v: unknown): string {
  return stable(v);
}

/** The engine semantics a result depends on beyond its inputs (C7): engine version and contract fingerprint. */
export function engineSemanticsKey(): string {
  return `${ENGINE_VERSION}|${CONTRACT_FINGERPRINT}`;
}

export function inputsHash(profile: unknown, schedule: unknown): string {
  return fnv1a(`${engineSemanticsKey()}|${stable(profile)}|${stable(schedule)}`);
}
