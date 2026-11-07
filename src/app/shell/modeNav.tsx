/**
 * Mode-aware navigation (INFORMATION_ARCHITECTURE §3.4–§3.6; r068 U14). Today is home in every mode (0.6.3): "/" lands
 * there, and it leads the navigation in both modes. The navigation is stable: its keys and rows follow the mode only,
 * never the page, and a place that needs a plan (Food, Progress) is left out without one rather than moved.
 *   - Phone dock (labelled, five keys, the same slots in both modes): Living = Today · Food · Train · Ring · More;
 *     Planning = Today · Plan · Activities · Ring · More (Plan stands for the three planning steps, Body · Simulate ·
 *     Plan, which a step switcher under each step's title joins: `PlanningSteps`). Train / Activities (one screen) is
 *     always the third key and Ring the fourth. More is a page (`/more`, `./MorePage`) listing every other place in
 *     labelled groups, never one a dock key already stands for; on desktop it hands over to the sidebar. (r069 D4) Energy,
 *     the day's energy page, follows Ring in the sidebar's first group and leads More, in both modes.
 *   - Desktop sidebar (one list in labelled groups): Living = Today · Food · Train · Ring / Your plan: Plan details ·
 *     Progress · Coach / Planning: Body · Simulate · Plan / Library: Evidence; Planning = Today · Activities · Ring /
 *     Planning: Body · Simulate · Plan · Coach / Library: Evidence. Settings at the foot. The same places as More.
 *   - The header's ⋯ carries the page's own actions only.
 * While a plan runs, every planning screen's header carries the plan's status icon (`planCapsuleOf`). The mode is
 * derived (`useAppMode`), never toggled for its own sake.
 */
import { useEffect } from 'react';
import { useMatches, type NavigateFunction } from 'react-router';
import { Route } from 'lucide-react';
import { StatusCapsule } from '@/components/StatusCapsule';
import { useActivePlanStore, type ActivePlan } from '@/features/living/activePlan';
import { currentDay, useLivingClock } from '@/features/living/clock';
import { STRIP_COPY } from '@/features/living/copy';
import { planDayOf, useAppMode, type AppMode } from '@/features/living/mode';
import { livingPaths } from '@/features/living/paths';
import { planTitle } from '@/features/living/plan/planTitle';
import { lastRoute } from '../lastRoute';
import {
  ACTIVITIES_ITEM,
  BODY_ITEM,
  COACH_ITEM,
  ENERGY_ITEM,
  EVIDENCE_ITEM,
  FOOD_ITEM,
  isCurrent,
  MORE_ITEM,
  PLAN_DETAILS_ITEM,
  PLAN_ITEM,
  PLANNING_PATTERN,
  PROGRESS_ITEM,
  RING_ITEM,
  SETTINGS_ITEM,
  SIMULATE_ITEM,
  TODAY_ITEM,
  TODAY_PATH,
  TRAIN_ITEM,
  type NavGroup,
  type NavItem,
} from './nav';
import { useShell } from './ShellContext';

/**
 * Run a screen without the tab bar (the first-run intake, design/screens/onboarding-intake-v2.md §3: "no tab bar during
 * setup"). Either declare it on the route — `{ path, element, handle: { chromeless: true } }` — or, when it depends on
 * state (`?from=setup`), call `useChromeless(on)` from the screen. The shell drops the tab bar and its reserved space,
 * and on phones the screen's <ActionBar> docks at the bottom of the screen as its toolbar.
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
  /** The phone dock's destination keys before More, in order (also ⌘/Ctrl + 1…n). */
  primary: NavItem[];
  /** The desktop sidebar's groups (the foot's Settings excluded): stable, the same in both modes but for the places a plan opens. */
  groups: NavGroup[];
  /** The More page's groups (phones): every place the dock has no key for, Settings last. */
  more: NavGroup[];
}

/**
 * The planning steps as one dock key: it reopens the step last used, and is current on all three. With none used yet
 * it opens the Planner, the step its label names (never Your body, whose unfinished setup is a focused flow).
 */
function planningKey(): NavItem {
  const last = lastRoute();
  return { ...PLAN_ITEM, to: last && PLANNING_HOMES.includes(last) ? last : PLAN_ITEM.to, match: PLANNING_PATTERN };
}

const LIVING_PRIMARY: NavItem[] = [TODAY_ITEM, FOOD_ITEM, TRAIN_ITEM, RING_ITEM];

/** The running plan's own places (Living): its page, its progress and the Coach. */
const YOUR_PLAN: NavGroup = { id: 'plan', label: 'Your plan', items: [PLAN_DETAILS_ITEM, PROGRESS_ITEM, COACH_ITEM] };
const LIBRARY: NavGroup = { id: 'library', label: 'Library', items: [EVIDENCE_ITEM] };

/**
 * (r068 final M19) The same groups in both modes: Progress follows Ring and the Coach sits in Planning whether or not a
 * plan runs; a plan adds Food and its own "Your plan" row (Plan details), and without one only those are left out.
 */
function sidebarGroups(living: boolean): NavGroup[] {
  return living
    ? [
        { id: 'main', items: [...LIVING_PRIMARY, ENERGY_ITEM, PROGRESS_ITEM] },
        { id: 'plan', label: 'Your plan', items: [PLAN_DETAILS_ITEM] },
        { id: 'planning', label: 'Planning', items: [BODY_ITEM, SIMULATE_ITEM, PLAN_ITEM, COACH_ITEM] },
        LIBRARY,
      ]
    : // r068 L29: Progress (weigh-ins, body, blood markers) needs no plan, so Planning lists it too, after Ring as in Living
      [{ id: 'main', items: [TODAY_ITEM, ACTIVITIES_ITEM, RING_ITEM, ENERGY_ITEM, PROGRESS_ITEM] }, { id: 'planning', label: 'Planning', items: [BODY_ITEM, SIMULATE_ITEM, PLAN_ITEM, COACH_ITEM] }, LIBRARY];
}

// (r069 D4) Energy has no dock key: it opens More, unlabelled, in both modes
const LIVING_MORE: NavGroup[] = [{ id: 'main', items: [ENERGY_ITEM] }, YOUR_PLAN, { id: 'planning', label: 'Planning', items: [BODY_ITEM, SIMULATE_ITEM, PLAN_ITEM] }, LIBRARY, { id: 'app', label: 'App', items: [SETTINGS_ITEM] }];
/**
 * Planning mode's More: the dock's Plan key already stands for Body · Simulate · Plan, so of the planning places only
 * the Coach is left; it shares a group with Evidence (the two places that explain), rather than three groups of one.
 * Progress, which works without a plan (r068 L29), opens the page unlabelled.
 */
const PLANNING_MORE: NavGroup[] = [
  // r068 L29: Progress needs no plan (weigh-ins, body, markers) and has no dock key in Planning, so it leads More
  { id: 'main', items: [ENERGY_ITEM, PROGRESS_ITEM] },
  { id: 'library', label: 'Guidance', items: [COACH_ITEM, EVIDENCE_ITEM] },
  { id: 'app', label: 'App', items: [SETTINGS_ITEM] },
];

/**
 * The mode's navigation. The keys follow the mode only: a screen the dock has no key for lights More when More lists
 * it (`moreIsCurrent`), and nothing otherwise (a pushed page hides the dock anyway).
 */
export function useShellNav(): ShellNav {
  const { mode, override, plan } = useAppMode();
  const living = mode === 'living';
  return {
    mode,
    override,
    plan,
    primary: living ? LIVING_PRIMARY : [TODAY_ITEM, planningKey(), ACTIVITIES_ITEM, RING_ITEM],
    groups: sidebarGroups(living),
    more: living ? LIVING_MORE : PLANNING_MORE,
  };
}

/** The More key is current on the More page and on every place it lists that no dock key already stands for. */
export function moreIsCurrent(nav: Pick<ShellNav, 'primary' | 'more'>, pathname: string): boolean {
  if (isCurrent(MORE_ITEM, pathname)) return true;
  if (nav.primary.some((k) => isCurrent(k, pathname))) return false;
  return nav.more.some((g) => g.items.some((i) => isCurrent(i, pathname)));
}

/** The planning screens the Planning dock's Plan key (and "Planning tools") may reopen on (the last one used). */
const PLANNING_HOMES = ['/body', '/simulate', '/plan'];

/** "Planning tools": open the planning screens over the live plan (navigate first, then set the override). */
export function enterPlanningTools(navigate: NavigateFunction): void {
  const last = lastRoute();
  navigate(last && PLANNING_HOMES.includes(last) ? last : BODY_ITEM.to);
  useActivePlanStore.getState().setPlanningOverride(true);
}

/** "Back to Today" (the override's sidebar mode switch / phone header Back, ⌘/Ctrl + 0): clear the override and land on Today. */
export function backToToday(navigate: NavigateFunction): void {
  useActivePlanStore.getState().setPlanningOverride(false);
  navigate(TODAY_PATH);
}

/** Plan details (`/plan/active…`) is a Living page, not a planning screen, though it shares the /plan prefix. */
const PLANNING_SCREEN = /^\/(?:body|simulate|plan(?!\/active(?:\/|$))|evidence)(?:\/|$)/;

/** The planning screens: Your body, Simulate, the Planner and Evidence, at any depth. */
export function isPlanningScreen(pathname: string): boolean {
  return PLANNING_SCREEN.test(pathname);
}

/**
 * The running plan the header shows as its plan status icon on this screen, or null: on every planning screen while a plan
 * runs (Living mode reached by a link or the ⋯, and the planning override), and on any other screen of the override
 * (the Coach). Never on a pushed header (TopBar decides that, by width).
 */
export function planCapsuleOf(nav: Pick<ShellNav, 'override' | 'plan'>, pathname: string): ActivePlan | null {
  if (!nav.plan) return null;
  return nav.override || isPlanningScreen(pathname) ? nav.plan : null;
}

/**
 * COMPONENTS §13.17, SPEC §9: on the planning screens of a running plan (and anywhere in the planning override) the
 * header carries the plan as a status icon (a route; its name "Spring cut is running, day 16 of 90"), so the person
 * always sees that the live plan keeps running while they plan; it opens Plan details. Not a way back: the override's
 * Back slot returns to Today. It comes after the page's own status icons, so it is among the first to move into the ⋯
 * when the bar has more than two; it leaves pushed pages. (Formerly a strip under the header, then a text capsule.)
 */
export function PlanStatus({ plan }: { plan: ActivePlan }) {
  const today = currentDay(useLivingClock());
  const { day, of } = planDayOf(plan, today);
  const scheduled = plan.status === 'scheduled' || day < 1;
  // the plan's name in plain words ("Medium plan", never a stored tag such as "Coach: medium")
  const name = planTitle(plan);
  const head = plan.status === 'paused' ? STRIP_COPY.paused(name) : scheduled ? STRIP_COPY.scheduled(name) : STRIP_COPY.running(name);
  const dayOf = !scheduled ? STRIP_COPY.dayOf(Math.min(day, of), of) : null;
  return <StatusCapsule className="lm-plan-status" icon={Route} label={dayOf ? `${head}, ${dayOf}` : head} to={livingPaths.planActive} />;
}
