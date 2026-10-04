/**
 * Reading the person's `markers` document (SUITE_SPEC §13.5) for the intake: a cached snapshot kept fresh by the
 * document store's `watch` (as ../doc.ts does for `intake/me`). Writes go through `markers.*` (./markersApi.ts).
 */
import { useSyncExternalStore } from 'react';
import { normaliseDoc } from '@/markers/doc';
import type { MarkersDoc } from '@/markers/types';
import type { DocumentStore } from '@/store';
import { getDocumentStore } from '@/state/runtime';

let watched: DocumentStore | null = null;
let unwatch: (() => void) | null = null;
let snapshot: MarkersDoc | null = null;
const listeners = new Set<() => void>();

const toDoc = (raw: unknown): MarkersDoc | null => (raw ? normaliseDoc(raw) : null);

function ensureWatch(): void {
  const store = getDocumentStore();
  if (store === watched) return;
  unwatch?.();
  watched = store;
  snapshot = toDoc(store.peek('markers', 'me'));
  unwatch = store.watch('markers', { id: 'me' }, (docs) => {
    if (watched !== store) return;
    snapshot = toDoc(docs[0]);
    listeners.forEach((l) => l());
  });
}

/** The markers document now (null when none was ever written). */
export function readMarkersDoc(): MarkersDoc | null {
  try {
    ensureWatch();
    return toDoc(getDocumentStore().peek('markers', 'me')) ?? snapshot;
  } catch {
    return null;
  }
}

function subscribe(fn: () => void): () => void {
  try {
    ensureWatch();
  } catch {
    /* no store yet */
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): MarkersDoc | null {
  try {
    ensureWatch();
  } catch {
    return null;
  }
  return snapshot;
}

/** The markers document, live. */
export function useMarkersDoc(): MarkersDoc | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
