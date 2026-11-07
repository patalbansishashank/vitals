/**
 * Where Today's activity screens get their data and send their taps (energy SPEC §V4.1–§V4.3, A.3.5): V3's review model
 * (`useActivityReview`) and today's energy and steps (`useTodayEnergySteps`: actual so far + the plan for the rest of the
 * day, one engine run), S2's minute timeline (through the Ring's Gauge client), the `activity.*` commands and package C's
 * command channel for recording. The screens never read a store or a transport themselves.
 *
 * Tests and the screenshot harness install their own `ActivityData` with `ActivityDataProvider`.
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { dispatch, type CommandResult } from '@/commands';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import {
  useActivityReview,
  useTodayEnergySteps,
  type DayEnergyRun,
  type PeriodEnergyDay,
  type TodayEnergyDeps,
  type EnergyBasis,
} from '@/state/livingActivity';
import { useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import type { GaugeCommandsController } from '@/state/gaugeCommands';
import { previewEstimate, type ActivityEditChanges, type DecisionEstimate } from '@/commands/living/activity';
import { timeZone } from '@/commands/bus';
import {
  isTombstone,
  type ActivityCandidateDoc,
  type CandidateDecision,
  type CandidateRecord,
  type ReviewSheetModel,
} from '@/living/activityCandidates';
import type { LogEntry } from '@/living/types';
import { movingSpans } from '@/living/boutParts';
import {
  energyDay,
  hoursFromRun,
  type EnergyBout,
  type EnergyDay,
  type EnergyHour,
  type EnergyMinute,
} from '@/living/sensors/energyDay';
import { freezeZoneBoundaries, hrProfile, type ZoneBoundaries } from '@/living/sensors';
import {
  progressActualsAdapter,
  progressActualsRevision,
  subscribeProgressActuals,
} from '../progress/v3Adapter';
import type { TodayEnergyStepsModel } from '@/living/todayModel';
import type { GaugeStepDay, GaugeTimeline } from '@/net/gauge';
import { useSteps as useRingSteps, useTimeline as useRingTimeline } from '@/features/ring/data';
import { useRingActivities } from '@/features/ring/useActivities';
import type { RingActivity } from '@/features/ring/activities';
import { shiftDate } from '@/features/ring/model';
import { ringCommands } from '@/features/ring/commands';
import { publishEnergyFigures } from '@/features/ring/planEnergy';
import type { ActionOutcome } from '../data/actions';
import { liveDetections, subscribeLiveDetections, type LiveDetection } from '@/state/liveDetections';

export interface TodayActivityView {
  model: TodayEnergyStepsModel;
  /** The day's energy display over the realised run (15-min states, TEF); null in quiet mode or without a run. */
  day: EnergyDay | null;
  /** (UI audit #21) The head plan's day over the same display (its scenario envelope is the Plan figure's range). */
  plan?: EnergyDay | null;
  energyBasis?: EnergyBasis;
}

/** What Save would book (the same functions as `activity.edit` / `activity.approve`), or the person fact it needs. */
export type PreviewOutcome = DecisionEstimate;

/** Heart Points of the week and of the day (V2 `fit-points/1` over covered minutes and approved bouts); null = unknown. */
export interface HeartPointsView {
  today: number | null;
  week: number | null;
}

/** An `activity.edit` from the sheet: what changed, and what was removed (`clear`, UI audit #16). */
export type ActivityEditInput = { id: string; revision: string } & ActivityEditChanges;

export interface ActivityData {
  useReview(from: string, to: string): ReviewSheetModel;
  /** The full record behind a review row (the estimator panel, the minute evidence). */
  useCandidate(id: string | null): ActivityCandidateDoc | null;
  /** Today's energy and steps on the real today (null elsewhere or while loading). */
  useToday(date: string, isToday: boolean): TodayActivityView | null;
  /** The day's minute timeline (steps by source, the scrubber's minute chart). */
  useTimeline(date: string): GaugeTimeline | null;
  /** The day of `steps-fuse/1` (the counted total, the headline policy, the ring's unlocated residual). */
  useStepsDay(date: string): GaugeStepDay | null;
  /** `separate`: the person said it was a separate activity from the one(s) it looks like (0.6.3 S3/A4). */
  approve(
    id: string,
    revision: string,
    asItemId?: string,
    opts?: { separate?: boolean },
  ): Promise<ActionOutcome>;
  approveAll(items: ReadonlyArray<{ id: string; revision: string }>): Promise<ActionOutcome>;
  edit(input: ActivityEditInput): Promise<ActionOutcome>;
  reject(id: string): Promise<ActionOutcome>;
  /**
   * The live estimate of the sheet (UI audit #1, #3): `draft` is the edited decision (`editedDecision`), null when nothing
   * changed. Exactly what Save books (`previewEstimate`: the same inputs as the commands); `missing: 'weight'` without one.
   */
  usePreview(id: string, draft: CandidateDecision | null): PreviewOutcome;
  /**
   * (UI audit #2) The zone boundaries of an activity: an approved one's are those frozen into its session entry at
   * approval; a pending one's come from the person's current heart settings (D6). Null without an age.
   */
  useZoneBoundaries(id: string | null): ZoneBoundaries | null;
  /** (UI audit #5) Heart Points of [from, to] by Progress's shared day calculation; null while it loads. */
  useHeartPoints(from: string, to: string): HeartPointsView | null;
  /**
   * (r063 FX2) The same calculation day by day (the Ring's score history derives each date's weekly pace from it); null
   * while it loads. Optional: a stand-in without it leaves past days' pace unavailable.
   */
  useHeartPointsDays?(
    from: string,
    to: string,
  ): ReadonlyArray<{ date: string; heartPoints: number | null }> | null;
  /**
   * (0.6.7 AD-VITALS) The home server's detection episodes still going on (Today's live line; never an activity to review
   * until they end). Optional: a stand-in without it shows no live line.
   */
  useLiveDetections?(): readonly LiveDetection[];
  /**
   * (r069 D4) A past day's energy for the day Energy page: the engine's day over that date (the plan's realised run, else
   * Your body's habitual day with the day's own entries), placed in its minutes and bouts like Today's. Optional: a
   * stand-in without it shows past days as unavailable.
   */
  useDayEnergy?(date: string): DayEnergyView;
  /**
   * (r069 D4) The activities of the date and the day before (the Ring's canonical list: in-force sessions, hand logs
   * included, and the ones still to review). Optional: a stand-in without it shows none.
   */
  useDayActivities?(date: string): { approved: readonly RingActivity[]; pending: readonly RingActivity[] };
  /**
   * (r069 D4) The past days of a period (a week, month, year or range): each day's energy and its kinds from the same run
   * its day view reads. Today is not in it (the page takes Today's own figure). Optional: a stand-in without it shows none.
   */
  useEnergyDays?(dates: readonly string[]): EnergyDaysView;
  /** Package C's controller (recording). */
  commands(): GaugeCommandsController;
}

/** (r069 D4) A period's past days: loading, each day's figure (null: no run that day), and why there are none. */
export interface EnergyDaysView {
  status: 'loading' | 'ready';
  days: readonly PeriodEnergyDay[];
  missing: 'profile' | null;
}

/** (r069 D4) A past day's energy: loading, the day (null without a run), and why there is none. */
export interface DayEnergyView {
  status: 'loading' | 'ready';
  day: EnergyDay | null;
  basis: 'plan' | 'body' | null;
  energyBasis?: EnergyBasis;
  missing: 'profile' | null;
}

// ------------------------------------------------------------------------------------------- the app's data
function outcome(r: CommandResult): ActionOutcome {
  if (!r.ok) return { ok: false, message: r.error.message };
  const cs = 'output' in r ? r.changeSet?.id : undefined;
  return cs
    ? { ok: true, undo: async () => outcome(await dispatch('history.undo', { changeSetId: cs })) }
    : { ok: true };
}

let stamp = 0;
let cache: { stamp: number; byKey: Map<string, CandidateRecord> } | null = null;
function candidates(): Map<string, CandidateRecord> {
  if (cache && cache.stamp === stamp) return cache.byKey;
  try {
    const recs = getDocumentStore()
      .peekAll<CandidateRecord>('activityCandidates')
      .map((d) => bodyOf<CandidateRecord>(d));
    cache = { stamp, byKey: new Map(recs.map((r) => [r.key, r] as const)) };
  } catch {
    cache = { stamp, byKey: new Map() };
  }
  return cache.byKey;
}
function subscribeCandidates(l: () => void): () => void {
  try {
    return getDocumentStore().watch('activityCandidates', {}, () => {
      stamp++;
      l();
    });
  } catch {
    return () => undefined;
  }
}

const HOURLY = ['rmr', 'tef', 'neat', 'stepsEnergy', 'exerciseEnergy', 'tdee'] as const;

/** The minutes of the timeline under the run's hours (aligned by instant; missing minutes are unknown, never zero). */
export function minutesFor(hours: readonly EnergyHour[], t: GaugeTimeline | null): EnergyMinute[] {
  const out: EnergyMinute[] = [];
  const first = t ? (t.start ? Date.parse(t.start) : Date.parse(`${t.date}T00:00:00`)) : 0;
  for (const h of hours) {
    for (let k = 0; k < 60; k++) {
      const i = t ? Math.floor((h.start + k * 60_000 - first) / 60_000) : -1;
      if (!t || i < 0 || i >= t.minutes) {
        out.push({ sleep: 'none', steps: null, support: null });
        continue;
      }
      const st = t.sleep.stage[i];
      const sleep =
        st === null || st === undefined
          ? 'none'
          : st === 'awake'
            ? 'awake'
            : st === 'unknown'
              ? 'unknownLabel'
              : 'asleep';
      const steps = t.steps.selected[i] ?? null;
      const sup = t.steps.support?.[i] ?? null;
      out.push({ sleep, steps, support: steps === null ? null : sup === 'minute' ? 'minute' : 'coarse' });
    }
  }
  return out;
}

/**
 * Approved activities of the day as energy bouts (their booked incremental kcal per moving minute caps their share). (r063
 * S10/A15) A paused bout counts only its moving intervals. The live screen reads the run's own bouts (`model.bouts`); this
 * stays for the screenshot harness and a model without them.
 */
export function boutsOf(recs: Iterable<CandidateRecord>, date: string): EnergyBout[] {
  const out: EnergyBout[] = [];
  for (const c of recs) {
    if (isTombstone(c) || c.date !== date || (c.status !== 'approved' && c.status !== 'edited')) continue;
    const w = c.decision
      ? { start: Date.parse(c.decision.startAt), end: Date.parse(c.decision.endAt) }
      : c.window;
    const e = c.decidedEstimate ?? c.estimate;
    const parts = movingSpans(w, c.pauses);
    const min = parts.reduce((a, p) => a + (p.end - p.start), 0) / 60_000;
    const inc = e?.cost.incrementalKcal ?? null;
    out.push({
      id: c.key,
      window: w,
      ...(parts.length > 1 ? { parts } : {}),
      incrementalKcalPerMin: inc !== null && min > 0 ? inc / min : null,
      envelope: e?.booked.envelope ?? null,
    });
  }
  return out;
}

function useAppToday(date: string, isToday: boolean): TodayActivityView | null {
  const [basis, setBasis] = useState<EnergyBasis | undefined>(undefined);
  const [captured, setCaptured] = useState<EnergyHour[] | null>(null);
  const [planHours, setPlanHours] = useState<EnergyHour[] | null>(null);
  // the same engine run V3's hook makes (actual through now + the plan's remainder), its hours kept for the display
  const deps = useMemo<TodayEnergyDeps>(
    () => ({
      runHours: async (kind, profile, schedule, todayIdx, dayStartMs) => {
        const { getSimulationClient } = await import('@/workers/simulationClient');
        const s = schedule as { horizonDays: number };
        const r = await getSimulationClient().runNominal(
          profile as never,
          {
            ...(schedule as object),
            horizonDays: Math.max(1, Math.min(s.horizonDays, todayIdx + 1)),
          } as never,
          { record: 'full', series: [...HOURLY], collectEvents: false },
        );
        const hourly = r.hourly as Partial<Record<(typeof HOURLY)[number], ArrayLike<number>>> | undefined;
        if (!hourly || !hourly.tdee || hourly.tdee.length < (todayIdx + 1) * 24) return null;
        const hours = hoursFromRun(
          hourly as Record<(typeof HOURLY)[number], ArrayLike<number>>,
          todayIdx * 24,
          24,
          dayStartMs,
        );
        if (kind === 'realised') {
          const { energyBasisOf } = await import('@/state/livingActivity');
          setBasis(energyBasisOf(profile as Parameters<typeof energyBasisOf>[0]));
          setCaptured(hours);
        } else setPlanHours(hours);
        return hours;
      },
    }),
    [],
  );
  const model = useTodayEnergySteps(deps);
  const timeline = useAppTimeline(date);
  const recs = useSyncExternalStore(subscribeCandidates, candidates, candidates);
  const view = useMemo(() => {
    if (!isToday || !model || model.date !== date) return null;
    const hours = captured;
    // (r063 A16) every session the run books (today's approved and logged entries, the plan's remainder), not only the
    // approved candidates: an ordinary Train log or a planned session's energy is exercise, never recovery
    const day =
      model.energy && hours
        ? energyDay({
            hours,
            minutes: minutesFor(hours, timeline),
            bouts: model.bouts ?? boutsOf(recs.values(), date),
          })
        : null;
    const plan =
      model.energy && planHours
        ? energyDay({ hours: planHours, minutes: [], bouts: model.planBouts ?? [] })
        : null;
    return { model, day, plan, energyBasis: basis };
  }, [isToday, model, date, timeline, recs, captured, planHours, basis]);
  // (0.6.3 S23/A18) the plan's active energy and the day's energy reach the Ring's goals and monitor (one engine run: this)
  const planActive = view?.model.energy?.planActive ?? null;
  const total = view?.day?.total ?? null;
  const active = view?.day?.active ?? null;
  useEffect(() => {
    if (view)
      publishEnergyFigures(
        date,
        view.model.energy ? { planActiveKcal: planActive, totalKcal: total, activeKcal: active } : null,
      );
  }, [view, date, planActive, total, active]);
  return view;
}

function useAppTimeline(date: string): GaugeTimeline | null {
  const q = useRingTimeline(date);
  return q.status === 'ready' ? q.data : null;
}

function useAppStepsDay(date: string): GaugeStepDay | null {
  const q = useRingSteps(date, date);
  return q.status === 'ready' ? (q.data.days.find((d) => d.date === date) ?? null) : null;
}

function useAppCandidate(id: string | null): ActivityCandidateDoc | null {
  const recs = useSyncExternalStore(subscribeCandidates, candidates, candidates);
  const c = id ? recs.get(id) : undefined;
  return c && !isTombstone(c) ? c : null;
}

// ------------------------------------------------------------------------------------------- other documents
/** A document collection as a change stamp (the hooks re-read on change; reads go to the store). */
function collectionStamp(col: 'measurements' | 'dailyLogs') {
  let n = 0;
  const subscribe = (l: () => void) => {
    try {
      return getDocumentStore().watch(col, {}, () => {
        n++;
        l();
      });
    } catch {
      return () => undefined;
    }
  };
  return { subscribe, get: () => n };
}
const measurementsStamp = collectionStamp('measurements');
const logsStamp = collectionStamp('dailyLogs');

function measurementsNow(): {
  measurements: Array<{ id: string; date: string; metric: string; value: number; assumed?: boolean }>;
} {
  try {
    // (0.6.3 FX1, aR14) with their ids: a retracted or corrected weigh-in is resolved out of the history (`personOn`)
    return {
      measurements: getDocumentStore()
        .peekAll<{ date: string; metric: string; value: number; assumed?: boolean }>('measurements')
        .map((d) => ({
          ...bodyOf<{ date: string; metric: string; value: number; assumed?: boolean }>(d),
          id: d._id,
        })),
    };
  } catch {
    return { measurements: [] };
  }
}

function useAppPreview(id: string, draft: CandidateDecision | null): PreviewOutcome {
  const c = useAppCandidate(id);
  const m = useSyncExternalStore(measurementsStamp.subscribe, measurementsStamp.get, measurementsStamp.get);
  const keytel = useSettingsStore((s) => s.keytelEnabled);
  const key = draft ? JSON.stringify(draft) : '';
  return useMemo(() => {
    if (!c) return { estimate: null, missing: null };
    let tz: string;
    try {
      tz = timeZone();
    } catch {
      tz = c.tz;
    }
    return previewEstimate(c, draft, measurementsNow(), tz);
    // `key` stands for the draft; `m` and `keytel` re-read the weigh-ins and the D2 setting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, key, m, keytel]);
}

/** (D6) The boundaries in force now: the synced heart settings, the profile age, the candidate's sleeping low HR. */
export function zonesFromSettings(
  ageY: number | null,
  hp:
    | { hrMaxOverride?: number | null; hrRestOverride?: number | null; useSleepLowAsRest?: boolean }
    | null
    | undefined,
  sleepingLowHr: number | null | undefined,
): ZoneBoundaries | null {
  return freezeZoneBoundaries(
    hrProfile({
      ageY,
      hrMaxOverride: hp?.hrMaxOverride ?? null,
      hrRestOverride: hp?.hrRestOverride ?? null,
      sleepingLowHr: sleepingLowHr ?? null,
      proxySleepLowOptIn: hp?.useSleepLowAsRest === true,
    }),
  );
}

/** The boundaries frozen into an approved activity's session entry (null: not approved, or an entry without them). */
export function frozenZonesOf(
  c: ActivityCandidateDoc | null,
  entry: { kind: LogEntry['kind']; zones?: ZoneBoundaries } | null | undefined,
): ZoneBoundaries | null {
  if (!c || (c.status !== 'approved' && c.status !== 'edited') || !entry || entry.kind !== 'session')
    return null;
  return entry.zones ?? null;
}

function useAppZones(id: string | null): ZoneBoundaries | null {
  const c = useAppCandidate(id);
  const age = useProfileStore((s) => s.ageYears);
  const hp = useSettingsStore((s) => s.hrProfile);
  const logs = useSyncExternalStore(logsStamp.subscribe, logsStamp.get, logsStamp.get);
  return useMemo(() => {
    let entry: (LogEntry & { zones?: ZoneBoundaries }) | null = null;
    if (c?.entryId) {
      try {
        const d = getDocumentStore().peek<LogEntry>('dailyLogs', c.entryId);
        entry = d ? (bodyOf<LogEntry>(d) as LogEntry & { zones?: ZoneBoundaries }) : null;
      } catch {
        entry = null;
      }
    }
    return (
      frozenZonesOf(c, entry) ?? zonesFromSettings(Number.isFinite(age) ? age : null, hp, c?.sleepingLowHr)
    );
    // `logs` re-reads the entry when the log changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, age, hp, logs]);
}

/** Sum of the known days (null when no day of the range is known). */
export function heartPointsView(
  days: ReadonlyArray<{ date: string; heartPoints: number | null }> | null,
  today: string,
): HeartPointsView | null {
  if (!days) return null;
  const known = days.filter((d) => d.heartPoints !== null && Number.isFinite(d.heartPoints));
  const t = days.find((d) => d.date === today);
  return {
    today: t && t.heartPoints !== null ? t.heartPoints : null,
    week: known.length > 0 ? known.reduce((s, d) => s + d.heartPoints!, 0) : null,
  };
}

function useAppHeartPoints(from: string, to: string): HeartPointsView | null {
  // the adapter answers what is loaded and bumps its revision when more arrives (an approval changes the logs it watches)
  const rev = useSyncExternalStore(
    subscribeProgressActuals,
    progressActualsRevision,
    progressActualsRevision,
  );
  const [askedAt] = useState(rev);
  return useMemo(() => {
    const days = progressActualsAdapter().progressActuals(from, to);
    // still null once the adapter answered (its revision moved on): no history to read, unknown rather than loading
    return heartPointsView(days, to) ?? (rev !== askedAt ? { today: null, week: null } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, rev]);
}

function useAppHeartPointsDays(
  from: string,
  to: string,
): ReadonlyArray<{ date: string; heartPoints: number | null }> | null {
  const rev = useSyncExternalStore(
    subscribeProgressActuals,
    progressActualsRevision,
    progressActualsRevision,
  );
  return useMemo(
    () =>
      progressActualsAdapter()
        .progressActuals(from, to)
        ?.map((d) => ({ date: d.date, heartPoints: d.heartPoints })) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, to, rev],
  );
}

// ------------------------------------------------------------------------------------------- a past day's energy (r069 D4)
const DAY_LOADING: DayEnergyView = { status: 'loading', day: null, basis: null, missing: null };

function useAppDayEnergy(date: string): DayEnergyView {
  const recs = useSyncExternalStore(subscribeCandidates, candidates, candidates);
  const logs = useSyncExternalStore(logsStamp.subscribe, logsStamp.get, logsStamp.get);
  const quiet = useSettingsStore((x) => x.quietMode);
  const timeline = useAppTimeline(date);
  const [run, setRun] = useState<{ key: string; value: DayEnergyRun | null } | null>(null);
  const key = `${date}:${logs}:${quiet}:${recs.size}`;
  useEffect(() => {
    let alive = true;
    void import('@/state/livingActivity')
      .then(({ loadDayEnergy }) => loadDayEnergy(date))
      .then(
        (value) => {
          if (alive) setRun({ key, value });
        },
        () => {
          if (alive) setRun({ key, value: null });
        },
      );
    return () => {
      alive = false;
    };
    // `key` stands for the date and every input the run reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => {
    if (!run || run.key !== key) return DAY_LOADING;
    const r = run.value;
    if (!r) return { status: 'ready', day: null, basis: null, missing: null };
    const day = r.hours
      ? energyDay({ hours: r.hours, minutes: minutesFor(r.hours, timeline), bouts: r.bouts })
      : null;
    return { status: 'ready', day, basis: r.basis, missing: r.missing, energyBasis: r.energyBasis };
  }, [run, key, timeline]);
}

const DAYS_LOADING: EnergyDaysView = { status: 'loading', days: [], missing: null };

function useAppEnergyDays(dates: readonly string[]): EnergyDaysView {
  const recs = useSyncExternalStore(subscribeCandidates, candidates, candidates);
  const logs = useSyncExternalStore(logsStamp.subscribe, logsStamp.get, logsStamp.get);
  const quiet = useSettingsStore((x) => x.quietMode);
  const [view, setView] = useState<{ key: string; value: EnergyDaysView } | null>(null);
  const key = `${dates[0] ?? ''}:${dates[dates.length - 1] ?? ''}:${dates.length}:${logs}:${quiet}:${recs.size}`;
  useEffect(() => {
    let alive = true;
    void import('@/state/livingActivity')
      .then(({ loadPeriodEnergy }) => loadPeriodEnergy(dates))
      .then(
        (r) => {
          if (alive) setView({ key, value: { status: 'ready', days: r.days, missing: r.missing } });
        },
        () => {
          if (alive) setView({ key, value: { status: 'ready', days: [], missing: null } });
        },
      );
    return () => {
      alive = false;
    };
    // `key` stands for the dates and every input the runs read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return view && view.key === key ? view.value : DAYS_LOADING;
}

export const appActivityData: ActivityData = {
  useReview: (from, to) => useActivityReview(from, to),
  useCandidate: useAppCandidate,
  useToday: useAppToday,
  useTimeline: useAppTimeline,
  useStepsDay: useAppStepsDay,
  approve: async (id, revision, asItemId, opts) =>
    outcome(
      await dispatch('activity.approve', {
        id,
        revision,
        ...(asItemId ? { asItemId } : {}),
        ...(opts?.separate ? { separate: true } : {}),
      }),
    ),
  approveAll: async (items) =>
    outcome(
      await dispatch('activity.approveAll', {
        items: items.map((i) => ({ id: i.id, revision: i.revision })),
      }),
    ),
  edit: async (input) =>
    outcome(
      await dispatch('activity.edit', { ...input, ...(input.clear ? { clear: [...input.clear] } : {}) }),
    ),
  reject: async (id) => outcome(await dispatch('activity.reject', { id })),
  usePreview: useAppPreview,
  useZoneBoundaries: useAppZones,
  useHeartPoints: useAppHeartPoints,
  useHeartPointsDays: useAppHeartPointsDays,
  useLiveDetections: () => useSyncExternalStore(subscribeLiveDetections, liveDetections, liveDetections),
  useDayEnergy: useAppDayEnergy,
  useDayActivities: (date) => useRingActivities(shiftDate(date, -1), date),
  useEnergyDays: useAppEnergyDays,
  commands: () => ringCommands(),
};

const Ctx = createContext<ActivityData>(appActivityData);
/** Tests and the screenshot harness stand in for the app's data here. */
export const ActivityDataProvider = Ctx.Provider;
export const useActivityData = (): ActivityData => useContext(Ctx);

/** The clock, re-read every `ms` (the recording banner ticks each second). */
export function useTicker(ms: number, on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}
