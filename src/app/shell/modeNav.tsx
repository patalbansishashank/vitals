/**
 * Mode-aware navigation (INFORMATION_ARCHITECTURE §3.4–§3.6, COMPONENTS §11 + §13.17, SUITE_SPEC §6): Planning shows
 * Body · Simulate · Plan · Evidence; Living (a plan scheduled, active or paused) shows Today · Food · Train · Coach ·
 * Progress with Evidence · Planning tools · Settings in the lower group; the planning override shows the Planning
 * destinations with the return key "today" in the first slot and the non-dismissable plan strip.
 * The mode is derived (`useAppMode`), never toggled for its own sake.
 */
import { useCallback, useEffect } from 'react';
import { useMatches, useNavigate, type NavigateFunction } from 'react-router';
import { Key } from '@/components/Key';
import { useActivePlanStore, type ActivePlan } from '@/features/living/activePlan';
import { currentDay, useLivingClock } from '@/features/living/clock';
import { STRIP_COPY } from '@/features/living/copy';
import { planDayOf, useAppMode, type AppMode } from '@/features/living/mode';
import { addDays, weekdayOf } from '@/living/dates';
import { lastRoute } from '../lastRoute';
import { DESTINATIONS, EVIDENCE_ITEM, LIVING_DESTINATIONS, PLANNING_ITEM, RETURN_ITEM, type NavItem } from './nav';
import { useShell } from './ShellContext';

/**
 * Run a screen without the tab bar (the first-run intake, design/screens/onboarding-intake-v2.md §3: "no tab bar during
 * setup"). Either declare it on the route — `{ path, element, handle: { chromeless: true } }` — or, when it depends on
 * state (`?from=setup`), call `useChromeless(on)` from the screen. The shell drops the tab bar and its reserved space.
 */
export function useChromeless(on: boolean): void {
  const register = useShell()?.setChromelessCount;
  useEffect(() => {
    if (!on || !register) return;
    register(1);
    return () => register(-1);
  }, [on, register]);
}

/** True when the current route declares `handle: { chromeless: true }`. */
export function useRouteChromeless(): boolean {
  return useMatches().some((m) => !!(m.handle as { chromeless?: boolean } | undefined)?.chromeless);
}

export interface ShellNav {
  mode: AppMode;
  override: boolean;
  plan: ActivePlan | null;
  /** Rail keys / tab bar keys, in order. */
  primary: NavItem[];
  /** Rail lower group above settings (desktop) / overflow menu (mobile). */
  lower: NavItem[];
}

const LIVING_LOWER: NavItem[] = [EVIDENCE_ITEM, PLANNING_ITEM];
const OVERRIDE_PRIMARY: NavItem[] = [RETURN_ITEM, ...DESTINATIONS];
const NONE: NavItem[] = [];

export function useShellNav(): ShellNav {
  const { mode, override, plan } = useAppMode();
  if (mode === 'living') return { mode, override, plan, primary: LIVING_DESTINATIONS, lower: LIVING_LOWER };
  if (override) return { mode, override, plan, primary: OVERRIDE_PRIMARY, lower: NONE };
  return { mode, override, plan, primary: DESTINATIONS, lower: NONE };
}

/** "Planning tools": open the planning screens over the live plan (navigate first, then set the override). */
export function enterPlanningTools(navigate: NavigateFunction): void {
  navigate(lastRoute() ?? PLANNING_ITEM.to);
  useActivePlanStore.getState().setPlanningOverride(true);
}

/** "Back to Today" / the return key: clear the override and land on Today. */
export function backToToday(navigate: NavigateFunction): void {
  useActivePlanStore.getState().setPlanningOverride(false);
  navigate(RETURN_ITEM.to);
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The rail's plan-day readout under the wordmark: "day 15 / 84", "paused", "starts Mon" (IA §3.6). */
export function PlanDayReadout({ plan }: { plan: ActivePlan }) {
  const today = currentDay(useLivingClock());
  let text: string;
  if (plan.status === 'paused') text = 'paused';
  else if (plan.status === 'scheduled' || today < plan.startDate) text = plan.startDate === addDays(today, 1) ? 'starts tomorrow' : `starts ${WD[weekdayOf(plan.startDate)]}`;
  else {
    const { day, of } = planDayOf(plan, today);
    text = `day ${Math.min(day, of)} / ${of}`;
  }
  return (
    <span className="lm-rail__day" aria-label={text.replace('/', 'of')}>
      {text}
    </span>
  );
}

/** COMPONENTS §13.17: the plan strip under the context bar while the planning override is on. Not dismissible. */
export function PlanStrip({ plan }: { plan: ActivePlan }) {
  const navigate = useNavigate();
  const today = currentDay(useLivingClock());
  const { day, of } = planDayOf(plan, today);
  const head = plan.status === 'paused' ? STRIP_COPY.paused(plan.name) : plan.status === 'scheduled' || day < 1 ? STRIP_COPY.scheduled(plan.name) : STRIP_COPY.running(plan.name);
  const onBack = useCallback(() => backToToday(navigate), [navigate]);
  return (
    <div className="lm-planstrip" role="region" aria-label="Plan running">
      <span className="lm-planstrip__dot" aria-hidden="true" />
      <p className="lm-planstrip__text">
        <strong>{head}</strong>
        {day >= 1 && plan.status !== 'scheduled' ? <span> · {STRIP_COPY.dayOf(Math.min(day, of), of)}</span> : null}
        <span className="lm-planstrip__note"> · {STRIP_COPY.safe}</span>
      </p>
      <Key size="sm" onClick={onBack}>
        {STRIP_COPY.back}
      </Key>
    </div>
  );
}
