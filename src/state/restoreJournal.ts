/** Durable mirror recovery. The document transaction's marker decides whether before or after wins on restart. */
export const RESTORE_JOURNAL_KEY = 'vitals.restore.pending';
export const RESTORE_MARKER_ID = 'restore';
export interface RestoreJournal {
  id: string;
  before: Record<string, string>;
  after: Record<string, string>;
}
function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
export function readRestoreJournal(): RestoreJournal | null {
  const raw = storage()?.getItem(RESTORE_JOURNAL_KEY);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('The import recovery record is damaged.');
  const j = value as RestoreJournal;
  const mirror = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x) && Object.entries(x).every(([k, v]) => k.startsWith('vitals.') && k !== RESTORE_JOURNAL_KEY && typeof v === 'string');
  if (typeof j.id !== 'string' || !mirror(j.before) || !mirror(j.after)) throw new Error('The import recovery record is damaged.');
  return j;
}
export function applyRestoreMirrors(j: RestoreJournal, side: 'before' | 'after'): void {
  const s = storage();
  if (!s) throw new Error('Browser storage is unavailable.');
  const target = j[side];
  // Free differing/after-only values before filling the target. Otherwise rollback
  // can hit quota while regrowing an old key beside a larger imported value.
  // The durable journal remains the source of truth through either pass.
  for (const key of new Set([...Object.keys(j.before), ...Object.keys(j.after)])) {
    if (!Object.hasOwn(target, key) || s.getItem(key) !== target[key]) s.removeItem(key);
  }
  for (const [key, value] of Object.entries(target)) if (s.getItem(key) !== value) s.setItem(key, value);
}
/** Synchronous hydration reads a pre-import view without altering another tab's active journal. */
export function pendingMirrorBeforeRecovery(key: string): { value: string | null } | null {
  const journal = readRestoreJournal();
  if (!journal || (!Object.hasOwn(journal.before, key) && !Object.hasOwn(journal.after, key))) return null;
  return { value: journal.before[key] ?? null };
}

export const RESTORE_LOCK = 'vitals-local-data-restore';
/** Recovery waits for an active restore; an explicit second Replace fails before changing anything. */
export async function withRestoreLock<T>(fn: () => Promise<T>, exclusiveImport = false): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return fn(); // memory / non-browser harness; persistent restore checks support itself
  return locks.request(RESTORE_LOCK, { mode: 'exclusive', ifAvailable: exclusiveImport }, async (lock) => {
    if (!lock) throw new Error('A data import is already in progress in another window. Try again when it finishes.');
    return fn();
  });
}
export function clearRestoreJournal(): void {
  storage()?.removeItem(RESTORE_JOURNAL_KEY);
}
