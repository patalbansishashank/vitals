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
 */
import { useMemo } from 'react';
import { useActivityData } from '@/features/living/activity/data';
import { useLiving } from '@/features/living/data/source';
import { weekOf } from '@/features/living/format';
import { useActivePlan } from '@/features/living/mode';
import type { LocalDate } from '@/living';
import type { GaugeBaselines } from '@/net/gauge';
import { useActivity, useSleep } from './data';
import { plannedSessionsOf, pointsPaceOf } from './day';
import { ringScores } from './indices';
import { useRingLoadBalances } from './load';
import { daysFrom, mainSession, shiftDate } from './model';
import { useGauge } from './useGauge';

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
}

/** (r063 FX2) A date's contributors besides its night, baselines and steps (null: unavailable, as in the headline). */
export interface HistoryContributors {
  weekPointsPace?: number | null;
  plannedSessions?: { planned: number; done: number } | null;
  loadBalance?: number | null;
}

export function vitalsIndexHistory(i: {
  dates: readonly string[];
  sleep: Parameters<typeof mainSession>[0];
  baselines: ReadonlyArray<GaugeBaselines | null>;
  steps: ReadonlyMap<string, number>;
  stepGoal: number;
  sleepGoalMin: number;
  contributors?: (date: string) => HistoryContributors;
}): VitalsIndexHistory {
  const out: VitalsIndexHistory = { from: i.dates[0] ?? '', dates: [...i.dates], recovery: [], sleep: [], activity: [], day: [], versions: { recovery: [], sleep: [], activity: [], day: [] }, reduced: !i.contributors };
  const add = (k: keyof VitalsIndexHistory['versions'], v: string | null | undefined) => {
    if (v && !out.versions[k].includes(v)) out.versions[k].push(v);
  };
  i.dates.forEach((d, k) => {
    const night = mainSession(i.sleep, d);
    const c = i.contributors?.(d) ?? {};
    const s = night?.metrics
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
 * The last `days` days (default `VITALS_HISTORY_DAYS`) of Vitals indices ending on `date`; null while they load. Each day
 * asks for its own baselines, so a page keeps `days` to a month (`VITALS_PERIOD_MAX_DAYS`).
 */
export function useVitalsIndexHistory(date: string, goals: { stepGoal: number; sleepGoalMin: number }, days: number = VITALS_HISTORY_DAYS): VitalsIndexHistory | null {
  const from = shiftDate(date, -(Math.max(1, days) - 1));
  const dates = useMemo(() => daysFrom(from, date), [from, date]);
  const sleep = useSleep(from, date);
  const act = useActivity(from, date);
  // each day's own baselines (S2 `/baselines?date` excludes that night), one cached question for the window
  const base = useGauge(`vitals-history-baselines:${from}:${date}`, (a) => (a.baselines ? Promise.all(dates.map((d) => a.baselines!(d).catch(() => null))) : Promise.resolve(null)));
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
    if (sleep.status !== 'ready' || act.status === 'loading' || base.status === 'loading' || balances === null) return null;
    const steps = new Map<string, number>();
    for (const d of act.data?.days ?? []) {
      const v = d.fusedHeadline ?? d.steps;
      if (typeof v === 'number' && Number.isFinite(v)) steps.set(d.date, v);
    }
    return vitalsIndexHistory({ dates, sleep: sleep.data.sessions, baselines: base.data ?? dates.map(() => null), steps, stepGoal: goals.stepGoal, sleepGoalMin: goals.sleepGoalMin, contributors });
  }, [sleep, act, base, dates, goals.stepGoal, goals.sleepGoalMin, contributors, balances]);
}
