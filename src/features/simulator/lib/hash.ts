/**
 * Stable input hash for results caching and staleness: profile + schedule → 8 hex chars (FNV-1a over a
 * key-sorted JSON). Same inputs → same hash, independent of property order.
 */
import { fnv1a } from '@/engine/core/math';

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

export function inputsHash(profile: unknown, schedule: unknown): string {
  return fnv1a(`${stable(profile)}|${stable(schedule)}`);
}
