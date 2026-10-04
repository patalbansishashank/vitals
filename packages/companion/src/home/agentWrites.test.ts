// @vitest-environment node
/**
 * R20-WRITERS-03 / -01 / -04: what an AI agent writes through the server reaches the person's other devices.
 *
 * The server's person program runs in-process (one person per module graph, as `personProgram.ts` allows in tests) behind
 * the real home pool and the relay of the same process. The person is added with `relayUrl: null` (as `persons add`
 * stores it before `init --public-origin`); the pool takes the loopback listener instead (R20-WRITERS-04).
 * - a second replica (a raw Evolu store of the same owner, as a browser holds it) sees an agent's `log.meal` by live push
 *   within 5 s;
 * - a proposal the agent stages on the server is applied on another replica (not "stale": R20-WRITERS-01).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEvoluSyncStore } from '@/sync/evolu/adapter';
import type { DocChange, SyncStore } from '@/sync/types';
import { createNodeEvoluPlatform } from '../evoluNode.ts';
import { startCompanion } from '../server.ts';
import { openPersonProgram } from './personProgram.ts';
import type { PersonResponse } from './personRpc.ts';
import { loopbackRelayUrl } from './serverConfig.ts';
import { SITE } from './testHome.ts';
import type { WorkerFactory } from './workers.ts';

const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'agent-writes-'));
const done: Array<() => Promise<unknown>> = [];
afterAll(async () => {
  for (const d of done.reverse()) await d().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

// the app's module graph loads once here (about 15 s cold), so the test itself measures sync, not module loading
beforeAll(async () => {
  await Promise.all([
    import('@/commands'), import('@/commands/bus'), import('@/commands/bio/runtime'), import('@/commands/bio/store'), import('@/commands/registry'),
    import('@/state/runtime'), import('@/state/blobStore'), import('@/agents/dispatcher'), import('@/commands/ai/agentDispatcher'),
    import('@/biometrics/importers/lumenCloudEvents'), import('@/biometrics/importers/lumenIngest'), import('@/biometrics/core/effective'),
  ]);
}, 120_000);

const SECRET = new Uint8Array(32).fill(5);
type Envelope = { ok: boolean; output?: unknown; error?: unknown; pending?: { pendingId: string } };
const value = <T>(r: PersonResponse): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value as T;
};
function waitFor<T>(s: SyncStore, pred: (c: DocChange) => T | undefined, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${what}`));
    }, ms);
    const off = s.subscribe((c) => {
      const v = pred(c);
      if (v === undefined) return;
      clearTimeout(t);
      off();
      resolve(v);
    });
  });
}
async function until<T>(f: () => T | undefined | Promise<T | undefined>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

it('an agent log.meal on the server reaches another device within 5 s; a proposal staged on the server applies on another device', async () => {
  // the server's person program, in-process, with the owner secret given to `persons.add` below
  const inProcess: WorkerFactory = async (init) => {
    const p = await openPersonProgram(init, SECRET);
    return { call: (req) => p.handle(req), close: () => p.close() };
  };
  let port = 0;
  const c = await startCompanion({
    port: 0, dataDir: join(dir, 'relay'), allowedOrigins: [], log: () => undefined,
    home: { dataDir: join(dir, 'home'), allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', mqtt: { enabled: false }, workerFactory: inProcess, relayUrl: () => loopbackRelayUrl({ host: '127.0.0.1', port }) },
  });
  port = c.port;
  done.push(() => c.close());
  const home = c.home!;
  const person = await home.persons.add({ label: 'agent-writes', timeZone: 'Europe/Berlin', secret: SECRET, relayUrl: null });
  expect((await home.persons.get(person.id))?.relayUrl).toBeNull();
  const call = (req: Parameters<typeof home.pool.call>[1]) => home.pool.call(person.id, req);

  // device B: same owner, its own replica, connected before the agent writes
  const relayUrl = loopbackRelayUrl({ host: '127.0.0.1', port })!;
  const b = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: join(dir, 'b'), instance: 'B' }), appName: 'vitals' });
  await b.open({ secret: SECRET, relayUrl, deviceId: 'DEVICEB000000001', memoryOnly: true });
  done.push(() => b.close());
  // both replicas connected: a first write from the server reaches B
  const first = waitFor(b, (ch) => (ch.origin === 'remote' && ch.col === 'profile' ? ch.doc : undefined), 10_000, 'the first sync to device B');
  expect(value<Envelope>(await call({ op: 'dispatch', command: 'profile.patch', input: { heightCm: 170 }, source: 'ui' })).ok).toBe(true);
  await first;

  // R20-WRITERS-03: the agent logs a meal (the MCP route's `agentCall`); B sees it by live push
  const marker = `agent meal ${Date.now()}`;
  const meal = waitFor(b, (ch) => (ch.origin === 'remote' && JSON.stringify(ch.doc?.value ?? null).includes(marker) ? ch : undefined), 5_000, 'the meal on device B');
  const t0 = performance.now();
  const logged = value<Envelope>(await call({ op: 'agentCall', command: 'log.meal', input: { text: marker, components: [{ name: 'eggs', grams: 120 }], method: 'aiText' }, actorId: 'test-agent', idempotencyKey: `meal-${marker}` }));
  expect(logged.ok, JSON.stringify(logged)).toBe(true);
  const seen = await meal;
  const ms = Math.round(performance.now() - t0);
  console.log(`agent log.meal on the server -> visible on device B in ${ms} ms (${seen.col}/${seen.id})`);
  expect(ms).toBeLessThan(5_000);

  // R20-WRITERS-01: the agent's profile edit is staged on the server ...
  const staged = waitFor(b, (ch) => (ch.origin === 'remote' && ch.col === 'pendingChanges' ? ch.doc : undefined), 5_000, 'the proposal on device B');
  const r = value<Envelope>(await call({ op: 'agentCall', command: 'profile.patch', input: { heightCm: 171 }, actorId: 'test-agent', idempotencyKey: `patch-${marker}` }));
  const pendingId = r.pending?.pendingId ?? (await staged)?._id;
  expect(pendingId, JSON.stringify(r)).toBeTruthy();
  await staged;
  await home.pool.close(person.id);

  // ... and applied on another device (its own replica, its own clock for the rows it received)
  const { getDocumentStore } = await import('@/state/runtime');
  const other = await openPersonProgram({ personId: 'c'.repeat(16), dir: join(dir, 'device-c'), timeZone: 'Europe/Berlin', deviceId: 'DEVICEC000000001', relayUrl, instance: 'c' }, SECRET);
  done.push(() => other.close());
  await until(() => {
    const p = getDocumentStore().peek<{ status: string }>('pendingChanges', pendingId!);
    return p?.status === 'pending' && getDocumentStore().peek('profile', 'me') ? true : undefined;
  }, 10_000, 'the proposal and the profile on device C');
  const applied = value<Envelope>(await other.handle({ op: 'dispatch', command: 'coach.applyPending', input: { pendingId }, source: 'ui' }));
  expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, output: { applied: true } });
  expect(getDocumentStore().peek<{ status: string }>('pendingChanges', pendingId!)?.status).toBe('applied');
}, 15_000);
