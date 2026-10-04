/**
 * Lumen ingest into a BioStore (tier H), shared by `bio.import` of a Lumen file and the server's broker (one message per
 * call): the pipeline of §4.3 plus the cross-batch `is_main` recompute of §14.5. Series samples need nothing extra: the
 * store merges them per chunk by (origin, t).
 */
import { sourceKeyOf } from '../core/source';
import type { BioBatch, SleepRecord } from '../core/types';
import { addDaysIso } from '../ingest/dates';
import { foldBatch, ingestBatches } from '../ingest/pipeline';
import type { IngestOpts, IngestOutcome } from '../ingest/pipeline';
import type { BioStore } from '../store/types';
import { recomputeMainSleep } from './lumenCloudEvents';

/** Sets `is_main` on the batch's nights against the stored nights of the same source and nearby wake dates, and adds
 * re-versioned stored nights whose `is_main` flips. Read the store after the previous batch was ingested. The fold
 * (§15.2, Lumen data filed under the ring key) is applied first, so the batch's nights and the stored ones share a key. */
export async function withLumenMainSleep(raw: BioBatch, store: BioStore, fold?: IngestOpts['fold']): Promise<BioBatch> {
  const batch = fold ? foldBatch(raw, fold) : raw;
  const sleeps = batch.records.filter((r): r is SleepRecord => r.kind === 'sleep');
  if (sleeps.length === 0) return batch;
  const dates = sleeps.map((r) => r.time.local_date).sort();
  const keys = new Set(sleeps.map((r) => sourceKeyOf(r.provenance)));
  // ±1 day: a re-synced night may end on another date than its stored version
  const stored = (await store.records({ kind: 'sleep', from: addDaysIso(dates[0]!, -1), to: addDaysIso(dates[dates.length - 1]!, 1) }))
    .filter((e) => e.record.kind === 'sleep' && keys.has(sourceKeyOf(e.record.provenance)))
    .map((e) => e.record as SleepRecord);
  return { ...batch, records: [...batch.records.filter((r) => r.kind !== 'sleep'), ...recomputeMainSleep(stored, sleeps)] };
}

export async function* withLumenMainSleep$(batches: AsyncIterable<BioBatch> | Iterable<BioBatch>, store: BioStore, fold?: IngestOpts['fold']): AsyncGenerator<BioBatch> {
  for await (const b of batches) yield await withLumenMainSleep(b, store, fold);
}

/** `ingestBatches` for Lumen batches (from `mapLumenEvents` or the file importer). */
export function ingestLumenBatches(batches: AsyncIterable<BioBatch> | Iterable<BioBatch>, store: BioStore, opts: IngestOpts): Promise<IngestOutcome> {
  return ingestBatches(withLumenMainSleep$(batches, store, opts.fold), store, opts);
}
