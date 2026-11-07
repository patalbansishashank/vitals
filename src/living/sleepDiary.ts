/**
 * The D11 diary times of a night (energy SPEC §V3.6, D11, D21): when the lights went out and when the person got out of
 * bed. Pure; `log.sleepTimes` writes them and the sleep screens read them through these functions.
 *
 * They live on the night's sleep entry (`lightsOutAt`, `outOfBedAt`). A ring-imported night takes them as a successor
 * that keeps everything else (its device source, its bed and wake times), so writing a lights-out time never turns the
 * ring's night into the person's correction. "Going to sleep" is tapped before the ring has the night: until a sleep
 * entry exists for the waking date, the times wait on that date's `dayStatus.sleepDiary`, and readers fall back to them.
 */
import { projectEntries } from './logs';
import type { DayStatusDoc, Instant, LocalDate, LogEntry } from './types';

export type SleepEntryRecord = Extract<LogEntry, { kind: 'sleep' }>;

export interface SleepDiaryTimes {
  lightsOutAt: Instant | null;
  outOfBedAt: Instant | null;
}

/** A change to the diary: a field left out stays, null clears it. */
export interface SleepDiaryPatch {
  lightsOutAt?: Instant | null;
  outOfBedAt?: Instant | null;
}

/**
 * The night ending on `date` (its main episode, never a nap) among the entries in force: the person's own night when
 * they logged one (the projection already hides the ring's then), else the ring's; the longest when several remain.
 */
export function nightOn(entries: readonly LogEntry[], date: LocalDate): SleepEntryRecord | null {
  const nights = projectEntries(entries).filter((e) => e.kind === 'sleep' && e.date === date && e.episodeKind !== 'nap') as SleepEntryRecord[];
  if (nights.length === 0) return null;
  const span = (e: SleepEntryRecord) => Date.parse(e.wakeAt) - Date.parse(e.bedAt);
  return [...nights].sort((a, b) => span(b) - span(a) || (a.id < b.id ? -1 : 1))[0]!;
}

const own = (e: { lightsOutAt?: Instant; outOfBedAt?: Instant } | null | undefined): SleepDiaryTimes => ({ lightsOutAt: e?.lightsOutAt ?? null, outOfBedAt: e?.outOfBedAt ?? null });

/** The diary of the night ending on `date`: the night's own fields, else (no night or none on it yet) what waits on the date. */
export function diaryOf(night: SleepEntryRecord | null, waiting: DayStatusDoc['sleepDiary'] | null | undefined): SleepDiaryTimes {
  const n = own(night);
  const w = own(waiting);
  return { lightsOutAt: n.lightsOutAt ?? w.lightsOutAt, outOfBedAt: n.outOfBedAt ?? w.outOfBedAt };
}

/** The diary after a patch (left-out fields kept, null cleared). */
export function patchDiary(current: SleepDiaryTimes, patch: SleepDiaryPatch): SleepDiaryTimes {
  return {
    lightsOutAt: patch.lightsOutAt !== undefined ? patch.lightsOutAt : current.lightsOutAt,
    outOfBedAt: patch.outOfBedAt !== undefined ? patch.outOfBedAt : current.outOfBedAt,
  };
}

/** Why a diary cannot be stored, or null: lights out comes before getting up, and both sit on the night ending on the date. */
export function diaryProblem(d: SleepDiaryTimes, date: LocalDate): { path: string; message: string } | null {
  const lo = d.lightsOutAt ? Date.parse(d.lightsOutAt) : null;
  const ob = d.outOfBedAt ? Date.parse(d.outOfBedAt) : null;
  if (lo !== null && !Number.isFinite(lo)) return { path: '/lightsOutAt', message: 'That lights-out time is not valid.' };
  if (ob !== null && !Number.isFinite(ob)) return { path: '/outOfBedAt', message: 'That time is not valid.' };
  if (lo !== null && ob !== null && !(ob > lo)) return { path: '/outOfBedAt', message: 'Getting up has to come after lights out.' };
  if (lo !== null && ob !== null && ob - lo > 24 * 3_600_000) return { path: '/outOfBedAt', message: 'Lights out and getting up have to be within a day.' };
  // the night ending on `date`: from the day before (UTC noon minus a day of slack for any zone) to the end of the date
  const day = Date.parse(`${date}T12:00:00Z`);
  const from = day - 2 * 86_400_000;
  const to = day + 1.5 * 86_400_000;
  for (const [t, path] of [[lo, '/lightsOutAt'], [ob, '/outOfBedAt']] as const) {
    if (t !== null && (t < from || t > to)) return { path, message: 'That time is not on the night ending on that date.' };
  }
  return null;
}

/**
 * The successor of a night with new diary times: everything else stays as it was (its source — a ring night stays the
 * ring's —, bed and wake, the asleep minutes, the occurrence); only the record time moves on.
 */
export function nightWithDiary(night: SleepEntryRecord, d: SleepDiaryTimes, now: Instant): Omit<SleepEntryRecord, 'id'> & { supersedes: string } {
  const { id, lightsOutAt: _lo, outOfBedAt: _ob, conflict: _c, ...rest } = night as SleepEntryRecord & { conflict?: unknown };
  void _lo;
  void _ob;
  void _c;
  return {
    ...rest,
    at: now,
    recordedAt: now,
    ...(d.lightsOutAt ? { lightsOutAt: d.lightsOutAt } : {}),
    ...(d.outOfBedAt ? { outOfBedAt: d.outOfBedAt } : {}),
    supersedes: id,
  };
}

/** The diary fields a ring correction carries over from the entry it supersedes (the import never drops the person's times). */
export function carriedDiary(head: LogEntry | undefined): { lightsOutAt?: Instant; outOfBedAt?: Instant } {
  if (!head || head.kind !== 'sleep') return {};
  return { ...(head.lightsOutAt ? { lightsOutAt: head.lightsOutAt } : {}), ...(head.outOfBedAt ? { outOfBedAt: head.outOfBedAt } : {}) };
}
