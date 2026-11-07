/**
 * What an upload makes detection look at again (r065 autodetect CONTRACT §2: "queue affected range ±30 min"). Pure: the
 * ingest transaction (`../lumenStore.ts`) asks `touchOf` for each stored event, merges the ranges and queues them in the
 * same transaction; the background job (`./job.ts`) widens each by the context and runs detection off the request path.
 */
import { DETECT_HORIZON_MS } from '../lumenMigrate.ts';
import type { Span } from '../lumenMigrate.ts';

const MIN = 60_000;

/** The categories whose events are detection evidence. */
export const DETECT_CATEGORIES: ReadonlySet<string> = new Set([
  'activity/phone_steps', 'activity/buckets', 'phone/acquisition', 'phone/activity_transition', 'phone/activity_recognition_acquisition',
  'metrics/hr', 'sleep/timeline', 'activity/gps', 'activity/session', 'hc/record', 'hc/deleted',
]);
/** The Health Connect record types detection reads. */
export const DETECT_HC_TYPES: ReadonlySet<string> = new Set(['Steps', 'HeartRate', 'ExerciseSession', 'SleepSession']);

/** A deletion's target that can hide detection evidence: `*`, one of the categories, or a group of them. */
export function deletionTouches(category: string): boolean {
  return category === '*' || DETECT_CATEGORIES.has(category) || [...DETECT_CATEGORIES].some((c) => c.startsWith(`${category}/`));
}

export type Touch = readonly [number, number] | { hcSubject: string } | null;

/**
 * The range one stored event touches: its span (a point gets its minute), a heart-rate reading's minute, a deletion's
 * target range (the whole horizon when it has none), or for a Health Connect tombstone the record it retracts (the
 * caller looks its span up).
 */
export function touchOf(e: { category: string; subject: string; observedMs: number; data: Record<string, unknown> }, span: Span | null, deletion: { category: string; from_ms: number | null; to_ms: number | null } | undefined, nowMs: number): Touch {
  if (deletion) {
    if (!deletionTouches(deletion.category)) return null;
    return deletion.from_ms !== null && deletion.to_ms !== null ? [deletion.from_ms, deletion.to_ms + MIN] : [nowMs - DETECT_HORIZON_MS, nowMs + MIN];
  }
  if (!DETECT_CATEGORIES.has(e.category)) return null;
  if (e.category === 'metrics/hr') return [e.observedMs, e.observedMs + MIN];
  if (e.category === 'hc/deleted') return DETECT_HC_TYPES.has(e.subject.split(':')[0]!) ? { hcSubject: e.subject } : null;
  if (e.category === 'hc/record' && !DETECT_HC_TYPES.has(String(e.data.record_type))) return null;
  if (!span) return [e.observedMs, e.observedMs + MIN];
  return [span.startMs, Math.max(span.endMs, span.startMs + MIN)];
}

/** Ranges sorted and merged (touching or at most `gapMs` apart), clipped to the detection horizon before `nowMs`. */
export function mergeRanges(ranges: ReadonlyArray<readonly [number, number]>, nowMs: number, gapMs = 30 * MIN): Array<[number, number]> {
  const lo = nowMs - DETECT_HORIZON_MS;
  const hi = nowMs + 24 * 60 * MIN;
  const xs = ranges.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)] as [number, number]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of xs) {
    const last = out.at(-1);
    if (last && a <= last[1] + gapMs) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
