/**
 * React access to the Evidence library. Other features use `useMechanism`,
 * `useMechanisms` and `useEvidenceSearch`; the library screen uses the rest.
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { EvidenceTopic, Mechanism } from '@/content/evidence/schema';
import { EMPTY_FILTERS, filtersFromKey, filtersKey, type EvidenceFilters } from './data/filters';
import {
  evidenceRepository,
  type EvidenceRepository,
  type EvidenceSnapshot,
  type ResolvedMechanism,
} from './data/repository';
import type { SearchResults } from './data/search';

/** Which repository the hooks read. The app uses the shared one; tests provide their own. */
export const EvidenceRepositoryContext = createContext<EvidenceRepository>(evidenceRepository);

export function useEvidenceRepository(): EvidenceRepository {
  return useContext(EvidenceRepositoryContext);
}

/** Re-renders whenever a topic loads or fails. */
export function useEvidenceSnapshot(): EvidenceSnapshot {
  const repo = useEvidenceRepository();
  return useSyncExternalStore(repo.subscribe, repo.getSnapshot, repo.getSnapshot);
}

/** Start loading every topic once the browser is idle after first paint. */
export function useLoadAllInBackground(enabled = true): void {
  const repo = useEvidenceRepository();
  useEffect(() => {
    if (enabled) repo.loadAllWhenIdle();
  }, [repo, enabled]);
}

/** Library loading progress. */
export function useEvidenceStatus(): Pick<
  EvidenceSnapshot,
  'loaded' | 'total' | 'failed' | 'settled' | 'complete'
> & { retry: () => void } {
  const repo = useEvidenceRepository();
  const { loaded, total, failed, settled, complete } = useEvidenceSnapshot();
  return { loaded, total, failed, settled, complete, retry: () => void repo.retryFailed() };
}

export type LoadStatus = 'loading' | 'ready' | 'not-found' | 'error';

export interface MechanismState {
  id: string | undefined;
  status: LoadStatus;
  mechanism?: Mechanism;
  /** The topic (dossier) the mechanism belongs to: its references, myths and siblings. */
  topic?: EvidenceTopic;
  /** Position within the topic. */
  index?: number;
  error?: unknown;
  retry: () => void;
}

interface Outcome {
  key: string;
  attempt: number;
  status: 'not-found' | 'error';
  error?: unknown;
}

/**
 * One mechanism by id, from whichever topic holds it (loads that topic on demand).
 * `status`: loading → ready | not-found | error.
 */
export function useMechanism(id: string | undefined): MechanismState {
  const repo = useEvidenceRepository();
  useEvidenceSnapshot();
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const resolved = id ? repo.getMechanism(id) : undefined;

  useEffect(() => {
    if (!id || repo.getMechanism(id)) return;
    let alive = true;
    repo.resolveMechanism(id).then(
      (r) => {
        if (alive && !r) setOutcome({ key: id, attempt, status: 'not-found' });
      },
      (error: unknown) => {
        if (alive) setOutcome({ key: id, attempt, status: 'error', error });
      },
    );
    return () => {
      alive = false;
    };
  }, [repo, id, attempt]);

  const failed = outcome && outcome.key === id && outcome.attempt === attempt ? outcome : null;
  const retry = () => setAttempt((a) => a + 1);
  if (!id) return { id, status: 'not-found', retry };
  if (resolved)
    return {
      id,
      status: 'ready',
      mechanism: resolved.mechanism,
      topic: resolved.topic,
      index: resolved.index,
      retry,
    };
  if (failed) return { id, status: failed.status, error: failed.error, retry };
  return { id, status: 'loading', retry };
}

export interface MechanismsState {
  /** Overall: loading while any id is still resolving; error if any failed to load; ready otherwise. */
  status: 'loading' | 'ready' | 'error';
  found: ResolvedMechanism[];
  /** Ids no topic contains. */
  missing: string[];
  retry: () => void;
}

/** Several mechanisms by id (Explain for a curve driven by more than one mechanism). */
export function useMechanisms(ids: readonly string[]): MechanismsState {
  const repo = useEvidenceRepository();
  useEvidenceSnapshot();
  const [attempt, setAttempt] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const key = ids.join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    let alive = true;
    for (const id of list) {
      if (repo.getMechanism(id)) continue;
      repo.resolveMechanism(id).then(
        (r) => {
          if (alive && !r)
            setOutcomes((o) => [...o.filter((x) => x.key !== id), { key: id, attempt, status: 'not-found' }]);
        },
        (error: unknown) => {
          if (alive)
            setOutcomes((o) => [
              ...o.filter((x) => x.key !== id),
              { key: id, attempt, status: 'error', error },
            ]);
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [repo, key, attempt]);

  const found: ResolvedMechanism[] = [];
  const missing: string[] = [];
  let loading = false;
  let error = false;
  for (const id of ids) {
    const r = repo.getMechanism(id);
    if (r) {
      found.push(r);
      continue;
    }
    const o = outcomes.find((x) => x.key === id && x.attempt === attempt);
    if (!o) loading = true;
    else if (o.status === 'not-found') missing.push(id);
    else error = true;
  }
  return {
    status: loading ? 'loading' : error ? 'error' : 'ready',
    found,
    missing,
    retry: () => setAttempt((a) => a + 1),
  };
}

export interface TopicState {
  status: LoadStatus;
  topic?: EvidenceTopic;
  error?: unknown;
  retry: () => void;
}

/** One topic (dossier) by slug. */
export function useTopic(slug: string | undefined): TopicState {
  const repo = useEvidenceRepository();
  useEvidenceSnapshot();
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const topic = slug ? repo.getTopic(slug) : undefined;
  const known = slug ? Boolean(repo.entryBySlug(slug)) : false;

  useEffect(() => {
    if (!slug || !repo.entryBySlug(slug) || repo.getTopic(slug)) return;
    let alive = true;
    repo.loadTopic(slug).catch((error: unknown) => {
      if (alive) setOutcome({ key: slug, attempt, status: 'error', error });
    });
    return () => {
      alive = false;
    };
  }, [repo, slug, attempt]);

  const retry = () => setAttempt((a) => a + 1);
  if (!slug || !known) return { status: 'not-found', retry };
  if (topic) return { status: 'ready', topic, retry };
  if (outcome && outcome.key === slug && outcome.attempt === attempt)
    return { status: 'error', error: outcome.error, retry };
  return { status: 'loading', retry };
}

/** `value`, but only after it has been stable for `ms` (0 = no delay). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (ms <= 0) return;
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return ms <= 0 ? value : debounced;
}

export interface EvidenceSearchOptions {
  /** Debounce the query inside the hook (ms). Default 0: pass an already-debounced query. */
  debounceMs?: number;
  /** Load every topic in the background after first paint (default true). */
  loadAll?: boolean;
}

export interface EvidenceSearchState extends SearchResults {
  loaded: number;
  total: number;
  /** Every topic loaded: results are final. */
  complete: boolean;
  settled: boolean;
  failed: readonly string[];
  /** The debounced query has not caught up with the typed one yet. */
  pending: boolean;
}

/**
 * Search mechanisms, common claims and metrics. Results are progressive: they
 * update as topics finish loading (`complete` tells when they are final).
 * An empty query lists every mechanism that passes the filters, in library order.
 */
export function useEvidenceSearch(
  query: string,
  filters: EvidenceFilters = EMPTY_FILTERS,
  options: EvidenceSearchOptions = {},
): EvidenceSearchState {
  const { debounceMs = 0, loadAll = true } = options;
  const snap = useEvidenceSnapshot();
  useLoadAllInBackground(loadAll);
  const q = useDebouncedValue(query, debounceMs);
  const fKey = filtersKey(filters);
  const results = useMemo(() => snap.index.search(q, filtersFromKey(fKey)), [snap, q, fKey]);
  return {
    ...results,
    loaded: snap.loaded,
    total: snap.total,
    complete: snap.complete,
    settled: snap.settled,
    failed: snap.failed,
    pending: q !== query,
  };
}

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** False while the browser reports being offline (external links then say they open a website). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    () => true,
  );
}
