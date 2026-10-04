/** Shared helpers for score functions (tier P). */
import { sha256Hex, stableStringify } from '../hash';
import type { ScoreContributor, ScoreInput, ScoreResult } from '../types';

export interface ResultParts {
  scope?: ScoreResult['scope'];
  status: ScoreResult['status'];
  value: number | null;
  state?: string;
  reason?: string;
  band?: ScoreResult['band'];
  confidence?: ScoreResult['confidence'];
  contributors?: ScoreContributor[];
  sourceIds?: string[];
  /** Anything that identifies the inputs used (record ids + versions, sample counts, values); hashed. */
  hashOf?: unknown;
  detail?: ScoreResult['detail'];
}

/** Builds a ScoreResult with the pinned clock and build from the input. */
export function makeResult(scoreId: string, version: string, input: ScoreInput, p: ResultParts): ScoreResult {
  const r: ScoreResult = {
    scoreId,
    version,
    scope: p.scope ?? { kind: 'day', localDate: input.localDate },
    status: p.status,
    value: p.status === 'withheld' || p.status === 'insufficient_baseline' ? (p.value ?? null) : p.value,
    confidence: p.confidence ?? 'low',
    contributors: p.contributors ?? [],
    inputsHash: sha256Hex(stableStringify({ scoreId, version, d: input.localDate, i: p.hashOf ?? null })).slice(0, 32),
    sourceIds: p.sourceIds ?? [],
    computedAt: input.computedAt,
    build: input.build,
  };
  if (p.state !== undefined) r.state = p.state;
  if (p.reason !== undefined) r.reason = p.reason;
  if (p.band !== undefined) r.band = p.band;
  if (p.detail !== undefined) r.detail = p.detail;
  return r;
}

/** A gate was not met: never fabricate a value. */
export function withheld(scoreId: string, version: string, input: ScoreInput, reason: string, scope?: ScoreResult['scope']): ScoreResult {
  return makeResult(scoreId, version, input, { status: 'withheld', value: null, reason, hashOf: reason, ...(scope ? { scope } : {}) });
}

/** Epoch ms of a LocalDate's midnight given a fixed UTC offset in seconds. */
export function localMidnightMs(localDate: string, tzOffsetS: number): number {
  return Date.parse(`${localDate}T00:00:00Z`) - tzOffsetS * 1000;
}

/** LocalDate arithmetic without a clock. */
export function addDays(localDate: string, n: number): string {
  const t = Date.parse(`${localDate}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : NaN;
}

/** Sample SD (n − 1). */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
