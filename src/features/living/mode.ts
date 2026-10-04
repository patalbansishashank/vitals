/**
 * App mode (docs/SUITE_SPEC.md §6.1; design/INFORMATION_ARCHITECTURE.md §3.4): derived, never toggled freely.
 * Living while a plan is scheduled, active or paused and the planning override is off; Planning otherwise.
 * Shell-safe (no engine imports).
 */
import { useSyncExternalStore } from 'react';
import { daysBetween } from '@/living/dates';
import type { LocalDate } from '@/living';
import { createDocumentActivePlanSource, inMemoryActivePlanSource, isLivePlan, type ActivePlan, type ActivePlanSource } from './activePlan';

export type AppMode = 'planning' | 'living';

export function deriveAppMode(plan: Pick<ActivePlan, 'status'> | null, planningOverride: boolean): AppMode {
  return isLivePlan(plan) && !planningOverride ? 'living' : 'planning';
}

let source: ActivePlanSource = inMemoryActivePlanSource;
let documentSource: (ActivePlanSource & { ready(): boolean }) | null = null;

/** Swap the source (tests; the app installs the documents with `installDocumentPlanSource`). Before the first render. */
export function setActivePlanSource(s: ActivePlanSource): void {
  source = s;
}
export function getActivePlanSource(): ActivePlanSource {
  return source;
}

/**
 * The app's source: the live plan from the plan documents (`createDocumentActivePlanSource`). Called once when the app's
 * router is created, before anything renders; tests that mount routes on their own keep the in-memory source.
 */
export function installDocumentPlanSource(): ActivePlanSource {
  documentSource ??= createDocumentActivePlanSource();
  source = documentSource;
  return documentSource;
}

/** True while the plan comes from the documents (the app), false for the in-memory stand-in (tests, demos). */
export function usesDocumentPlan(): boolean {
  return documentSource !== null && source === documentSource;
}

const subscribe = (l: () => void) => source.subscribe(l);
const snapshot = () => source.get();
const readySnapshot = () => source.ready?.() ?? true;

/** False while the plan source is still loading (the document store opening): wait before deciding "no plan". */
export function useLivePlanReady(): boolean {
  return useSyncExternalStore(subscribe, readySnapshot, readySnapshot);
}

export interface AppModeState {
  mode: AppMode;
  /** The live plan (also while the planning override is on), or null. */
  plan: ActivePlan | null;
  /** True while "Planning tools" is open over a live plan (plan strip + return key). */
  override: boolean;
}

/** The current mode, the live plan and the planning override. */
export function useAppMode(): AppModeState {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const plan = isLivePlan(s.plan) ? s.plan : null;
  return { mode: deriveAppMode(plan, s.planningOverride), plan, override: !!plan && s.planningOverride };
}

/** The live plan or null (ignores the override). */
export function useActivePlan(): ActivePlan | null {
  return useAppMode().plan;
}

/** Plan-day readout: day n of N (1-based), or null before the start / after the end. */
export function planDayOf(plan: Pick<ActivePlan, 'startDate' | 'plannedEndDate'>, date: LocalDate): { day: number; of: number } {
  return { day: daysBetween(plan.startDate, date) + 1, of: daysBetween(plan.startDate, plan.plannedEndDate) };
}
