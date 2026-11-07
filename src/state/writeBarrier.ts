/** Restore is an exclusive write boundary; work started against an old snapshot cannot commit afterward. */
let generation = 0;
let externalRestore = false;
let restoreEpoch: string | null = null;
export const EXTERNAL_RESTORE_MESSAGE = 'Data was replaced in another window. Reload Vitals to continue.';
export const externalRestoreRequired = () => externalRestore;
export const currentRestoreEpoch = () => restoreEpoch;
export const setRestoreEpoch = (epoch: string | null) => { restoreEpoch = epoch; };
const externalListeners = new Set<() => void>();
export const onExternalRestore = (listener: () => void) => { externalListeners.add(listener); return () => { externalListeners.delete(listener); }; };
export function invalidateExternalRestore(): void {
  if (externalRestore) return;
  externalRestore = true;
  generation++;
  for (const listener of [...listeners, ...externalListeners]) { try { listener(); } catch { console.error('Vitals: a restore listener failed'); } }
}

let restoring = false;
let settled: Promise<void> = Promise.resolve();
export const waitForRestore = () => settled;
const listeners = new Set<() => void>();
export const onDataReplaced = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const writeGeneration = () => generation;
export const restoreInProgress = () => restoring;
export function assertCurrentWrite(expected: number): void {
  if (externalRestore) throw new Error(EXTERNAL_RESTORE_MESSAGE);
  if (restoring) throw new Error('A data import is in progress. Try again when it finishes.');
  if (expected !== generation) throw new Error('The data was replaced while this action was running. Try again.');
}
export function beginRestore(): { committed(epoch?: string): void; release(): void } {
  assertCurrentWrite(generation);
  if (restoring) throw new Error('A data import is already in progress.');
  restoring = true;
  let release!: () => void;
  settled = new Promise<void>((resolve) => { release = resolve; });
  return {
    committed: (epoch) => {
      if (epoch) restoreEpoch = epoch;
      generation++;
      for (const listener of listeners) { try { listener(); } catch { console.error('Vitals: a restore listener failed'); } }
    },
    release: () => { restoring = false; release(); },
  };
}
