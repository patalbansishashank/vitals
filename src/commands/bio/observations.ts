/**
 * The living plan's biometric `ObservationAdapter` (E5 contract, src/living/observations.ts; SUITE_SPEC §4.5) over the
 * app's biometrics documents: the shared synchronous `BioDocIndex` of the current document store, resolved one source
 * per metric per day and gated by the person's stream policy (`engine: true` only) by E10's `buildObservations`.
 *
 * Synchronous by contract: before the index has loaded the store's documents it answers with no observations (the
 * plan then keeps its assumptions), and the next assimilation picks the measurements up. Answers are cached per index
 * revision and range, so repeated reads during one projection cost nothing.
 */
import type { DayObservations, LogEntry, ObservationAdapter } from '@/living';
import { addDays } from '@/living/dates';
import type { DocumentStore } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { timeZone } from '../bus';
import { effectivePolicy } from '@/biometrics/core/effective';
import { buildObservations } from '@/biometrics/core/observations';
import { contentRecordId, LUMEN_SOURCE } from '@/biometrics/core/recordIds';
import type { BioRecord, PolicyStream } from '@/biometrics/core/types';
import { sharedBioIndex, type BioDocIndex } from '@/biometrics/store/docIndex';

const zone = (): string => timeZone();

/** Observations of [from, to] from an index (pure apart from reading it). */
export function observationsFromIndex(ix: BioDocIndex, from: string, to: string, tz = zone()): DayObservations[] {
  if (!ix.isLoaded || from > to) return [];
  const records = ix.latestRecords(from, to).map((e) => ({ sourceKey: e.sourceKey, record: e.record }));
  const corrections = ix.corrections().filter((c) => c.target.localDate >= from && c.target.localDate <= to);
  if (records.length === 0 && corrections.length === 0) return [];
  const results = [...ix.scores()].filter((r) => r.scope.localDate >= from && r.scope.localDate <= to);
  return buildObservations({ records, sources: ix.sources(), person: ix.personPolicies, results, tz, from, to, corrections });
}

const DEVICE_STREAM: Partial<Record<LogEntry['kind'], PolicyStream>> = { steps: 'steps', sleep: 'sleep_sessions', session: 'workouts' };
const DEVICE_KIND: Partial<Record<LogEntry['kind'], BioRecord['kind']>> = { steps: 'daily', sleep: 'sleep', session: 'workout' };

/** The source of the record an entry names by the id it had before `biometrics.ringFold` re-id'd it under the ring
 * key: the record of the entry's kind, on the entry's day or its neighbours, whose Lumen-form content id is that id. */
function reidSource(ix: BioDocIndex, e: LogEntry, id: string): string | undefined {
  const kind = DEVICE_KIND[e.kind];
  for (const r of ix.latestRecords(addDays(e.date, -1), addDays(e.date, 1))) {
    if (r.record.kind === kind && contentRecordId(r.record, LUMEN_SOURCE) === id) return r.sourceKey;
  }
  return undefined;
}

/**
 * Ids of the device entries (`log.fromBiometrics`) whose stream the person hides from the Coach (plan 04 item 11): the
 * plan uses them (`engine` on), an agent's read leaves them out. The entry's record names its source (by its current
 * id, or by the id it had before the ring fold re-id'd it); a record no longer stored falls back to the person's own
 * setting. Entries by hand are not device data and are never in it.
 */
export function coachHiddenEntryIds(ix: BioDocIndex, entries: readonly LogEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    const stream = DEVICE_STREAM[e.kind];
    if (!stream || e.source.by !== 'device' || e.source.method !== 'biometrics') continue;
    const id = e.source.bioRecordId;
    const doc = id ? ix.latest.get(id) : undefined;
    const sk = doc ? ix.recDocs.get(doc)?.sourceKey : id ? reidSource(ix, e, id) : undefined;
    const p = effectivePolicy(sk ? (ix.source(sk) ?? { policies: [] }) : null, ix.personPolicies, stream);
    if (!p.imported || p.coach === 'hidden') out.add(e.id);
  }
  return out;
}

/** The adapter over the app's current document store (or a given one, in tests). */
export function createBioObservationAdapter(store: () => Pick<DocumentStore, 'ready' | 'peekAll' | 'subscribe'> = getDocumentStore): ObservationAdapter {
  let memo: { ix: BioDocIndex; rev: number; key: string; out: DayObservations[] } | null = null;
  return {
    observations(from, to) {
      const ix = sharedBioIndex(store());
      const key = `${from}|${to}`;
      if (memo && memo.ix === ix && memo.rev === ix.revision() && memo.key === key) return memo.out;
      const out = observationsFromIndex(ix, from, to);
      memo = { ix, rev: ix.revision(), key, out };
      return out;
    },
  };
}
