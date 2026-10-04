/**
 * Meal slots of a day's prescription and the logged meals that belong to them. Pure.
 */
import type { LogEntrySummary, PrescribedDaySnapshot } from '@/living';
import { mealName } from '../format';
import { entrySlot } from './ledger';
import type { MealSlotTarget } from './recipes';

/** The prescription's meal slots as recipe targets. */
export function slotTargets(rx: PrescribedDaySnapshot | null): MealSlotTarget[] {
  if (!rx) return [];
  return rx.meals.map((m) => ({ slot: m.slot, name: mealName(m.slot, m.clockH), clockH: m.clockH, energyKcal: m.energyKcal, proteinG: m.proteinG, carbG: m.carbG, fatG: m.fatG }));
}

/** Clock hour inside an eating window (windows may cross midnight). */
export function inWindow(h: number, w: { startH: number; endH: number }): boolean {
  return w.endH > w.startH ? h >= w.startH && h < w.endH : h >= w.startH || h < w.endH;
}

/** A fast day: the prescription holds a fast, or no meals at all. */
export function isFastDay(rx: PrescribedDaySnapshot | null): boolean {
  return !!rx && (!!rx.fast || rx.meals.length === 0);
}

/** Slots shown on the day: on a fast day, slots outside the eating window are hidden. */
export function visibleSlots(rx: PrescribedDaySnapshot | null, slots: readonly MealSlotTarget[]): MealSlotTarget[] {
  if (rx?.fast && rx.window) return slots.filter((s) => inWindow(s.clockH, rx.window!));
  return [...slots];
}

/** Meal entries by slot (the entry's slot, else the slot at the same clock time); the rest are "other food". */
export function groupEntries(entries: readonly LogEntrySummary[], slots: readonly MealSlotTarget[]): { bySlot: Map<string, LogEntrySummary[]>; other: LogEntrySummary[] } {
  const bySlot = new Map<string, LogEntrySummary[]>();
  const other: LogEntrySummary[] = [];
  for (const e of entries) {
    if (e.kind !== 'meal') continue;
    const named = entrySlot(e);
    const slot = (named && slots.find((s) => s.slot === named)) || (e.clockH !== undefined ? slots.find((s) => Math.abs(s.clockH - e.clockH!) < 1e-6) : undefined);
    if (slot) bySlot.set(slot.slot, [...(bySlot.get(slot.slot) ?? []), e]);
    else other.push(e);
  }
  return { bySlot, other };
}
