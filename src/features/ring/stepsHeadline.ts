/**
 * (r087 IA) The day's steps as one headline, one forecast and one state word, read by Today's Steps card and by Ring's
 * Movement so the two show the same count and the same word for the same day.
 *
 * Two pipelines count steps. The Ring's is the server's calendar-day headline (`stepsHeadlineOf`) with this phone's
 * newer ring count (`withLocalSteps`). Today's is the plan's steps entry: the person's own, or the import's copy of the
 * fused count written on the app day (small hours belong to the day before) under the person's headline setting, which
 * is the count the plan's energy model uses. The two are not the same count, so they are never compared: on the real
 * today the plan's entry is the headline, with only the phone's ring steps since the server's last ring total added to
 * an imported entry (recent steps fall on the same day in either meaning, and the phone's ring count is the ring's
 * total, so this is skipped when the entry counts located steps only). The entry and the server's ring total reach the
 * screen at different moments: when the entry was read after the ring total held here was answered, it may already hold
 * the steps the phone is ahead by, so they are added only while that answer is at least as new as the entry; otherwise
 * the entry stands alone. Without an entry, and on any other day, the Ring's pipeline is the headline; the timeline's
 * counted minutes are the last resort; nothing observed is "No reading".
 *
 * Today holds the plan's steps model (an engine run); the Ring never starts a second run. Today's card publishes the
 * model here and Movement reads it (memory only, like `./planEnergy`).
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useDaily, useSteps } from './data';
import { stepsHeadlineOf, type StepsHeadline } from './day';
import { useGaugeLive, withLocalSteps } from './localFill';
import type { GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { liveTodaySteps, subscribeLiveSteps } from '@/state/liveSteps';
import type { TodayStepsModel } from '@/living/todayReplay';
import type { GaugeStepDay } from './types';

export const STEP_WORDS = {
  met: 'Goal met',
  onCourse: 'On course',
  under: 'Likely under',
  building: 'Building',
  short: 'Short of the goal',
  none: 'No reading',
} as const;

/** What the shared headline needs from today's plan steps model (`TodayActivityView.model.steps`). */
export type PlanSteps = Pick<
  TodayStepsModel,
  'fusedSoFar' | 'lineages' | 'headlinePolicy' | 'total' | 'prior' | 'rxSteps' | 'remainingAwakeFrac'
>;

export interface DayStepsInput {
  date: string;
  isToday: boolean;
  /** S2's step day (`/steps`); its headline is the fused total. */
  stepsDay?: Pick<GaugeStepDay, 'headline' | 'coverage' | 'ringDailyTotal' | 'headlinePolicy'> | null;
  /** The fused total from another answer of the server (the activity days), when S2's step day is not there. */
  fused?: number | null;
  /** The ring's own daily count (the day summary). */
  ringSteps?: number | null;
  /** Gauge's snapshot on this phone (absent off Android or on an older native app). */
  local?: GaugeLocalSnapshot | null;
  /** Today's plan steps model (read only on the real today). */
  plan?: PlanSteps | null;
  /** When the plan entry's count was read (epoch ms: the import's reading of today), when known. */
  planAt?: number | null;
  /** When the server's ring total held here was answered (epoch ms: the `/steps` answer, else the day summary). */
  ringAt?: number | null;
  /** The timeline's counted minutes, summed. */
  counted?: number | null;
}

export interface DaySteps {
  headline: StepsHeadline | null;
  /** The person's own entry decides the count (not a reading). */
  own: boolean;
  /** Likely by bedtime: the count plus the plan's share of the awake time ahead; null without a plan for today. */
  likely: number | null;
}

/** Whether a steps entry's lineages are the ring import's (ring, phone, Health Connect) rather than the person's own. */
export function importedStepsLineage(lineages: readonly string[]): boolean {
  return lineages.some((l) => l === 'device' || l.startsWith('ring') || l.startsWith('phone') || l.startsWith('hc'));
}

/**
 * The person's own entry (typed, or logged by the Coach) has its author as its lineage. An import with no located
 * interval on the day writes no lineage at all, so an empty list is the import's, not the person's.
 */
export function ownStepsEntry(lineages: readonly string[]): boolean {
  return lineages.length > 0 && !importedStepsLineage(lineages);
}

const fin = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** The phone's ring steps the server's ring total does not have yet (0 when unknown or none). */
function phoneRingAhead(i: DayStepsInput): number {
  const serverRing = i.stepsDay?.ringDailyTotal ?? i.ringSteps ?? null;
  if (!fin(serverRing)) return 0;
  const h = withLocalSteps(
    { value: serverRing, lineage: 'ring' },
    { date: i.date, local: i.local ?? null, stepsDay: i.stepsDay ?? null, serverRing },
  );
  return h?.provisional ? h.value - serverRing : 0;
}

/** The day's steps, its forecast and whose they are. Pure. */
export function daySteps(i: DayStepsInput): DaySteps {
  const server = stepsHeadlineOf({ fused: i.stepsDay?.headline ?? i.fused, ringSteps: i.ringSteps, stepsDay: i.stepsDay ?? null });
  const plan = i.isToday ? (i.plan ?? null) : null;
  let headline: StepsHeadline | null;
  let own = false;
  if (plan && fin(plan.fusedSoFar)) {
    own = ownStepsEntry(plan.lineages);
    // an entry read after the ring total held here may already count the phone's lead over it: never added twice
    const entryNewer = fin(i.planAt) && !(fin(i.ringAt) && i.ringAt >= i.planAt);
    const ahead = own || plan.headlinePolicy === 'located' || entryNewer ? 0 : phoneRingAhead(i);
    const lineage = server?.lineage ?? 'fused';
    headline = ahead > 0 ? { value: plan.fusedSoFar + ahead, lineage, provisional: true } : { value: plan.fusedSoFar, lineage };
  } else {
    headline =
      withLocalSteps(server, { date: i.date, local: i.local ?? null, stepsDay: i.stepsDay ?? null, serverRing: i.ringSteps ?? null }) ??
      (fin(i.counted) ? { value: i.counted, lineage: 'fused' } : null);
  }
  return { headline, own, likely: stepsForecast(headline?.value ?? null, plan) };
}

/** The day's step headline alone, or null when nothing observed any steps. Pure. */
export function dayStepsHeadline(i: DayStepsInput): StepsHeadline | null {
  return daySteps(i).headline;
}

/**
 * Likely by bedtime. With the plan's entry the model's own total (what the energy model books), moved by the phone's
 * newer steps; without one the model's prior already covers the whole awake day, so only the share still ahead is added
 * to the reading shown.
 */
export function stepsForecast(value: number | null, plan: PlanSteps | null | undefined): number | null {
  if (value === null || !plan || plan.rxSteps === null || !(plan.prior > 0)) return null;
  if (fin(plan.fusedSoFar) && fin(plan.total)) return Math.round(plan.total + (value - plan.fusedSoFar));
  return Math.round(value + plan.rxSteps * plan.remainingAwakeFrac);
}

// ------------------------------------------------------------------------------------- today's model, published
/** An imported entry this old may lag the Ring's own pipeline: Movement then reads the Ring's count instead. */
export const PLAN_STEPS_FRESH_MS = 15 * 60_000;

let published: { date: string; plan: PlanSteps; at: number } | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** Today's card: the plan steps model of the real today (each recompute republishes it). */
export function publishPlanSteps(date: string, plan: PlanSteps, at = Date.now()): void {
  published = { date, plan, at };
  for (const l of listeners) l();
}

/** Tests: forget the published model. */
export function resetPlanSteps(): void {
  published = null;
  for (const l of listeners) l();
}

/**
 * The published model for `date` as Movement may use it: while fresh; past that only the person's own entry, which no
 * reading overtakes.
 */
export function publishedPlanSteps(
  p: { date: string; plan: PlanSteps; at: number } | null,
  date: string,
  nowMs: number,
): PlanSteps | null {
  if (!p || p.date !== date) return null;
  if (nowMs - p.at <= PLAN_STEPS_FRESH_MS) return p.plan;
  return fin(p.plan.fusedSoFar) && ownStepsEntry(p.plan.lineages) ? p.plan : null;
}

/**
 * The shared hook: the day summary and this phone's ring count added to what the caller holds. Today passes its plan
 * steps model (`plan`, publishing it); Movement leaves it out and reads the published one (`nowMs` judges its age).
 * `isToday` is the app day's today on both screens.
 */
export function useDaySteps(
  i: Omit<DayStepsInput, 'ringSteps' | 'local' | 'planAt' | 'ringAt'> & { nowMs?: number },
): DaySteps {
  const daily = useDaily(i.date);
  const ringSteps = daily.status === 'ready' ? (daily.data?.activity?.steps ?? null) : null;
  const local = useGaugeLive().local;
  // the times of the two answers the phone's lead is measured between: the import's reading of today behind the plan
  // entry, and the `/steps` answer both screens hold for the day (the same read as theirs), else the day summary
  const live = useSyncExternalStore(subscribeLiveSteps, liveTodaySteps, liveTodaySteps);
  const liveAt = live && live.day.date === i.date ? Date.parse(live.at) : Number.NaN;
  const planAt = Number.isFinite(liveAt) ? liveAt : null;
  const stepsSavedAt = useSteps(i.date, i.date).savedAt ?? null;
  const ringAt = fin(i.stepsDay?.ringDailyTotal) ? stepsSavedAt : (daily.savedAt ?? null);
  const held = useSyncExternalStore(subscribe, () => published, () => published);
  const { date, isToday, stepsDay, fused, counted, nowMs } = i;
  const passed = 'plan' in i;
  const given = i.plan;
  useEffect(() => {
    if (passed && isToday && given) publishPlanSteps(date, given);
  }, [passed, isToday, given, date]);
  const plan = passed ? (given ?? null) : nowMs === undefined ? null : publishedPlanSteps(held, date, nowMs);
  return useMemo(
    () => daySteps({ date, isToday, stepsDay, fused, ringSteps, local, plan, planAt, ringAt, counted }),
    [date, isToday, stepsDay, fused, ringSteps, local, plan, planAt, ringAt, counted],
  );
}

/**
 * The state word under the steps: met at the goal; on the real today "On course" or "Likely under" when a forecast is
 * known, else "Building"; a past day short of the goal says so. Never a digit, so quiet mode reads it as it is.
 */
export function stepsStateWord(value: number | null, goal: number, o: { isToday: boolean; likely?: number | null }): string {
  if (value === null) return STEP_WORDS.none;
  if (value >= goal) return STEP_WORDS.met;
  if (!o.isToday) return STEP_WORDS.short;
  if (o.likely === null || o.likely === undefined) return STEP_WORDS.building;
  return o.likely >= goal ? STEP_WORDS.onCourse : STEP_WORDS.under;
}
