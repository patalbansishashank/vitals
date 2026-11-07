/**
 * Reading the Gauge client from a screen: one cached answer per question (stale while it refreshes, so moving between
 * the Ring tabs is instant), a refresh when the tab comes back to the front, and a clock that ticks once a minute so
 * "synced 4 min ago" stays true.
 *
 * (0.6.3 A30/S28) Every answer is kept under the paired server and person (`gaugeIdentity()`): pairing another server,
 * unpairing, a revoked device (401/403) or a replaced client drops them all, and a refused read never keeps the last
 * answer. An offline read keeps the last answer and says so (`stale`), so a screen can tell "can't reach your server"
 * from "this device may no longer read it". A successful import or measurement asks every question on screen again.
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
const cache = new Map<string, unknown>();
const meta = new Map<string, Meta>();
const pending = new Map<string, { promise: Promise<unknown>; controller: AbortController }>();
const active = new Map<string, number>();
let generation = 0;
let epoch = 0;
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
onGaugeDataChanged(() => refreshGauge());
export function clearGaugeCache(): void { dropAll(); }

/** Refresh visible questions; a superseded response can never replace its successor. */
export function refreshGauge(): void {
  for (const key of pending.keys()) cancel(key);
  epoch++;
  for (const b of bumps) b();
}
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
const snapshot = () => `${generation}:${epoch}`;
const scoped = (key: string): string => `${gaugeIdentity() ?? '-'}::${key}`;
const refused = (p: GaugeProblem | null | undefined): boolean => p === 'unauthorized' || p === 'not_paired';
function forgetRefused(problem: GaugeProblem): void {
  for (const key of pending.keys()) cancel(key);
  for (const key of new Set([...cache.keys(), ...active.keys()])) {
    cache.set(key, null);
    meta.set(key, { problem, cached: false, savedAt: null });
  }
  publish();
}
function trim(): void {
  // Evict inactive questions only. Mounted cards keep their current snapshot.
  for (const key of cache.keys()) {
    if (cache.size <= 192) break;
    if (!active.has(key)) { cache.delete(key); meta.delete(key); }
  }
}
function run<T>(key: string, load: (api: RingApi) => Promise<T | null>): Promise<T | null> {
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
  const readApi = api.withOptions?.({ signal: controller.signal }) ?? api;
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
    if (pending.get(ck)?.controller === controller) pending.delete(ck);
    trim();
    publish(ck);
    return (cache.get(ck) as T | null) ?? null;
  });
  pending.set(ck, { promise: p, controller });
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
    void run(key, loadRef.current);
  }, [key]);
  useEffect(() => {
    recheckGaugeIdentity();
    const ck = scoped(key);
    active.set(ck, (active.get(ck) ?? 0) + 1);
    void run(key, loadRef.current);
    return () => {
      const count = (active.get(ck) ?? 1) - 1;
      if (count > 0) active.set(ck, count);
      else { active.delete(ck); cancel(ck); }
    };
  }, [key, gen]);
  useEffect(() => {
    const api = gauge();
    return api.subscribe(() => {
      const problem = api.status().problem;
      if (refused(problem)) forgetRefused(problem!);
    });
  }, [gen]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void run(key, loadRef.current); };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', onVisible);
    window.addEventListener('online', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('resume', onVisible); window.removeEventListener('online', onVisible); };
  }, [key]);
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
