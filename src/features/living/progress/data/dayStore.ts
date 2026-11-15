/**
 * (r087 C3) One kept answer per local date for the questions the server answers a day at a time (the fused minute
 * timeline, a day's baselines). Every screen that needs a day reads it here, so a day is asked once however many cards
 * show it, and a window of many days never becomes a burst of requests:
 *  - today and yesterday are still filling: asked again after a few minutes, and when new data is announced (then for an
 *    answer newer than the announcement, and once more when a read was under way as it came);
 *  - an older day changes rarely: it is kept for hours, then asked again a couple at a time while a screen reads it
 *    (never the whole window at once), the days asked longest ago first, and the screens hear when such a day changed;
 *  - a day the server could not answer is null (no coverage, never zeros) and is asked again after a wait that grows;
 *  - at most `DAY_READS_IN_FLIGHT` requests run at once over every store, each at the client's background priority:
 *    this week first, the newest day first (today and this week are what is on screen first); behind them the readers
 *    take turns, so a screen that needs one older day does not wait behind another screen's long window;
 *  - a day saved on this device shows at once while the server is asked.
 * A new fusion context, another pairing, another client or erasing the app's data drops every day; a refused read
 * (401/403) too, so nothing from before a refusal is shown again (0.6.3 FX1, sR15).
 */
import { gauge, onGaugeApiChange } from '@/features/ring/api';
import type { RingApi } from '@/features/ring/types';
import { addDays, compareDates } from '@/living/dates';
import type { LocalDate } from '@/living';
import { onFusionContextChange, type GaugeCallOptions, type GaugeProblem } from '@/net/gauge';
import { onGaugeDataChanged, onGaugeIdentityChange } from '@/net/gaugeIdentity';
import { registerEraseHook } from '@/state/persistence';

/** Today and yesterday are asked again after this long (P). */
export const DAY_RECENT_TTL_MS = 5 * 60_000;
/** An older day is kept this long before it is asked again, lazily (P). */
export const DAY_PAST_TTL_MS = 6 * 3_600_000;
/** A day the server could not answer is asked again after this long, four times longer after each failure in a row. */
const DAY_RETRY_MS = 60_000;
/** The longest wait before a failed older day is asked again. */
export const DAY_RETRY_MAX_MS = 3_600_000;
/** At most this many day reads at once, over every day store. */
export const DAY_READS_IN_FLIGHT = 2;
/** Older days past their keep time are asked again at most this many per `DAY_LAZY_GAP_MS`. */
const DAY_LAZY_BATCH = 2;
export const DAY_LAZY_GAP_MS = 60_000;

/**
 * How long an answer stands before it is asked again. `fails`: the reads in a row that got nothing (0: it has an
 * answer). `recent`: today or yesterday, which never wait longer than their own keep time.
 */
export function dayKeepMs(fails: number, recent: boolean): number {
  if (fails > 0) return Math.min(DAY_RETRY_MS * 4 ** (fails - 1), recent ? DAY_RECENT_TTL_MS : DAY_RETRY_MAX_MS);
  return recent ? DAY_RECENT_TTL_MS : DAY_PAST_TTL_MS;
}

/* ---- the queue every day store shares ----------------------------------------------------------------------------- */

interface Job {
  date: LocalDate;
  lazy: boolean;
  seq: number;
  /** Who waits for it (`''`: a reader that gave no name). */
  readers: Set<string>;
  run: () => Promise<void>;
}

const waiting: Job[] = [];
let running = 0;
let seq = 0;
let pumping = false;
/** The turn at which each reader last had a read start, while reads wait (absent: none yet). */
const served = new Map<string, number>();
let turn = 0;
/** The first day of "this week" for the queue: the device's date six days back, read when reads start. */
let weekFrom: LocalDate = '';

const turnOf = (j: Job): number => {
  let t = Number.POSITIVE_INFINITY;
  for (const r of j.readers) t = Math.min(t, served.get(r) ?? -1);
  return t;
};

/**
 * A day a screen waits for before a lazy re-read. Then this week's days, the newest first. Behind them the reader whose
 * last turn is longest ago (a reader's own days the newest first): one older day another screen needs goes out at the
 * next free place, not after every newer day of a long window. Last, the order asked.
 */
function before(a: Job, b: Job): boolean {
  if (a.lazy !== b.lazy) return !a.lazy;
  const near = a.date >= weekFrom;
  if (near !== b.date >= weekFrom) return near;
  if (!near) {
    const ta = turnOf(a);
    const tb = turnOf(b);
    if (ta !== tb) return ta < tb;
  }
  return a.date !== b.date ? a.date > b.date : a.seq < b.seq;
}

function pump(): void {
  pumping = false;
  weekFrom = addDays(deviceDate(Date.now()), -6);
  while (running < DAY_READS_IN_FLIGHT && waiting.length > 0) {
    let best = 0;
    for (let i = 1; i < waiting.length; i++) if (before(waiting[i]!, waiting[best]!)) best = i;
    const job = waiting.splice(best, 1)[0]!;
    if (!job.lazy) {
      turn++;
      for (const r of job.readers) served.set(r, turn);
    }
    running++;
    void job.run().finally(() => {
      running--;
      pump();
    });
  }
  if (waiting.length === 0) served.clear();
}

/**
 * Run a per-day read through the shared queue. `lazy`: nothing on screen waits for it, so it runs after every read a
 * screen waits for (`wait()` lifts that when a screen starts to wait). `reader` names who waits (a screen's window, a
 * mounted card), for the turns between readers; `wait(reader)` adds another. `done` never rejects.
 */
export function queueDayRead(date: LocalDate, lazy: boolean, run: () => Promise<void>, reader = ''): { done: Promise<void>; wait: (reader?: string) => void } {
  let job!: Job;
  const done = new Promise<void>((resolve) => {
    job = { date, lazy, seq: seq++, readers: new Set([reader]), run: () => run().then(resolve, () => resolve()) };
  });
  waiting.push(job);
  // started after the code that is asking now has asked for all its days, so the newest of them goes first
  if (!pumping) {
    pumping = true;
    queueMicrotask(pump);
  }
  return {
    done,
    wait(who = '') {
      job.lazy = false;
      job.readers.add(who);
    },
  };
}

let lazyAt = Number.NEGATIVE_INFINITY;
let lazyUsed = 0;

function takeLazy(now: number): boolean {
  if (now - lazyAt >= DAY_LAZY_GAP_MS || now < lazyAt) {
    lazyAt = now;
    lazyUsed = 0;
  }
  if (lazyUsed >= DAY_LAZY_BATCH) return false;
  lazyUsed++;
  return true;
}

/** A lazy re-read that found the day changed gives its turn back: while older days are changing, they keep being read. */
const refundLazy = (): void => void (lazyUsed = Math.max(0, lazyUsed - 1));

/* ---- the client ---------------------------------------------------------------------------------------------------- */

type Prioritised = { withOptions?: (options: GaugeCallOptions & { priority?: 'screen' | 'background' }) => RingApi };

/**
 * The client for one day read, at background priority. A client that takes per-read options answers with a view whose
 * `status()` is this read's own; an older client or a test fake is used as it is. `since`: when new data was last
 * announced, so the answer never comes from a request another screen sent before it (the client shares identical reads).
 */
function backgroundApi(api: RingApi, since?: number): RingApi {
  try {
    return (api as RingApi & Prioritised).withOptions?.({ priority: 'background', ...(since !== undefined ? { since } : {}) }) ?? api;
  } catch {
    return api;
  }
}

const refused = (p: GaugeProblem | null): boolean => p === 'unauthorized' || p === 'not_paired';

/** The local calendar date of an instant on this device. */
function deviceDate(ms: number): LocalDate {
  const t = new Date(ms);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/* ---- a store ------------------------------------------------------------------------------------------------------- */

export type DaySource<T> = (date: LocalDate) => Promise<T | null>;
/** Why a source's last read got nothing. */
export type DayProblem = () => GaugeProblem | null;

export interface DayStore<T> {
  /**
   * The answers of `dates` (deduplicated; a date after `today` is null without a request, whatever another reader with a
   * later today holds for it). Waits for the days not held yet and for today's and yesterday's when they are due again;
   * an older day past its keep time answers what is held. `reader` names who asks, for the queue's turns.
   */
  load(dates: readonly LocalDate[], today: LocalDate, now?: number, reader?: string): Promise<Map<LocalDate, T | null>>;
  /** What is held for a date without asking: undefined when it was not answered yet. */
  peek(date: LocalDate): T | null | undefined;
  clear(): void;
  /**
   * Tests and the screenshot harness: read days from here (null restores the server), with why a read got nothing
   * (`problem`; default: never refused). Drops every day.
   */
  setSource(source: DaySource<T> | null, problem?: DayProblem): void;
  /** Hears every change of what is held and every call for the screens to ask again. */
  subscribe(listener: () => void): () => void;
  /** Moves with every `subscribe` notification. */
  revision(): number;
  /** Moves when the screens should ask for their days again (new data was announced, the days were dropped). */
  epoch(): number;
  /** Hears when a day that had an answer got another one (a late correction, a failed day that now answers): its date. */
  onChange(listener: (date: LocalDate) => void): () => void;
}

export function createDayStore<T>(o: {
  /** One day from the client; null when the server could not answer. */
  read: (api: RingApi, date: LocalDate) => Promise<T | null>;
  /** A cheap signature of an answer: a re-read with the same one keeps the object held and tells nobody. */
  signature: (value: T) => string;
}): DayStore<T> {
  interface Entry {
    value: T | null;
    /** When it was asked for. */
    at: number;
    /** Reads in a row that got nothing. */
    fails: number;
    /** New data was announced since: asked again at the next read. */
    due: boolean;
  }
  interface Flight {
    /** The day has an answer to show (a saved one, or the server's). */
    first: Promise<void>;
    /** The server answered or failed. */
    done: Promise<void>;
    wait: (reader?: string) => void;
    /** New data was announced while it ran: its answer may predate it. */
    again: boolean;
  }
  type Answer = { value: T | null; problem: GaugeProblem | null };

  const serverSource = async (date: LocalDate): Promise<Answer> => {
    let api: RingApi;
    try {
      api = backgroundApi(gauge(), changedAt);
    } catch {
      return { value: null, problem: null };
    }
    const value = await o.read(api, date).catch(() => null);
    if (value !== null) return { value, problem: null };
    try {
      return { value, problem: api.status().problem };
    } catch {
      return { value, problem: null };
    }
  };
  /** The day as this device saved it (a screen snapshot: never a request); null when there is none. */
  const serverSaved = async (date: LocalDate): Promise<T | null> => {
    const api = gauge();
    if (!api.snapshot) return null;
    const s = await api.snapshot((a) => o.read(a, date));
    return s.savedAt === null ? null : s.data;
  };

  let source = serverSource;
  let saved: ((date: LocalDate) => Promise<T | null>) | null = serverSaved;
  const cache = new Map<LocalDate, Entry>();
  const inflight = new Map<LocalDate, Flight>();
  const listeners = new Set<() => void>();
  const changeListeners = new Set<(date: LocalDate) => void>();
  /** Bumped when the days are dropped: an answer for an older generation is not kept. */
  let gen = 0;
  let rev = 0;
  let epoch = 0;
  /** When new data was last announced (undefined: not since the days were last dropped). */
  let changedAt: number | undefined;

  const bump = (): void => {
    rev++;
    for (const l of [...listeners]) l();
  };

  function clear(): void {
    cache.clear();
    inflight.clear();
    // the client drops its requests under way for the same reasons (or is another client): none from before can answer
    changedAt = undefined;
    gen++;
    epoch++;
    bump();
  }

  const recent = (date: LocalDate, today: LocalDate): boolean => compareDates(date, addDays(today, -1)) >= 0;

  /** Whether a held day stands (`keep`), must be asked before it is answered (`ask`), or is answered and asked again lazily. */
  function need(e: Entry, date: LocalDate, today: LocalDate, now: number): 'keep' | 'ask' | 'lazy' {
    const isRecent = recent(date, today);
    // (readers do not share one clock: an answer a moment ahead of this reader's reading still stands)
    if (!e.due && Math.abs(now - e.at) < dayKeepMs(e.fails, isRecent)) return 'keep';
    return e.value === null || isRecent ? 'ask' : 'lazy';
  }

  function settle(date: LocalDate, now: number, a: Answer, flight: Flight, lazy: boolean): void {
    const prev = cache.get(date);
    if (a.value === null) {
      const fails = (prev?.fails ?? 0) + 1;
      if (refused(a.problem)) {
        // (FX1, sR15) refused: nothing kept from before stands (this day and every other)
        if ([...cache.values()].some((e) => e.value !== null)) clear();
        cache.set(date, { value: null, at: now, fails, due: false });
        bump();
        return;
      }
      // a failed re-read keeps the day it had
      cache.set(date, { value: prev?.value ?? null, at: now, fails, due: false });
      if (!prev) bump();
      return;
    }
    const same = !!prev && prev.value !== null && o.signature(prev.value) === o.signature(a.value);
    cache.set(date, { value: same ? prev.value : a.value, at: now, fails: 0, due: flight.again });
    if (same) return;
    if (lazy) refundLazy();
    bump();
    if (prev) for (const l of [...changeListeners]) l(date);
  }

  function fly(date: LocalDate, now: number, lazy: boolean, reader: string): Flight {
    const had = inflight.get(date);
    if (had) {
      if (!lazy) had.wait(reader);
      return had;
    }
    const g = gen;
    let ready!: () => void;
    const first = new Promise<void>((resolve) => (ready = resolve));
    const job = queueDayRead(date, lazy, async () => {
      // dropped since it was asked for: nothing is requested
      if (g !== gen) return;
      const a = await source(date);
      if (g === gen) settle(date, now, a, flight, lazy);
    }, reader);
    const flight: Flight = {
      first,
      again: false,
      wait: job.wait,
      done: job.done.then(() => {
        if (inflight.get(date) === flight) inflight.delete(date);
        ready();
        // new data was announced while it ran: the screens ask again, once (the next read starts with `again` false)
        if (flight.again && g === gen) {
          epoch++;
          bump();
        }
      }),
    };
    inflight.set(date, flight);
    if (saved && !cache.has(date)) {
      void saved(date).then(
        (value) => {
          if (g !== gen || value === null || cache.has(date)) return;
          cache.set(date, { value, at: now, fails: 0, due: false });
          bump();
          ready();
        },
        () => undefined,
      );
    }
    return flight;
  }

  async function load(dates: readonly LocalDate[], today: LocalDate, now: number = Date.now(), reader = ''): Promise<Map<LocalDate, T | null>> {
    const want = [...new Set(dates)].filter((d) => compareDates(d, today) <= 0);
    const waits: Promise<void>[] = [];
    const stale: Array<{ date: LocalDate; at: number }> = [];
    for (const d of want) {
      const e = cache.get(d);
      if (!e) waits.push(fly(d, now, false, reader).first);
      else {
        const n = need(e, d, today, now);
        if (n === 'ask') waits.push(fly(d, now, false, reader).done);
        else if (n === 'lazy' && !inflight.has(d)) stale.push({ date: d, at: e.at });
      }
    }
    // the days asked longest ago first (the newest of those asked together): visits hours apart go through the whole
    // window instead of the same newest days each time
    stale.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.date < b.date ? 1 : -1));
    for (const { date } of stale) {
      if (!takeLazy(now)) break;
      fly(date, now, true, reader);
    }
    await Promise.all(waits);
    // a date after this reader's today is unknown to it, also when a reader with a later today had it read
    return new Map(dates.map((d) => [d, compareDates(d, today) > 0 ? null : (cache.get(d)?.value ?? null)] as const));
  }

  // (r063 S6) a new fusion context on the server changes every fused answer: the past days are dropped too
  onFusionContextChange(() => clear());
  // (0.6.3 A30) another server or person (or an unpairing) holds other days: nothing kept before stands
  onGaugeIdentityChange(() => clear());
  onGaugeApiChange(() => clear());
  // "Erase all data": nothing read before stays in memory
  registerEraseHook(() => clear());
  // (0.6.3 S28) new data arrived: the ring is still uploading today and yesterday; an older day waits for its keep time
  onGaugeDataChanged((at) => {
    const nowMs = Date.now();
    // a late report of an earlier change never moves it back
    changedAt = Math.max(changedAt ?? Number.NEGATIVE_INFINITY, at ?? nowMs);
    const since = addDays(deviceDate(nowMs), -1);
    let any = false;
    for (const [d, e] of cache) {
      if (d < since) continue;
      e.due = true;
      any = true;
    }
    for (const [d, f] of inflight) if (d >= since) f.again = true;
    if (!any) return;
    epoch++;
    bump();
  });

  return {
    load,
    peek: (date) => cache.get(date)?.value,
    clear,
    setSource(s, problem) {
      source = s
        ? async (date) => {
            const value = await s(date).catch(() => null);
            return { value, problem: value === null ? (problem?.() ?? null) : null };
          }
        : serverSource;
      saved = s ? null : serverSaved;
      clear();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    revision: () => rev,
    epoch: () => epoch,
    onChange(listener) {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    },
  };
}
