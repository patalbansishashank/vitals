/** Test-harness scheduling only: rolling load is a retry heuristic, never an exemption from the time budget. */
import type { BenchRow } from '../bench/benchEntry';

/** One-minute load average per available CPU; it is not an instantaneous CPU-utilization measurement. */
export function machineLoad(): number {
  const g = globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } };
  const os = g.process?.getBuiltinModule?.('node:os') as { loadavg(): number[]; availableParallelism?(): number; cpus(): unknown[] } | undefined;
  if (!os) return 0;
  const n = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  return (os.loadavg()[0] ?? 0) / Math.max(1, n);
}

const LOAD_THRESHOLD = 0.5;
const MAX_WAIT_MS = 120_000;
// Leave room for the existing 25-run retry, assertions and bundle cleanup inside the 240-second test deadline.
const RETRY_RESERVE_MS = 30_000;
const POLL_MS = 1_000;

export interface BenchAttempt {
  runs: 15 | 25;
  rows: BenchRow[];
  load: number;
}
export interface LoadWait {
  waitedMs: number;
  initialLoad: number;
  finalLoad: number;
  belowThreshold: boolean;
}
export interface BenchMeasurement {
  first: BenchAttempt;
  retry?: BenchAttempt;
  wait?: LoadWait;
  rows: BenchRow[];
}
interface RetryOptions {
  deadlineMs: number;
  load?: () => number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (attempt: BenchAttempt) => void;
  onWait?: (wait: LoadWait) => void;
}

/** Keeps both attempts' numbers. The caller must assert the final rows even when the rolling load stays high. */
export async function measureWithLoadRetry(
  bench: (runs: number) => BenchRow[],
  within: (rows: BenchRow[]) => boolean,
  options: RetryOptions,
): Promise<BenchMeasurement> {
  const load = options.load ?? machineLoad;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const first: BenchAttempt = { runs: 15, rows: bench(15), load: load() };
  options.onAttempt?.(first);
  // A measured pass stands even under high rolling load. A quiet over-budget result fails without an extra attempt.
  if (within(first.rows) || !(first.load > LOAD_THRESHOLD)) return { first, rows: first.rows };

  const started = now();
  const maxWait = Math.max(0, Math.min(MAX_WAIT_MS, options.deadlineMs - started - RETRY_RESERVE_MS));
  let currentLoad = first.load;
  while (currentLoad > LOAD_THRESHOLD && now() - started < maxWait) {
    await sleep(Math.min(POLL_MS, Math.max(0, maxWait - (now() - started))));
    currentLoad = load();
  }
  const wait: LoadWait = { waitedMs: Math.max(0, now() - started), initialLoad: first.load, finalLoad: currentLoad, belowThreshold: currentLoad <= LOAD_THRESHOLD };
  options.onWait?.(wait);
  // The same loaded function/module is reused, preserving its JIT state. benchEngine's own warm-ups are unchanged.
  const retry: BenchAttempt = { runs: 25, rows: bench(25), load: load() };
  options.onAttempt?.(retry);
  return { first, retry, wait, rows: retry.rows };
}
