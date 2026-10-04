/**
 * Reading `intake/me` (SUITE_SPEC §2.3.1) for the screens: a cached snapshot kept fresh by the document store's
 * `watch`, exposed as `useIntakeDoc()`. Writes go through `intake.answer` / `intake.skip` (./persist.ts).
 */
import { useSyncExternalStore } from 'react';
import type { DocumentStore } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { markersTurns } from './chapters/markers';
import { readMarkersDoc } from './chapters/markersStore';
import { EMPTY_INTAKE, type ChapterAnswers, type ChapterId, type IntakeDoc, TURNS_SECTION } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored body → `IntakeDoc` (metadata stripped; missing stamps filled). */
export function toIntakeDoc(raw: unknown): IntakeDoc {
  if (!isObj(raw)) return EMPTY_INTAKE;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith('_')) out[k] = v;
  return {
    ...(out as Partial<IntakeDoc>),
    answeredAt: isObj(out.answeredAt) ? (out.answeredAt as IntakeDoc['answeredAt']) : {},
    questionSetVersion: isObj(out.questionSetVersion) ? (out.questionSetVersion as IntakeDoc['questionSetVersion']) : {},
  };
}

/** A chapter's stored turns (empty when never answered). */
export function turnsOf(doc: IntakeDoc, chapter: ChapterId): ChapterAnswers {
  const body = doc[TURNS_SECTION[chapter]] as { turns?: unknown } | undefined;
  const t = body?.turns;
  // blood markers: the readings live in their own document; with no stored turns (a Coach import, an older document)
  // the turns are derived from it
  if (chapter === 'markers' && (!isObj(t) || !isObj(t.values) || !Object.keys(t.values).length)) return markersTurns(readMarkersDoc());
  if (!isObj(t) || !isObj(t.values) || !isObj(t.status)) return { values: {}, status: {} };
  const order = Array.isArray(t.order) ? t.order.filter((x): x is string => typeof x === 'string') : undefined;
  return {
    values: { ...t.values },
    status: { ...(t.status as ChapterAnswers['status']) },
    ...(order ? { order } : {}),
    ...(t.skippedAll === true ? { skippedAll: true } : {}),
  };
}

let watched: DocumentStore | null = null;
let unwatch: (() => void) | null = null;
let snapshot: IntakeDoc = EMPTY_INTAKE;
const listeners = new Set<() => void>();

function ensureWatch(): void {
  const store = getDocumentStore();
  if (store === watched) return;
  unwatch?.();
  watched = store;
  const now = store.peek('intake', 'me');
  snapshot = now ? toIntakeDoc(now) : EMPTY_INTAKE;
  unwatch = store.watch('intake', { id: 'me' }, (docs) => {
    if (watched !== store) return;
    snapshot = docs[0] ? toIntakeDoc(docs[0]) : EMPTY_INTAKE;
    listeners.forEach((l) => l());
  });
}

/** The intake document now (synchronous; the store cache). */
export function readIntake(): IntakeDoc {
  ensureWatch();
  const d = getDocumentStore().peek('intake', 'me');
  return d ? toIntakeDoc(d) : snapshot;
}

function subscribe(fn: () => void): () => void {
  ensureWatch();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function getSnapshot(): IntakeDoc {
  ensureWatch();
  return snapshot;
}

/** The intake document, live. */
export function useIntakeDoc(): IntakeDoc {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
