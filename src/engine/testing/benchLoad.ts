/**
 * Load scaling for the engine micro-benchmarks.
 *
 * The benches assert time budgets measured on a quiet machine. On a busy machine (the release gate shares the PC with
 * other suites) every core runs slower, so a fixed limit fails without any code change. Here a fixed calibration loop,
 * shaped like the module hooks (typed arrays, Math.exp, branches), is timed in the same process right before and right
 * after the bench. The budget is multiplied by how much slower that loop ran than on the quiet reference machine.
 * A busy machine slows both, so the guard holds; a real slowdown of the module slows only the bench, so it still fails.
 */

/**
 * Best calibration time in ms on the quiet reference machine (dev PC). On other hardware set VITALS_BENCH_REF_MS to that
 * machine's quiet figure (`calibrationMs()`): a uniformly slower machine would otherwise read as "loaded" and, with the
 * gain below, loosen every limit more than the code slows.
 */
const envRef = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITALS_BENCH_REF_MS);
export const CALIBRATION_REF_MS = Number.isFinite(envRef) && envRef > 0 ? envRef : 0.39;

/**
 * Module code (memory traffic, many small objects) slows more under contention than this compact loop: at load ~45 on
 * the dev PC the benches slowed 1.6-2.5× as much as the loop's own excess (loop 1.32×, intake 1.79×). So the excess
 * over 1 is doubled. A quiet machine still gets a factor of about 1.
 */
const LOAD_GAIN = 2;

/** The factor never tightens a budget, and a machine more than this many times slower is not trusted to judge. */
const MAX_FACTOR = 6;

const N = 2048;
const a = new Float64Array(N);
const b = new Float64Array(N);
let sink = 0;

function calibrationRun(): number {
  for (let i = 0; i < N; i++) {
    a[i] = (i % 97) / 97; // same start every run, so every run does the same work
    b[i] = 0;
  }
  const t0 = performance.now();
  for (let r = 0; r < 24; r++) {
    for (let i = 0; i < N; i++) {
      const x = a[i]! * 0.999 + b[i]! * 0.001 + r * 1e-6;
      a[i] = x > 1 ? x - 1 : x;
      b[i] = Math.exp(-x) + (i & 1 ? 0.5 : 0.25);
    }
    sink += a[r]!;
  }
  return performance.now() - t0;
}

/**
 * Best of several timed calibration runs (after a warm-up), in ms. The best run is the least noisy figure and matches
 * the benches, most of which assert on their best run too.
 */
export function calibrationMs(runs = 25): number {
  for (let i = 0; i < 10; i++) calibrationRun();
  let best = Infinity;
  for (let i = 0; i < runs; i++) best = Math.min(best, calibrationRun());
  if (!Number.isFinite(sink)) throw new Error('calibration loop diverged');
  return best;
}

/** How much slower this process runs now than the quiet reference machine (≥ 1, capped). */
export function loadFactor(): number {
  const ratio = calibrationMs() / CALIBRATION_REF_MS;
  return Math.min(MAX_FACTOR, Math.max(1, 1 + LOAD_GAIN * (ratio - 1)));
}

/**
 * Runs `measure` between two calibrations and returns its result with the load factor. The smaller of the two is used:
 * a real load lasts across the bench and shows in both, while a short spike in one calibration must not loosen the
 * guard. Use as `expect(ms).toBeLessThan(BUDGET * factor)`.
 */
export function measureUnderLoad<T>(measure: () => T): { result: T; factor: number } {
  const before = loadFactor();
  const result = measure();
  const after = loadFactor();
  return { result, factor: Math.min(before, after) };
}
