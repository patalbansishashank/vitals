/**
 * (0.6.3 S22/A17) The history of Vitals' own indices, kept apart from Gauge's legacy scores: each day of the last two
 * weeks worked out again by the same V2 functions as today (`sleep-index/5`, `recovery-index/6`, `activity-index/4`,
 * `day-index/1`), from that day's night metrics, that day's baselines (each excluding its own night) and that day's steps,
 * against today's goals. A point carries the version it was worked out with; a day without the inputs is a gap, never a
 * zero.
 *
 * (r063 FX2, final review sR17/aR15) Each date's contributors are derived the same way as the headline's: the week's Heart
 * Points pace through that date (Progress's shared day calculation), the prior-day training-load balance of that date
 * (`useRingLoadBalances`), and the planned sessions done (the day shown only: a past day's plan state is not kept, so a
 * past day's sessions part is unavailable, as the note says). So the point of the day shown equals its headline. Without
 * contributors (`reduced`) the history is the reduced calculation and says so.
 *
 * (r087 C3) Each day's baselines are one kept answer per date (`baselineDays`), read two at a time with the newest day
 * first, and an older day's are kept for hours: a month of history is no longer a month of requests at once, again with
 * every import. The day view's trend line shows the days whose baselines it has and fills in the others as they arrive;
 * a period, whose average is over every day of it, is answered once all of them are in.
 */
import { useMemo } from 'react';
import { useActivityData } from '@/features/living/activity/data';
import { createDayStore, type DayStore } from '@/features/living/progress/data/dayStore';
import { useLiving } from '@/features/living/data/source';
import { weekOf } from '@/features/living/format';
import { useActivePlan } from '@/features/living/mode';
import type { LocalDate } from '@/living';
import type { GaugeBaselines } from '@/net/gauge';
import { useActivity, useSleep } from './data';
import { plannedSessionsOf, pointsPaceOf } from './day';
import { ringScores } from './indices';
import { useRingLoadBalances } from './load';
import { calendarDate, daysFrom, mainSession, shiftDate } from './model';
import { useDayAnswers } from './useDayAnswers';
import { useNow } from './useGauge';

export const VITALS_HISTORY_DAYS = 14;

/** (r069 U2) The most days of Vitals indices a period shows (each day asks for its own baselines). */
export const VITALS_PERIOD_MAX_DAYS = 31;

export interface VitalsIndexHistory {
  from: string;
  dates: string[];
  recovery: number[];
  sleep: number[];
  activity: number[];
  day: number[];
  /** The algorithm versions behind the points (one per index; several when a version changed inside the window). */
  versions: { recovery: string[]; sleep: string[]; activity: string[]; day: string[] };
  /** (r063 FX2) True when no date's contributors were given: the points leave out pace, sessions and load. */
  reduced: boolean;
  /**
   * (r087 C3) Days still waiting for their baselines (gaps for now); absent once every day is in. An average over the
   * window is not the window's while this is set.
   */
  pending?: number;
}

/** (r063 FX2) A date's contributors besides its night, baselines and steps (null: unavailable, as in the headline). */
export interface HistoryContributors {
  weekPointsPace?: number | null;
  plannedSessions?: { planned: number; done: number } | null;
  loadBalance?: number | null;
}

/**
 * What a baselines answer says (its inputs hash when the server sends one), without when the phone last uploaded: that
 * moves with every read and would make each re-read look like a change.
 */
export function baselinesSignature(b: GaugeBaselines): string {
  if (b.inputsHash) return b.inputsHash;
  const { freshness: _freshness, installations: _installations, ...said } = b;
  return JSON.stringify(said);
}

/** Each day's own baselines (S2 `/baselines?date` excludes that night), one kept answer per date. */
export const baselineDays: DayStore<GaugeBaselines> = createDayStore<GaugeBaselines>({
  read: (api, date) => (api.baselines ? api.baselines(date) : Promise.resolve(null)),
  signature: baselinesSignature,
});

export function vitalsIndexHistory(i: {
  dates: readonly string[];
  sleep: Parameters<typeof mainSession>[0];
  /** A day's baselines; null when the server could not answer; undefined while they load (the day is then a gap). */
  baselines: ReadonlyArray<GaugeBaselines | null | undefined>;
  steps: ReadonlyMap<string, number>;
  stepGoal: number;
  sleepGoalMin: number;
  contributors?: (date: string) => HistoryContributors;
}): VitalsIndexHistory {
  const out: VitalsIndexHistory = { from: i.dates[0] ?? '', dates: [...i.dates], recovery: [], sleep: [], activity: [], day: [], versions: { recovery: [], sleep: [], activity: [], day: [] }, reduced: !i.contributors };
  const add = (k: keyof VitalsIndexHistory['versions'], v: string | null | undefined) => {
    if (v && !out.versions[k].includes(v)) out.versions[k].push(v);
  };
  const waiting = i.dates.filter((_, k) => i.baselines[k] === undefined).length;
  if (waiting > 0) out.pending = waiting;
  i.dates.forEach((d, k) => {
    const night = mainSession(i.sleep, d);
    const c = i.contributors?.(d) ?? {};
    const s = night?.metrics && i.baselines[k] !== undefined
      ? ringScores({ night, baselines: i.baselines[k] ?? null, steps: i.steps.get(d) ?? null, stepGoal: i.stepGoal, sleepGoalMin: i.sleepGoalMin, weekPointsPace: c.weekPointsPace ?? null, plannedSessions: c.plannedSessions ?? null, loadBalance: c.loadBalance ?? null })
      : null;
    const v = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x : Number.NaN);
    // only Vitals' own figures: a day Gauge's legacy values would stand in for is a gap here
    const vitals = s && s.source === 'vitals' ? s : null;
    out.recovery.push(v(vitals?.recovery.value));
    out.sleep.push(v(vitals?.sleep.value));
    out.activity.push(v(vitals?.activity.value));
    out.day.push(v(vitals?.day.value));
    if (vitals) {
      if (vitals.recovery.value !== null) add('recovery', vitals.recovery.version);
      if (vitals.sleep.value !== null) add('sleep', vitals.sleep.version);
      if (vitals.activity.value !== null) add('activity', vitals.activity.version);
      if (vitals.day.value !== null) add('day', vitals.day.version);
    }
  });
  return out;
}

/** A stand-in's missing day-by-day points: unavailable. */
const noPointDays = (): null => null;

/**
 * The last `days` days (default `VITALS_HISTORY_DAYS`) of Vitals indices ending on `date`; null while the nights and steps
 * load. Each day asks for its own baselines, so a page keeps `days` to a month (`VITALS_PERIOD_MAX_DAYS`).
 *
 * `fill`: answer before every day's baselines are in, the days still waiting as gaps and counted in `pending`. That is
 * right for a trend line, which is what the default window is drawn as, so it is on there. A caller that names its own
 * `days` shows figures over the whole window (the Scores period's average and its band): the average of the days that
 * happen to be in first is not the window's, so it gets null until all of them are, unless it reads `pending` itself.
 */
export function useVitalsIndexHistory(date: string, goals: { stepGoal: number; sleepGoalMin: number }, days?: number, o: { fill?: boolean } = {}): VitalsIndexHistory | null {
  const fill = o.fill ?? days === undefined;
  const from = shiftDate(date, -(Math.max(1, days ?? VITALS_HISTORY_DAYS) - 1));
  const dates = useMemo(() => daysFrom(from, date), [from, date]);
  const sleep = useSleep(from, date);
  const act = useActivity(from, date);
  // every day of the window is asked, also when the window ends after this device's calendar date
  const today = calendarDate(useNow());
  const base = useDayAnswers(baselineDays, dates, date > today ? date : today);
  // (r063 FX2 sR17/aR15) each date's contributors, the headline's way
  const data = useActivityData();
  const weekStart = weekOf(from as LocalDate)[0]!;
  const useDays = data.useHeartPointsDays ?? noPointDays;
  const pointDays = useDays(weekStart, date);
  const headlineWeek = data.useHeartPoints(weekOf(date as LocalDate)[0]!, date)?.week ?? null;
  const balances = useRingLoadBalances(from, date);
  const plan = useActivePlan();
  const sessionsKey = useLiving((s) => {
    if (!plan) return '';
    const v = s.today(date as LocalDate);
    const p = plannedSessionsOf(v?.prescription, v?.logged.items);
    return p ? `${p.planned}:${p.done}` : '';
  }, [date, plan?.id ?? null]);
  const contributors = useMemo(() => {
    const byDate = new Map((pointDays ?? []).map((d) => [d.date, d.heartPoints] as const));
    const planned = sessionsKey ? { planned: Number(sessionsKey.split(':')[0]), done: Number(sessionsKey.split(':')[1]) } : null;
    return (d: string): HistoryContributors => {
      let week: number | null = null;
      if (d === date) week = headlineWeek;
      else {
        for (const w of weekOf(d as LocalDate)) {
          const v = w <= d ? byDate.get(w) : undefined;
          if (typeof v === 'number' && Number.isFinite(v)) week = (week ?? 0) + v;
        }
      }
      return { weekPointsPace: pointsPaceOf(week, d), plannedSessions: d === date ? planned : null, loadBalance: balances?.get(d) ?? null };
    };
  }, [pointDays, headlineWeek, balances, sessionsKey, date]);
  return useMemo(() => {
    if (sleep.status !== 'ready' || act.status === 'loading' || balances === null) return null;
    const steps = new Map<string, number>();
    for (const d of act.data?.days ?? []) {
      const v = d.fusedHeadline ?? d.steps;
      if (typeof v === 'number' && Number.isFinite(v)) steps.set(d.date, v);
    }
    const history = vitalsIndexHistory({ dates, sleep: sleep.data.sessions, baselines: dates.map((d) => base.get(d)), steps, stepGoal: goals.stepGoal, sleepGoalMin: goals.sleepGoalMin, contributors });
    return history.pending && !fill ? null : history;
  }, [sleep, act, base, dates, goals.stepGoal, goals.sleepGoalMin, contributors, balances, fill]);
}
