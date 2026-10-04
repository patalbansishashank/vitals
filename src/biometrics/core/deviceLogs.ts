/**
 * Device data → Living log entries (`log.fromBiometrics`; SUITE_SPEC §3.4 "steps and sleep from devices", §4.5). Tier P,
 * pure: the command reads the documents and writes what this returns.
 *
 * For one app day D (the day the person sees, rolling over at `rolloverH`, default 04:00):
 *  - steps: the daily record dated D;
 *  - sleep: the main sleep that ends on app day D (a night ending 07:00 on D is D's; a sleep ending 02:30 still is the
 *    day before's);
 *  - workouts: every workout that starts on app day D, with its type, duration, active energy and heart rate.
 *
 * Only streams the person lets their plan use (Settings › Devices "my plan", `engine` on; `effectivePolicy` per source)
 * are read; among the sources left, one is chosen per metric by the person's priority (`resolveDays`, never averaged).
 *
 * Idempotent by a natural key per day and stream (`${D}:steps`, `${D}:sleep_sessions`, `${D}:workouts:${recordId}`,
 * kept in `source.deviceKey`): an entry in force with the same value is left alone, one with another value is superseded,
 * one the person removed is not brought back. An entry the person (or the Coach) made for the same item always wins:
 * steps or sleep of D, or a session of D that names the workout or starts within an hour of it.
 */
import { appDay, DEFAULT_ROLLOVER_H } from '@/living/appDay';
import { addDays } from '@/living/dates';
import { projectEntries } from '@/living/logs';
import { workoutKindOf } from '@/living/observations';
import type { DeviceWorkout, EntrySource, LocalDate, LogEntry, StimulusVector } from '@/living';
import { effectivePolicy } from './effective';
import { usedByEngine } from './policy';
import { resolveDays, type SourcedRecord } from './resolve';
import { reconcileSleep } from './reconcileSleep';
import type { BioCorrection, BioRecord, BioSourceDoc, PolicyStream, SleepRecord, StreamPolicy, WorkoutRecord } from './types';

export type DeviceLogStream = 'steps' | 'sleep_sessions' | 'workouts';

export interface DeviceLogInput {
  /** The app day to log. */
  date: LocalDate;
  tz: string;
  rolloverH?: number;
  /** Newest version of every record dated D − 1 … D + 1 (any order; other kinds are ignored). */
  records: readonly SourcedRecord[];
  sources: readonly BioSourceDoc[];
  /** The person's stream policies (`bioSources/policy:me`). */
  person: readonly StreamPolicy[];
  /** Every stored log entry (supersedes and retracts unresolved; any dates). */
  entries: readonly LogEntry[];
  /** The person's corrections (SUITE_SPEC §14.6); those of day D replace the device value in the entry. */
  corrections?: readonly BioCorrection[];
}

/** An entry to write (no id yet; `supersedes` names the device entry it updates). */
export type DeviceEntryDraft = Omit<LogEntry, 'id' | 'tz' | 'at' | 'source'> & { source: EntrySource };

export interface DeviceLogCreate {
  key: string;
  stream: DeviceLogStream;
  sourceKey: string;
  recordId: string;
  entry: DeviceEntryDraft;
  supersedes?: string;
}

export type DeviceLogSkipReason = 'userEntry' | 'unchanged' | 'removed';

export interface DeviceLogSkip {
  key: string;
  stream: DeviceLogStream;
  recordId: string;
  reason: DeviceLogSkipReason;
  /** The entry that stays (the person's, or the device entry already in force). */
  entryId?: string;
}

export interface DeviceLogPlan {
  date: LocalDate;
  create: DeviceLogCreate[];
  skipped: DeviceLogSkip[];
  /** Streams that had data for the day but are not used by the plan (nothing was read from them). */
  notOptedIn: DeviceLogStream[];
}

const STREAM_OF: Readonly<Record<'daily' | 'sleep' | 'workout', DeviceLogStream>> = { daily: 'steps', sleep: 'sleep_sessions', workout: 'workouts' };
const CATALOGUE_VERSION = 'device';

/** The app day an instant falls on. */
const dayOf = (at: string, tz: string, rolloverH: number): LocalDate => appDay(Date.parse(at), { tz, rolloverH });

/** Local clock hour of an instant in `tz`. */
function clockH(at: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.parse(at)));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (g('hour') % 24) + g('minute') / 60;
}

/** The app day a record belongs to, or null when it cannot say (no instant where one is needed). */
function appDayOf(r: BioRecord, tz: string, rolloverH: number): LocalDate | null {
  if (r.kind === 'daily') return r.time.local_date;
  if (r.kind === 'sleep') return r.time.end ? dayOf(r.time.end, tz, rolloverH) : null;
  if (r.kind === 'workout') return r.time.start ? dayOf(r.time.start, tz, rolloverH) : null;
  return null;
}

function stimulusOf(w: WorkoutRecord, kind: DeviceWorkout['kind'], minutes: number): StimulusVector {
  const cardio = kind !== 'resistance';
  return {
    effectiveSetsByRegion: {},
    pattern: kind === 'resistance' ? 'complex' : kind === 'cardio' ? 'locomotion' : 'sport',
    loadClass: kind === 'resistance' ? 'moderate' : 'light',
    netKcal: w.active_kcal ?? 0,
    mem: cardio ? minutes : 0,
    hiMinutes: 0,
    mobilityMinutes: {},
  };
}

function workoutEntry(w: WorkoutRecord, date: LocalDate, tz: string, source: EntrySource): DeviceEntryDraft {
  const t = w.exercise_type || 'other';
  const kind = workoutKindOf(t);
  const minutes = Math.round((w.active_duration_s / 60) * 10) / 10;
  const startH = clockH(w.time.start!, tz);
  const workout: DeviceWorkout = {
    exerciseType: t,
    kind,
    ...(w.title ? { title: w.title } : {}),
    ...(w.active_kcal !== undefined ? { activeKcal: w.active_kcal } : {}),
    ...(w.distance_m !== undefined ? { distanceM: w.distance_m } : {}),
  };
  const hr = { ...(w.hr_avg_bpm !== undefined ? { avgBpm: w.hr_avg_bpm } : {}), ...(w.hr_max_bpm !== undefined ? { maxBpm: w.hr_max_bpm } : {}) };
  return {
    date,
    source,
    kind: 'session',
    status: 'done',
    startH,
    durationMin: minutes,
    performed: [],
    ...(w.rpe_0_10 !== undefined ? { rpe: w.rpe_0_10 } : {}),
    ...(Object.keys(hr).length ? { hr } : {}),
    bioWorkoutId: w.record_id,
    stimulus: stimulusOf(w, kind, minutes),
    catalogueVersion: CATALOGUE_VERSION,
    engine: [kind === 'resistance' ? { kind: 'resistance', startH, durationMin: minutes, volume: 'light' } : { kind: 'cardio', modality: 'other', startH, durationMin: minutes }],
    workout,
    ...(w.title ? { text: w.title } : {}),
  } as DeviceEntryDraft;
}

/** The fields that make two device entries "the same value" (so a re-run with unchanged data writes nothing). */
function valueOf(e: Pick<LogEntry, 'kind'> & Record<string, unknown>): string {
  switch (e.kind) {
    case 'steps':
      return JSON.stringify([e.steps]);
    case 'sleep':
      return JSON.stringify([e.bedAt, e.wakeAt, e.quality ?? null]);
    case 'session':
      return JSON.stringify([e.bioWorkoutId, e.startH, e.durationMin, e.hr ?? null, e.rpe ?? null, e.workout ?? null]);
    default:
      return '';
  }
}

/** What `log.fromBiometrics` writes for one app day. */
export function planDeviceLogs(i: DeviceLogInput): DeviceLogPlan {
  const D = i.date;
  const rolloverH = i.rolloverH ?? DEFAULT_ROLLOVER_H;
  const docs = new Map(i.sources.map((s) => [s.sourceKey, s] as const));
  const allowed = (sk: string, stream: PolicyStream): boolean => usedByEngine(effectivePolicy(docs.get(sk) ?? { policies: [] }, i.person, stream));

  // the day's candidates, re-dated to the app day so the resolver picks one source per metric for D
  const off = new Set<DeviceLogStream>();
  const on = new Set<DeviceLogStream>();
  const candidates: SourcedRecord[] = [];
  for (const sr of reconcileSleep(i.records)) {
    const r = sr.record;
    if (r.kind !== 'daily' && r.kind !== 'sleep' && r.kind !== 'workout') continue;
    if (r.kind === 'daily' && r.steps === undefined) continue;
    if (r.kind === 'workout' && !r.time.start) continue;
    if (appDayOf(r, i.tz, rolloverH) !== D) continue;
    const stream = STREAM_OF[r.kind];
    if (!allowed(sr.sourceKey, stream)) {
      off.add(stream);
      continue;
    }
    on.add(stream);
    candidates.push({ sourceKey: sr.sourceKey, record: { ...r, time: { ...r.time, local_date: D } } as BioRecord });
  }
  const day = resolveDays(candidates, i.sources, { from: D, to: D }, (i.corrections ?? []).filter((c) => c.target.localDate === D))[0];

  const all = i.entries;
  // one version per lineage, the one that is counted: a fork compares with it, not with an arbitrary sibling (L-REV2 R3-01)
  const inForce = projectEntries(all).filter((e) => e.date === D);
  const removed = new Set(all.filter((e) => e.kind === 'retract').map((e) => (e as Extract<LogEntry, { kind: 'retract' }>).target));
  const deviceSource = (key: string, recordId: string): EntrySource => ({ by: 'device', method: 'biometrics', bioRecordId: recordId, deviceKey: key });
  const isDevice = (e: LogEntry): boolean => e.source.by === 'device' && e.source.method === 'biometrics';

  const create: DeviceLogCreate[] = [];
  const skipped: DeviceLogSkip[] = [];
  const consider = (stream: DeviceLogStream, key: string, sourceKey: string, recordId: string, entry: DeviceEntryDraft, userEntry: LogEntry | undefined): void => {
    if (userEntry) {
      skipped.push({ key, stream, recordId, reason: 'userEntry', entryId: userEntry.id });
      return;
    }
    const mine = inForce.find((e) => e.source.deviceKey === key);
    if (mine) {
      if (valueOf(mine as never) === valueOf(entry as never)) skipped.push({ key, stream, recordId, reason: 'unchanged', entryId: mine.id });
      else create.push({ key, stream, sourceKey, recordId, entry, supersedes: mine.id });
      return;
    }
    // the person removed the device entry for this key: a re-run does not bring it back
    if (all.some((e) => e.source.deviceKey === key && removed.has(e.id))) {
      skipped.push({ key, stream, recordId, reason: 'removed' });
      return;
    }
    create.push({ key, stream, sourceKey, recordId, entry });
  };

  if (day?.daily?.steps !== undefined && day.sourceByMetric['steps']) {
    const key = `${D}:steps`;
    const rid = day.daily.record_id;
    consider('steps', key, day.sourceByMetric['steps'], rid, { date: D, source: deviceSource(key, rid), kind: 'steps', steps: Math.round(day.daily.steps) } as DeviceEntryDraft, inForce.find((e) => e.kind === 'steps' && !isDevice(e)));
  }

  const sleep: SleepRecord | undefined = day?.mainSleep;
  if (sleep?.time.start && sleep.time.end && day?.sourceByMetric['sleep']) {
    const key = `${D}:sleep_sessions`;
    const rid = sleep.record_id;
    const entry = { date: D, source: deviceSource(key, rid), kind: 'sleep', bedAt: sleep.time.start, wakeAt: sleep.time.end } as DeviceEntryDraft;
    consider('sleep_sessions', key, day.sourceByMetric['sleep'], rid, entry, inForce.find((e) => e.kind === 'sleep' && !isDevice(e)));
  }

  if (day && day.workouts.length > 0 && day.sourceByMetric['workouts']) {
    const userSessions = inForce.filter((e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session' && !isDevice(e));
    for (const w of day.workouts) {
      const key = `${D}:workouts:${w.record_id}`;
      const entry = workoutEntry(w, D, i.tz, deviceSource(key, w.record_id));
      const startH = (entry as unknown as { startH: number }).startH;
      const user = userSessions.find((s) => s.bioWorkoutId === w.record_id || (s.startH !== undefined && Math.abs(s.startH - startH) <= 1));
      consider('workouts', key, day.sourceByMetric['workouts'], w.record_id, entry, user);
    }
  }

  return { date: D, create, skipped, notOptedIn: [...off].filter((s) => !on.has(s)).sort() };
}

/** Local dates whose records can hold app day D's data (a sleep dated by its start, a workout after midnight). */
export function deviceLogWindow(date: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: addDays(date, -1), to: addDays(date, 1) };
}
