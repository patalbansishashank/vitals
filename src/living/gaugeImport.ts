/**
 * The Gauge import (vitals-research/step1/BRIEF.md): the person's ring steps and main sleep, read from their home server,
 * become ordinary daily-log entries (`dailyLogs`, kinds `steps` and `sleep`) the living plan, the check-ins and the
 * planner read exactly like the person's own logs. Pure: `log.fromGauge` reads the documents and writes what this returns.
 *
 * Rules:
 *  - one entry per natural key, `gauge:steps:<date>` (the ring's daily total of that local date) and
 *    `gauge:sleep:<waking date>` (the night's main episode: the session with the most minutes asleep among those of the
 *    waking day; naps are not imported), kept in `source.deviceKey`;
 *  - a key whose value did not change writes nothing; a changed value supersedes the Gauge entry in force; today's steps
 *    (still climbing) are rewritten only after 90 minutes or 3000 more steps, so a day leaves a handful of versions;
 *  - the person's own entry always wins: a steps entry not from Gauge on that day, or a sleep entry not from Gauge and not
 *    a nap on that wake date, and nothing is written for the key (the import never writes over it). An entry the person
 *    removed (`log.retract`) is never brought back;
 *  - a night still going on is not imported: a session counts once its wake is an hour in the past or a later episode
 *    began after it (r063 S29: timestamps, not the rollover). It is dated by the app day of its wake
 *    (`GAUGE_SLEEP_WAKE_DATE`), so a 20:00-03:00 night lands on the app day it began. Should a night imported early (the
 *    ring stopped syncing mid-night) later end on another wake date, the early entry is retracted with the new one;
 *  - ids are deterministic (key, value and the entry it supersedes), so two devices importing the same reading write the
 *    same document, which sync merges into one (no duplicates across devices); should two devices still fork a key, the
 *    projection counts the newest reading without a conflict (`projectEntries`);
 *  - unknown is never zero: a day the ring counted no steps, or a session with no minutes asleep, is skipped.
 *
 * Provenance (C1): `source { by: 'device', method: 'biometrics', app: 'gauge', deviceKey }`, steps `provenance: 'measured'`
 * with a date-only calendar-local occurrence, sleep `provenance: 'estimated'` (device-classified stages) with the
 * [bed, wake) interval as its occurrence, dated by the wake date (D8-06). No sleep quality is derived (D8-06: quality only
 * as the person rated it; the ring's sleep score has no validated mapping to poor/fair/good).
 */
import { CONTRACT_VERSIONS, contentHash, dateOnlyOccurrence, intervalOccurrence } from '@/lib/bodyContracts';
import { appDay, DEFAULT_ROLLOVER_H } from './appDay';
import { effectiveEntries, isGaugeEntry, projectEntries } from './logs';
import { addDays } from './dates';
import { carriedDiary } from './sleepDiary';
import { GAUGE_APP, type EntrySource, type Instant, type LocalDate, type LogEntry, type StepsFusionDay } from './types';

/**
 * A day of steps: the fused headline of `/steps` (`steps-fuse/1`, energy SPEC §V3.6) with its lineages and fused day, or
 * (when the server has no `/steps` yet) the ring's daily total (`gauge_activity`: `steps`, else `bucketSteps`).
 */
export interface GaugeStepsDay {
  date: LocalDate;
  steps: number;
  /** The fused day (absent = a ring-only total). */
  fusion?: StepsFusionDay;
  /** The lineages the fused day used. */
  sources?: readonly string[];
}

/** A ring sleep session (the server's `gauge_sleep` session). */
export interface GaugeSleepEpisode {
  wakingDate: LocalDate;
  start: Instant;
  end: Instant;
  asleepMinutes: number;
  /**
   * (0.6.3 FX5) The Health Connect app the night came from, when the ring recorded no sleep that night (the server's
   * fallback); its entry carries the lineage `hc-other:<origin>`. Absent: the ring's.
   */
  origin?: string;
}

export type GaugeStream = 'steps' | 'sleep';

export interface GaugeImportInput {
  /** Every stored log entry (supersedes and retracts unresolved; any dates). */
  entries: readonly LogEntry[];
  steps: readonly GaugeStepsDay[];
  sleep: readonly GaugeSleepEpisode[];
  tz: string;
  rolloverH?: number;
  /** The app day now. */
  today: LocalDate;
  /** Now (ISO): the entries' audit time and the today-steps throttle. */
  now: Instant;
  /**
   * (0.6.3 FX1, sR03/aR05) What the server answered in full this run (an authoritative answer, never a failed or offline
   * read): `steps`, the app days the fused read covered; `sleep`, the wake dates the sleep read covered. An imported entry
   * of one of them that the answer no longer supports (no reading that day, no night overlapping it) was deleted upstream
   * and is retracted (by the import; it comes back if the evidence does). Absent = nothing is inferred.
   */
  answered?: { steps?: readonly LocalDate[]; sleep?: { from: LocalDate; to: LocalDate } };
}

export interface GaugeImportCreate {
  key: string;
  stream: GaugeStream;
  /** The deterministic id to write it under. */
  id: string;
  entry: Omit<LogEntry, 'id'>;
}

export type GaugeImportSkipReason = 'userEntry' | 'unchanged' | 'removed' | 'throttled' | 'changedUpstream';

/** Late corrections inside this window supersede the entry in force; older ones are only listed "changed upstream". */
export const GAUGE_CORRECTION_WINDOW_DAYS = 30;

export interface GaugeImportSkip {
  key: string;
  stream: GaugeStream;
  reason: GaugeImportSkipReason;
  entryId?: string;
}

export interface GaugeImportPlan {
  create: GaugeImportCreate[];
  skipped: GaugeImportSkip[];
}

/** Today's climbing step count is rewritten at most this often (or after `TODAY_STEPS_JUMP` more steps). */
export const TODAY_STEPS_REWRITE_MS = 90 * 60_000;
export const TODAY_STEPS_JUMP = 3000;

export const gaugeKey = (stream: GaugeStream, date: LocalDate): string => `gauge:${stream}:${date}`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID-shaped id that every device computes alike: the time part is the entry's date (so ids still sort by day), the
 * rest an 80-bit hash of the key, the value and the superseded entry.
 */
export function gaugeEntryId(date: LocalDate, seed: string): string {
  let t = Math.max(0, Date.parse(`${date}T00:00:00Z`) || 0);
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let bits = BigInt(`0x${contentHash(`a|${seed}`)}${contentHash(`b|${seed}`)}`);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand = CROCKFORD[Number(bits & 31n)] + rand;
    bits >>= 5n;
  }
  return time + rand;
}

const iso = (s: string): string | null => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

type StepsEntry = Extract<LogEntry, { kind: 'steps' }>;
type SleepEntry = Extract<LogEntry, { kind: 'sleep' }>;

type GaugeReading = {
  kind: string;
  steps?: number;
  bedAt?: string;
  wakeAt?: string;
  asleepMin?: number;
  fusion?: StepsFusionDay;
  source?: { sources?: readonly string[] };
  occurrence?: { dateMeaning?: string; rolloverH?: number };
};

/** Stored fusion facts that can change replay or provenance even when the headline count does not. */
function stepMetadata(e: GaugeReading) {
  const f = e.fusion;
  if (!f) return null;
  return {
    version: f.version,
    located: f.located,
    headlinePolicy: f.headlinePolicy,
    ringDailyTotal: f.ringDailyTotal ?? null,
    ringResidual: f.ringResidual ?? null,
    coverage: f.coverage
      ? [f.coverage.ringMin, f.coverage.phoneMin, f.coverage.eitherMin, f.coverage.unknownMin]
      : null,
    // Absent spans trigger the older minute-count fallback; an empty span list means observed coverage is empty.
    spans: f.spans === undefined ? null : [...f.spans].map((s) => [s.start, s.end]).sort((a, b) => a[0]!.localeCompare(b[0]!) || a[1]!.localeCompare(b[1]!)),
    sources: [...new Set(e.source?.sources ?? [])].sort(),
    dateMeaning: e.occurrence?.dateMeaning ?? null,
    rolloverH: e.occurrence?.rolloverH ?? null,
  };
}

/** What makes two Gauge entries the same reading. Server inputsHash is deliberately absent from the stored day. */
function valueOf(e: GaugeReading): string {
  // A fused day differs from a ring-only one even at the same count; a semantic fusion correction supersedes the prior
  // entry, while a hash-only algorithm revision with the same selected day remains idempotent.
  return e.kind === 'steps' ? JSON.stringify([e.steps, stepMetadata(e)]) : JSON.stringify([e.bedAt, e.wakeAt, e.asleepMin ?? null]);
}
type Draft = Omit<StepsEntry, 'id'> | Omit<SleepEntry, 'id'>;

/** The steps of a server activity day: its daily total, else the sum of its buckets; null when unknown or zero. */
export function gaugeDaySteps(day: { steps: number | null; bucketSteps?: number | null }): number | null {
  const v = day.steps ?? day.bucketSteps ?? null;
  return v !== null && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/**
 * (r063 S29) The wake-date contract of an imported night: the app day (rollover applied) of its wake instant, as `log.sleep`
 * dates the person's own nights (D8-06, `sleepDateContract`). A wake at 03:00 is the app day before; one at 07:00 today's.
 */
export const GAUGE_SLEEP_WAKE_DATE = 'appDayOfWake' as const;
/** A night whose wake is at least this far in the past is over (the ring syncs every few minutes while worn). */
export const GAUGE_SLEEP_SETTLE_MS = 60 * 60_000;

/** Is a night over at `nowMs`: its wake settled, or a later episode began after it (timestamps only, never the rollover). */
export function sleepCompleted(wakeMs: number, nowMs: number, otherStarts: readonly number[] = []): boolean {
  if (!Number.isFinite(wakeMs) || !Number.isFinite(nowMs) || wakeMs > nowMs) return false;
  return nowMs - wakeMs >= GAUGE_SLEEP_SETTLE_MS || otherStarts.some((t) => t >= wakeMs);
}

/** What `log.fromGauge` writes. */
export function planGaugeImport(i: GaugeImportInput): GaugeImportPlan {
  const rolloverH = i.rolloverH ?? DEFAULT_ROLLOVER_H;
  const all = i.entries;
  const live = effectiveEntries(all);
  // the person's entries: the projection never hides them (only Gauge entries give way)
  const inForce = projectEntries(all);
  const retracts = all.filter((e): e is Extract<LogEntry, { kind: 'retract' }> => e.kind === 'retract');
  // (FX1) the import's own retractions (evidence deleted upstream) never block a reading that comes back; the person's do
  const byImport = (e: LogEntry) => isGaugeEntry(e) && e.source.actorId === 'gauge-import';
  const removedIds = new Set(retracts.filter((e) => !byImport(e)).map((e) => e.target));
  const importRetracted = new Map(retracts.filter(byImport).map((e) => [e.target, e.id] as const));
  const nowMs = Date.parse(i.now);
  const create: GaugeImportCreate[] = [];
  const skipped: GaugeImportSkip[] = [];

  const source = (key: string): EntrySource => ({ by: 'device', method: 'biometrics', app: GAUGE_APP, deviceKey: key, actorId: 'gauge-import' });
  const base = (date: LocalDate, key: string) => ({ date, tz: i.tz, at: i.now, recordedAt: i.now, contract: CONTRACT_VERSIONS.observation, source: source(key) });

  const consider = (stream: GaugeStream, key: string, date: LocalDate, draft: Draft, userEntry: LogEntry | undefined): void => {
    if (userEntry) {
      skipped.push({ key, stream, reason: 'userEntry', entryId: userEntry.id });
      return;
    }
    const keyed = (e: LogEntry) => isGaugeEntry(e) && e.source.deviceKey === key;
    const newest = (e: LogEntry) => e.recordedAt ?? e.at ?? '';
    const head = live.filter(keyed).sort((a, b) => newest(b).localeCompare(newest(a)) || b.id.localeCompare(a.id))[0];
    if (!head && all.some((e) => keyed(e) && removedIds.has(e.id))) {
      skipped.push({ key, stream, reason: 'removed' });
      return;
    }
    if (head) {
      if (valueOf(head) === valueOf(draft)) {
        skipped.push({ key, stream, reason: 'unchanged', entryId: head.id });
        return;
      }
      // a correction older than the window is listed, never rewritten (the history it fed stays as it was)
      if (date < addDays(i.today, -(GAUGE_CORRECTION_WINDOW_DAYS - 1))) {
        skipped.push({ key, stream, reason: 'changedUpstream', entryId: head.id });
        return;
      }
      if (stream === 'steps' && date === i.today && head.kind === 'steps' && draft.kind === 'steps') {
        const since = nowMs - Date.parse(newest(head));
        if (draft.steps !== head.steps && Math.abs(draft.steps - head.steps) < TODAY_STEPS_JUMP && Number.isFinite(since) && since < TODAY_STEPS_REWRITE_MS) {
          skipped.push({ key, stream, reason: 'throttled', entryId: head.id });
          return;
        }
      }
    }
    // (D11) a corrected ring night keeps the person's diary times (`log.sleepTimes`): the import never drops them
    const entry = { ...draft, ...(stream === 'sleep' ? carriedDiary(head) : {}), ...(head ? { supersedes: head.id } : {}) } as Omit<LogEntry, 'id'>;
    // (FX1) a reading back after the import retracted the key's entry: a new id (the retraction is part of its seed)
    const after = head ? head.id : lastImportRetraction(key);
    create.push({ key, stream, id: gaugeEntryId(date, `${key}|${valueOf(draft)}|${after ?? ''}`), entry });
  };
  /** The newest import retraction of a key's entries (FX1), when the key has no entry in force. */
  const lastImportRetraction = (key: string): string | undefined => {
    const gone = all.filter((e) => e.kind !== 'retract' && isGaugeEntry(e) && e.source.deviceKey === key && importRetracted.has(e.id));
    const ids = gone.map((e) => importRetracted.get(e.id)!).sort();
    return ids.at(-1);
  };
  /** (FX1) The import's retraction of a Gauge entry whose evidence the server no longer has (deterministic id). */
  const retractOf = (key: string, stream: GaugeStream, e: LogEntry): GaugeImportCreate => ({ key, stream, id: gaugeEntryId(e.date, `${key}|retract|${e.id}`), entry: { ...base(e.date, key), kind: 'retract', target: e.id } as Omit<LogEntry, 'id'> });
  const correctable = (date: LocalDate) => date >= addDays(i.today, -(GAUGE_CORRECTION_WINDOW_DAYS - 1));

  // ---- steps: one per local date
  // one per date: a fused day wins over a ring-only total of the same date (never the larger of two lineages)
  const stepsByDate = new Map<LocalDate, GaugeStepsDay>();
  for (const d of i.steps) {
    // a count of 0 is a reading only with fused step coverage that day (Codex #16: a correction to zero replaces the old
    // count); a bare 0 without coverage is no evidence and writes nothing
    const supportedZero = d.steps === 0 && (d.fusion?.coverage?.eitherMin ?? 0) > 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date > i.today || !(Number.isFinite(d.steps) && (d.steps > 0 || supportedZero))) continue;
    const prev = stepsByDate.get(d.date);
    const next = { ...d, steps: Math.round(d.steps) };
    if (!prev || (next.fusion && !prev.fusion) || (!!next.fusion === !!prev.fusion && next.steps > prev.steps)) stepsByDate.set(d.date, next);
  }
  for (const [date, day] of [...stepsByDate].sort((a, b) => a[0].localeCompare(b[0]))) {
    const key = gaugeKey('steps', date);
    const steps = day.steps;
    const b = base(date, key);
    const draft = {
      ...b,
      ...(day.fusion ? { source: { ...b.source, sources: [...(day.sources ?? [])].sort() }, sourceVersion: day.fusion.version, fusion: { ...day.fusion } } : {}),
      kind: 'steps',
      steps,
      // the ring (and the fused day) count every step seen, training included
      scope: 'totalDay',
      provenance: 'measured',
      // (audit F12) a fused day is an app day (the small hours moved to the day they belong to); a ring-only total stays
      // the ring's calendar day
      occurrence: day.fusion ? { ...dateOnlyOccurrence(date, 'appDay', 'device'), rolloverH } : dateOnlyOccurrence(date, 'calendarLocal', 'device'),
    } satisfies Omit<StepsEntry, 'id'>;
    consider('steps', key, date, draft, inForce.find((e) => e.kind === 'steps' && e.date === date && !isGaugeEntry(e)));
  }

  // (FX1, sR03/aR05) a day the server answered in full with no reading (no steps, no coverage: its evidence was deleted
  // upstream): the imported entry in force is retracted, never kept as if the steps were still there. Only an
  // authoritative answer says so; a failed or offline read never reaches here
  for (const date of [...new Set(i.answered?.steps ?? [])].sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > i.today || stepsByDate.has(date)) continue;
    const key = gaugeKey('steps', date);
    for (const e of live) {
      if (e.kind !== 'steps' || !isGaugeEntry(e) || e.source.deviceKey !== key) continue;
      if (!correctable(date)) skipped.push({ key, stream: 'steps', reason: 'changedUpstream', entryId: e.id });
      else create.push(retractOf(key, 'steps', e));
    }
  }

  // ---- sleep: the main episode of each wake date, once the night is over
  // (r063 S29) the wake-date contract (`GAUGE_SLEEP_WAKE_DATE`): a completed night is dated by Vitals' app day of its wake,
  // the same rule as `log.sleep` (D8-06), whatever the server's own `wakingDate` (Gauge dates a bout by its start with a
  // 19:00 rule, possibly in another zone; audit F13). Completion is read from the timestamps, never from the wake being
  // after the rollover: the night is over once its wake is `GAUGE_SLEEP_SETTLE_MS` in the past, or a later episode began
  // after it. So a 20:00-03:00 night lands on the app day of 03:00 (the evening it began) when the ring syncs later.
  const starts = i.sleep.map((s) => Date.parse(s.start)).filter((t) => Number.isFinite(t));
  const mainByDate = new Map<LocalDate, { bedAt: string; wakeAt: string; asleepMin: number; origin?: string }>();
  for (const s of i.sleep) {
    const bedAt = iso(s.start);
    const wakeAt = iso(s.end);
    if (!bedAt || !wakeAt) continue;
    const wakeMs = Date.parse(wakeAt);
    const span = wakeMs - Date.parse(bedAt);
    const asleepMin = Math.round(s.asleepMinutes);
    if (!(span > 0 && span <= 24 * 3_600_000) || !(asleepMin > 0) || asleepMin * 60_000 > span) continue;
    if (!sleepCompleted(wakeMs, nowMs, starts)) continue;
    const wakeDay = appDay(wakeMs, { tz: i.tz, rolloverH });
    if (wakeDay > i.today) continue;
    const cur = mainByDate.get(wakeDay);
    if (!cur || asleepMin > cur.asleepMin || (asleepMin === cur.asleepMin && bedAt < cur.bedAt)) mainByDate.set(wakeDay, { bedAt, wakeAt, asleepMin, ...(s.origin ? { origin: s.origin } : {}) });
  }
  for (const [date, s] of [...mainByDate].sort((a, b) => a[0].localeCompare(b[0]))) {
    const key = gaugeKey('sleep', date);
    const b0 = base(date, key);
    const draft = {
      ...b0,
      // (0.6.3 FX5) a night from Health Connect says so in its lineage
      ...(s.origin ? { source: { ...b0.source, sources: [`hc-other:${s.origin}`] } } : {}),
      kind: 'sleep',
      bedAt: s.bedAt,
      wakeAt: s.wakeAt,
      asleepMin: s.asleepMin,
      episodeKind: 'main',
      sleepDateContract: CONTRACT_VERSIONS.sleepDate,
      provenance: 'estimated',
      occurrence: intervalOccurrence(s.bedAt, s.wakeAt, { tz: i.tz, date, dateMeaning: 'wakeDate', source: 'device' }),
    } satisfies Omit<SleepEntry, 'id'>;
    const before = create.length;
    consider('sleep', key, date, draft, inForce.find((e) => e.kind === 'sleep' && e.date === date && !isGaugeEntry(e) && e.episodeKind !== 'nap'));
    if (create.length === before) continue;
    // (S29) the same night imported earlier under another wake date (it seemed over, then went on): that entry goes
    const a = Date.parse(s.bedAt);
    const b = Date.parse(s.wakeAt);
    for (const e of live) {
      if (e.kind !== 'sleep' || !isGaugeEntry(e) || e.source.deviceKey === key || removedIds.has(e.id)) continue;
      const ea = Date.parse(e.bedAt);
      const eb = Date.parse(e.wakeAt);
      if (!(Math.min(b, eb) > Math.max(a, ea)) || !(eb < b)) continue;
      const k = e.source.deviceKey ?? gaugeKey('sleep', e.date);
      create.push({ key: k, stream: 'sleep', id: gaugeEntryId(e.date, `${k}|retract|${e.id}`), entry: { ...base(e.date, k), kind: 'retract', target: e.id } as Omit<LogEntry, 'id'> });
    }
  }

  // (FX1, sR03/aR05) an imported night of a wake date the sleep read covered in full, when no night of the answer overlaps
  // it any more (deleted upstream): retracted. A night still going on, or revised, overlaps a session and stays
  const sa = i.answered?.sleep;
  if (sa && /^\d{4}-\d{2}-\d{2}$/.test(sa.from) && /^\d{4}-\d{2}-\d{2}$/.test(sa.to)) {
    const spans = i.sleep.map((s) => [Date.parse(s.start), Date.parse(s.end)] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
    const retracting = new Set(create.flatMap((c) => (c.entry.kind === 'retract' ? [(c.entry as unknown as { target: string }).target] : [])));
    for (const e of live) {
      if (e.kind !== 'sleep' || !isGaugeEntry(e) || e.date < sa.from || e.date > sa.to || mainByDate.has(e.date) || retracting.has(e.id)) continue;
      const a = Date.parse(e.bedAt);
      const b = Date.parse(e.wakeAt);
      if (!Number.isFinite(a) || !Number.isFinite(b) || spans.some(([x, y]) => Math.min(b, y) > Math.max(a, x))) continue;
      const key = e.source.deviceKey ?? gaugeKey('sleep', e.date);
      if (!correctable(e.date)) skipped.push({ key, stream: 'sleep', reason: 'changedUpstream', entryId: e.id });
      else create.push(retractOf(key, 'sleep', e));
    }
  }

  return { create, skipped };
}

/**
 * (r063 S27/A29) Today's live step reading, apart from the throttled persistence: the import writes today's climbing count
 * at most every 90 minutes (or 3000 steps), but the freshest reading it saw is kept as a live snapshot, and today's model
 * reads it through this overlay. The overlay replaces today's Gauge steps entry (or stands in for a missing one) with the
 * snapshot as an unstored entry; the person's own steps entry always wins. Never written: history keeps the throttled
 * versions. Pure.
 */
export interface LiveStepsSnapshot {
  day: GaugeStepsDay;
  /** When the import read it (ISO). */
  at: Instant;
}

export function liveStepsOverlay(entries: readonly LogEntry[], live: LiveStepsSnapshot | null, i: { today: LocalDate; tz: string; rolloverH?: number }): LogEntry[] {
  if (!live || live.day.date !== i.today || !Number.isFinite(live.day.steps) || live.day.steps < 0) return [...entries];
  const own = entries.some((e) => e.kind === 'steps' && e.date === i.today && !e.assumed && !isGaugeEntry(e));
  if (own) return [...entries];
  const key = gaugeKey('steps', i.today);
  const kept = entries.filter((e) => !(e.kind === 'steps' && e.date === i.today && isGaugeEntry(e)));
  const d = live.day;
  const entry = {
    id: `live:${key}`,
    date: i.today,
    tz: i.tz,
    at: live.at,
    recordedAt: live.at,
    source: { by: 'device', method: 'biometrics', app: GAUGE_APP, deviceKey: key, actorId: 'gauge-import', ...(d.fusion ? { sources: [...(d.sources ?? [])].sort() } : {}) },
    kind: 'steps',
    steps: Math.round(d.steps),
    scope: 'totalDay',
    provenance: 'measured',
    ...(d.fusion ? { sourceVersion: d.fusion.version, fusion: { ...d.fusion } } : {}),
    occurrence: d.fusion ? { ...dateOnlyOccurrence(i.today, 'appDay', 'device'), rolloverH: i.rolloverH ?? DEFAULT_ROLLOVER_H } : dateOnlyOccurrence(i.today, 'calendarLocal', 'device'),
  } as LogEntry;
  return [...kept, entry];
}
