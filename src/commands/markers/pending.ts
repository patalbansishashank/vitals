/**
 * Pending extractions (E20): what `markers.import` read, kept in memory for this session until `markers.confirm`
 * saves the rows the person accepted. Nothing from an import reaches the `markers` document before that. The job's
 * own result (`job.result`) holds the same extraction; this map outlives the job runner's pruning.
 */
import type { ActorKind } from '../types';
import type { MarkerExtraction } from '@/markers/types';

export interface PendingExtraction {
  extraction: MarkerExtraction;
  attachmentId: string;
  mime: string;
  /** Who started the import (`ai` → provenance `coach`). */
  by: ActorKind;
  at: string;
  /** Set when `markers.confirm` saved it (a replay returns the view without writing again). */
  confirmedAt?: string;
}

const MAX = 20;
const pending = new Map<string, PendingExtraction>();

export function keepExtraction(p: PendingExtraction): void {
  pending.delete(p.extraction.extractionId);
  pending.set(p.extraction.extractionId, p);
  while (pending.size > MAX) pending.delete(pending.keys().next().value as string);
}

export function pendingExtraction(id: string): PendingExtraction | undefined {
  return pending.get(id);
}

/** Tests. */
export function clearPendingExtractions(): void {
  pending.clear();
}
