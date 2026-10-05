import type { BioRecord } from '../core/types';

/** The order of `BioStore.records`: ascending local date, then start (or instant), then record id. */
export function recordOrder(a: { record: BioRecord }, b: { record: BioRecord }): number {
  const when = (r: BioRecord): string => r.time.start ?? r.time.at ?? '';
  return a.record.time.local_date.localeCompare(b.record.time.local_date) || when(a.record).localeCompare(when(b.record)) || a.record.record_id.localeCompare(b.record.record_id);
}
