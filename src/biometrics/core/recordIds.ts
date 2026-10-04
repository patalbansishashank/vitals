/**
 * Content-derived record ids for Lumen Health data (SUITE_SPEC §14.5 "Record ids for per-message ingest"; R16 §3 G1, G2).
 * One rule for every way the same data can arrive: the live MQTT stream (`mqtt:lumen`), a CloudEvents dump
 * (`file:lumen_cloudevents`) and Lumen's own Export All Data archive (`file:lumen_archive`). The ids never depend on the
 * channel, the envelope id or batch boundaries, so a history import followed by the live stream stores each record once.
 *
 * Every id is `recordId({ source: LUMEN_SOURCE, kind, metric, start })` (`./hash.ts`). The source string is the
 * CloudEvents file key, so ids of Lumen data imported before the live stream existed stay the same.
 * - series: kind 'series', metric `<stream>|<origin>`, start local_date — one record per day window, samples merge by
 *   (origin, t);
 * - sleep:  kind 'sleep', metric 'session', start = session start — provisional and complete nights are versions of
 *   one record;
 * - daily:  kind 'daily', metric, start local_date;
 * - workout: kind 'workout', metric 'session', start.
 *
 * Tier P: pure, no clock. Used by the CloudEvents importer (file and broker ingest) and the archive importer.
 */
import { recordId } from './hash';
import type { BioStream, LocalDate } from './types';

/** The source part of every Lumen Health id (one value whatever the channel the data came through). */
export const LUMEN_SOURCE = 'file:lumen_cloudevents';

/** Sample origin as the record ids see it. */
export type IdOrigin = 'history' | 'live' | 'spot' | 'workout_stream' | 'import';

export function seriesRecordId(p: { source: string; stream: BioStream; origin: IdOrigin | string; localDate: LocalDate }): string {
  return recordId({ source: p.source, kind: 'series', metric: `${p.stream}|${p.origin}`, start: p.localDate });
}

/** `start` is the session start as an ISO instant in UTC (`2026-09-28T21:00:00.000Z`). */
export function sleepRecordId(p: { source: string; start: string }): string {
  return recordId({ source: p.source, kind: 'sleep', metric: 'session', start: p.start });
}

export function dailyRecordId(p: { source: string; metric: string; localDate: LocalDate }): string {
  return recordId({ source: p.source, kind: 'daily', metric: p.metric, start: p.localDate });
}

export function workoutRecordId(p: { source: string; start: string }): string {
  return recordId({ source: p.source, kind: 'workout', metric: 'session', start: p.start });
}

/** Added to a complete night's version: a complete night always wins over a provisional one, in any arrival order. */
export const SLEEP_COMPLETE = 2e12;

/**
 * R16 G2: a complete night supersedes every provisional one; later re-syncs supersede earlier ones. The ×100 leaves
 * room for `is_main` rewrites (+1) of the same delivery.
 */
export function sleepVersion(complete: boolean, receivedS: number): number {
  return (complete ? SLEEP_COMPLETE : 0) + Math.max(0, Math.round(receivedS)) * 100;
}
