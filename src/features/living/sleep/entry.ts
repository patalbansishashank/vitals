/**
 * The D11 sleep entry: when the light went out and when the person got up (`lightsOutAt`, `outOfBedAt`). The ring alone
 * cannot know either, so true time-to-fall-asleep and sleep efficiency exist only with them (SPEC A.0, A.1.2 #12, #15).
 *
 * They are the living plan's own data (§V3.6): the fields of the night's sleep entry for the waking date, written with
 * `log.sleepTimes` (`@/living/sleepDiary`). A ring-imported night keeps its source and its bed and wake times; a night
 * that is not in yet ("Going to sleep" before the ring has it) holds them on the date until it arrives. Reads come
 * straight from the document store, so the Ring, the sleep page and Today see one value; a write shows at once and
 * settles when the command has stored it.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { dispatch, type CommandResult } from '@/commands';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { diaryOf, nightOn, type SleepDiaryPatch } from '@/living/sleepDiary';
import type { DayStatusDoc, LogEntry } from '@/living';
import type { SleepEntryTimes } from '@/living/sensors';

const listeners = new Set<() => void>();
let stamp = 0;
/** What a write said, shown until the store has it (null = cleared). */
const optimistic = new Map<string, SleepEntryTimes | null>();
const memo = new Map<string, { stamp: number; value: SleepEntryTimes | null }>();
let watching: Array<() => void> | null = null;

const emit = () => {
  stamp++;
  for (const l of listeners) l();
};

function watchStore(): void {
  if (watching) return;
  try {
    const store = getDocumentStore();
    watching = [store.watch('dailyLogs', {}, emit), store.watch('dayStatus', {}, emit)];
  } catch {
    watching = [];
  }
}

function stored(wakingDate: string): SleepEntryTimes | null {
  try {
    const store = getDocumentStore();
    const entries = store.peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry);
    const status = store.peek<DayStatusDoc>('dayStatus', `day:${wakingDate}`);
    const d = diaryOf(nightOn(entries, wakingDate), status && !status._deleted ? bodyOf<DayStatusDoc>(status).sleepDiary : null);
    return d.lightsOutAt || d.outOfBedAt ? { lightsOutAt: d.lightsOutAt, outOfBedAt: d.outOfBedAt } : null;
  } catch {
    return null;
  }
}

function entryFor(wakingDate: string): SleepEntryTimes | null {
  if (optimistic.has(wakingDate)) return optimistic.get(wakingDate) ?? null;
  const hit = memo.get(wakingDate);
  if (hit && hit.stamp === stamp) return hit.value;
  const value = stored(wakingDate);
  // keep the same object while the value is the same (a store change elsewhere never re-renders a reader)
  const same = hit && hit.value?.lightsOutAt === value?.lightsOutAt && hit.value?.outOfBedAt === value?.outOfBedAt;
  const next = same ? hit.value : value;
  memo.set(wakingDate, { stamp, value: next });
  return next;
}

const subscribe = (l: () => void) => {
  watchStore();
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The outcome of a diary write: ok, its plain-language refusal, and the undo of the change. */
export interface SleepTimesOutcome {
  ok: boolean;
  message?: string;
  /** True when the night is not in yet: the times wait on the date. */
  waiting?: boolean;
  undo?: () => Promise<SleepTimesOutcome>;
}

function outcomeOf(r: CommandResult): SleepTimesOutcome {
  if (!r.ok) return { ok: false, message: r.error.message };
  const cs = 'output' in r ? r.changeSet?.id : undefined;
  const waiting = 'output' in r ? (r.output as { waiting?: boolean } | null)?.waiting === true : false;
  return { ok: true, waiting, ...(cs ? { undo: async () => outcomeOf(await dispatch('history.undo', { changeSetId: cs })) } : {}) };
}

/**
 * Change the diary of the night ending on `wakingDate` (`log.sleepTimes`): a field left out stays, null clears it. Shown
 * at once; a refusal puts the stored value back.
 */
export async function saveSleepTimes(wakingDate: string, patch: SleepDiaryPatch): Promise<SleepTimesOutcome> {
  const before = entryFor(wakingDate);
  const next: SleepEntryTimes = {
    lightsOutAt: patch.lightsOutAt !== undefined ? patch.lightsOutAt : (before?.lightsOutAt ?? null),
    outOfBedAt: patch.outOfBedAt !== undefined ? patch.outOfBedAt : (before?.outOfBedAt ?? null),
  };
  optimistic.set(wakingDate, next.lightsOutAt || next.outOfBedAt ? next : null);
  emit();
  let o: SleepTimesOutcome;
  try {
    o = outcomeOf(await dispatch('log.sleepTimes', { date: wakingDate, ...patch }));
  } catch {
    o = { ok: false, message: 'That didn’t save. Try again.' };
  }
  optimistic.delete(wakingDate);
  emit();
  return o;
}

/** Set (or with null clear) both diary times of a night. The sleep page's "Add lights-out time" calls this. */
export function setSleepEntry(wakingDate: string, e: SleepEntryTimes | null): void {
  void saveSleepTimes(wakingDate, { lightsOutAt: e?.lightsOutAt ?? null, outOfBedAt: e?.outOfBedAt ?? null });
}

/** Tests: forget what is shown and read the store again. */
export function resetSleepEntries(): void {
  optimistic.clear();
  memo.clear();
  emit();
}

export function useSleepEntry(wakingDate: string): SleepEntryTimes | null {
  const get = useCallback(() => entryFor(wakingDate), [wakingDate]);
  return useSyncExternalStore(subscribe, get, get);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:MM" on the night ending on `wakingDate` as an instant: from noon on, the evening before. */
export function timeOnNight(wakingDate: string, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const [y, mo, d] = wakingDate.split('-').map(Number) as [number, number, number];
  const day = new Date(y, mo - 1, d, h, min);
  if (h >= 12) day.setDate(day.getDate() - 1);
  return day.toISOString();
}

/**
 * "HH:MM" as the first instant at that clock time after `afterIso` (out of bed after lights out, Claude UI P3-7): a
 * 12:30 rise after a 23:40 lights out is the next day, not the evening before. Null for a bad time.
 */
export function timeAfter(afterIso: string, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  const base = new Date(Date.parse(afterIso));
  if (!m || !Number.isFinite(base.getTime())) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min);
  if (t.getTime() <= base.getTime()) t.setDate(t.getDate() + 1);
  return t.toISOString();
}

/** "23:05" of an instant on this device's clock. */
export function clockOfIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(Date.parse(iso));
  return Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}
