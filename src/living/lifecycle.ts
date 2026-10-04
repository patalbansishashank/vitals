/**
 * Plan lifecycle (docs/SUITE_SPEC.md §3.1): draft → scheduled → active ⇄ paused → ended {completed | abandoned | replaced |
 * safety}. Every transition is a pure function returning the new `PlanDoc` (or a refusal); E4's `plan.*` commands persist
 * the result. Ending never deletes versions or logs.
 */
import { addDays, compareDates, daysBetween, hoursBetween } from './dates';
import { planDay } from './calendar';
import type { EndReason, Instant, LocalDate, PlanDoc, PlanState } from './types';

export type LifecycleEvent = 'start' | 'activate' | 'pause' | 'resume' | 'end' | 'replace' | 'complete' | 'discard' | 'safetyPause';

const ALLOWED: Record<PlanState, readonly LifecycleEvent[]> = {
  draft: ['start'],
  scheduled: ['activate', 'end', 'replace', 'discard'],
  active: ['pause', 'end', 'replace', 'complete', 'safetyPause', 'discard'],
  paused: ['resume', 'end', 'replace', 'complete'],
  ended: [],
};

export function canTransition(from: PlanState, ev: LifecycleEvent): boolean {
  return ALLOWED[from].includes(ev);
}

export type Transition = { ok: true; plan: PlanDoc; notes: string[] } | { ok: false; reason: string };

function refuse(reason: string): Transition {
  return { ok: false, reason };
}

/** Live = scheduled, active or paused (at most one per person). */
export function isLive(plan: Pick<PlanDoc, 'status'>): boolean {
  return plan.status === 'scheduled' || plan.status === 'active' || plan.status === 'paused';
}

/** `scheduled → active` once `today ≥ startDate` (first open on/after the start). */
export function activateIfDue(plan: PlanDoc, today: LocalDate): Transition {
  if (plan.status !== 'scheduled') return refuse('not scheduled');
  if (compareDates(today, plan.startDate) < 0) return refuse('start date not reached');
  return { ok: true, plan: { ...plan, status: 'active' }, notes: [] };
}

export function pausePlan(plan: PlanDoc, date: LocalDate, reason?: string): Transition {
  if (plan.status !== 'active') return refuse('only an active plan can be paused');
  return { ok: true, plan: { ...plan, status: 'paused', pauses: [...plan.pauses, { from: date, to: null, ...(reason ? { reason } : {}) }] }, notes: [] };
}

/**
 * A `danger` forecast warning or a screening change that blocks the regime pauses the plan with reason 'safety'
 * (§3.1); only the person resumes (UI-only path), and an `event` re-plan proposal is opened by the caller.
 */
export function safetyPause(plan: PlanDoc, date: LocalDate): Transition {
  if (plan.status !== 'active') return refuse('only an active plan can be paused');
  return { ok: true, plan: { ...plan, status: 'paused', pauses: [...plan.pauses, { from: date, to: null, reason: 'safety' }] }, notes: ['The plan is paused for safety; resume it when you are ready.'] };
}

/**
 * `paused → active` on `date`: closes the open pause [P, R) and moves the planned end by R − P. The caller adds the
 * resume version (`resumeSchedule`, effective from R).
 */
export function resumePlan(plan: PlanDoc, date: LocalDate, by: 'user' | 'ai' = 'user'): Transition & { shift?: { P: number; R: number } } {
  if (plan.status !== 'paused') return refuse('not paused');
  const open = plan.pauses.findIndex((p) => p.to === null);
  if (open < 0) return refuse('no open pause');
  const pause = plan.pauses[open]!;
  if (pause.reason === 'safety' && by !== 'user') return refuse('a safety pause is resumed by the person only');
  if (compareDates(date, pause.from) < 0) return refuse('resume date before the pause');
  const shiftDays = daysBetween(pause.from, date);
  const pauses = plan.pauses.map((p, i) => (i === open ? { ...p, to: date } : p));
  return {
    ok: true,
    plan: { ...plan, status: 'active', pauses, plannedEndDate: addDays(plan.plannedEndDate, shiftDays) },
    notes: shiftDays > 0 ? [`The plan resumes where it paused; the end date moves by ${shiftDays} day${shiftDays === 1 ? '' : 's'}.`] : [],
    shift: { P: planDay(plan, pause.from), R: planDay(plan, date) },
  };
}

export function endPlan(plan: PlanDoc, at: Instant, date: LocalDate, reason: EndReason, note?: string): Transition {
  if (!isLive(plan)) return refuse('plan already ended');
  const pauses = plan.pauses.map((p) => (p.to === null ? { ...p, to: date } : p));
  return { ok: true, plan: { ...plan, status: 'ended', pauses, ended: { at, date, reason, ...(note ? { note } : {}) } }, notes: [] };
}

/** `ended:completed` at the first open after `plannedEndDate` (§3.1). */
export function completeIfDue(plan: PlanDoc, today: LocalDate, at: Instant): Transition {
  if (plan.status !== 'active' && plan.status !== 'paused') return refuse('not running');
  if (compareDates(today, plan.plannedEndDate) < 0) return refuse('not finished');
  return endPlan(plan, at, plan.plannedEndDate, 'completed');
}

/** `plan.discard`: only within 24 h of creation and with no logs (§3.1); the plan document is removed. */
export function canDiscard(plan: PlanDoc, now: Instant, hasLogs: boolean): { ok: boolean; reason?: string } {
  if (!isLive(plan)) return { ok: false, reason: 'plan already ended' };
  if (hasLogs) return { ok: false, reason: 'the plan has logs; end it instead' };
  if (hoursBetween(plan.createdAt, now) > 24) return { ok: false, reason: 'more than 24 hours since start; end it instead' };
  return { ok: true };
}

/**
 * Sync conflict rule (§3.1): at most one plan in {scheduled, active, paused}. The newer plan (by `createdAt`, then id)
 * wins; the others end as 'replaced' with a notice on both devices.
 */
export function resolveLivePlans<P extends PlanDoc & { id: string }>(plans: readonly P[], at: Instant, today: LocalDate): { winner: P | null; replaced: P[] } {
  const live = plans.filter(isLive).sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  if (live.length <= 1) return { winner: live[0] ?? null, replaced: [] };
  const [winner, ...rest] = live;
  const replaced = rest.map((p) => {
    const t = endPlan(p, at, today, 'replaced', 'Another device started a newer plan.');
    return (t.ok ? t.plan : p) as P;
  });
  return { winner: winner!, replaced };
}

/** Lifecycle state for display (a plan before its start date that is still 'scheduled'). */
export function stateOn(plan: PlanDoc, today: LocalDate): PlanState {
  if (plan.status === 'scheduled' && compareDates(today, plan.startDate) >= 0) return 'active';
  return plan.status;
}
