/**
 * Reading the Gauge client from a screen: one cached answer per question (stale while it refreshes, so moving between
 * the Ring tabs is instant), a refresh when the tab comes back to the front, and a clock that ticks once a minute so
 * "synced 4 min ago" stays true.
 *
 * (0.6.3 A30/S28) Every answer is kept under the paired server and person (`gaugeIdentity()`): pairing another server,
 * unpairing, a revoked device (401/403) or a replaced client drops them all, and a refused read never keeps the last
 * answer. An offline read keeps the last answer and says so (`stale`), so a screen can tell "can't reach your server"
 * from "this device may no longer read it". A successful import or measurement asks every question on screen again.
 *
 * (r087) New data never cancels a read that is under way: the server would finish the cancelled work anyway and then do
 * it again. The read is left to answer and asked once more when it has (`refreshGauge`). Nothing is asked while the app
 * is hidden; coming back asks every question on screen once.
 *
 * The client shares one request between everyone asking the same thing (a card, the Progress data, the import), so a
 * question asked again because something changed says since when (`since`): its answer then never comes from a request
 * that was sent before the change.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { onFusionContextChange, type GaugeProblem } from '@/net/gauge';
import { gaugeIdentity, onGaugeDataChanged, onGaugeIdentityChange, recheckGaugeIdentity } from '@/net/gaugeIdentity';
import { registerEraseHook } from '@/state/persistence';
import { gauge, onGaugeApiChange } from './api';
import type { RingApi } from './types';

type QueryDetails = {
  refresh: () => void;
  problem?: GaugeProblem | null;
  /** A saved answer awaiting validation, or retained after a failed refresh. */
  cached?: boolean;
  refreshing?: boolean;
  /** Last validation time (epoch ms); for composed snapshots, the oldest contributing answer. */
  savedAt?: number | null;
};
export type GaugeQuery<T> = QueryDetails & (
  | { status: 'loading'; data?: undefined; stale?: undefined }
  | { status: 'unavailable'; data?: undefined; stale?: undefined }
  | { status: 'ready'; data: T; stale?: boolean }
);

type Meta = { problem: GaugeProblem | null; cached: boolean; savedAt: number | null };
/**
 * A read under way. `since`: its answer is known to be newer than this moment (null: as old as any request it may have
 * joined). `again`: the data moved at this moment, after the read's answer may have been made, so it is asked once
 * more when it answers.
 */
type Pending = { promise: Promise<unknown>; controller: AbortController; startedAt: number; since: number | null; again: number | null };
/** A read that began this long before the app came back was cut off by a suspended app; its answer is not coming. */
export const GAUGE_PENDING_MAX_AGE_MS = 30_000;
const cache = new Map<string, unknown>();
const meta = new Map<string, Meta>();
const pending = new Map<string, Pending>();
/** The mounted readers of each question: each is a function that asks it again with the reader's current loader. */
const mounted = new Map<string, Set<(since: number) => void>>();
let generation = 0;
/** New data arrived while the app was hidden: every question is asked again when it comes back. */
let owed = false;
const bumps = new Set<() => void>();
const queryVersions = new Map<string, number>();
const queryListeners = new Map<string, Set<() => void>>();
/** Ordinary answers notify only their readers. Identity/refusal changes still notify every query. */
const publish = (key?: string) => {
  const keys = key === undefined ? [...queryListeners.keys()] : [key];
  for (const ck of keys) {
    const listeners = queryListeners.get(ck);
    if (!listeners) continue;
    queryVersions.set(ck, (queryVersions.get(ck) ?? 0) + 1);
    for (const fn of listeners) fn();
  }
};
const cancel = (key: string) => { pending.get(key)?.controller.abort(); pending.delete(key); };
function dropAll(): void {
  for (const key of pending.keys()) cancel(key);
  cache.clear();
  meta.clear();
  generation++;
  for (const b of bumps) b();
  publish();
}
registerEraseHook(dropAll);
onGaugeApiChange(dropAll);
onGaugeIdentityChange(dropAll);
onGaugeDataChanged((changedAt) => refreshGauge(changedAt));
export function clearGaugeCache(): void { owed = false; dropAll(); }

const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState !== 'visible';
/** Asks a question on screen again, for an answer newer than `since`. */
const ask = (ck: string, since: number): void => { mounted.get(ck)?.values().next().value?.(since); };
/** The data moved at `changedAt` while this read was under way: once more when it answers, unless it is newer already. */
const askAgain = (p: Pending, changedAt: number): void => {
  if (p.since !== null && p.since >= changedAt) return;
  p.again = Math.max(p.again ?? changedAt, changedAt);
};

/**
 * New data may exist as of `changedAt` (default now): every question on screen is asked again. A read under way is not
 * cancelled; unless it was itself asked for an answer that new, it is asked once more when it answers, so the screen
 * ends up fresh and the server never does the same work twice at once. While the app is hidden nothing is asked;
 * `resume` catches up.
 */
export function refreshGauge(changedAt: number = Date.now()): void {
  if (hidden()) { owed = true; return; }
  for (const ck of [...mounted.keys()]) {
    const p = pending.get(ck);
    if (p) askAgain(p, changedAt);
    else ask(ck, changedAt);
  }
}

/**
 * The app came back to the front (or the network did): every question on screen is asked once, of the server as it is
 * now. A request from before the pause may have been frozen with the app, so none of them is joined.
 */
function resume(): void {
  if (hidden()) return;
  const catchUp = owed;
  owed = false;
  const now = Date.now();
  for (const ck of [...mounted.keys()]) {
    const p = pending.get(ck);
    if (p && now - p.startedAt <= GAUGE_PENDING_MAX_AGE_MS) {
      // what arrived while hidden arrived before now
      if (catchUp) askAgain(p, now);
      continue;
    }
    // a suspended app froze this read's timer with it: waiting on it would end in a false "offline" and no retry
    if (p) cancel(ck);
    ask(ck, now);
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', resume);
  // the Android shell's own resume event (Capacitor fires it on the document), in case the WebView's visibility lags
  document.addEventListener('resume', resume);
}
if (typeof window !== 'undefined') window.addEventListener('online', resume);

// A correction changes the meaning of fused figures. Do not keep the old figures during that refresh.
onFusionContextChange(dropAll);
const subscribeGeneration = (fn: () => void) => { bumps.add(fn); return () => bumps.delete(fn); };
const subscribeData = (key: string, fn: () => void) => {
  let listeners = queryListeners.get(key);
  if (!listeners) { listeners = new Set(); queryListeners.set(key, listeners); }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) { queryListeners.delete(key); queryVersions.delete(key); }
  };
};
const snapshot = () => generation;
const scoped = (key: string): string => `${gaugeIdentity() ?? '-'}::${key}`;
const refused = (p: GaugeProblem | null | undefined): boolean => p === 'unauthorized' || p === 'not_paired';
function forgetRefused(problem: GaugeProblem): void {
  for (const key of pending.keys()) cancel(key);
  for (const key of new Set([...cache.keys(), ...mounted.keys()])) {
    cache.set(key, null);
    meta.set(key, { problem, cached: false, savedAt: null });
  }
  publish();
}
function trim(): void {
  // Evict inactive questions only. Mounted cards keep their current snapshot.
  for (const key of cache.keys()) {
    if (cache.size <= 192) break;
    if (!mounted.has(key)) { cache.delete(key); meta.delete(key); }
  }
}
function run<T>(key: string, load: (api: RingApi) => Promise<T | null>, since: number | null = null): Promise<T | null> {
  const ck = scoped(key);
  const hit = pending.get(ck);
  if (hit) return hit.promise as Promise<T | null>;
  const gen = generation;
  const controller = new AbortController();
  const api = gauge();
  const valid = () => gen === generation && !controller.signal.aborted;
  let completed = false;
  // A disk read and network validation share the client's hydration. Whichever completes first may display;
  // a late disk read cannot overwrite a newer response, including an authoritative empty answer.
  if (!cache.has(ck) && api.snapshot) {
    void api.snapshot(load).then((saved) => {
      if (!valid() || completed || saved.data === null || saved.savedAt === null) return;
      cache.set(ck, saved.data);
      meta.set(ck, { problem: null, cached: true, savedAt: saved.savedAt });
      trim();
      publish(ck);
    }).catch(() => undefined);
  }
  const readApi = api.withOptions?.({ signal: controller.signal, priority: 'screen', ...(since !== null ? { since } : {}) }) ?? api;
  let failed = false;
  const p = load(readApi).catch(() => { failed = true; return null; }).then((v) => {
    completed = true;
    if (!valid()) return null;
    let problem: GaugeProblem | null = null;
    try { problem = readApi.status().problem; } catch { /* test/old client */ }
    if (refused(problem)) {
      // A refusal from any question invalidates all shown health snapshots.
      forgetRefused(problem!);
      cache.set(ck, null);
    } else if (v !== null || (!failed && problem === null) || !cache.has(ck)) cache.set(ck, v);
    const previous = meta.get(ck);
    meta.set(ck, { problem, cached: problem !== null && cache.get(ck) != null, savedAt: problem === null ? Date.now() : previous?.savedAt ?? null });
    const mine = pending.get(ck);
    if (mine?.controller === controller) pending.delete(ck);
    trim();
    publish(ck);
    if (mine?.controller === controller && mine.again !== null) {
      // the data moved while this read was under way: once more, now that the server is free of it
      if (!hidden()) ask(ck, mine.again);
      // nobody is looking: coming back asks
      else owed = true;
    }
    return (cache.get(ck) as T | null) ?? null;
  });
  pending.set(ck, { promise: p, controller, startedAt: Date.now(), since, again: null });
  publish(ck);
  return p;
}

/** Shared query, immediate saved snapshot, then conditional server validation. */
export function useGauge<T>(key: string, load: (api: RingApi) => Promise<T | null>): GaugeQuery<T> {
  const gen = useSyncExternalStore(subscribeGeneration, snapshot, snapshot);
  const ck = scoped(key);
  const subscribeQuery = useCallback((fn: () => void) => subscribeData(ck, fn), [ck]);
  const queryVersion = useCallback(() => queryVersions.get(ck) ?? 0, [ck]);
  useSyncExternalStore(subscribeQuery, queryVersion, queryVersion);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const refresh = useCallback(() => {
    cancel(scoped(key));
    // after a write: an answer made before it is not the answer
    void run(key, loadRef.current, Date.now());
  }, [key]);
  useEffect(() => {
    recheckGaugeIdentity();
    const ck = scoped(key);
    const again = (since?: number) => void run(key, loadRef.current, since);
    let readers = mounted.get(ck);
    if (!readers) { readers = new Set(); mounted.set(ck, readers); }
    readers.add(again);
    again();
    return () => {
      readers.delete(again);
      if (readers.size > 0 || mounted.get(ck) !== readers) return;
      mounted.delete(ck);
      cancel(ck);
    };
  }, [key, gen]);
  useEffect(() => {
    const api = gauge();
    return api.subscribe(() => {
      const problem = api.status().problem;
      if (refused(problem)) forgetRefused(problem!);
    });
  }, [gen]);
  const m = meta.get(ck);
  const problem = m?.problem ?? null;
  const cached = m?.cached ?? false;
  const savedAt = m?.savedAt ?? null;
  const refreshing = pending.has(ck);
  const hasAnswer = cache.has(ck);
  const value = cache.get(ck) as T | null;
  // Keep composed consumers' memo dependencies stable when only their parent rerenders.
  return useMemo<GaugeQuery<T>>(() => {
    const details = { refresh, problem, cached, savedAt, refreshing };
    if (!hasAnswer) return { status: 'loading', ...details };
    return value === null ? { status: 'unavailable', ...details } : { status: 'ready', data: value, stale: problem === 'offline', ...details };
  }, [refresh, problem, cached, savedAt, refreshing, hasAnswer, value]);
}

/** The Gauge client's last problem (offline, refused, …), re-read when it changes. */
export function useGaugeProblem(): GaugeProblem | null {
  const sub = useCallback((fn: () => void) => {
    try {
      return gauge().subscribe(fn);
    } catch {
      return () => undefined;
    }
  }, []);
  const get = useCallback(() => {
    try {
      return gauge().status().problem;
    } catch {
      return null;
    }
  }, []);
  return useSyncExternalStore(sub, get, get);
}

/** The current time, re-read every `ms` (default a minute). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
