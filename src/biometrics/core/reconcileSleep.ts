import type { BioRecord } from './types';

/**
 * A partial history read can start halfway through a night and thus have a different content id. Keep immutable
 * deliveries for sync, but expose only maximal sleep coverage per source: a contained provisional session is an older
 * view of its containing session. Complete sessions and disjoint naps remain separate. Resolve before date filtering
 * because a tail read before midnight can have a different wake date from the finished night.
 */
export function reconcileSleep<T extends { sourceKey: string; record: BioRecord }>(records: readonly T[]): T[] {
  const bySource = new Map<string, Array<{ entry: T; start: number; end: number; provisional: boolean }>>();
  for (const entry of records) {
    const r = entry.record;
    if (r.kind !== 'sleep') continue;
    const start = Date.parse(r.time.start ?? '');
    const end = Date.parse(r.time.end ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const group = bySource.get(entry.sourceKey) ?? [];
    group.push({ entry, start, end, provisional: r.quality.flags.includes('provisional_stages') });
    bySource.set(entry.sourceKey, group);
  }
  const superseded = new Set<T>();
  for (const group of bySource.values()) {
    group.sort((a, b) => a.start - b.start || b.end - a.end || Number(a.provisional) - Number(b.provisional)
      || b.entry.record.version - a.entry.record.version || a.entry.record.record_id.localeCompare(b.entry.record.record_id));
    let furthestEnd = -Infinity;
    for (const { entry, end, provisional } of group) {
      if (provisional && end <= furthestEnd) superseded.add(entry);
      furthestEnd = Math.max(furthestEnd, end);
    }
  }
  return records.filter((entry) => !superseded.has(entry));
}
