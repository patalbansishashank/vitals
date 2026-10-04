/**
 * Browser platform for the Evolu adapter: `@evolu/web` (SharedWorker + DbWorker, SQLite-WASM on the OPFS SAH pool).
 * Import it only through a dynamic `import()` so Evolu and its 1 MB WASM stay out of the initial bundle.
 *
 * Needs CSP `script-src 'self' 'wasm-unsafe-eval'` (WebAssembly compilation) and `worker-src 'self'`.
 */
import { createEvoluDeps, createRun } from '@evolu/web';
import type { EvoluPlatform } from './adapter';

let shared: { deps: ReturnType<typeof createEvoluDeps>; run: ReturnType<typeof createRun>; users: number } | null = null;

/** One set of deps per page: Evolu connects every instance in a tab to one SharedWorker. */
export function createWebEvoluPlatform(): EvoluPlatform {
  if (!shared) {
    const deps = createEvoluDeps({ onSharedWorkerUnsupported: () => {} });
    shared = { deps, run: createRun(deps), users: 0 };
  }
  shared.users += 1;
  const mine = shared;
  let disposed = false;
  return {
    deps: mine.deps,
    run: (task) => mine.run(task as never) as never,
    async deleteDatabase(name) {
      // sqlite-wasm keeps an OPFS SAH pool in `.${name}`; removing it forgets the local database.
      const root = await globalThis.navigator?.storage?.getDirectory?.();
      await root?.removeEntry(`.${name}`, { recursive: true }).catch(() => {});
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      mine.users -= 1;
    },
  };
}
