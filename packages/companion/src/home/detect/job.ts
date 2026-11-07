/**
 * The detection job (r065 autodetect CONTRACT §2): runs `detect/2` over the ranges ingest queued, never on the request
 * path. Per person, after a short debounce: the queued ranges (each widened by `AFFECT_PAD_MS`, clipped to the
 * horizon) are cut into cores of at most `CORE_MS`, and each core is one synchronous step in its own macrotask (the
 * event loop serves requests between them):
 *
 * 1. the core grows to cover the stored episodes it overlaps and any detection it finds that reaches past it (up to
 *    `MAX_CORE_MS`), so an episode is always detected and reconciled whole;
 * 2. the evidence is read for the core ± `CONTEXT_MS` (the HR baseline, bridging), inside a row budget
 *    (`READ_BUDGET_ROWS`; a core over it is split in two);
 * 3. the detections overlapping the core are reconciled with the stored episodes (`./episodes.ts`) and written in one
 *    transaction.
 *
 * The queue rows are removed only after the run, so a restart repeats the work (idempotent) rather than losing it.
 */
import { ReadBudgetError, withReadBudget, READ_BUDGET_ROWS } from '../gaugeDerive.ts';
import type { LumenStore } from '../lumenStore.ts';
import { DETECT_HORIZON_MS } from '../lumenMigrate.ts';
import { detect2, PARAMS, type DetectedEpisode, type Suppression } from './detect.ts';
import { episodeId, reconcile } from './episodes.ts';
import { detectionInput } from './features.ts';
import { mergeRanges } from './queue.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
export const AFFECT_PAD_MS = 30 * MIN;
export const CORE_MS = 6 * HOUR;
// A delayed baseline or recovery upload can be the final missing dependency of a
// previously suppressed HR bout. Read far enough to include that whole bout and
// its opposite context; otherwise a partial elevated segment becomes its own baseline.
export const CONTEXT_MS = (PARAMS.hr.maxMin + Math.max(PARAMS.hr.baselineWindow, PARAMS.hr.recoveryWindow)) * MIN;
export const MAX_CORE_MS = 36 * HOUR;
const MIN_CORE_MS = 30 * MIN;
export const DEBOUNCE_MS = 3000;

const hull = (a: readonly [number, number], xs: ReadonlyArray<{ startMs: number; endMs: number }>): [number, number] =>
  [Math.min(a[0], ...xs.map((x) => x.startMs)), Math.max(a[1], ...xs.map((x) => x.endMs))];

export interface CoreResult {
  episodes: number;
  writes: number;
  suppressed: Suppression[];
}

/** Detects and reconciles one core `[loMs, hiMs)` (synchronous; call inside a row budget). */
export function processCore(store: LumenStore, loMs: number, hiMs: number, o: { tz: string; nowMs: number }): CoreResult {
  let core: [number, number] = [Math.floor(loMs / MIN) * MIN, Math.ceil(hiMs / MIN) * MIN];
  let rel: DetectedEpisode[] = [];
  let suppressed: Suppression[] = [];
  for (let pass = 0; pass < 6; pass++) {
    core = hull(core, store.detections.overlapping(core[0], core[1]).filter((s) => s.state !== 'withdrawn'));
    const w = detectionInput(store, core[0] - CONTEXT_MS, core[1] + CONTEXT_MS, o);
    const res = detect2(w.input);
    rel = res.episodes.filter((e) => e.startMs < core[1] && e.endMs > core[0]);
    suppressed = res.suppressed.filter((e) => e.startMs < core[1] && e.endMs > core[0]);
    const next = hull(core, rel);
    if ((next[0] === core[0] && next[1] === core[1]) || next[1] - next[0] > MAX_CORE_MS) break;
    core = next;
  }
  const span = hull(core, rel);
  const stored = store.detections.overlapping(span[0], span[1]);
  const writes = reconcile(stored, rel, { nowMs: o.nowMs, newId: (d, k) => episodeId(d, k, o.nowMs) });
  store.detections.apply(writes);
  return { episodes: rel.length, writes: writes.length, suppressed };
}

export interface RunReport {
  cores: number;
  writes: number;
  ms: number;
  skipped: number;
}

export interface DetectionJob {
  /** Something was queued for this person: run soon (debounced). */
  kick(personId: string): void;
  /** Runs the person's queue now (resolves when it is empty or the job closed). */
  run(personId: string): Promise<RunReport>;
  close(): void;
}

export interface DetectionJobOptions {
  open: (personId: string) => LumenStore | null;
  tzOf: (personId: string) => Promise<string> | string;
  now?: () => number;
  log?: (line: string) => void;
  debounceMs?: number;
  coreMs?: number;
  /** (r069 sync) A kicked run wrote episodes: the Gauge pulse tells the person's Vitals devices. */
  onWrites?: (personId: string, writes: number) => void;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

export function createDetectionJob(o: DetectionJobOptions): DetectionJob {
  const now = o.now ?? Date.now;
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Map<string, Promise<RunReport>>();
  const again = new Set<string>();
  let closed = false;

  async function runOnce(personId: string): Promise<RunReport> {
    const started = performance.now();
    const report: RunReport = { cores: 0, writes: 0, ms: 0, skipped: 0 };
    const first = o.open(personId);
    if (!first) return report;
    const queued = first.detections.queue();
    if (!queued.length) return report;
    const tz = await o.tzOf(personId);
    const nowMs = now();
    const maxId = Math.max(...queued.map((q) => q.id));
    const ranges = mergeRanges(queued.map((q) => [q.fromMs - AFFECT_PAD_MS, q.toMs + AFFECT_PAD_MS] as const), nowMs, 0)
      .map(([a, b]) => [Math.max(a, nowMs - DETECT_HORIZON_MS), Math.min(b, nowMs + 5 * MIN)] as [number, number]).filter(([a, b]) => b > a);
    const size = o.coreMs ?? CORE_MS;
    const cores: Array<[number, number]> = [];
    for (const [a, b] of ranges) for (let x = a; x < b; x += size) cores.push([x, Math.min(b, x + size)]);
    const suppressed: Record<string, number> = {};
    let processed = 0;
    while (cores.length) {
      if (closed) return report;
      await tick();
      const store = o.open(personId);
      if (!store) return report;
      const [a, b] = cores.shift()!;
      try {
        const r = withReadBudget(() => processCore(store, a, b, { tz, nowMs }), READ_BUDGET_ROWS);
        report.cores++;
        report.writes += r.writes;
        for (const s of r.suppressed) suppressed[s.reason] = (suppressed[s.reason] ?? 0) + 1;
        processed = Math.max(processed, Math.min(b, nowMs));
      } catch (e) {
        if (e instanceof ReadBudgetError && b - a > MIN_CORE_MS) {
          const mid = a + Math.floor((b - a) / 2 / MIN) * MIN;
          cores.unshift([a, mid], [mid, b]);
          continue;
        }
        report.skipped++;
        o.log?.(`detect: a window could not be processed (${e instanceof Error ? e.name : 'error'})`);
      }
    }
    const store = o.open(personId);
    // A failed core must remain durable work. Replaying successful cores is idempotent;
    // deleting the batch here would silently lose the failed window until another upload
    // happens to touch it. Do not advance the completion watermark for a partial run.
    if (store && report.skipped === 0) {
      store.detections.dequeue(maxId);
      store.detections.noteRun({ processedMs: processed || nowMs, suppressed });
    }
    report.ms = Math.round(performance.now() - started);
    return report;
  }

  async function run(personId: string): Promise<RunReport> {
    const cur = running.get(personId);
    if (cur) {
      again.add(personId);
      return cur;
    }
    const p = (async () => {
      const total: RunReport = { cores: 0, writes: 0, ms: 0, skipped: 0 };
      do {
        again.delete(personId);
        const r = await runOnce(personId);
        total.cores += r.cores;
        total.writes += r.writes;
        total.ms += r.ms;
        total.skipped += r.skipped;
      } while (again.has(personId) && !closed);
      return total;
    })().finally(() => running.delete(personId));
    running.set(personId, p);
    return p;
  }

  return {
    kick(personId) {
      if (closed) return;
      const t = timers.get(personId);
      if (t) clearTimeout(t);
      const timer = setTimeout(() => {
        timers.delete(personId);
        run(personId).then((r) => {
          if (r.cores) o.log?.(`detect: person ${personId}: ${r.cores} windows, ${r.writes} episode writes in ${r.ms} ms`);
          if (r.writes > 0) o.onWrites?.(personId, r.writes);
        }, (e: unknown) => o.log?.(`detect: person ${personId}: failed (${e instanceof Error ? e.name : 'error'})`));
      }, o.debounceMs ?? DEBOUNCE_MS);
      timer.unref();
      timers.set(personId, timer);
    },
    run,
    close() {
      closed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
