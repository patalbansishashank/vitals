/**
 * One person's Vitals program on the `home` server (SUITE_SPEC §14.1; R17): the person's Evolu replica, the app's
 * document runtime and command bus on top of it, living automation and the blob file store (photos).
 *
 *   const p = await openPersonProgram(init, secret);   // one person per module graph (a worker_threads Worker)
 *   await p.handle({ op: 'dispatch', command: 'today.get', input: {}, source: 'ui' });
 *   await p.close();
 *
 * The bus and the document runtime are module singletons (R17 blocker 1), so a module graph holds ONE person:
 * production runs this in a Worker per person (`./personWorkerEntry.ts`), tests in-process, one person at a time.
 *
 * Planner: the Planner's worker pool (`src/workers/plannerClient.ts`, `src/features/planner/run.ts`) is not ported to
 * Node; `planner.*` runs and living re-plans answer precondition_failed with `detail.rule: 'not_on_server'` (R17
 * blocker 10: the request builder lives in the Planner screen's state and needs its own bundled pool, well over the
 * size this program should carry). The person runs the Planner in the app.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandResult, DispatchOptions } from '@/commands';
import { COLLECTIONS, createDocumentStore, createMemoryBackend, isCollectionId, type BackendDoc, type DeviceId, type PersistenceBackend } from '@/store';
import { createRemoteBlobBackend } from '@/sync/blobs/remote';
import { createEvoluSyncStore } from '@/sync/evolu/adapter';
import { relayHttpBase } from '@/sync/pairing';
import { createSyncedBackend } from '@/sync/syncedBackend';
import type { NetPort } from '@/sync/types';
import { createNodeEvoluPlatform } from '../evoluNode.ts';
import { openFileChunkStore } from './blobFiles.ts';
import { openLocalDb } from './localDb.ts';
import type { PersonInit, PersonProgram, PersonRequest, PersonResponse, PersonStats } from './personRpc.ts';
import { busPersonDispatch, type BusModules, type PersonDispatch } from '../personContext.ts';

const isSynced = (col: string) => isCollectionId(col) && COLLECTIONS[col].sync === 'yes';
const nodeNet: NetPort = { fetch: (input, init) => globalThis.fetch(input, init), assertAllowed: () => {} };
const NOT_ON_SERVER = 'Finding and re-planning plans runs in the Vitals app, not on the server. Open the Planner in the app.';

/** Tighten every file Evolu and SQLite created in `dir` (WAL files included) to 0600, directories to 0700. */
function tighten(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if ((s.mode & 0o777) !== 0o700) chmodSync(p, 0o700);
      tighten(p);
    } else if ((s.mode & 0o777) !== 0o600) chmodSync(p, 0o600);
  }
}

/**
 * The synced backend mirrors synced collections into its local backend (so a browser boots offline). On the server the
 * Evolu replica is the local copy already: keep `local.db` to the local-only collections.
 */
function localOnly(local: PersistenceBackend): PersistenceBackend {
  return {
    ...local,
    engine: local.engine,
    get: (col, id) => (isSynced(col) ? Promise.resolve(null) : local.get(col, id)),
    list: (col, opts) => (isSynced(col) ? Promise.resolve([]) : local.list(col, opts)),
    put: async <T>(col: string, id: string, value: T, opts?: { schema?: number }) =>
      isSynced(col) ? ({ _id: id, _col: col, _schema: opts?.schema ?? 1, _rev: '', _device: '', _created: '', _updated: '', value } as unknown as BackendDoc<T>) : local.put(col, id, value, opts),
    delete: (col, id) => (isSynced(col) ? Promise.resolve() : local.delete(col, id)),
    subscribe: (l) => local.subscribe(l),
  };
}

const failure = (code: string, message: string): PersonResponse => ({ ok: false, error: { code, message } });

export async function openPersonProgram(init: PersonInit, secret: Uint8Array): Promise<PersonProgram> {
  const t0 = performance.now();
  if (!existsSync(init.dir)) mkdirSync(init.dir, { recursive: true, mode: 0o700 });
  chmodSync(init.dir, 0o700);
  const device = init.deviceId as DeviceId;

  const commands = await import('@/commands');
  const { setTimeZoneSource } = await import('@/commands/bus');
  const { installPersistenceBackend, setDocumentStore, getDocumentStore, STATE_MIGRATIONS } = await import('@/state/runtime');
  const { setBlobStore } = await import('@/state/blobStore');
  const { fail } = await import('@/commands/registry');
  // R17 blocker 4: "today", the rollover and the observations follow the person's zone, not the host's
  setTimeZoneSource(() => init.timeZone);

  const sync = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: init.dir, instance: init.instance }), appName: 'vitals', net: nodeNet });
  await sync.open({ secret, relayUrl: init.relayUrl, deviceId: device, memoryOnly: false });
  const local = openLocalDb(join(init.dir, 'local.db'), { device });
  const backend = createSyncedBackend({ synced: sync, local: localOnly(local), isSynced });

  // blob bytes (photos) on disk, sealed and uploaded to the relay's /blobs like a browser's (R17 blocker 2)
  const blobs = openFileChunkStore(join(init.dir, 'blobs'));
  if (init.relayUrl && sync.keys) {
    await blobs.store.attachRemote({ seal: sync.keys.blob, backend: createRemoteBlobBackend({ baseUrl: relayHttpBase(init.relayUrl), keys: sync.keys, net: nodeNet }) });
  }
  setBlobStore(blobs.store);

  // R17 blocker 5: no localStorage, so seed the runtime with the person's fixed device id (installPersistenceBackend keeps it)
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device }), device, migrations: STATE_MIGRATIONS }));
  // writeDefaults false: an empty replica must not write default documents over the person's synced ones
  await installPersistenceBackend(backend, { copy: false, prefer: 'docs', writeDefaults: false });

  // ports: no planner pool on the server (see the header)
  commands.installPorts({
    planner: { prepare: () => fail('precondition_failed', NOT_ON_SERVER, { rule: 'not_on_server', reason: 'not_on_server', retryable: false }), run: () => Promise.reject(new Error(NOT_ON_SERVER)), cancel: () => {} },
  });
  // a re-plan answers precondition_failed naming not_on_server, so the agent route drops the tool from the list
  commands.installLivingPorts({ planner: { replan: async () => fail('precondition_failed', NOT_ON_SERVER, { rule: 'not_on_server', reason: 'not_on_server', retryable: false }) } });

  // what the browser does after boot (src/state/persistence.ts): undo across restarts, retention, living automation
  commands.loadChangeLog();
  await commands.pruneLocalLogs().catch(() => 0);
  const stopAutomation = commands.startLivingAutomation();
  tighten(init.dir);
  const openedMs = Math.round(performance.now() - t0);

  const settle = async () => {
    await commands.settleCommits();
    await backend.settled();
  };

  const actorOf = (source: Extract<PersonRequest, { op: 'dispatch' }>['source']): DispatchOptions['actor'] => {
    switch (source) {
      case 'ui':
        return { kind: 'user', id: 'local-user' };
      case 'coach':
        return { kind: 'ai', id: 'coach' };
      case 'agent':
        return { kind: 'mcp', id: 'agent' };
      case 'server':
        return { kind: 'companion', id: 'server' };
    }
  };

  const stats = (): PersonStats => {
    const store = getDocumentStore();
    let documents = 0;
    for (const col of Object.keys(COLLECTIONS)) documents += store.peekAll(col as never).length;
    return { personId: init.personId, timeZone: init.timeZone, deviceId: init.deviceId, documents, openedMs };
  };

  // agent tools run through the app's own guard, with direct apply off (an edit is always staged on the server)
  let agentDispatch: Promise<PersonDispatch> | null = null;
  const agents = () =>
    (agentDispatch ??= Promise.all([import('@/agents/dispatcher'), import('@/commands/ai/agentDispatcher')]).then(([d, a]) =>
      busPersonDispatch({ guardedCall: d.guardedCall as BusModules['guardedCall'], createBusAgentDispatcher: a.createBusAgentDispatcher as BusModules['createBusAgentDispatcher'] }),
    ));

  let closed = false;
  return {
    async handle(req) {
      if (closed) return failure('closed', 'This person is closed.');
      try {
        switch (req.op) {
          case 'dispatch': {
            const opts: DispatchOptions = { actor: actorOf(req.source), ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}) };
            const value: CommandResult = await commands.dispatch(req.command, req.input, opts);
            await settle();
            return { ok: true, value };
          }
          case 'stats':
            return { ok: true, value: stats() };
          case 'agentManifest':
            return { ok: true, value: await (await agents()).manifest() };
          case 'agentCall': {
            const value = await (await agents()).dispatch(req.command, req.input, { kind: 'mcp', id: req.actorId }, {
              ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}),
              ...(req.stage ? { stage: true } : {}),
            });
            await settle();
            return { ok: true, value };
          }
          case 'flush':
            await settle();
            await blobs.store.flush().catch(() => 0);
            return { ok: true, value: null };
          default:
            return failure('invalid_request', `Unknown op ${(req as { op?: unknown }).op as string}.`);
        }
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        return failure(typeof code === 'string' ? code : 'internal', e instanceof Error ? e.message : String(e));
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      stopAutomation();
      await settle().catch(() => undefined);
      await blobs.store.flush().catch(() => 0);
      blobs.store.detachRemote();
      await backend.close!();
      await sync.close();
      await local.close();
      blobs.close();
      setBlobStore(null);
      setTimeZoneSource(null);
    },
  };
}
