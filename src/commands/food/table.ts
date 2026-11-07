/**
 * The one shared food provider (D6-05): the frozen bundled reference (`FOOD_REFERENCE`, exact FDC rows) merged with the
 * person's own foods from `catalogueCustom` (`catalogue.addFood` documents and legacy bodies carrying `per100g`). Every
 * record — bundled, custom, cached or synced — passes the same validator (`validateFoodRecord`); malformed custom
 * records are quarantined (`foodTableIssues`), never normalised into arithmetic. A custom food with a reference id
 * overrides it explicitly; logged meals keep their own frozen composition snapshots, so neither an override nor a new
 * reference release rewrites history. The food commands, the kitchen matching and the Food screen read this table.
 * Tests may pin a table (`setFoodTable`); the test fixture is never the production base.
 */
import { createValidatedFoodTable } from '@/catalogues/foods';
import { userFoodsFromDocs } from '@/catalogues/user';
import type { FoodTable } from '@/catalogues/types';
import { contentHash } from '@/lib/bodyContracts';
import { FOOD_REFERENCE, FOOD_REFERENCE_VERSION } from '@/content/catalogues/foods.reference'; // not the index: it builds the whole seed catalogue
import { getDocumentStore } from '@/state/runtime';

let pinned: FoodTable | null = null;
let reference: FoodTable | null = null;
let lastIssues: ReadonlyArray<{ id: string | null; docId?: string | null; issues: readonly string[] }> = [];

/** Tests: use this table instead of the bundled one (null restores the default). */
export function setFoodTable(t: FoodTable | null): void {
  pinned = t;
}

/** The bundled reference alone (validated once; a malformed bundled row is a build error, not a quarantine). */
export function referenceFoodTable(): FoodTable {
  if (!reference) {
    const v = createValidatedFoodTable(FOOD_REFERENCE, FOOD_REFERENCE_VERSION);
    if (v.quarantined.length > 0) throw new Error(`food reference: invalid rows ${v.quarantined.map((q) => q.id).join(', ')}`);
    reference = v.table;
  }
  return reference;
}

/**
 * The bundled table plus the person's custom foods (synchronous read of the document cache). The version names the
 * reference and a hash of the custom records, so a snapshot records which custom composition it was taken from.
 */
export function foodTable(): FoodTable {
  const base = pinned ?? referenceFoodTable();
  const { foods, skipped } = userFoodsFromDocs(getDocumentStore().peekAll<Record<string, unknown>>('catalogueCustom') as Array<Record<string, unknown>>);
  const ids = new Set(foods.map((f) => f.id));
  const merged = createValidatedFoodTable([...base.all().filter((f) => !ids.has(f.id)), ...foods], foods.length ? `${base.version}+user:${contentHash(foods)}` : base.version);
  lastIssues = [...skipped.map((s) => ({ id: null, docId: s.docId, issues: [s.reason] })), ...merged.quarantined];
  return foods.length === 0 && merged.quarantined.length === 0 ? base : merged.table;
}

/** Custom food records the last `foodTable()` read quarantined (malformed or duplicate), with their issues. */
export function foodTableIssues(): ReadonlyArray<{ id: string | null; docId?: string | null; issues: readonly string[] }> {
  return lastIssues;
}
