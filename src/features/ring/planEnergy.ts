/**
 * (0.6.3 S23/A18) Today's energy figures as Today's engine run worked them out, for the Ring: the plan's day active
 * energy (A.1.4: the active-energy goal; `EnergyToday.planActive`, `energyDay` over the head schedule's day) and the day's
 * total and active energy (`energyDay` over the realised run: actual through now plus the plan's remainder). Today
 * publishes them; the Ring's goals and monitor read them, so the Ring never starts a second engine run. Memory only, by
 * date; absent until a run has them (the Ring then falls back to the person's own goal setting, or shows no value).
 * All in kcal (the storage unit).
 */
import { useSyncExternalStore } from 'react';

export interface EnergyFigures {
  planActiveKcal: number | null;
  totalKcal: number | null;
  activeKcal: number | null;
}

const byDate = new Map<string, EnergyFigures>();
const listeners = new Set<() => void>();
const fin = (x: number | null | undefined): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const same = (a: number | null, b: number | null) => (a === null ? b === null : b !== null && Math.abs(a - b) < 0.5);

/** Today's engine run: the figures for `date` (null forgets them). */
export function publishEnergyFigures(date: string, f: EnergyFigures | null): void {
  const had = byDate.get(date);
  if (!f) {
    if (!had) return;
    byDate.delete(date);
  } else {
    const next = { planActiveKcal: fin(f.planActiveKcal), totalKcal: fin(f.totalKcal), activeKcal: fin(f.activeKcal) };
    if (had && same(had.planActiveKcal, next.planActiveKcal) && same(had.totalKcal, next.totalKcal) && same(had.activeKcal, next.activeKcal)) return;
    byDate.set(date, next);
  }
  for (const l of listeners) l();
}

/** Tests: forget every published figure. */
export function resetEnergyFigures(): void {
  byDate.clear();
  for (const l of listeners) l();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** The figures for `date`, null when no run has worked them out. */
export function useEnergyFigures(date: string): EnergyFigures | null {
  return useSyncExternalStore(
    subscribe,
    () => byDate.get(date) ?? null,
    () => byDate.get(date) ?? null,
  );
}

/** The plan's active energy for `date` (kcal), null when Today has not worked it out. */
export function usePlanActiveKcal(date: string): number | null {
  const f = useEnergyFigures(date);
  return f && f.planActiveKcal !== null && f.planActiveKcal > 0 ? f.planActiveKcal : null;
}
