/**
 * The interaction table (SUITE_SPEC §13.5.2), generated from the four research JSON files by
 * `scripts/markers/build-interactions.ts` (never edited by hand; `__tests__/interactions.test.ts` checks it equals a
 * fresh build). The plan view, the Coach and the Evidence library all read this one table.
 *
 * Only the parts the rule engine needs (`markers`, `rules`) are imported here, by name, so the bundler leaves the
 * lever-by-lever `interactions` rows (≈ 56 kB gzip) out of every chunk that only evaluates rules; `loadInteractions`
 * loads them on demand.
 */
import { generatedFrom, markers, rules, schema } from './interactions.json';
import type { Interaction, InteractionRule, InteractionTable, MarkerId, MarkerMeta } from './types';

export const TABLE = { schema, generatedFrom, markers, rules } as unknown as Omit<InteractionTable, 'interactions'>;

const RULES = new Map<string, InteractionRule>(TABLE.rules.map((r) => [r.id, r]));
const META = new Map<MarkerId, MarkerMeta>(TABLE.markers.map((m) => [m.markerId, m]));

export const ruleById = (id: string): InteractionRule | undefined => RULES.get(id);
export const metaOf = (id: MarkerId): MarkerMeta | undefined => META.get(id);
export const rulesOf = (id: MarkerId): InteractionRule[] => TABLE.rules.filter((r) => r.markerId === id);

/** The whole table, interaction rows included (loaded on demand). */
export async function loadInteractionTable(): Promise<InteractionTable> {
  const m = await import('./interactions.json');
  return m.default as unknown as InteractionTable;
}
export const interactionsOf = async (id: MarkerId): Promise<Interaction[]> => (await loadInteractionTable()).interactions.filter((i) => i.markerId === id);
