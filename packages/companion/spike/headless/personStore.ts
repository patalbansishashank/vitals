/**
 * R17 spike (seed of E25): one person's Vitals store opened headless in Node.
 *
 *   const p = await openPersonStore({ dir, secret, relayUrl, deviceId: 'SERVERHOME000001' });
 *   await attachToCommandBus(p);           // the app's document runtime now runs on this person's Evolu database
 *   await dispatch('today.get', {});       // the same command bus the website uses
 *
 * The Evolu side is the existing Node platform (`packages/companion/src/evoluNode.ts`, better-sqlite3, in-process
 * worker shims). The document runtime and the command bus are module singletons (`src/state/runtime.ts`,
 * `src/commands/bus.ts`), so ONE module graph holds ONE person: several persons in one process need one
 * `worker_threads` Worker (or one process) per person until those singletons take a context (see R17 report).
 */
import { chmodSync, mkdirSync } from 'node:fs';
import { COLLECTIONS, createMemoryBackend, isCollectionId, type DeviceId, type PersistenceBackend } from '@/store';
import { createEvoluSyncStore } from '@/sync/evolu/adapter';
import { createSyncedBackend } from '@/sync/syncedBackend';
import type { SyncStore } from '@/sync/types';
import { createNodeEvoluPlatform } from '../../src/evoluNode.ts';

export interface PersonStoreOptions {
  /** The person's directory (created 0700). Evolu writes `<appName>.db` (+ WAL files) inside it. */
  dir: string;
  /** 32-byte owner secret (the pairing secret / mnemonic entropy). Never logged. */
  secret: Uint8Array;
  relayUrl: string | null;
  deviceId: DeviceId;
  /** Distinguishes Evolu instances in one process (locks and broadcast channels). */
  instance: string;
  appName?: string;
}

export interface PersonStore {
  sync: SyncStore;
  /** Synced collections in Evolu; local-only collections in memory (spike: lost on restart, see report). */
  backend: PersistenceBackend & { settled(): Promise<void> };
  openMs: number;
  deviceId: DeviceId;
  close(): Promise<void>;
}

export const isSynced = (col: string) => isCollectionId(col) && COLLECTIONS[col].sync === 'yes';

export async function openPersonStore(o: PersonStoreOptions): Promise<PersonStore> {
  mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  chmodSync(o.dir, 0o700);
  const t0 = performance.now();
  const sync = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: o.dir, instance: o.instance }), appName: o.appName ?? 'vitals' });
  await sync.open({ secret: o.secret, relayUrl: o.relayUrl, deviceId: o.deviceId, memoryOnly: false });
  const backend = createSyncedBackend({ synced: sync, local: createMemoryBackend({ device: o.deviceId }), isSynced });
  return { sync, backend, openMs: performance.now() - t0, deviceId: o.deviceId, close: () => sync.close() };
}

/** Point the app's document runtime (and so every command) at this person's store. One person per module graph. */
export async function attachToCommandBus(p: PersonStore): Promise<void> {
  const { installPersistenceBackend, setDocumentStore, STATE_MIGRATIONS } = await import('@/state/runtime');
  const { createDocumentStore } = await import('@/store');
  // Without localStorage `deviceId()` mints a new id per process; seed the runtime with the person's device id first
  // (installPersistenceBackend keeps `previous.device`).
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: p.deviceId }), device: p.deviceId, migrations: STATE_MIGRATIONS }));
  await installPersistenceBackend(p.backend, { copy: false, prefer: 'docs' });
}
