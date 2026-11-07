/**
 * Meal slots of a day's prescription and the logged meals that belong to them. Pure.
 */
import type { LogEntrySummary, PrescribedDaySnapshot, TodayView } from '@/living';
import { mealName } from '../format';
import type { MealSlotTarget } from './recipes';

/** The slot an entry was logged against, when it was. */
export function entrySlot(e: LogEntrySummary): string | undefined {
  return e.slot;
}

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

/** The slot an entry's words name ("breakfast", "Lunch as planned"), case-insensitive. */
function slotNamed(label: string, slots: readonly MealSlotTarget[]): MealSlotTarget | undefined {
  const l = label.trim().toLowerCase();
  return slots.find((s) => {
    const names = [s.name.toLowerCase(), s.slot.toLowerCase()];
    return names.some((n) => l === n || l === `${n} as planned`);
  });
}

/**
 * Meal entries by slot: the entry's slot, else the slot at the same clock time, else the slot its words name (a typed
 * "breakfast" belongs to Breakfast, not to "Other food"). The rest are "other food" (snacks and real extras).
 */
export function groupEntries(entries: readonly LogEntrySummary[], slots: readonly MealSlotTarget[]): { bySlot: Map<string, LogEntrySummary[]>; other: LogEntrySummary[] } {
  const bySlot = new Map<string, LogEntrySummary[]>();
  const other: LogEntrySummary[] = [];
  for (const e of entries) {
    if (e.kind !== 'meal') continue;
    const named = entrySlot(e);
    const slot =
      (named && slots.find((s) => s.slot === named)) ||
      // a meal logged as "breakfast" belongs to the plan's breakfast even when the plan names its slots meal1, meal2…
      (named && slots.find((s) => s.name.toLowerCase() === named.toLowerCase())) ||
      (e.clockH !== undefined ? slots.find((s) => Math.abs(s.clockH - e.clockH!) < 1e-6) : undefined) ||
      slotNamed(e.label, slots);
    if (slot) bySlot.set(slot.slot, [...(bySlot.get(slot.slot) ?? []), e]);
    else other.push(e);
  }
  return { bySlot, other };
}

/**
 * The entry's words inside its slot: nothing when they only repeat the slot ("dinner" under Dinner), the rest when they
 * start with it ("lunch as planned" under Lunch → "as planned"), else the words as logged.
 */
export function labelInSlot(label: string, slotName?: string): string | null {
  if (!slotName) return label;
  const l = label.trim();
  const n = slotName.trim().toLowerCase();
  if (l.toLowerCase() === n) return null;
  return l.toLowerCase().startsWith(`${n} `) ? l.slice(n.length + 1) : l;
}

/**
 * The meal entries one slot holds on a day, grouped as Today's row, Food's row and the meal sheet group them: what the
 * person sees under the meal, so what an answer to it replaces.
 */
export function slotEntries(view: Pick<TodayView, 'prescription' | 'logged'> | null | undefined, slot: string): LogEntrySummary[] {
  if (!view) return [];
  const rx = view.prescription;
  return groupEntries(view.logged.entries, visibleSlots(rx, slotTargets(rx))).bySlot.get(slot) ?? [];
}
