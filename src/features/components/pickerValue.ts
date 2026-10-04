/**
 * Picker value ⇄ command inputs and command views (pure). The screens keep the picker controlled with these and write
 * through `kitchen.set` / `pantry.add` only.
 */
import type { KitchenKind } from '@/catalogues/kitchen';
import type { PickerEntry, PickerValue } from './PickerTypes';

/** The slice of the `kitchen.get` view the picker needs. */
export interface KitchenViewLike {
  equipment: ReadonlyArray<{ id: string; label: string; note?: string; use: 'use' | 'ownNotUsed'; custom: boolean; source?: 'picker' | 'coach' | 'paste' }>;
  cuisines: ReadonlyArray<{ id: string; label: string; rank: number }>;
  staples: ReadonlyArray<{ id: string; label: string; custom: boolean; source?: 'picker' | 'coach' | 'paste' }>;
  regions: readonly string[];
}
export interface PantryViewLike {
  items: ReadonlyArray<{ id: string; label: string; qtyApprox?: string; custom: boolean; source?: 'picker' | 'coach' | 'paste' }>;
}

export function pickerFromKitchen(view: KitchenViewLike, kind: Exclude<KitchenKind, 'pantry'>): PickerEntry[] {
  if (kind === 'equipment') return view.equipment.map((e) => ({ id: e.id, ...(e.custom ? { label: e.label } : {}), ...(e.note ? { note: e.note } : {}), ...(e.use === 'ownNotUsed' ? { ownNotUsed: true } : {}), ...(e.source ? { source: e.source } : {}) }));
  if (kind === 'cuisines') return [...view.cuisines].sort((a, b) => a.rank - b.rank).map((c) => ({ id: c.id, ...(c.id.startsWith('custom:') ? { label: c.label } : {}) }));
  return view.staples.map((s) => ({ id: s.id, ...(s.custom ? { label: s.label } : {}), ...(s.source ? { source: s.source } : {}) }));
}

export function pickerFromPantry(view: PantryViewLike): PickerEntry[] {
  return view.items.map((p) => ({ id: p.id, ...(p.custom ? { label: p.label } : {}), ...(p.qtyApprox ? { note: p.qtyApprox } : {}), ...(p.source ? { source: p.source } : {}) }));
}

/** `kitchen.set` input for one list. */
export function pickerToKitchenInput(kind: Exclude<KitchenKind, 'pantry'>, value: PickerValue): Record<string, unknown> {
  if (kind === 'equipment') return { equipment: value.map((e) => ({ id: e.id, ...(e.label ? { label: e.label } : {}), note: e.note ?? '', use: e.ownNotUsed ? 'ownNotUsed' : 'use', ...(e.source ? { source: e.source } : {}) })) };
  if (kind === 'cuisines') return { cuisines: value.map((c, i) => ({ id: c.id, rank: i + 1, ...(c.label ? { label: c.label } : {}) })) };
  return { staples: value.map((s) => ({ id: s.id, ...(s.label ? { label: s.label } : {}), ...(s.source ? { source: s.source } : {}) })) };
}

/** `pantry.add` input replacing the whole list (the picker). */
export function pickerToPantryInput(value: PickerValue): { items: Array<{ id: string; label: string; qtyApprox?: string }>; replace: true } {
  return { items: value.map((p) => ({ id: p.id, label: p.label ?? p.id, ...(p.note ? { qtyApprox: p.note } : {}) })), replace: true };
}
