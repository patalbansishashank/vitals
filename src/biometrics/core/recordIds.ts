/**
 * Content-derived record ids (SUITE_SPEC §14.5 "Record ids for per-message ingest"; R16 §3 G1, G2). One rule for every
 * way the same data can arrive: a ring read over Bluetooth (`packages/rings/src/records.ts`), the live MQTT stream
 * (`mqtt:lumen`), a CloudEvents dump (`file:lumen_cloudevents`) and Lumen's own Export All Data archive
 * (`file:lumen_archive`). The ids never depend on the channel, the envelope id or batch boundaries, so a history import
 * followed by the live stream, or a ring read followed by Lumen's relay of the same night, stores each record once.
 *
 * Every id is `recordId({ source, kind, metric, start })` (`./hash.ts`), where `source` is the key the record is FILED
 * under: a ring's §15.2 key for its own reads and for Lumen data folded into it (`contentRecordId`), `LUMEN_SOURCE` for
 * Lumen data that has no ring (the CloudEvents file key, so ids of data imported before the live stream stay the same).
 * - series: kind 'series', metric `<stream>|<origin>`, start local_date — one record per day window, samples merge by
 *   (origin, t);
 * - sleep: kind 'sleep', metric 'session', start = session start — same-start reads are versions of one record;
 *   the read projection also supersedes contained provisional sessions when a fuller read changes the start;
 * - daily:  kind 'daily', metric ('activity', or the vendor opinion the record carries), start local_date;
 * - workout: kind 'workout', metric 'session', start.
 *
 * Tier P: pure, no clock. Used by the ring mapper, the CloudEvents importer (file and broker ingest), the archive
 * importer, the ingest fold and `biometrics.ringFold`.
 */
import { recordId } from './hash';
import type { BioRecord, BioStream, DailyRecord, LocalDate } from './types';

/** The source part of every Lumen Health id while the data has no ring to be filed under. */
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

/** The id metric of a daily record: the one vendor opinion it carries (Lumen's insights and VO2 estimates are records of
 * their own), else the day's activity. */
export function dailyMetricOf(r: DailyRecord): string {
  if (r.vendor?.sleep !== undefined) return 'insight:sleep_score';
  if (r.vendor?.recovery !== undefined) return 'insight:recovery_score';
  if (r.vo2max) return r.vo2max.method === 'derived' ? 'insight:vo2max_estimate' : 'vo2max';
  return 'activity';
}

/** The id of a record filed under `source`: what the record is and when, never which device or path read it. */
export function contentRecordId(r: BioRecord, source: string): string {
  switch (r.kind) {
    case 'series': {
      const origin = r.sampling.mode === 'spot' ? 'spot' : r.sampling.mode === 'continuous' ? (r.context === 'exercise' ? 'workout_stream' : 'live') : 'history';
      return seriesRecordId({ source, stream: r.metric, origin, localDate: r.time.local_date });
    }
    case 'sleep':
      return sleepRecordId({ source, start: r.time.start ?? r.time.local_date });
    case 'daily':
      return dailyRecordId({ source, metric: dailyMetricOf(r), localDate: r.time.local_date });
    case 'workout':
      return workoutRecordId({ source, start: r.time.start ?? r.time.local_date });
    default:
      return r.record_id;
  }
}

/** Added to a complete night's version: a complete night always wins over a provisional one, in any arrival order. */
export const SLEEP_COMPLETE = 2e12;

/**
 * R16 G2: a complete night supersedes every provisional one; later re-syncs supersede earlier ones. The ×100 leaves
 * room for `is_main` rewrites (+1) of the same delivery. Also the version of a ring's own day total read at `receivedS`:
 * it outranks a sum of activity buckets (version = steps) and Lumen's daily (version = its received time), whose other
 * fields readers merge in (`mergeDailyVersions`).
 */
export function sleepVersion(complete: boolean, receivedS: number): number {
  return (complete ? SLEEP_COMPLETE : 0) + Math.max(0, Math.round(receivedS)) * 100;
}
