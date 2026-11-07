/**
 * The welcome-back sheet shows once per lapse: after the person answers it (fill in, leave empty, or closes it) the
 * lapse is remembered on this device and the sheet does not come back for it. A lapse is named by the plan and its
 * first missed day, so a later lapse asks again. Kept under a `vitals-` key (not `vitals.`): device-local UI state,
 * never exported, imported or synced. Storage may be blocked: an in-memory set covers the session then.
 */
import type { LocalDate } from '@/living';

const STORAGE_KEY = 'vitals-today-welcome-back';
/** Lapses remembered (newest last); older ones can never come back, so the list stays short. */
const KEEP = 12;

const memory = new Set<string>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readAll(): string[] {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** The lapse's name, or null when there is no gap to fill. */
export function lapseKey(planId: string, gap: readonly LocalDate[]): string | null {
  return gap.length ? `${planId}|${gap[0]}` : null;
}

export function isLapseAnswered(key: string): boolean {
  return memory.has(key) || readAll().includes(key);
}

export function answerLapse(key: string): void {
  memory.add(key);
  const all = [...readAll().filter((k) => k !== key), key].slice(-KEEP);
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage full or blocked: the in-memory answer holds for this session
  }
}

/** Tests: forget every answered lapse. */
export function clearAnsweredLapses(): void {
  memory.clear();
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
