/**
 * The food table the `food.*` and meal-logging executors compute with: the bundled foods (today the E8 test fixture;
 * the curated USDA/IFCT bundle is a later data task, docs/CATALOGUES.md) merged with the person's own foods from
 * `catalogueCustom` (documents carrying `per100g`; user entries win on id clashes). Tests may pin a table.
 */
import { createFoodTable } from '@/catalogues';
import type { FoodRecord, FoodTable } from '@/catalogues/types';
import { FOOD_FIXTURE } from '@/content/catalogues/foods.fixture'; // not the index: it builds the whole seed catalogue
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';

let pinned: FoodTable | null = null;

/** Tests: use this table instead of the bundled one (null restores the default). */
export function setFoodTable(t: FoodTable | null): void {
  pinned = t;
}

const isFood = (b: Record<string, unknown>): boolean => typeof b.name === 'string' && !!b.per100g && typeof b.per100g === 'object';

/** The bundled table plus the person's custom foods (synchronous read of the document cache). */
export function foodTable(): FoodTable {
  const base = pinned ?? createFoodTable(FOOD_FIXTURE, 'fixture');
  const custom = getDocumentStore()
    .peekAll<Record<string, unknown>>('catalogueCustom')
    .map((d) => ({ ...bodyOf<Record<string, unknown>>(d), id: (bodyOf<Record<string, unknown>>(d).id as string | undefined) ?? d._id }))
    .filter(isFood)
    .map((b) => ({ aliases: [], group: 'other', tags: [], source: 'user', verified: false, state: 'as-eaten', portions: [], sources: [], ...b }) as unknown as FoodRecord);
  if (custom.length === 0) return base;
  const ids = new Set(custom.map((f) => f.id));
  return createFoodTable([...base.all().filter((f) => !ids.has(f.id)), ...custom], `${base.version}+user`);
}
