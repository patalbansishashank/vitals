import { formatCardEntry, parseCardEntry, sanitizeTodayCards } from '@/state/settingsStore';
import type { CardSize, LibrarySelection } from '@/components';

export const DEFAULT_TODAY_CARDS = ['eaten', 'energy', 'sleep', 'steps', 'weight'] as const;
export interface CardDefinition {
  id: string;
  sizes: readonly CardSize[];
  defaultSize: CardSize;
}

/**
 * Cards that became another card (r087: "Energy burned" was the Energy card under a second title). A saved layout keeps
 * its place and size under the new id; when both are saved, the first one in the list stays.
 */
const RENAMED_CARDS: Readonly<Record<string, string>> = { 'energy-burned': 'energy' };

/** Availability never changes the saved choice: a hidden card returns when its data does. */
export function resolveTodayCards(
  stored: string[] | null,
  definitions: readonly CardDefinition[],
): LibrarySelection[] {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const seen = new Set<string>();
  return (sanitizeTodayCards(stored) ?? [...DEFAULT_TODAY_CARDS]).flatMap((entry) => {
    const parsed = parseCardEntry(entry);
    const id = parsed ? (RENAMED_CARDS[parsed.id] ?? parsed.id) : null;
    const def = id !== null ? byId.get(id) : undefined;
    if (!parsed || !def || id === 'hero' || seen.has(def.id)) return [];
    seen.add(def.id);
    const size = parsed.size && def.sizes.includes(parsed.size as CardSize) ? parsed.size : def.defaultSize;
    return [{ id: def.id, ...(def.sizes.length > 1 ? { size } : {}) }];
  });
}

export function storeTodayCards(
  selected: readonly LibrarySelection[],
  definitions: readonly CardDefinition[],
): string[] {
  return resolveTodayCards(selected.map(formatCardEntry), definitions).map(formatCardEntry);
}
