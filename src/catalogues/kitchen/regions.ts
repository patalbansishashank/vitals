/**
 * Regional defaults (R12 §4.2), pure. Three tiers per region: `preTick` (ticked on first view, one tap removes it),
 * `defaults` ("common here": shown first in each group, not ticked) and everything else. Two regions combine as the
 * union, ordered by the first. Perishable pantry items are never pre-ticked (R12 §4.2); the seed lists 13 in `preTick`, which are
 * dropped here and stay "common here".
 */
import type { KitchenCatalogue } from './catalogue';
import type { KitchenKind, SeedCuisine, SeedPantry } from './types';

export const WESTERN_GENERIC = 'western-generic';

export interface RegionDefaults {
  /** Ticked on first view, in region order. */
  preTick: string[];
  /** Common in the region (includes `preTick`), in region order. */
  common: string[];
}

export function regionDefaults(cat: KitchenCatalogue, regionIds: readonly string[], kind: KitchenKind): RegionDefaults {
  const pre: string[] = [];
  const common: string[] = [];
  const seenPre = new Set<string>();
  const seenCommon = new Set<string>();
  for (const rid of regionIds) {
    const r = cat.region(rid);
    if (!r) continue;
    for (const id of r.preTick[kind] ?? []) {
      const item = cat.get(id);
      if (!item || seenPre.has(id) || (kind === 'pantry' && (item as SeedPantry).perishable)) continue;
      seenPre.add(id);
      pre.push(id);
    }
    for (const id of r.defaults[kind] ?? []) {
      if (seenCommon.has(id) || !cat.get(id)) continue;
      seenCommon.add(id);
      common.push(id);
    }
  }
  return { preTick: pre, common };
}

/**
 * The region to start from (R12 §4.2): the person's own choice; else the region of the first-ranked cuisine (its
 * `regions[0]`, walking up the parent chain when a sub-cuisine names none); else `western-generic` outside India and
 * none inside India (an Indian kitchen with no clue pre-ticks nothing rather than guess the wrong state).
 */
export function chooseRegions(cat: KitchenCatalogue, input: { chosen?: readonly string[]; cuisines?: readonly string[]; india: boolean }): string[] {
  const chosen = (input.chosen ?? []).filter((r) => cat.region(r));
  if (chosen.length) return [...new Set(chosen)];
  for (const cid of input.cuisines ?? []) {
    let c = cat.get(cid) as SeedCuisine | undefined;
    for (let depth = 0; c && depth < 4; depth++) {
      const r = c.regions?.find((x) => cat.region(x));
      if (r) return [r];
      c = c.parent ? (cat.get(c.parent) as SeedCuisine | undefined) : undefined;
    }
  }
  return input.india ? [] : [WESTERN_GENERIC];
}

/** Ids of a kind ordered for display inside their group: common-in-region first (region order), then seed order. */
export function orderForRegion(ids: readonly string[], common: readonly string[]): string[] {
  const rank = new Map(common.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
}
