/**
 * worker_threads entry of one person (bundled by `vite.person.config.ts` to `dist/person-worker.mjs`):
 * `new Worker(bundle, { workerData: { init: PersonInit } })`. Reads the owner secret from `<dir>/owner.key` (32 raw
 * bytes, never logged), opens the person's program and serves `{ id, req }` / `{ id, close: true }` (`./personRpc.ts`).
 * Memory and time limits are set and enforced by the main thread (`./workers.ts`): this file only reports when a request
 * starts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHeapSpaceStatistics, getHeapStatistics, writeHeapSnapshot } from 'node:v8';
import { parentPort, workerData } from 'node:worker_threads';
import type { PersonInit, PersonResponse, PersonWorkerIn, PersonWorkerOut } from './personRpc.ts';

const port = parentPort!;
const post = (m: PersonWorkerOut) => port.postMessage(m);

/** A CPU profile of this thread for `ms`, written to `file` (Chrome DevTools format). */
async function cpuProfile(file: string, ms: number): Promise<string> {
  const { Session } = await import('node:inspector/promises');
  const { writeFileSync } = await import('node:fs');
  const s = new Session();
  s.connect();
  await s.post('Profiler.enable');
  await s.post('Profiler.start');
  await new Promise((r) => setTimeout(r, ms));
  const { profile } = await s.post('Profiler.stop');
  s.disconnect();
  writeFileSync(file, JSON.stringify(profile), { mode: 0o600 });
  return file;
}

async function main(): Promise<void> {
  // @evolu/common relies on Map/WeakMap getOrInsert[Computed] (TC39 upsert); install before Evolu loads
  const { installPolyfills } = await import('@evolu/common/polyfills');
  installPolyfills();
  const { init } = workerData as { init: PersonInit };
  const secret = new Uint8Array(readFileSync(join(init.dir, 'owner.key')));
  if (secret.length !== 32) throw new Error(`owner.key of person ${init.personId} is not 32 bytes`);
  const { openPersonProgram } = await import('./personProgram.ts');
  const program = await openPersonProgram(init, secret);
  secret.fill(0);

  // event-loop delay since the last diagnostic read (a loop blocked by a synchronous call shows here)
  let tick = performance.now();
  let maxLagMs = 0;
  setInterval(() => {
    const t = performance.now();
    maxLagMs = Math.max(maxLagMs, t - tick - 500);
    tick = t;
  }, 500).unref();
  let waiting = 0;
  let current: { op: string; since: number } | null = null;

  // one request at a time, in arrival order: the bus and the document runtime are shared by every request
  let queue: Promise<void> = Promise.resolve();
  port.on('message', (m: PersonWorkerIn) => {
    // diagnostics are answered at once, outside the queue
    if ('diag' in m) {
      const mem = process.memoryUsage();
      const h = getHeapStatistics();
      post({
        id: m.id,
        diag: {
          heap: { used: h.used_heap_size, total: h.total_heap_size, limit: h.heap_size_limit, external: h.external_memory, malloced: h.malloced_memory, peakMalloced: h.peak_malloced_memory, contexts: h.number_of_native_contexts, detached: h.number_of_detached_contexts },
          spaces: Object.fromEntries(getHeapSpaceStatistics().map((x) => [x.space_name, x.space_used_size])),
          arrayBuffers: mem.arrayBuffers,
          rss: mem.rss,
          waiting,
          current: current ? { op: current.op, ms: Math.round(performance.now() - current.since) } : null,
          maxLagMs: Math.round(maxLagMs),
          resources: process.getActiveResourcesInfo().reduce<Record<string, number>>((a, r) => ((a[r] = (a[r] ?? 0) + 1), a), {}),
        },
      });
      maxLagMs = 0;
      return;
    }
    if ('profile' in m) {
      void cpuProfile(m.profile, m.ms).then((file) => post({ id: m.id, diag: { file } }), (e: unknown) => post({ id: m.id, diag: { error: String(e) } }));
      return;
    }
    if ('snapshot' in m) {
      post({ id: m.id, diag: { file: writeHeapSnapshot(m.snapshot) } });
      return;
    }
    waiting++;
    queue = queue.then(async () => {
      waiting--;
      if ('close' in m) {
        await program.close().catch(() => undefined);
        post({ id: m.id, res: { ok: true, value: null } });
        port.close();
        process.exit(0);
      }
      // the main thread's time limit for this request starts now, not while it waited in this queue
      post({ id: m.id, started: true });
      current = { op: m.req.op === 'dispatch' || m.req.op === 'agentCall' ? `${m.req.op} ${m.req.command}` : m.req.op, since: performance.now() };
      let res: PersonResponse;
      try {
        res = await program.handle(m.req);
      } catch (e) {
        res = { ok: false, error: { code: 'internal', message: e instanceof Error ? e.message : String(e) } };
      }
      current = null;
      post({ id: m.id, res });
    });
  });
  post({ ready: true });
}

main().catch((e: unknown) => {
  post({ fatal: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
