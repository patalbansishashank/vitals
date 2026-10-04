/**
 * What the biometrics jobs are doing right now (tier H, no React), for status chips ("updating scores…") and the
 * devices screen. The command layer (src/commands/bio) sets it; screens read it with `subscribe` + `get`.
 */
import type { LocalDate } from '../core/types';

export interface BioJobActivity {
  jobId: string;
  /** 0..1 */
  progress: number;
}
export interface BioActivity {
  /** A rescore job is running (new score versions or new data). */
  rescoring: (BioJobActivity & { from: LocalDate | null; to: LocalDate | null; versions: string[] }) | null;
  /** A file import is running. */
  importing: (BioJobActivity & { name: string }) | null;
  /** A Bluetooth read is running. */
  syncing: (BioJobActivity & { sourceKey: string | null; driver: string }) | null;
}

let state: BioActivity = { rescoring: null, importing: null, syncing: null };
const listeners = new Set<() => void>();

export const bioActivity = {
  get(): BioActivity {
    return state;
  },
  set(patch: Partial<BioActivity>): void {
    state = { ...state, ...patch };
    for (const l of listeners) {
      try {
        l();
      } catch (e) {
        console.error(e);
      }
    }
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Tests. */
  reset(): void {
    state = { rescoring: null, importing: null, syncing: null };
  },
};
