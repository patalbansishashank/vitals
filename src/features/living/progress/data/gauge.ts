/**
 * The Gauge reads of Progress (energy SPEC §V4.6): fused steps (`steps`, §2.2) and the nightly metrics (`sleep`
 * `sessions[].metrics`, §S2.4) with the baselines they are read against (`baselines`, §S2.5). One cached answer per
 * question; `unavailable` when the server is not paired, has no such route or is offline with nothing cached, so a card
 * that cannot be filled is left out instead of drawn as zeros.
 *
 * (0.6.3 FX1, sR15) A refusal is not an offline read: when the server refuses (401/403: the pairing ended or this token
 * may not read Gauge data) or the device is not paired, every answer kept is forgotten and nothing from before is shown.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { gaugeApi, type GaugeApi, type GaugeProblem, type GaugeV2Api } from '@/net/gauge';
import { registerEraseHook } from '@/state/persistence';
import { gaugeIdentity, onGaugeDataChanged, onGaugeIdentityChange } from '@/net/gaugeIdentity';

/** `stepsFuse` is optional: a client or a test fake without it is asked `steps` for the same range. */
export type ProgressGauge = Pick<GaugeApi, 'sleep'> & Pick<GaugeV2Api, 'steps' | 'baselines'> & Partial<Pick<GaugeV2Api, 'stepsFuse'>> & Partial<Pick<GaugeApi, 'status' | 'subscribe' | 'snapshot' | 'withOptions'>>;

let override: ProgressGauge | null = null;
/** (r063 S27/A29) Each answer with when it arrived: a failed (null) one is asked again after a short wait, any after a while. */
const cache = new Map<string, { at: number; value: unknown }>();
/** A failed or unavailable answer is asked again after this long (P). */
export const PROGRESS_GAUGE_RETRY_MS = 30_000;
/** Any answer is asked again after this long while a card shows it (P): today's numbers move, corrections land. */
export const PROGRESS_GAUGE_TTL_MS = 5 * 60_000;
const ttlOf = (v: unknown) => (v === null || v === undefined ? PROGRESS_GAUGE_RETRY_MS : PROGRESS_GAUGE_TTL_MS);
const pending = new Map<string, Promise<unknown>>();
const bumps = new Set<() => void>();
let generation = 0;
/** (FX1) Bumped when answers are forgotten in place (a refusal): the screens read again without asking again. */
let epoch = 0;
/** Retire pending presentation promises without immediately retrying a refused query. */
let refusalRevision = 0;

/** The client Progress reads from. */
export const progressGauge = (): ProgressGauge => override ?? gaugeApi;

/** Tests and the screenshot harness: read from this client (null restores the real one). Drops the cache. */
export function setProgressGauge(api: ProgressGauge | null): void {
  override = api;
  lastShown.clear();
  savedMeta.clear();
  cache.clear();
  pending.clear();
  generation++;
  for (const b of bumps) b();
}

/** The last answer of each question (by identity), shown while a refresh after an import asks again. */
const lastShown = new Map<string, unknown>();
const savedMeta = new Map<string, { cached: true; savedAt: number | null }>();
function askAgain(o: { forget: boolean }): void {
  cache.clear();
  pending.clear();
  if (o.forget) { lastShown.clear(); savedMeta.clear(); }
  generation++;
  for (const b of bumps) b();
}
// (0.6.3 A30) answers are kept per paired server and person; another one (or an unpairing, a revoked device) drops them
onGaugeIdentityChange(() => askAgain({ forget: true }));
registerEraseHook(() => askAgain({ forget: true }));

/** (FX1, sR15) The pairing ended or this device may not read Gauge data: never the last answer. */
const refused = (p: GaugeProblem | null | undefined): boolean => p === 'unauthorized' || p === 'not_paired';
const problemOf = (api: ProgressGauge): GaugeProblem | null => {
  try {
    return api.status ? api.status().problem : null;
  } catch {
    return null;
  }
};
/**
 * (FX1, sR15) Forget every answer in place: each question now answers unavailable until asked again after the short wait
 * (no new generation, so a refused server is not asked again at once in a loop).
 */
function forgetRefused(): void {
  refusalRevision++;
  lastShown.clear();
  savedMeta.clear();
  const t = Date.now();
  for (const k of new Set([...cache.keys(), ...pending.keys()])) cache.set(k, { at: t, value: null });
  pending.clear();
  epoch++;
  for (const b of bumps) b();
}
// (FX1, sR15) any Gauge read refused (the Ring's, the import's): Progress forgets what it shows too
try {
  let was = false;
  gaugeApi.subscribe(() => {
    const now = refused(problemOf(progressGauge()));
    if (now && !was) forgetRefused();
    was = now;
  });
} catch {
  // no Gauge client here: the per-answer check below still applies
}
// (0.6.3 S28) a successful import or measurement: ask again, keeping what is shown until the new answer arrives (a
// failed read is never kept past it either)
onGaugeDataChanged(() => askAgain({ forget: false }));

export type GaugeRead<T> = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; data: T; cached?: boolean; savedAt?: number | null };

const subscribe = (fn: () => void) => {
  bumps.add(fn);
  return () => bumps.delete(fn);
};
const snapshot = () => `${generation}:${epoch}`;

/**
 * Ask one question; `key` names it (method and arguments) so every card on screen shares the answer. (r063 S27/A29) The
 * answer expires (`PROGRESS_GAUGE_TTL_MS`, a failure after `PROGRESS_GAUGE_RETRY_MS`) and is asked again while the card is
 * on screen; the old answer stays shown until the new one arrives (a failed refresh never blanks a good answer).
 */
export function useProgressGauge<T>(key: string, load: (api: ProgressGauge) => Promise<T | null>): GaugeRead<T> {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const gen = generation;
  const refusedAt = refusalRevision;
  const shownKey = `${gaugeIdentity() ?? '-'}:${key}`;
  const cacheKey = `${gen}:${shownKey}`;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hit = cache.get(cacheKey);
    const age = hit ? Date.now() - hit.at : Number.POSITIVE_INFINITY;
    if (hit && age < ttlOf(hit.value)) {
      // fresh: come back when it expires
      timer = setTimeout(() => live && setTick((t) => t + 1), ttlOf(hit.value) - age + 5);
      return () => {
        live = false;
        if (timer) clearTimeout(timer);
      };
    }
    let p = pending.get(cacheKey);
    if (!p) {
      const source = progressGauge();
      const api = source.withOptions?.({}) ?? source;
      let completed = false;
      if (!lastShown.has(shownKey) && api.snapshot) {
        void api.snapshot(load).then((saved) => {
          if (gen !== generation || refusedAt !== refusalRevision || refused(problemOf(source)) || completed || saved.data === null || saved.savedAt === null) return;
          lastShown.set(shownKey, saved.data);
          savedMeta.set(shownKey, { cached: true, savedAt: saved.savedAt });
          epoch++;
          for (const b of bumps) b();
        }).catch(() => undefined);
      }
      p = load(api)
        .catch(() => null)
        .then((v) => {
          completed = true;
          if (gen !== generation || refusedAt !== refusalRevision) {
            if (pending.get(cacheKey) === p) pending.delete(cacheKey);
            return null;
          }
          const prev = cache.get(cacheKey);
          const none = v === null || v === undefined;
          if (none && refused(problemOf(api))) {
            // (FX1, sR15) refused, not offline: this answer and every other one kept is forgotten
            pending.delete(cacheKey);
            forgetRefused();
            cache.set(cacheKey, { at: Date.now(), value: null });
            return v;
          }
          // a failed refresh keeps the good answer it would replace (asked again after the short wait)
          const previous = prev?.value ?? lastShown.get(shownKey);
          cache.set(cacheKey, none && previous != null ? { at: Date.now() - PROGRESS_GAUGE_TTL_MS + PROGRESS_GAUGE_RETRY_MS, value: previous } : { at: Date.now(), value: v });
          if (!none) lastShown.set(shownKey, v);
          if (problemOf(api) === null && !none) savedMeta.delete(shownKey);
          else if (lastShown.has(shownKey)) savedMeta.set(shownKey, { cached: true, savedAt: savedMeta.get(shownKey)?.savedAt ?? null });
          while (cache.size > 192) cache.delete(cache.keys().next().value!);
          while (lastShown.size > 192) { const oldest = lastShown.keys().next().value!; lastShown.delete(oldest); savedMeta.delete(oldest); }
          pending.delete(cacheKey);
          return v;
        });
      pending.set(cacheKey, p);
    }
    void p.then(() => {
      if (live) setTick((t) => t + 1);
    });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // `load` is keyed by `key`; `tick` re-checks the expiry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, tick, refusedAt]);
  const hit = cache.get(cacheKey);
  if (!hit) return lastShown.has(shownKey) ? { status: 'ready', data: lastShown.get(shownKey) as T, ...savedMeta.get(shownKey) } : { status: 'loading' };
  const v = hit.value as T | null;
  return v === null || v === undefined ? { status: 'unavailable' } : { status: 'ready', data: v, ...savedMeta.get(shownKey) };
}
