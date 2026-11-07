import { formatCardEntry, parseCardEntry, sanitizeTodayCards } from '@/state/settingsStore';
import type { CardSize, LibrarySelection } from '@/components';

export const DEFAULT_TODAY_CARDS = ['eaten', 'energy', 'sleep', 'steps', 'weight'] as const;
export interface CardDefinition {
  id: string;
  sizes: readonly CardSize[];
  defaultSize: CardSize;
}

/** Availability never changes the saved choice: a hidden card returns when its data does. */
export function resolveTodayCards(
  stored: string[] | null,
  definitions: readonly CardDefinition[],
): LibrarySelection[] {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  return (sanitizeTodayCards(stored) ?? [...DEFAULT_TODAY_CARDS]).flatMap((entry) => {
    const parsed = parseCardEntry(entry);
    const def = parsed && byId.get(parsed.id);
    if (!parsed || !def || parsed.id === 'hero') return [];
    const size = parsed.size && def.sizes.includes(parsed.size as CardSize) ? parsed.size : def.defaultSize;
    return [{ id: parsed.id, ...(def.sizes.length > 1 ? { size } : {}) }];
  });
}

export function storeTodayCards(
  selected: readonly LibrarySelection[],
  definitions: readonly CardDefinition[],
): string[] {
  return resolveTodayCards(selected.map(formatCardEntry), definitions).map(formatCardEntry);
}
