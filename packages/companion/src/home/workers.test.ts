// @vitest-environment node
/**
 * The person-worker pool's memory safety (docs/SERVER.md "Limits"): the open-person cap with least-recently-used close
 * and `server_busy`, a worker that runs out of heap, a request over its time limit, and the minute memory sample.
 * Real `worker_threads` Workers on a stand-in script (`./workers.fixture.mjs`) with the production message protocol.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PersonInit, PersonRequest, PersonResponse } from './personRpc.ts';
import type { PersonRegistry } from './persons.ts';
import { memoryLines } from './serverCli.ts';
import { loopbackRelayUrl } from './serverConfig.ts';
import { fakeWorkers } from './testHome.ts';
import { createWorkerPool, isImport, personErrorStatus, threadWorkerFactory, timeoutOf, type PersonWorker, type WorkerFactory, type WorkerPool } from './workers.ts';

const FIXTURE = new URL('./workers.fixture.mjs', import.meta.url);
const ids = ['a000000000000001', 'b000000000000002', 'c000000000000003', 'd000000000000004'] as const;
const [A, B, C] = ids;
const persons = {
  get: async (id: string) => ({ id, label: id, timeZone: 'UTC', deviceId: 'SERVERTEST000001', relayUrl: null, createdAt: '' }),
  paths: (id: string) => ({ dir: join(process.env.TMPDIR ?? '/tmp', 'workers-test', id) }),
} as unknown as PersonRegistry;
const cmd = (command: string, input: unknown = {}): PersonRequest => ({ op: 'dispatch', command, input, source: 'ui' });

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
};

const pools: WorkerPool[] = [];
afterEach(async () => {
  for (const p of pools.splice(0)) await p.closeAll();
});
const pool = (o: Partial<Parameters<typeof createWorkerPool>[0]> & { factory: WorkerFactory }) => {
  const lines: string[] = [];
  const p = createWorkerPool({ persons, log: (l) => lines.push(l), memoryLogMs: 0, ...o });
  pools.push(p);
  return { p, lines };
};

/** In-process workers whose calls wait until the test lets them go. */
function heldWorkers() {
  const opened: string[] = [];
  const closed: string[] = [];
  const held: Array<() => void> = [];
  const factory: WorkerFactory = async (init: PersonInit) => {
    opened.push(init.personId);
    const w: PersonWorker = {
      call: (req) =>
        new Promise<PersonResponse>((r) => {
          const done = () => r({ ok: true, value: init.personId });
          if (req.op === 'dispatch' && req.command === 'hold') held.push(done);
          else done();
        }),
      close: async () => void closed.push(init.personId),
    };
    return w;
  };
  return { factory, opened, closed, held, release: () => held.splice(0).forEach((f) => f()) };
}

describe('open-person cap', () => {
  it('closes the least recently used idle person to make room', async () => {
    const h = heldWorkers();
    const { p, lines } = pool({ factory: h.factory, maxOpenPersons: 2 });
    await p.call(A, cmd('x'));
    await p.call(B, cmd('x'));
    await p.call(A, cmd('x')); // B is now the least recently used
    expect(await p.call(C, cmd('x'))).toEqual({ ok: true, value: C });
    expect(h.closed).toEqual([B]);
    expect([p.isOpen(A), p.isOpen(B), p.isOpen(C)]).toEqual([true, false, true]);
    expect(lines).toContain(`person ${B}: closed to make room (at most 2 persons open)`);
    // B comes back and pushes out A (C was used later)
    await p.call(C, cmd('x'));
    await p.call(B, cmd('x'));
    expect(h.closed).toEqual([B, A]);
  });

  it('answers server_busy (503) when every open person is busy, and opens once one is free', async () => {
    const h = heldWorkers();
    const { p } = pool({ factory: h.factory, maxOpenPersons: 2 });
    const a = p.call(A, cmd('hold'));
    const b = p.call(B, cmd('hold'));
    const busy = await p.call(C, cmd('x'));
    expect(busy).toEqual({ ok: false, error: { code: 'server_busy', message: 'The server is busy with other people right now. Try again in a minute.' } });
    expect(personErrorStatus(busy.ok ? '' : busy.error.code)).toBe(503);
    await until(() => h.held.length === 2);
    expect(h.opened).toEqual([A, B]);
    h.release();
    await Promise.all([a, b]);
    expect(await p.call(C, cmd('x'))).toEqual({ ok: true, value: C });
  });

  it('defaults to 4 open persons', async () => {
    const h = heldWorkers();
    const { p } = pool({ factory: h.factory });
    const calls = ids.map((id) => p.call(id, cmd('hold')));
    expect((await p.call('e000000000000005', cmd('x'))).ok).toBe(false);
    await until(() => h.held.length === 4);
    h.release();
    await Promise.all(calls);
  });
});

describe('relay URL of a person worker (R20-WRITERS-04)', () => {
  it('is asked at each open, so a person stored with relayUrl null syncs once the server listens; null falls back to the stored one', async () => {
    const fake = fakeWorkers();
    let url: string | null = null;
    const stored = { ...persons, get: async (id: string) => ({ ...(await persons.get(id))!, relayUrl: id === B ? 'wss://stored.example/sync' : null }) } as PersonRegistry;
    const { p } = pool({ factory: fake.factory, persons: stored, relayUrl: () => url });
    await p.call(A, cmd('x'));
    await p.call(B, cmd('x'));
    expect(fake.opened.map((i) => i.relayUrl)).toEqual([null, 'wss://stored.example/sync']);
    await p.closeAll();
    url = loopbackRelayUrl({ host: '127.0.0.1', port: 4870 });
    await p.call(A, cmd('x'));
    await p.call(B, cmd('x'));
    expect(fake.opened.slice(2).map((i) => i.relayUrl)).toEqual(['ws://127.0.0.1:4870/sync', 'ws://127.0.0.1:4870/sync']);
  });

  it('takes the loopback listener when the server binds loopback or every address, else none', () => {
    expect(loopbackRelayUrl({ host: '127.0.0.1', port: 4870 })).toBe('ws://127.0.0.1:4870/sync');
    expect(loopbackRelayUrl({ host: 'localhost', port: 4870 })).toBe('ws://localhost:4870/sync');
    expect(loopbackRelayUrl({ host: '0.0.0.0', port: 4870 })).toBe('ws://127.0.0.1:4870/sync');
    expect(loopbackRelayUrl({ host: '::', port: 4870 })).toBe('ws://[::1]:4870/sync');
    expect(loopbackRelayUrl({ host: '[::1]', port: 4870 })).toBe('ws://[::1]:4870/sync');
    // a tailnet address only: its Host would not pass the Host rule, so the public origin (or the stored URL) is used
    expect(loopbackRelayUrl({ host: '100.64.0.1', port: 4870 })).toBeNull();
  });
});

describe('real workers', () => {
  it('a worker that runs out of heap dies alone; the request answers person_restarting and the next one reopens', async () => {
    let opens = 0;
    const real = threadWorkerFactory(FIXTURE, { limits: { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 8 } });
    const { p, lines } = pool({ factory: (i) => (opens++, real(i)) });
    expect(await p.call(A, cmd('x'))).toMatchObject({ ok: true });
    const queued = p.call(A, cmd('x'));
    const hog = await p.call(A, cmd('test.hog'));
    expect(hog).toEqual({ ok: false, error: { code: 'precondition_failed', message: 'Your data on the server is restarting. Try again in a moment.', detail: { reason: 'person_restarting' } } });
    expect(await queued).toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(p.isOpen(A)).toBe(false);
    expect(lines.some((l) => l.startsWith(`person ${A}: worker ran out of memory (heap limit 24 MB); closed`))).toBe(true);
    // the server process is fine, and the person opens again
    expect(await p.call(A, cmd('x'))).toEqual({ ok: true, value: { personId: A, op: 'dispatch' } });
    expect(opens).toBe(2);
  }, 60_000);

  it('a request over its time limit stops the worker; the others queued behind it answer person_restarting; the next reopens', async () => {
    let opens = 0;
    const real = threadWorkerFactory(FIXTURE, { commandMs: 300, importMs: 5000 });
    const { p, lines } = pool({ factory: (i) => (opens++, real(i)) });
    const slow = p.call(A, cmd('test.spin', { ms: 5000 }));
    const behind = p.call(A, cmd('x'));
    expect(await slow).toEqual({ ok: false, error: { code: 'precondition_failed', message: 'This took longer than 1 s and was stopped. Try again.', detail: { reason: 'timeout' } } });
    expect(await behind).toMatchObject({ error: { detail: { reason: 'person_restarting' } } });
    await new Promise((r) => setTimeout(r, 50));
    expect(lines.some((l) => l === `person ${A}: worker stopped: a test.spin request ran past 1 s; closed, it opens again on the next request`)).toBe(true);
    expect(await p.call(A, cmd('x'))).toMatchObject({ ok: true });
    expect(opens).toBe(2);
  }, 30_000);

  it('the limit counts from when the worker starts a request, not while it waits in the queue', async () => {
    const { p } = pool({ factory: threadWorkerFactory(FIXTURE, { commandMs: 1500 }) });
    // three 600 ms requests in a row: the last finishes 1.8 s after it was sent, but each ran under 1.5 s
    const r = await Promise.all([0, 1, 2].map(() => p.call(A, cmd('test.wait', { ms: 600 }))));
    expect(r.every((x) => x.ok)).toBe(true);
  }, 30_000);

  it('imports get the long limit', () => {
    const t = { commandMs: 60_000, importMs: 600_000 };
    expect(timeoutOf({ op: 'ingestLumen', events: [], installations: {} }, t)).toBe(600_000);
    expect(timeoutOf(cmd('bio.import'), t)).toBe(600_000);
    expect(timeoutOf(cmd('log.steps'), t)).toBe(60_000);
    expect(isImport({ op: 'agentCall', command: 'log.steps', input: {}, actorId: 'x' })).toBe(false);
  });

  it('samples every open worker heap and the server rss once a minute, to the log and memory.json', async () => {
    const file = join(process.env.TMPDIR ?? '/tmp', `workers-memory-${process.pid}.json`);
    const { p, lines } = pool({ factory: threadWorkerFactory(FIXTURE), memoryLogMs: 100, memoryFile: file });
    await p.call(A, cmd('x'));
    await p.call(B, cmd('x'));
    await new Promise((r) => setTimeout(r, 400));
    const line = new RegExp(`^person ${A}: memory heap \\d+/\\d+ MB, external \\d+ MB; server rss \\d+ MB$`);
    expect(lines.some((l) => line.test(l))).toBe(true);
    const m = JSON.parse(await readFile(file, 'utf8')) as Awaited<ReturnType<WorkerPool['memory']>>;
    expect(m.rssMb).toBeGreaterThan(10);
    expect(m.persons.map((x) => x.id).sort()).toEqual([A, B]);
    expect(m.persons[0]!.heapUsedMb).toBeGreaterThan(0);
  }, 30_000);
});

describe('a removed person', () => {
  it('has its worker closed on the next minute check, and the sample no longer lists it', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { createPersonRegistry } = await import('./persons.ts');
    const dataDir = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'workers-removed-'));
    try {
      const registry = createPersonRegistry(dataDir);
      const add = (label: string) => registry.add({ label, timeZone: 'UTC', secret: new Uint8Array(32).fill(7), relayUrl: null });
      const [keep, drop] = [(await add('keep')).id, (await add('drop')).id];
      const h = heldWorkers();
      const file = join(dataDir, 'memory.json');
      const { p, lines } = pool({ persons: registry, factory: h.factory, memoryLogMs: 50, memoryFile: file });
      await p.call(keep, cmd('x'));
      await p.call(drop, cmd('x'));
      await new Promise((r) => setTimeout(r, 120));
      expect(h.closed).toEqual([]); // both exist: nothing closes
      // `vitals-server persons remove` runs in another process: same files, another registry
      expect(await createPersonRegistry(dataDir).remove(drop)).toBe(true);
      await until(() => h.closed.length > 0);
      expect(h.closed).toEqual([drop]);
      expect([p.isOpen(keep), p.isOpen(drop)]).toEqual([true, false]);
      expect(lines).toContain(`person ${drop}: removed; closing its worker`);
      await new Promise((r) => setTimeout(r, 150)); // the next sample rewrites memory.json
      const m = JSON.parse(await readFile(file, 'utf8')) as Awaited<ReturnType<WorkerPool['memory']>>;
      expect(m.persons.map((x) => x.id)).toEqual([keep]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('a sample written before the check shows the removed person as closing and does not count it', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = join(process.env.TMPDIR ?? '/tmp', `workers-status-removed-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const at = '2026-10-03T10:00:00.000Z';
    await writeFile(join(dir, 'memory.json'), JSON.stringify({ at, rssMb: 443, heapUsedMb: 53, maxOpenPersons: 4, persons: [{ id: A, busy: 0, idleSec: 40 }, { id: B, busy: 0, idleSec: 300 }, { id: C, busy: 0, idleSec: 900 }] }));
    expect(await memoryLines(dir, Date.parse(at) + 10_000, new Set([A]))).toEqual([
      'Memory (10 s ago): server rss 443 MB, main heap 53 MB, 1 of at most 4 persons open',
      `  ${A}  heap unknown, idle 40 s`,
      `  ${B}  heap unknown, removed (its worker closes within a minute)`,
      `  ${C}  heap unknown, removed (its worker closes within a minute)`,
    ]);
  });
});

describe('diagnostics (loopback route)', () => {
  it('a worker blocked in a synchronous call shows as busy with a pending request and no report, without blocking the reader', async () => {
    const { p } = pool({ factory: threadWorkerFactory(FIXTURE, { commandMs: 30_000 }) });
    await p.call(A, cmd('x'));
    const idle = await p.diag();
    expect(idle).toEqual([expect.objectContaining({ id: A, pending: 0, report: { waiting: 0 } })]);
    const slow = p.call(A, cmd('test.spin', { ms: 3500 }));
    await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    const [d] = await p.diag();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(d).toMatchObject({ id: A, busy: 1, pending: 1, report: null });
    expect(d!.elu).toBeGreaterThan(0.8);
    expect(await slow).toMatchObject({ ok: true });
  }, 30_000);
});

describe('vitals-server status', () => {
  it('prints the last memory sample, or says there is none yet', async () => {
    const dir = join(process.env.TMPDIR ?? '/tmp', `workers-status-${process.pid}`);
    expect(await memoryLines(dir)).toEqual(['Memory: no sample yet (the server writes one a minute after it starts).']);
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    const at = '2026-10-03T10:00:00.000Z';
    await writeFile(join(dir, 'memory.json'), JSON.stringify({ at, rssMb: 412, heapUsedMb: 53, maxOpenPersons: 4, persons: [{ id: A, busy: 0, idleSec: 40, heapUsedMb: 52, heapTotalMb: 102, externalMb: 3 }, { id: B, busy: 1, idleSec: 0 }] }));
    expect(await memoryLines(dir, Date.parse(at) + 31_000)).toEqual([
      'Memory (31 s ago): server rss 412 MB, main heap 53 MB, 2 of at most 4 persons open',
      `  ${A}  heap 52/102 MB, external 3 MB, idle 40 s`,
      `  ${B}  heap unknown, busy (1)`,
    ]);
  });
});
