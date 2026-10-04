/**
 * App wiring for sync (I1): one `SyncRuntime` (`./controller.ts`), created on first use, and the hooks the UI reads.
 * The Evolu engine and its WASM load through a dynamic import only when this device is paired (or the person pairs
 * it), so this chunk carries only the runtime, the scheduler, pairing and the vault. Writes go through the `sync.*`
 * commands (`src/commands/sync`); the UI reads status here.
 *
 *   void import('@/state/sync').then((m) => m.initSync());   // src/main.tsx, after the first render
 *   const view = useSyncView();                               // Settings › Sync, the sync pill
 */
import { useSyncExternalStore } from 'react';
import { allowOrigin, browserNet } from '@/net/net';
import { createIdbBackend, createMemoryBackend, isIndexedDbAvailable, SYNC_OFF, type SyncStatus } from '@/store';
import { relayHttpBase } from '@/sync/pairing';
import { createRemoteBlobBackend } from '@/sync/blobs/remote';
import type { PairingCode, SyncStore } from '@/sync/types';
import { getBlobStore, isChunkStore } from '../blobStore';
import { bootDocuments, deviceId } from '../runtime';
import { createSyncRuntime, type SyncRuntime, type SyncView } from './controller';
import { createIdbVault, createMemoryVault } from './vault';

export { SyncError, isSyncedCollection, mergeBodies, type JoinMode, type SyncRuntime, type SyncView } from './controller';

async function createEvoluEngine(): Promise<SyncStore> {
  const [{ createEvoluSyncStore }, { createWebEvoluPlatform }] = await Promise.all([import('@/sync/evolu/adapter'), import('@/sync/evolu/webPlatform')]);
  return createEvoluSyncStore({ platform: createWebEvoluPlatform, net: browserNet });
}

function watchEnvironment(scheduler: { setVisible(v: boolean): void; trigger(r: 'online'): Promise<void> }): () => void {
  if (typeof document === 'undefined') return () => {};
  const onVisibility = () => scheduler.setVisible(document.visibilityState === 'visible');
  const onOnline = () => void scheduler.trigger('online');
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  onVisibility();
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}

/** Sync needs IndexedDB (the vault, the local copy) and WebCrypto (keys). */
export function syncAvailable(): boolean {
  return isIndexedDbAvailable() && Boolean(globalThis.crypto?.subtle);
}

/** Every Evolu database of this app in OPFS (`.vitals-<owner>` SAH pools): erase without an open engine. */
async function deleteEvoluData(): Promise<void> {
  const root = (await globalThis.navigator?.storage?.getDirectory?.()) as (FileSystemDirectoryHandle & { keys?(): AsyncIterable<string> }) | undefined;
  if (!root?.keys) return;
  const names: string[] = [];
  for await (const name of root.keys()) if (name.startsWith('.vitals-')) names.push(name);
  for (const name of names) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
}

function browserRuntime(): SyncRuntime {
  const available = syncAvailable();
  return createSyncRuntime({
    vault: available ? createIdbVault() : createMemoryVault(),
    createEngine: createEvoluEngine,
    localBackend: () => (isIndexedDbAvailable() ? createIdbBackend({ device: deviceId() }) : createMemoryBackend({ device: deviceId() })),
    allowRelay: (url) => void allowOrigin(relayHttpBase(url), 'sync'),
    watchEnvironment,
    blobs: async () => {
      const b = await getBlobStore();
      return isChunkStore(b) ? b : null;
    },
    remoteBlobs: (url, keys) => createRemoteBlobBackend({ baseUrl: relayHttpBase(url), keys, net: browserNet }),
    deleteEngineData: deleteEvoluData,
  });
}

let runtime: SyncRuntime | null = null;

/** The app's sync runtime (the engine loads only when sync is set up). */
export function getSyncRuntime(): SyncRuntime {
  runtime ??= browserRuntime();
  return runtime;
}

/** Tests: replace the runtime (e.g. one over memory stores). */
export function setSyncRuntimeForTests(r: SyncRuntime | null): void {
  runtime = r;
}

const subscribe = (l: () => void) => getSyncRuntime().subscribe(l);
const OFF_VIEW: SyncView = { status: SYNC_OFF, paired: false, enabled: false, relayUrl: null, label: null, deviceId: '' };

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => getSyncRuntime().status(), () => SYNC_OFF);
}

export function useSyncView(): SyncView {
  return useSyncExternalStore(subscribe, () => getSyncRuntime().view(), () => OFF_VIEW);
}

/** "Show pairing code": the paired owner's code (a read; the UI never passes it to an agent). */
export function readPairingCode(): Promise<PairingCode | null> {
  return getSyncRuntime().pairingCode();
}

/** "This device has …" for the merge/replace question, or null when it holds no user data. */
export function describeLocalData(): string | null {
  return getSyncRuntime().describeLocalData();
}

/** App start: resume syncing if this device was paired. Never throws; a failure shows in the status. */
export async function initSync(): Promise<void> {
  try {
    if (!syncAvailable()) return;
    await bootDocuments();
    const rt = getSyncRuntime();
    if (await rt.load()) await rt.resume();
  } catch (e) {
    console.warn('Sync could not start', e);
  }
}

/** Erase this device (registered by `../persistence.ts`): detach, delete local sync data, forget the secret. */
export async function eraseSyncLocal(): Promise<void> {
  await getSyncRuntime().eraseLocal();
}
