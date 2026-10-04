/**
 * The day's swaps, kept on this device so a reload (or coming back later the same day) still shows the exercises the
 * person chose (QA LIV-11). A swap applies to that day only (living-mode.md Train); entries are per plan, day and session
 * slot, and days older than two weeks are dropped. Making a swap permanent is a plan proposal, not this.
 */
import { addDays, compareDates } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { SwapPick } from './session';

const STORAGE_KEY = 'vitals.train.swaps.v1';
const KEEP_DAYS = 14;

type Stored = Record<string, { planId: string; date: LocalDate; swaps: Record<number, SwapPick> }>;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readAll(): Stored {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Stored) : {};
  } catch {
    return {};
  }
}

/** The swaps kept for a session (`key` = `<date>|<slotKey>`) of this plan, or null. */
export function storedSwaps(key: string, planId: string | undefined): Record<number, SwapPick> | null {
  if (!planId) return null;
  const e = readAll()[key];
  return e && e.planId === planId && e.swaps && typeof e.swaps === 'object' && Object.keys(e.swaps).length > 0 ? e.swaps : null;
}

/** Keep (or, when empty, forget) a session's swaps. */
export function storeSwaps(key: string, planId: string | undefined, date: LocalDate, swaps: Readonly<Record<number, SwapPick>>, today: LocalDate): void {
  const s = storage();
  if (!s || !planId) return;
  const all = readAll();
  const cutoff = addDays(today, -KEEP_DAYS);
  for (const [k, e] of Object.entries(all)) if (!e || typeof e.date !== 'string' || compareDates(e.date, cutoff) < 0) delete all[k];
  if (Object.keys(swaps).length > 0) all[key] = { planId, date, swaps: { ...swaps } };
  else delete all[key];
  try {
    if (Object.keys(all).length > 0) s.setItem(STORAGE_KEY, JSON.stringify(all));
    else s.removeItem(STORAGE_KEY);
  } catch {
    // storage full or unavailable: the swap still holds for this visit
  }
}

/** Tests: forget every kept swap. */
export function clearStoredSwaps(): void {
  storage()?.removeItem(STORAGE_KEY);
}
