/**
 * One Ring day, as the Overview cards, the Signals rows and the Ring glance read it: the day summary, S2's baselines,
 * last night joined through V2 (`nightView`), the steps headline (`fusedHeadline` when S2 fuses, else the ring's own
 * count), the A.1.4 goals and the V2 indices with the Day score. Each part is a cached Gauge question, so the cards on
 * one screen share them.
 */
import { useMemo } from 'react';
import { nightView, type NightView } from '@/features/living/sleep/model';
import { useSleepEntry } from '@/features/living/sleep/entry';
import { useActivityData } from '@/features/living/activity/data';
import { useLiving } from '@/features/living/data/source';
import { weekOf } from '@/features/living/format';
import { useActivePlan } from '@/features/living/mode';
import type { LocalDate } from '@/living';
import { weekPointsPace } from '@/living/sensors';
import { useActivity, useBaselines, useDaily, useSteps } from './data';
import { useGoals, type RingGoals } from './goals';
import { useGaugeLive, withLocalSteps } from './localFill';
import { ringScores, type RingScores } from './indices';
import { useRingLoad, type RingLoad } from './load';
import { mainSession } from './model';
import type { GaugeBaselines, GaugeDaily, GaugeStepDay } from './types';
import type { GaugeQuery } from './useGauge';

export interface StepsHeadline {
  value: number;
  /** `fused`: S2's `steps-fuse/1` headline (ring and phone); `ring`: the ring's own count. */
  lineage: 'fused' | 'ring';
  /**
   * (r069 sync) Gauge on this phone counted more today than the server has yet: the ring's newer total, until the
   * upload lands (`./localFill`, `withLocalSteps`).
   */
  provisional?: boolean;
}

/**
 * The day's steps headline, or null when nothing observed any (Codex UI #6: a missing reading is unknown, never an
 * observed zero). A fused 0 counts only when some source covered part of the day (`coverage.eitherMin`) or the ring
 * reported a daily total; without S2's `/steps` the fused value is taken as served.
 */
export function stepsHeadlineOf(i: { fused: number | null | undefined; ringSteps: number | null | undefined; stepsDay?: Pick<GaugeStepDay, 'coverage' | 'ringDailyTotal'> | null }): StepsHeadline | null {
  const fin = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);
  if (fin(i.fused)) {
    const d = i.stepsDay;
    const unobserved = i.fused === 0 && !!d && !(d.coverage?.eitherMin > 0) && !(fin(d.ringDailyTotal) && d.ringDailyTotal > 0);
    if (!unobserved) return { value: i.fused, lineage: 'fused' };
  }
  return fin(i.ringSteps) ? { value: i.ringSteps, lineage: 'ring' } : null;
}

export interface RingDay {
  q: GaugeQuery<GaugeDaily>;
  daily: GaugeDaily | null;
  baselines: GaugeBaselines | null;
  night: NightView | null;
  steps: StepsHeadline | null;
  goals: RingGoals;
  scores: RingScores | null;
  /** (0.6.3 S21) The day's training load from approved activities; null while it loads. */
  load: RingLoad | null;
}

/**
 * (0.6.3 S22) The day's prescribed sessions (the plan's, after the eligibility overlay) and the credit of those done:
 * a done session counts 1, a partial one its credit (half when unstated); null without a plan or a planned session.
 */
export function plannedSessionsOf(rx: { sessions: ReadonlyArray<{ kind: 'resistance' | 'cardio'; slotKey: string }> } | null | undefined, items: ReadonlyArray<{ itemId: string; status: string; credit?: number }> | null | undefined): { planned: number; done: number } | null {
  const sessions = rx?.sessions ?? [];
  if (sessions.length === 0) return null;
  const by = new Map((items ?? []).map((i) => [i.itemId, i] as const));
  let done = 0;
  for (const s of sessions) {
    const it = by.get(`${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${s.slotKey}`);
    if (it?.status === 'done') done += 1;
    else if (it?.status === 'partial') done += typeof it.credit === 'number' && Number.isFinite(it.credit) ? Math.max(0, Math.min(1, it.credit)) : 0.5;
  }
  return { planned: sessions.length, done };
}

/** The week's Heart Points pace through `date` (Today's shared figure), null when the week is unknown. */
export function pointsPaceOf(week: number | null | undefined, date: string): number | null {
  if (typeof week !== 'number' || !Number.isFinite(week)) return null;
  const days = weekOf(date as LocalDate).filter((d) => d <= date).length;
  return weekPointsPace(week, days);
}

export function useRingDay(date: string): RingDay {
  const q = useDaily(date);
  const b = useBaselines(date);
  const act = useActivity(date, date);
  const daily = q.data ?? null;
  const baselines = b.data ?? null;
  const goals = useGoals(date, daily?.activity?.ringStepGoal ?? act.data?.days[0]?.ringStepGoal ?? null);
  const entry = useSleepEntry(date);
  const fused = act.data?.days.find((d) => d.date === date)?.fusedHeadline ?? null;
  const ringSteps = daily?.activity?.steps ?? null;
  const sq = useSteps(date, date);
  const stepsDay = sq.data?.days.find((d) => d.date === date) ?? null;
  // (r069 sync) Gauge's own count on this phone fills today in until the server has it (never added to it)
  const local = useGaugeLive().local;
  const steps = useMemo(
    () => withLocalSteps(stepsHeadlineOf({ fused, ringSteps, stepsDay }), { date, local, stepsDay, serverRing: ringSteps }),
    [fused, ringSteps, stepsDay, date, local],
  );
  const session = daily?.sleep ? mainSession(daily.sleep, date) : null;
  const night = useMemo(() => (session ? nightView({ session, baselines, plan: goals.sleepPlan, entry }) : null), [session, baselines, goals.sleepPlan, entry]);
  // (S22/A17) the activity index's other parts: the week's Heart Points pace and the day's planned sessions done; the
  // recovery index's prior-day TRIMP balance when eligible. Each stays null (unavailable) when it cannot be known.
  const hp = useActivityData().useHeartPoints(weekOf(date as LocalDate)[0]!, date);
  const pace = pointsPaceOf(hp?.week, date);
  const plan = useActivePlan();
  const sessionsKey = useLiving((s) => {
    if (!plan) return '';
    const v = s.today(date as LocalDate);
    const p = plannedSessionsOf(v?.prescription, v?.logged.items);
    return p ? `${p.planned}:${p.done}` : '';
  }, [date, plan?.id ?? null]);
  const planned = useMemo(() => (sessionsKey ? { planned: Number(sessionsKey.split(':')[0]), done: Number(sessionsKey.split(':')[1]) } : null), [sessionsKey]);
  const load = useRingLoad(date);
  const balance = load?.balance?.score ?? null;
  const scores = useMemo(
    () =>
      daily
        ? ringScores({ night: session, baselines, steps: steps?.value ?? null, stepGoal: goals.steps.value, sleepGoalMin: goals.sleepMin.value, legacy: daily.scores ?? null, weekPointsPace: pace, plannedSessions: planned, loadBalance: balance })
        : null,
    [daily, session, baselines, steps?.value, goals.steps.value, goals.sleepMin.value, pace, planned, balance],
  );
  return { q, daily, baselines, night, steps, goals, scores, load };
}
