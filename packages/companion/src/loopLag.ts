/**
 * Event-loop lag for `/health` (r063: the 2026-10-28 incident, when one synchronous SQLite read held the loop for
 * minutes and every request queued behind it). `perf_hooks.monitorEventLoopDelay` samples the loop's delay; the numbers
 * cover the current and the previous 30-second window, so a stall shows in `/health` for half a minute to a minute
 * after it ends. While the loop is blocked `/health` cannot answer at all: the deployment's watchdog
 * (`deploy/vitals-watchdog.sh`) counts that as a failure.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

const WINDOW_MS = 30_000;
const ms = (ns: number) => Math.round(ns / 1e5) / 10;

export interface LoopLag {
  /** Mean, 99th percentile and largest delay seen in the window (ms, one decimal). */
  meanMs: number;
  p99Ms: number;
  maxMs: number;
  /** The window those cover (s). */
  windowS: number;
}

let users = 0;
let histogram: IntervalHistogram | null = null;
let timer: NodeJS.Timeout | null = null;
let previous: { mean: number; p99: number; max: number } | null = null;
let windowStart = 0;

/** Starts sampling (shared by every server in the process); the returned function stops this user's share. */
export function startLoopMonitor(): () => void {
  users++;
  if (!histogram) {
    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    windowStart = Date.now();
    timer = setInterval(() => {
      if (!histogram) return;
      previous = histogram.count > 0 ? { mean: histogram.mean, p99: histogram.percentile(99), max: histogram.max } : null;
      histogram.reset();
      windowStart = Date.now() - WINDOW_MS;
    }, WINDOW_MS);
    timer.unref();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--users > 0) return;
    histogram?.disable();
    histogram = null;
    if (timer) clearInterval(timer);
    timer = null;
    previous = null;
  };
}

/** The loop's recent delay, or null when nothing samples it. */
export function loopLag(): LoopLag | null {
  if (!histogram) return null;
  const cur = histogram.count > 0 ? { mean: histogram.mean, p99: histogram.percentile(99), max: histogram.max } : null;
  const all = [cur, previous].filter((x): x is { mean: number; p99: number; max: number } => x !== null);
  if (!all.length) return { meanMs: 0, p99Ms: 0, maxMs: 0, windowS: Math.round((Date.now() - windowStart) / 1000) };
  return {
    meanMs: ms(all.reduce((n, x) => n + x.mean, 0) / all.length),
    p99Ms: ms(Math.max(...all.map((x) => x.p99))),
    maxMs: ms(Math.max(...all.map((x) => x.max))),
    windowS: Math.round((Date.now() - windowStart) / 1000),
  };
}
