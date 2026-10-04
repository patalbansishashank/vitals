/**
 * One person program per person (SUITE_SPEC §14.1, R17 blocker 1): opened on the first request, closed after 15 minutes
 * idle. Production runs each in a `worker_threads` Worker on the bundled `dist/person-worker.mjs`; tests may pass an
 * in-process factory. The main thread never opens a person store itself.
 *
 * Memory safety (after the 2026-10-03 incident, docs/SERVER.md "Limits"):
 * - each Worker has a hard heap limit (`WORKER_LIMITS`); one that runs out dies alone, its pending requests answer
 *   `precondition_failed` with `detail.reason: 'person_restarting'`, and the next request opens it again;
 * - each request has a wall-clock limit counted from when the worker starts it (`COMMAND_TIMEOUT_MS`,
 *   `IMPORT_TIMEOUT_MS`); past it the worker is stopped and reopens on the next request;
 * - at most `maxOpenPersons` workers are open; a new person closes the least recently used idle one, and when every
 *   open person is busy the request answers `server_busy` (HTTP 503, `personErrorStatus`);
 * - once a minute every open person logs its worker's heap and the server's RSS, also written to `memory.json`.
 */
import { writeFile } from 'node:fs/promises';
import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { PersonInit, PersonRequest, PersonResponse, PersonWorkerOut } from './personRpc.ts';
import type { PersonRegistry } from './persons.ts';

export const IDLE_CLOSE_MS = 15 * 60_000;
export const DEFAULT_MAX_OPEN_PERSONS = 4;
/** Per person Worker. Hitting either limit ends the Worker with ERR_WORKER_OUT_OF_MEMORY, never the server. */
export const WORKER_LIMITS: ResourceLimits = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 };
export const COMMAND_TIMEOUT_MS = 60_000;
export const IMPORT_TIMEOUT_MS = 10 * 60_000;
export const MEMORY_LOG_MS = 60_000;

const MB = 1024 * 1024;
const mb = (n: number) => Math.round(n / MB);

/** Imports get the long limit: a Lumen batch from the broker and a file import. */
export const isImport = (req: PersonRequest) => req.op === 'ingestLumen' || (req.op === 'dispatch' && req.command.startsWith('bio.import'));
export const timeoutOf = (req: PersonRequest, t: { commandMs: number; importMs: number }) => (isImport(req) ? t.importMs : t.commandMs);

export const RESTARTING: PersonResponse = {
  ok: false,
  error: { code: 'precondition_failed', message: 'Your data on the server is restarting. Try again in a moment.', detail: { reason: 'person_restarting' } },
};
export const SERVER_BUSY: PersonResponse = {
  ok: false,
  error: { code: 'server_busy', message: 'The server is busy with other people right now. Try again in a minute.' },
};
const span = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);
const timedOut = (ms: number): PersonResponse => ({
  ok: false,
  error: { code: 'precondition_failed', message: `This took longer than ${span(ms)} and was stopped. Try again.`, detail: { reason: 'timeout' } },
});

/** HTTP status for a person-worker error code, for routes that answer a failed `pool.call` directly. */
export function personErrorStatus(code: string): number {
  return code === 'server_busy' ? 503 : code === 'precondition_failed' ? 409 : 500;
}

export interface WorkerMemory {
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
}
/** `message` completes "person <id>: worker …" in the log. */
export type WorkerExit = { reason: 'out_of_memory' | 'timeout' | 'crashed'; message: string };

export interface PersonWorker {
  call(req: PersonRequest): Promise<PersonResponse>;
  close(): Promise<void>;
  /** Settles once when the worker ends without being asked to (out of memory, over a time limit, a crash). */
  exited?: Promise<WorkerExit>;
  /** The worker's own V8 heap (a thread has no RSS of its own); null when it cannot be read. */
  memory?(): Promise<WorkerMemory | null>;
  /** Diagnostics for the loopback control route: the worker's own report (null when it does not answer in 2 s) and what the main thread sees. */
  diag?(): Promise<WorkerDiag>;
  /** Writes the worker's heap snapshot to `file`; resolves to the file name. */
  snapshot?(file: string): Promise<string>;
  /** Writes a CPU profile of the worker's thread over `ms` to `file`. */
  profile?(file: string, ms: number): Promise<string>;
}
export interface WorkerDiag {
  /** Requests sent and not answered yet, as the main thread counts them. */
  pending: number;
  /** Event-loop utilisation since the previous read (0–1), read from the main thread: works even when the worker's loop is blocked. */
  elu: number | null;
  report: unknown;
}
export type WorkerFactory = (init: PersonInit) => Promise<PersonWorker>;

export interface ThreadWorkerOptions {
  limits?: ResourceLimits;
  commandMs?: number;
  importMs?: number;
}

/** A Worker running the bundled person program; it reads `owner.key` itself, so the secret never crosses threads. */
export function threadWorkerFactory(bundle: string | URL, o: ThreadWorkerOptions = {}): WorkerFactory {
  const t = { commandMs: o.commandMs ?? COMMAND_TIMEOUT_MS, importMs: o.importMs ?? IMPORT_TIMEOUT_MS };
  const limits = o.limits ?? WORKER_LIMITS;
  return (init) =>
    new Promise((resolve, reject) => {
      const w = new Worker(bundle, { workerData: { init }, resourceLimits: limits });
      const pending = new Map<number, { req: PersonRequest; done: (r: PersonResponse) => void; timer?: NodeJS.Timeout }>();
      /** diag and snapshot requests, answered outside the request queue */
      const side = new Map<number, (v: unknown) => void>();
      let lastElu: ReturnType<typeof w.performance.eventLoopUtilization> | undefined;
      let next = 1;
      let ready = false;
      let dead: WorkerExit | null = null;
      let closing = false;
      let onExit!: (x: WorkerExit) => void;
      const exited = new Promise<WorkerExit>((r) => (onExit = r));
      /** The worker is gone or going: answer everything still pending, once. */
      const end = (x: WorkerExit, answer: (id: number) => PersonResponse = () => RESTARTING) => {
        if (dead) return;
        dead = x;
        for (const [id, p] of pending) {
          if (p.timer) clearTimeout(p.timer);
          p.done(answer(id));
        }
        pending.clear();
        if (!closing) onExit(x);
      };
      w.on('error', (e: Error & { code?: string }) => {
        const x: WorkerExit =
          e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? { reason: 'out_of_memory', message: `ran out of memory (heap limit ${limits.maxOldGenerationSizeMb} MB)` } : { reason: 'crashed', message: `stopped (${e.message})` };
        if (!ready) reject(e);
        end(x);
      });
      w.on('exit', (code) => {
        if (!ready) reject(new Error(`person worker exited (${code}) before it opened`));
        end({ reason: 'crashed', message: `stopped (exit code ${code})` });
      });
      w.on('message', (m: PersonWorkerOut) => {
        if ('fatal' in m) return reject(new Error(m.fatal));
        if ('ready' in m) {
          ready = true;
          const send = (msg: { req: PersonRequest } | { close: true }) =>
            new Promise<PersonResponse>((done) => {
              if (dead) return done(RESTARTING);
              const id = next++;
              if ('req' in msg) pending.set(id, { req: msg.req, done });
              else pending.set(id, { req: { op: 'flush' }, done });
              w.postMessage({ id, ...msg });
            });
          return resolve({
            call: (req) => send({ req }),
            close: async () => {
              closing = true;
              if (!dead) await send({ close: true });
              await w.terminate();
            },
            exited,
            diag: async () => {
              let elu: number | null;
              try {
                const now = w.performance.eventLoopUtilization();
                elu = Math.round((lastElu ? w.performance.eventLoopUtilization(now, lastElu) : now).utilization * 100) / 100;
                lastElu = now;
              } catch {
                elu = null;
              }
              const report = dead
                ? null
                : await Promise.race([
                    new Promise<unknown>((r) => {
                      const id = next++;
                      side.set(id, r);
                      w.postMessage({ id, diag: true });
                    }),
                    new Promise<null>((r) => void setTimeout(() => r(null), 2000).unref()),
                  ]);
              return { pending: pending.size, elu, report };
            },
            snapshot: (file) =>
              new Promise<string>((r) => {
                const id = next++;
                side.set(id, (v) => r((v as { file: string }).file));
                w.postMessage({ id, snapshot: file });
              }),
            profile: (file, ms) =>
              new Promise<string>((r) => {
                const id = next++;
                side.set(id, (v) => r((v as { file: string }).file));
                w.postMessage({ id, profile: file, ms });
              }),
            memory: async () => {
              if (dead || typeof w.getHeapStatistics !== 'function') return null;
              const h = await Promise.race([w.getHeapStatistics().catch(() => null), new Promise<null>((r) => void setTimeout(() => r(null), 2000).unref())]);
              return h ? { heapUsedMb: mb(h.used_heap_size), heapTotalMb: mb(h.total_heap_size), externalMb: mb((h as { external_memory?: number }).external_memory ?? 0) } : null;
            },
          });
        }
        if ('diag' in m) {
          side.get(m.id)?.(m.diag);
          side.delete(m.id);
          return;
        }
        const p = pending.get(m.id);
        if (!p) return;
        if ('started' in m) {
          // the limit counts from here: a request that waited behind others in the worker's queue is not penalised
          const ms = timeoutOf(p.req, t);
          p.timer = setTimeout(() => {
            end({ reason: 'timeout', message: `stopped: a ${p.req.op === 'dispatch' ? p.req.command : p.req.op} request ran past ${span(ms)}` }, (id) => (id === m.id ? timedOut(ms) : RESTARTING));
            void w.terminate();
          }, ms);
          p.timer.unref();
          return;
        }
        if (p.timer) clearTimeout(p.timer);
        pending.delete(m.id);
        p.done(m.res);
      });
    });
}

export interface PoolMemory {
  at: string;
  /** The server process's resident memory (every worker thread lives in it). */
  rssMb: number;
  /** Main thread V8 heap. */
  heapUsedMb: number;
  maxOpenPersons: number;
  persons: Array<{ id: string; busy: number; idleSec: number } & Partial<WorkerMemory>>;
}

export interface WorkerPool {
  /** The person's worker, opened on demand; every call resets the idle timer. Answers `server_busy` when full. */
  call(personId: string, req: PersonRequest): Promise<PersonResponse>;
  isOpen(personId: string): boolean;
  close(personId: string): Promise<void>;
  closeAll(): Promise<void>;
  /** Heap of every open worker and the process's RSS (what the minute log line and `memory.json` hold). */
  memory(): Promise<PoolMemory>;
  /** Every open worker's diagnostics (the loopback control route, `./diag.ts`). */
  diag(): Promise<Array<{ id: string; busy: number; idleSec: number } & Partial<WorkerDiag>>>;
  /** Heap snapshot of one open worker into `file`. */
  snapshot(personId: string, file: string): Promise<string | null>;
  /** CPU profile of one open worker over `ms` into `file`. */
  profile(personId: string, file: string, ms: number): Promise<string | null>;
}

export function createWorkerPool(o: {
  persons: PersonRegistry;
  factory: WorkerFactory;
  idleMs?: number;
  log?: (l: string) => void;
  maxOpenPersons?: number;
  /** 0 turns the minute memory line off. */
  memoryLogMs?: number;
  /** Where the minute sample is written (0600) for `vitals-server status`. */
  memoryFile?: string;
  now?: () => number;
}): WorkerPool {
  const { persons, factory, idleMs = IDLE_CLOSE_MS, log = () => undefined, memoryLogMs = MEMORY_LOG_MS, now = Date.now } = o;
  const maxOpen = Math.max(1, o.maxOpenPersons ?? DEFAULT_MAX_OPEN_PERSONS);
  /** `seq` orders use (two calls in the same millisecond still have an order); `lastUsed` is the clock time. */
  type Slot = { w: Promise<PersonWorker>; worker: PersonWorker | null; timer: NodeJS.Timeout | null; busy: number; seq: number; lastUsed: number };
  let seq = 0;
  const open = new Map<string, Slot>();
  /** A worker that is still flushing and closing: the next one for the same person waits for it (one process per replica directory). */
  const closing = new Map<string, Promise<void>>();

  const start = (personId: string, after?: Promise<void>): Slot => {
    const slot: Slot = { w: null as unknown as Promise<PersonWorker>, worker: null, timer: null, busy: 0, seq: ++seq, lastUsed: now() };
    slot.w = (async () => {
      await closing.get(personId);
      // the person this one displaced is closed first, so the cap holds in memory and not only in the count
      await after;
      const p = await persons.get(personId);
      if (!p) throw new Error('Unknown person.');
      const init: PersonInit = { personId, dir: persons.paths(personId).dir, timeZone: p.timeZone, deviceId: p.deviceId, relayUrl: p.relayUrl, instance: `p${personId}` };
      const t0 = performance.now();
      const worker = await factory(init);
      log(`person ${personId}: opened in ${Math.round(performance.now() - t0)} ms`);
      slot.worker = worker;
      void worker.exited?.then((x) => {
        if (open.get(personId) === slot) {
          open.delete(personId);
          if (slot.timer) clearTimeout(slot.timer);
        }
        log(`person ${personId}: worker ${x.message}; closed, it opens again on the next request`);
      });
      return worker;
    })();
    open.set(personId, slot);
    slot.w.catch(() => (open.get(personId) === slot ? open.delete(personId) : undefined));
    return slot;
  };
  const close = async (personId: string) => {
    const slot = open.get(personId);
    if (!slot) return closing.get(personId);
    open.delete(personId);
    if (slot.timer) clearTimeout(slot.timer);
    const done = (async () => {
      const w = await slot.w.catch(() => null);
      if (!w) return;
      // rescoring is flushed before the store closes (R17 blocker 6)
      await w.call({ op: 'flush' }).catch(() => undefined);
      await w.close().catch(() => undefined);
      log(`person ${personId}: closed`);
    })();
    closing.set(personId, done);
    await done;
    if (closing.get(personId) === done) closing.delete(personId);
  };
  /** The slot for a call: open, newly opened, or null when the cap is reached and every open person is busy. */
  const slotFor = (personId: string): Slot | null => {
    const have = open.get(personId);
    if (have) return have;
    let after: Promise<void> | undefined;
    if (open.size >= maxOpen) {
      let victim: [string, Slot] | undefined;
      for (const e of open) if (e[1].busy === 0 && (!victim || e[1].seq < victim[1].seq)) victim = e;
      if (!victim) return null;
      log(`person ${victim[0]}: closed to make room (at most ${maxOpen} persons open)`);
      after = close(victim[0]);
    }
    return start(personId, after);
  };

  const memory = async (): Promise<PoolMemory> => {
    const t = now();
    const list = await Promise.all(
      [...open].map(async ([id, s]) => ({ id, busy: s.busy, idleSec: s.busy ? 0 : Math.round((t - s.lastUsed) / 1000), ...((await s.worker?.memory?.().catch(() => null)) ?? {}) })),
    );
    const m = process.memoryUsage();
    return { at: new Date(t).toISOString(), rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed), maxOpenPersons: maxOpen, persons: list };
  };
  const sample = async () => {
    const m = await memory();
    for (const p of m.persons) {
      const heap = p.heapUsedMb === undefined ? 'heap unknown' : `heap ${p.heapUsedMb}/${p.heapTotalMb} MB, external ${p.externalMb} MB`;
      log(`person ${p.id}: memory ${heap}; server rss ${m.rssMb} MB`);
    }
    if (o.memoryFile) await writeFile(o.memoryFile, `${JSON.stringify(m)}\n`, { mode: 0o600 }).catch(() => undefined);
  };
  const sampler = memoryLogMs > 0 ? setInterval(() => void sample().catch(() => undefined), memoryLogMs) : null;
  sampler?.unref();

  return {
    async call(personId, req) {
      const slot = slotFor(personId);
      if (!slot) return SERVER_BUSY;
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      slot.busy++;
      try {
        return await (await slot.w).call(req);
      } finally {
        slot.busy--;
        slot.lastUsed = now();
        slot.seq = ++seq;
        if (!slot.busy && open.get(personId) === slot) {
          slot.timer = setTimeout(() => void close(personId), idleMs);
          slot.timer.unref();
        }
      }
    },
    isOpen: (personId) => open.has(personId),
    close,
    closeAll: async () => {
      if (sampler) clearInterval(sampler);
      await Promise.all([...new Set([...open.keys(), ...closing.keys()])].map(close));
    },
    memory,
    diag: async () => {
      const t = now();
      return Promise.all([...open].map(async ([id, s]) => ({ id, busy: s.busy, idleSec: s.busy ? 0 : Math.round((t - s.lastUsed) / 1000), ...((await s.worker?.diag?.().catch(() => null)) ?? {}) })));
    },
    snapshot: async (personId, file) => {
      const w = open.get(personId)?.worker;
      return w?.snapshot ? w.snapshot(file) : null;
    },
    profile: async (personId, file, ms) => {
      const w = open.get(personId)?.worker;
      return w?.profile ? w.profile(file, ms) : null;
    },
  };
}
