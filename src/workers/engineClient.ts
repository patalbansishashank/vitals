import * as Comlink from 'comlink';
import type { EngineWorkerApi } from './engine.worker';

let worker: Worker | null = null;
let proxy: Comlink.Remote<EngineWorkerApi> | null = null;

/** Lazily creates the engine worker and returns a typed proxy to it. */
export function getEngine(): Comlink.Remote<EngineWorkerApi> {
  if (!proxy) {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'vitals-engine' });
    proxy = Comlink.wrap<EngineWorkerApi>(worker);
  }
  return proxy;
}

/** Cancels any in-flight work by tearing the worker down. The next getEngine() call starts a fresh one. */
export function cancelEngine(): void {
  proxy?.[Comlink.releaseProxy]();
  worker?.terminate();
  worker = null;
  proxy = null;
}

export const progressCallback = <T extends (...args: never[]) => void>(fn: T) => Comlink.proxy(fn);
