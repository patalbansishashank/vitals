/**
 * The recipe's "Needs: pressure cooker, tawa" line (pure): which of the recipe's equipment the person's kitchen does
 * not seem to have. A recipe item counts as owned when a kitchen label names it (case-insensitive, either way round:
 * "Pressure cooker, medium (5 L)" covers "pressure cooker") or when the catalogue resolves it to an owned item
 * ("kadai" → "Kadhai (wok-like pan)"). Without a kitchen list nothing is called missing.
 */
import { ACCEPT_AT, searchKitchen, type KitchenIndex } from '@/catalogues/kitchen';

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** `a` contains `b` as whole words. */
const containsWords = (a: string, b: string): boolean => !!b && ` ${a} `.includes(` ${b} `);

export function equipmentLine(recipeEquipment: readonly string[], kitchenLabels: readonly string[], index: KitchenIndex | null): { needs: string[]; missing: string[] } {
  const needs = [...new Set(recipeEquipment.map((e) => e.trim()).filter(Boolean))];
  if (!kitchenLabels.length) return { needs, missing: [] };
  const owned = kitchenLabels.map(norm).filter(Boolean);
  const ownedSet = new Set(owned);
  const has = (name: string): boolean => {
    const n = norm(name);
    if (!n) return true;
    if (owned.some((o) => o === n || containsWords(o, n) || containsWords(n, o))) return true;
    if (!index) return false;
    return searchKitchen(index, name, { kinds: ['equipment'], min: ACCEPT_AT, limit: 5 }).some((h) => ownedSet.has(norm(h.item.label)));
  };
  return { needs, missing: needs.filter((n) => !has(n)) };
}
