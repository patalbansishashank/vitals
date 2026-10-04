/**
 * When to sync (R7 §8, SUITE_SPEC §2.6 triggers): app open, tab visible, network back, a local write (debounced 2 s),
 * a heartbeat every 5 minutes while visible, and "Sync now". The live socket pushes and receives on its own; these
 * rounds are the fallback that catches anything a dropped socket missed.
 *
 * After 3 consecutive failures the next automatic round waits 30 s, doubling up to 5 minutes; a manual "Sync now"
 * and the network coming back always run at once. Rounds never overlap: a trigger during a round runs one more round afterwards.
 *
 * Tier H: no DOM. The caller forwards visibility and online events (see `src/state/sync`).
 */

export type SyncTrigger = 'open' | 'visible' | 'online' | 'write' | 'heartbeat' | 'manual' | 'retry';

export interface SchedulerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SchedulerOptions {
  /** One reconcile round; resolve true on success, false (or throw) on failure. */
  round(trigger: SyncTrigger): Promise<boolean>;
  timers?: SchedulerTimers;
  writeDebounceMs?: number;
  heartbeatMs?: number;
  backoffStartMs?: number;
  backoffMaxMs?: number;
  /** Consecutive failures before backing off. */
  failuresBeforeBackoff?: number;
}

export interface SyncScheduler {
  start(): void;
  stop(): void;
  trigger(reason: SyncTrigger): Promise<void>;
  /** A local write happened (debounced). */
  noteWrite(): void;
  setVisible(visible: boolean): void;
  readonly failures: number;
  /** Milliseconds of the current back-off, 0 when none. */
  readonly backoffMs: number;
}

export const SYNC_TIMING = { writeDebounceMs: 2000, heartbeatMs: 5 * 60_000, backoffStartMs: 30_000, backoffMaxMs: 5 * 60_000, failuresBeforeBackoff: 3 };

const BYPASS_BACKOFF: ReadonlySet<SyncTrigger> = new Set(['manual', 'retry', 'online']);

export function createSyncScheduler(options: SchedulerOptions): SyncScheduler {
  const t = options.timers ?? { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (h) => globalThis.clearTimeout(h as number) };
  const writeDebounceMs = options.writeDebounceMs ?? SYNC_TIMING.writeDebounceMs;
  const heartbeatMs = options.heartbeatMs ?? SYNC_TIMING.heartbeatMs;
  const backoffStartMs = options.backoffStartMs ?? SYNC_TIMING.backoffStartMs;
  const backoffMaxMs = options.backoffMaxMs ?? SYNC_TIMING.backoffMaxMs;
  const failuresBeforeBackoff = options.failuresBeforeBackoff ?? SYNC_TIMING.failuresBeforeBackoff;

  let running = false;
  let visible = true;
  let inFlight: Promise<void> | null = null;
  let again: SyncTrigger | null = null;
  let failures = 0;
  let backoffMs = 0;
  let writeTimer: unknown = null;
  let heartbeatTimer: unknown = null;
  let retryTimer: unknown = null;

  const clear = (h: unknown) => {
    if (h !== null) t.clearTimeout(h);
  };
  const armHeartbeat = () => {
    clear(heartbeatTimer);
    heartbeatTimer = running && visible ? t.setTimeout(() => void scheduler.trigger('heartbeat'), heartbeatMs) : null;
  };

  const runRound = async (reason: SyncTrigger): Promise<void> => {
    let ok: boolean;
    try {
      ok = await options.round(reason);
    } catch {
      ok = false;
    }
    if (ok) {
      failures = 0;
      backoffMs = 0;
      clear(retryTimer);
      retryTimer = null;
    } else {
      failures += 1;
      if (failures >= failuresBeforeBackoff) {
        backoffMs = backoffMs === 0 ? backoffStartMs : Math.min(backoffMaxMs, backoffMs * 2);
        clear(retryTimer);
        retryTimer = running ? t.setTimeout(() => void scheduler.trigger('retry'), backoffMs) : null;
      }
    }
    armHeartbeat();
  };

  const scheduler: SyncScheduler = {
    get failures() {
      return failures;
    },
    get backoffMs() {
      return backoffMs;
    },
    start() {
      if (running) return;
      running = true;
      // a stop cleared the retry timer: a back-off left from before would otherwise block every automatic round
      failures = 0;
      backoffMs = 0;
      void scheduler.trigger('open');
    },
    stop() {
      running = false;
      for (const h of [writeTimer, heartbeatTimer, retryTimer]) clear(h);
      writeTimer = heartbeatTimer = retryTimer = null;
    },
    async trigger(reason) {
      if (!running) return;
      // While backing off, only "Sync now", the scheduled retry and the network coming back run a round.
      if (backoffMs > 0 && !BYPASS_BACKOFF.has(reason)) return;
      if (inFlight) {
        again = reason;
        return inFlight;
      }
      inFlight = (async () => {
        try {
          await runRound(reason);
          while (again && running) {
            const next = again;
            again = null;
            if (backoffMs > 0 && !BYPASS_BACKOFF.has(next)) break;
            await runRound(next);
          }
        } finally {
          again = null;
          inFlight = null;
        }
      })();
      return inFlight;
    },
    noteWrite() {
      if (!running) return;
      clear(writeTimer);
      writeTimer = t.setTimeout(() => {
        writeTimer = null;
        void scheduler.trigger('write');
      }, writeDebounceMs);
    },
    setVisible(v) {
      const was = visible;
      visible = v;
      if (!running) return;
      if (v && !was) void scheduler.trigger('visible');
      else armHeartbeat();
    },
  };
  return scheduler;
}

const NOT_CONNECTED: ReadonlySet<string> = new Set(['offline', 'error', 'connecting']);

/**
 * Feed it every engine state; it calls `back` when the state goes from offline, error or connecting to synced. The
 * caller runs the `online` round then: the socket came back on its own (a relay restart, a link that flapped without a
 * browser `online` event), so queued blob uploads go out at once and the back-off resets (`online` bypasses it).
 */
export function onEngineBack(back: () => void): (state: string) => void {
  let prev: string | null = null;
  return (state) => {
    const was = prev;
    prev = state;
    if (state === 'synced' && was !== null && NOT_CONNECTED.has(was)) back();
  };
}
