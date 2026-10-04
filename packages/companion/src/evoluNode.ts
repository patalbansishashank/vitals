/**
 * Node platform for the Vitals Evolu adapter (`src/sync/evolu/adapter.ts`): Evolu's in-memory worker shims run the
 * SharedWorker and DbWorker in this process, SQLite is better-sqlite3, the socket is Node's global WebSocket.
 *
 * Every platform instance gets its own lock manager (`./home/threadLocks.ts`) and broadcast-channel prefix, so several simulated devices can
 * live in one process (the two-device tests) without sharing Evolu's build lock or channels.
 */
import {
  createBroadcastChannel,
  createConsole,
  createConsoleStoreOutput,
  createMessageChannel,
  createMessagePort,
  createRandomBytes,
  createRun,
  createSharedWorker,
  createWebSocket,
  createWorker,
  type CreateBroadcastChannel,
} from '@evolu/common';
import { createEvoluDeps, initSharedWorker, startDbWorker } from '@evolu/common/local-first';
import { createBetterSqliteDriver } from '@evolu/nodejs';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EvoluPlatform } from '../../../src/sync/evolu/adapter.ts';
import { createThreadLockManager } from './home/threadLocks.ts';

export interface NodeEvoluPlatformOptions {
  /** Directory for the SQLite files (ignored for memory-only stores). Defaults to the current directory. */
  dataDir?: string;
  /** Distinguishes simulated devices in one process. */
  instance?: string;
  /** Print Evolu's log to stderr. */
  verbose?: boolean;
}

let counter = 0;

export function createNodeEvoluPlatform(options: NodeEvoluPlatformOptions = {}): EvoluPlatform {
  const instance = options.instance ?? `node${++counter}`;
  const output = createConsoleStoreOutput();
  const console = options.verbose ? createConsole() : createConsole({ output });
  // never Node's process-wide navigator.locks: on Node 24 a pending request there keeps every other thread awake (docs/wp/E34.md)
  const lockManager = createThreadLockManager();
  const channel: CreateBroadcastChannel = <I, O = I>(name: string) => createBroadcastChannel<I, O>(`${instance}:${name}`);
  const createSqliteDriver: typeof createBetterSqliteDriver = (name, opts) =>
    createBetterSqliteDriver((options.dataDir ? join(options.dataDir, name) : name) as never, opts);
  const workerDeps = { console, consoleStoreOutputEntry: output.entry, createBroadcastChannel: channel, createMessageChannel, createMessagePort, lockManager };

  const dbRun = createRun({ ...workerDeps, createSqliteDriver, randomBytes: createRandomBytes() } as never);
  const sharedRun = createRun({ ...workerDeps, createWebSocket, getDevicePersistence: async () => 'Unknown' } as never);
  const sharedWorker = createSharedWorker((self) => {
    void sharedRun(initSharedWorker(self as never) as never);
  });
  const deps = createEvoluDeps({
    createDbWorker: () =>
      createWorker((self) => {
        void dbRun(startDbWorker(self as never) as never);
      }) as never,
    createBroadcastChannel: channel,
    createMessageChannel,
    lockManager,
    reloadApp: () => {},
    sharedWorker: sharedWorker as never,
    console,
  });
  const run = createRun(deps as never);
  let disposed = false;

  return {
    deps,
    run: (task) => run(task as never) as never,
    async deleteDatabase(name) {
      const file = options.dataDir ? join(options.dataDir, `${name}.db`) : `${name}.db`;
      for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) rmSync(f, { force: true });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      deps[Symbol.dispose]();
      await Promise.allSettled([run[Symbol.asyncDispose](), sharedRun[Symbol.asyncDispose](), dbRun[Symbol.asyncDispose]()]);
    },
  };
}
