/**
 * The living plan's biometric `ObservationAdapter` (E5 contract, src/living/observations.ts; SUITE_SPEC §4.5) over the
 * app's biometrics documents: the shared synchronous `BioDocIndex` of the current document store, resolved one source
 * per metric per day and gated by the person's stream policy (`engine: true` only) by E10's `buildObservations`.
 *
 * Synchronous by contract: before the index has loaded the store's documents it answers with no observations (the
 * plan then keeps its assumptions), and the next assimilation picks the measurements up. Answers are cached per index
 * revision and range, so repeated reads during one projection cost nothing.
 */
import type { DayObservations, ObservationAdapter } from '@/living';
import type { DocumentStore } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { timeZone } from '../bus';
import { buildObservations } from '@/biometrics/core/observations';
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
