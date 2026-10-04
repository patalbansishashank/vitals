/**
 * The markers document for the screens (SUITE_SPEC §13.5): a cached snapshot of `markers/me` kept fresh by the document
 * store's `watch` (the same pattern as `useIntakeDoc`), plus the person's day and date style. No rule engine here, so a
 * screen that only reads the document does not load the interaction table (./useMarkers.ts has the evaluation).
 */
import { useSyncExternalStore } from 'react';
import { appDay } from '@/living/appDay';
import type { DocumentStore, LocalDate } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { useSettingsStore } from '@/state/settingsStore';
import type { DateStyle } from '../because';
import { normaliseDoc } from '../doc';
import { emptyMarkersDoc, type MarkersDoc } from '../types';

const EMPTY: MarkersDoc = emptyMarkersDoc();

let watched: DocumentStore | null = null;
let unwatch: (() => void) | null = null;
let snapshot: MarkersDoc = EMPTY;
const listeners = new Set<() => void>();

function ensureWatch(): void {
  const store = getDocumentStore();
  if (store === watched) return;
  unwatch?.();
  watched = store;
  const now = store.peek('markers', 'me');
  snapshot = now ? normaliseDoc(now) : EMPTY;
  unwatch = store.watch('markers', { id: 'me' }, (docs) => {
    if (watched !== store) return;
    snapshot = docs[0] ? normaliseDoc(docs[0]) : EMPTY;
    listeners.forEach((l) => l());
  });
}

/** The markers document now (synchronous; the store cache). Empty when never written. */
export function readMarkersDoc(): MarkersDoc {
  ensureWatch();
  const d = getDocumentStore().peek('markers', 'me');
  return d ? normaliseDoc(d) : snapshot;
}

function subscribe(fn: () => void): () => void {
  ensureWatch();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function getSnapshot(): MarkersDoc {
  ensureWatch();
  return snapshot;
}

/** The markers document, live (empty document until something is entered). */
export function useMarkersDoc(): MarkersDoc {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The person's day (rolls over at 04:00 like the rest of the app). */
export const markersToday = (): LocalDate => appDay(new Date());

/** The person's date style for "because …" lines. */
export function useMarkerDateStyle(): DateStyle {
  return useSettingsStore((s) => s.dateStyle) as DateStyle;
}
