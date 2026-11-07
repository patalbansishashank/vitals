/**
 * V3 adapter for Progress (energy SPEC §V4.6, A.3.7): the one read Progress makes of the living plan (V3). For each
 * elapsed day it answers the approved actuals (§V3.2, §V3.5), the realised run's energy (§V3.4, §V2.6 `energyDay` over
 * that run) and the resolved intake (`toLoggedDay`); `./data/actuals.ts` reads one day out, this file gathers the inputs:
 *  - the realised history: `projectLiving` over the stored documents (`realiseLivingHistory` days, each with its
 *    `toLoggedDay` result) and the effective log entries (approved `session` entries; pending candidates write none);
 *  - the fused minute timelines of the days (S2 `timeline`, `./data/timelines.ts`), for V2 `heartPoints` and the minute
 *    placement of `energyDay`;
 *  - one engine run over the realised schedule of the past plan days (`projectionSchedule`, hourly series), the same
 *    single authority Today reads.
 * The read is asynchronous: `progressActuals` answers what is loaded (null at first), starts the load, and a revision bump
 * tells the cards to read again. Each window, the projection and the run are memoised until a document, the profile's age
 * or a timeline changes; each day is memoised by its own inputs, so a change to one day recomputes only that day.
 * Unknowns stay null, never 0 (§1.2). `setProgressActuals` is a seam for tests and the screenshot harness only.
 *
 * (0.6.3 FX1, aR11) The loaded windows are scoped by the Gauge identity (paired server and person): pairing, unpairing, a
 * revoked device or a refused read (403) drops them and every per-day answer (nothing is shown from before); new Gauge
 * data (an import, a measurement) or a new fusion context re-reads them, keeping what is shown until the new answer
 * arrives; a load started under another identity or before an invalidation is dropped.
 */
import type { StimulusVector } from '@/catalogues/types';
import type { LocalDate, LogEntry } from '@/living';
import { addDays, compareDates } from '@/living/dates';
import type { Envelope } from '@/living/sensors';
import { hoursFromRun, type EnergyHour } from '@/living/sensors/energyDay';
import type { LoggedDayResult } from '@/living/loggedDay';
import type * as Runtime from '@/state/runtime';
import type * as ProfileStore from '@/state/profileStore';
import { gaugeApi, onFusionContextChange, type GaugeProblem } from '@/net/gauge';
import { gaugeIdentity, onGaugeDataChanged, onGaugeIdentityChange } from '@/net/gaugeIdentity';
import { dayActual, dayBouts } from './data/actuals';
import { hrExactFor, hrExactSignature, hrExactSpan } from './data/hrExact';
import { minuteIndex, timelineSignature, timelinesFor } from './data/timelines';

/** One elapsed day as Progress reads it from the realised history. */
export interface ProgressDayActual {
  date: LocalDate;
  /**
   * Heart Points of the day (`fit-points/1`, V2 `heartPoints` over the day's fused timeline and its APPROVED bouts; pending
   * candidates never earn points). Exact count, rounded only for display. null: no sensor coverage that day (not zero).
   */
  heartPoints: number | null;
  /**
   * The `stimulus` of every done session entry that day (approved device bouts and logged sessions alike). Progress sums a
   * week with the engine's `weeklyDose`, whose D3-03 guideline minutes are the WHO moderate-equivalent minutes.
   */
  sessionStimuli: readonly StimulusVector[];
  /**
   * Energy out: `energyDay(...).total` over the realised run's hourly series for the date, with its scenario envelope
   * (§V2.6, §1.5). null when the day has no realised run.
   */
  energyOut: { kcal: number; envelope: Envelope } | null;
  /** Intake logged that day (kcal), only when every meal of the day is resolved; else null (`toLoggedDay` intake coverage). */
  intakeKcal: number | null;
}

/** The read Progress needs from V3. */
export interface ProgressActualsAdapter {
  /**
   * Elapsed days in [from, to] (inclusive, oldest first); null while it loads or when the documents cannot be read.
   * Without a plan (0.6.3) the days carry Heart Points and session stimuli only (energy out and intake unknown).
   */
  progressActuals(from: LocalDate, to: LocalDate): readonly ProgressDayActual[] | null;
}

/* ---- the live read ------------------------------------------------------------------------------------------------ */

const HOURLY = ['rmr', 'tef', 'neat', 'stepsEnergy', 'exerciseEnergy', 'tdee'] as const;
type Hourly = Partial<Record<(typeof HOURLY)[number], ArrayLike<number>>>;
type Session = Extract<LogEntry, { kind: 'session' }>;

/** The engine run over the realised schedule's first `days` plan days (hourly series), or null when it cannot run here. */
async function runPastHourly(profile: unknown, schedule: unknown, days: number): Promise<Hourly | null> {
  const { getSimulationClient } = await import('@/workers/simulationClient');
  const r = await getSimulationClient().runNominal(profile as never, { ...(schedule as object), horizonDays: days } as never, { record: 'full', series: [...HOURLY], collectEvents: false });
  return (r.hourly as Hourly | undefined) ?? null;
}

interface Base {
  /** Effective session entries by date. */
  sessions: Map<LocalDate, Session[]>;
  /** The realised history's day results by date (plan days up to today). */
  results: Map<LocalDate, LoggedDayResult>;
  /** The realised run's hours by date (past plan days only). */
  hours: Map<LocalDate, EnergyHour[]>;
  /** App-day starts by date (UTC ms). */
  dayStart: (date: LocalDate) => number;
  tz: string;
  today: LocalDate;
  ageY: number | null;
}

let stamp = 0;
/** (FX1) Bumped only when the history base must be rebuilt (a document or the age changed), not on a Gauge-side change. */
let baseStamp = 0;
let baseMemo: { key: string; at: number; base: Promise<Base | null> } | null = null;
const dayMemo = new Map<LocalDate, { key: string; value: ProgressDayActual }>();
/** (r063 S27/A29) Each loaded window with when it loaded: it expires (today moves, a failed load is retried). */
const windows = new Map<string, { at: number; value: readonly ProgressDayActual[] | null }>();
/** A loaded window is read again after this long while asked (today's minutes and timelines move; P). */
export const PROGRESS_WINDOW_TTL_MS = 5 * 60_000;
/** A window that failed to load (null) is retried after this long (P). */
export const PROGRESS_WINDOW_RETRY_MS = 30_000;
/** The history base (projection and the realised run) is rebuilt after this long even without a document change (P). */
export const PROGRESS_BASE_TTL_MS = 30 * 60_000;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const stale = new Map<string, readonly ProgressDayActual[] | null>();
const loading = new Map<string, number>();

async function loadBase(now: number): Promise<Base | null> {
  const [{ readDocs }, { currentDay }, { timeZone }, living, { appDayStartInstant }, { projectEntries }, profile, body] = await Promise.all([
    import('@/commands/living'),
    import('@/commands/livingWiring'),
    import('@/commands/bus'),
    import('@/living/projection'),
    import('@/living/realisedHistory'),
    import('@/living/logs'),
    import('@/state/profileStore'),
    import('@/features/body/model'),
  ]);
  const today = currentDay(now);
  const docs = await readDocs(today);
  const tz = timeZone();
  const rolloverH = docs.settings?.dayRolloverH ?? 4;
  const summary = body.summarizeBody(profile.selectBodyValues(profile.useProfileStore.getState()));
  const ageY = summary.missing.includes('age') ? null : summary.ageYears;
  const p = living.projectLiving({ docs, today, tz, now: new Date(now).toISOString(), skipAssimilation: true });
  // without a plan (0.6.3: Today in Planning mode) the days still have their sessions and the ring's minutes, so Heart
  // Points are known; energy out and intake stay unknown (no realised run, no plan day to resolve the meals against)
  const sessions = new Map<LocalDate, Session[]>();
  for (const e of projectEntries(docs.entries)) {
    if (e.kind !== 'session') continue;
    sessions.set(e.date, [...(sessions.get(e.date) ?? []), e]);
  }
  const results = new Map(p.days.map((d) => [d.date, d.result] as const));
  const dayStart = (date: LocalDate) => Date.parse(appDayStartInstant(date, tz, rolloverH));
  const hours = new Map<LocalDate, EnergyHour[]>();
  const past = p.days.filter((d) => compareDates(d.date, today) < 0);
  const lastIdx = past.reduce((m, d) => Math.max(m, d.planDay), -1);
  const schedule = p.plan && p.head && lastIdx >= 0 ? living.projectionSchedule(p, today) : null;
  if (schedule && p.plan) {
    try {
      const hourly = await liveDeps.runPast(p.plan.baselineProfile, schedule, lastIdx + 1);
      const tdee = hourly?.tdee;
      if (hourly && tdee) {
        for (const d of past) {
          if (tdee.length < (d.planDay + 1) * 24) continue;
          hours.set(d.date, hoursFromRun(hourly as Record<(typeof HOURLY)[number], ArrayLike<number>>, d.planDay * 24, 24, dayStart(d.date)));
        }
      }
    } catch {
      // no engine here: energy out stays unknown
    }
  }
  return { sessions, results, hours, dayStart, tz, today, ageY };
}

const hoursSig = (h: readonly EnergyHour[] | undefined) => (h ? `${h[0]?.start}:${h.reduce((s, x) => s + x.tdee + x.exerciseEnergy + x.stepsEnergy, 0).toFixed(3)}` : '-');

function resultSig(r: LoggedDayResult | undefined): string {
  if (!r) return '-';
  return `${r.assumedDay ? 1 : 0}:${r.observed.energyKcal}:${r.observed.unknownEnergyMeals}:${r.remainders.filter((x) => x.channel === 'energy').length}`;
}

async function loadWindow(from: LocalDate, to: LocalDate, now: number): Promise<readonly ProgressDayActual[] | null> {
  const key = `${baseStamp}`;
  // (r063 S27/A29) the base is kept across window refreshes (no rerun of the history), up to its own expiry
  if (!baseMemo || baseMemo.key !== key || now - baseMemo.at > PROGRESS_BASE_TTL_MS) baseMemo = { key, at: now, base: loadBase(now).catch(() => null) };
  const base = await baseMemo.base;
  // a failed base is not kept: the next window asks again
  if (!base && baseMemo.key === key) baseMemo = null;
  if (!base) return null;
  const last = compareDates(to, base.today) > 0 ? base.today : to;
  if (compareDates(from, last) > 0) return [];
  const dates: LocalDate[] = [];
  for (let d = from; compareDates(d, last) <= 0; d = addDays(d, 1)) dates.push(d);
  // an app day starts at the rollover, so its late minutes sit on the next calendar date's timeline
  const tls = await timelinesFor([addDays(from, -1), ...dates, addDays(last, 1)], base.today, now);
  // (r063 FX2) each day's inputs, then Gauge's exact HR of the minutes where it can change the day's points (one batch)
  const rows = dates.map((date) => {
    const start = base.dayStart(date);
    const end = date === base.today ? Math.min(now, base.dayStart(addDays(date, 1))) : base.dayStart(addDays(date, 1));
    const sessions = base.sessions.get(date) ?? [];
    const near = [addDays(date, -1), date, addDays(date, 1)].map((d) => tls.get(d) ?? null);
    const minuteAt = minuteIndex(near, base.tz);
    const span = hrExactSpan({ start, end, minuteAt, parts: dayBouts(sessions, date, base.tz).flatMap((b) => b.parts ?? [b.window]) });
    return { date, start, end, sessions, near, minuteAt, span };
  });
  const exact = await hrExactFor(rows.map((r) => ({ key: r.date, span: r.span })), now);
  const out: ProgressDayActual[] = [];
  for (const { date, start, end, sessions, near, minuteAt } of rows) {
    const result = base.results.get(date) ?? null;
    const hours = base.hours.get(date) ?? null;
    const hrExact = exact.get(date) ?? null;
    const k = [
      sessions.map((s) => s.id).join(','),
      resultSig(result ?? undefined),
      near.map(timelineSignature).join('|'),
      hoursSig(hours ?? undefined),
      base.ageY,
      date === base.today ? Math.floor(end / 60_000) : end,
      hrExactSignature(hrExact),
    ].join(';');
    const hit = dayMemo.get(date);
    if (hit && hit.key === k) {
      out.push(hit.value);
      continue;
    }
    const value = dayActual({ date, start, end, tz: base.tz, sessions, result, minuteAt, hours, ageY: base.ageY, hrExact });
    dayMemo.set(date, { key: k, value });
    out.push(value);
  }
  return out;
}

/** Test seams of the live read (the engine run and the clock). */
interface LiveDeps {
  runPast: (profile: unknown, schedule: unknown, days: number) => Promise<Hourly | null>;
  now: () => number;
}
const liveDeps: LiveDeps = { runPast: runPastHourly, now: () => Date.now() };

/** Tests only: replace the engine run or the clock of the live read (null restores them). Drops every cached answer. */
export function setLiveProgressDeps(deps: Partial<LiveDeps> | null): void {
  liveDeps.runPast = deps?.runPast ?? runPastHourly;
  liveDeps.now = deps?.now ?? (() => Date.now());
  invalidateProgressActuals({ dropDays: true });
}

type WatchMods = [typeof Runtime, typeof ProfileStore];
let mods: WatchMods | null = null;
let modsLoading = false;
let watched: unknown = null;
let offs: Array<() => void> = [];

/** Re-read when a document the history is made of, or the profile's age, changes (and when the store is replaced). */
function ensureWatch(): void {
  if (!mods) {
    if (!modsLoading) {
      modsLoading = true;
      void Promise.all([import('@/state/runtime'), import('@/state/profileStore')]).then((m) => {
        mods = m;
        ensureWatch();
      });
    }
    return;
  }
  const [{ getDocumentStore }, profile] = mods;
  let store: ReturnType<typeof getDocumentStore>;
  try {
    store = getDocumentStore();
  } catch {
    return; // no document store here: nothing to read or watch
  }
  if (store === watched) return;
  offs.forEach((off) => off());
  offs = [];
  const first = watched === null;
  watched = store;
  const COLS = ['dailyLogs', 'dayStatus', 'plans', 'planVersions', 'activePlan', 'measurements', 'anchors'] as const;
  for (const col of COLS) {
    let started = false;
    offs.push(
      store.watch(col, {}, () => {
        // each watch reports once when it starts; only later reports are changes
        if (!started) {
          started = true;
          return;
        }
        invalidateProgressActuals();
      }),
    );
  }
  let age = profile.useProfileStore.getState().ageYears;
  offs.push(
    profile.useProfileStore.subscribe((st) => {
      if (st.ageYears === age) return;
      age = st.ageYears;
      invalidateProgressActuals();
    }),
  );
  // another store (a reset, another person) holds other documents: nothing loaded before stands
  if (!first) invalidateProgressActuals({ dropDays: true });
}

/**
 * Forget the loaded windows (kept on screen until the new answer arrives) and read again. `dropDays`: nothing loaded
 * before is shown again (another identity, a refusal). `keepBase` (FX1): only the Gauge side moved (new data, a new
 * fusion context), so the history base (projection, engine run) is kept and only the days whose minutes changed recompute.
 */
export function invalidateProgressActuals(o: { dropDays?: boolean; keepBase?: boolean } = {}): void {
  stamp++;
  if (!o.keepBase) {
    baseStamp++;
    baseMemo = null;
  }
  for (const [k, v] of windows) stale.set(k, v.value);
  windows.clear();
  loading.clear();
  if (o.dropDays) {
    dayMemo.clear();
    stale.clear();
  }
  bump();
}

/** (FX1) A refusal that must never show the last answer: the pairing ended, or this device may not read Gauge data. */
const refused = (p: GaugeProblem | null | undefined): boolean => p === 'unauthorized' || p === 'not_paired';
let gaugeWatched = false;

/** (FX1, aR11) Gauge identity, data, fusion-context and refusal notifications (once per session). */
function watchGauge(): void {
  if (gaugeWatched) return;
  gaugeWatched = true;
  try {
    onGaugeIdentityChange(() => invalidateProgressActuals({ dropDays: true, keepBase: true }));
    onGaugeDataChanged(() => invalidateProgressActuals({ keepBase: true }));
    onFusionContextChange(() => invalidateProgressActuals({ keepBase: true }));
    let was = false;
    gaugeApi.subscribe(() => {
      let now: boolean;
      try {
        now = refused(gaugeApi.status().problem);
      } catch {
        now = false;
      }
      if (now && !was) invalidateProgressActuals({ dropDays: true, keepBase: true });
      was = now;
    });
  } catch {
    // no Gauge client here (tests without a server): the documents still drive the reads
  }
}

const liveAdapter: ProgressActualsAdapter = {
  progressActuals(from, to) {
    ensureWatch();
    watchGauge();
    // (FX1, aR11) one window per identity: another server's or person's days are never answered
    const identity = gaugeIdentity();
    const k = `${identity ?? '-'}|${from}:${to}`;
    const hit = windows.get(k);
    const now = liveDeps.now();
    if (hit) {
      // (r063 S27/A29) fresh: answer it; expired (or a failure past its retry wait): keep it on screen and read again
      if (now - hit.at < (hit.value === null ? PROGRESS_WINDOW_RETRY_MS : PROGRESS_WINDOW_TTL_MS)) return hit.value;
      windows.delete(k);
      if (hit.value !== null) stale.set(k, hit.value);
    }
    if (loading.get(k) !== stamp) {
      const at = stamp;
      loading.set(k, at);
      void loadWindow(from, to, now)
        .catch(() => null)
        .then((v) => {
          // an invalidation (or another identity) since it started: this answer is obsolete
          if (at !== stamp || gaugeIdentity() !== identity) return;
          loading.delete(k);
          // a failed refresh keeps the answer on screen (and is retried after the short wait)
          const prev = stale.get(k);
          const t = liveDeps.now();
          windows.set(k, v === null && prev ? { at: t - PROGRESS_WINDOW_TTL_MS + PROGRESS_WINDOW_RETRY_MS, value: prev } : { at: t, value: v });
          stale.delete(k);
          scheduleExpiry();
          bump();
        });
    }
    return stale.get(k) ?? null;
  },
};

/** (r063 S27/A29) Re-ask the screens once the earliest loaded window expires (one timer; a bump makes them read again). */
function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  let next = Number.POSITIVE_INFINITY;
  for (const w of windows.values()) next = Math.min(next, w.at + (w.value === null ? PROGRESS_WINDOW_RETRY_MS : PROGRESS_WINDOW_TTL_MS));
  if (!Number.isFinite(next)) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    bump();
  }, Math.max(1_000, next - liveDeps.now() + 5));
}

/** Resolves when every window asked for so far has loaded (tests). */
export async function settleProgressActuals(): Promise<void> {
  for (let i = 0; i < 50 && loading.size > 0; i++) await new Promise((r) => setTimeout(r, 10));
}

/* ---- the seam ------------------------------------------------------------------------------------------------------ */

let current: ProgressActualsAdapter = liveAdapter;
const listeners = new Set<() => void>();
let rev = 0;

function bump(): void {
  rev++;
  for (const l of listeners) l();
}

/** The adapter in use. */
export function progressActualsAdapter(): ProgressActualsAdapter {
  return current;
}

/** Tests and the screenshot harness only: install an adapter (null restores the live read). */
export function setProgressActuals(adapter: ProgressActualsAdapter | null): void {
  current = adapter ?? liveAdapter;
  bump();
}

export function subscribeProgressActuals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const progressActualsRevision = (): number => rev;
