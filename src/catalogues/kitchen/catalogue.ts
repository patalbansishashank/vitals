/**
 * The kitchen catalogue as an indexed object (pure): lookups by id, groups in seed order, validation of the seed's
 * cross-references (R12 §1), and the group labels shown on screen.
 */
import { KIND_PREFIX, KITCHEN_KINDS, type KitchenItem, type KitchenKind, type KitchenSeed, type SeedCuisine, type SeedEquipment, type SeedPantry, type SeedRegion, type SeedStaple } from './types';

export interface KitchenGroup {
  id: string;
  label: string;
  items: readonly KitchenItem[];
}

export interface KitchenCatalogue {
  readonly seed: KitchenSeed;
  get(id: string): KitchenItem | undefined;
  kindOf(id: string): KitchenKind | null;
  list(kind: KitchenKind): readonly KitchenItem[];
  /** Groups of a kind in seed order (cuisines: Indian split into regional and community lists, design F5). */
  groups(kind: KitchenKind): readonly KitchenGroup[];
  region(id: string): SeedRegion | undefined;
  regions(): readonly SeedRegion[];
}

/** Plain group names (design F5/F7/F7b/F7c). */
export const GROUP_LABEL: Readonly<Record<string, string>> = {
  // equipment
  cooking: 'cooking',
  prep: 'prep',
  storage: 'storage',
  serving: 'serving',
  // cuisines
  'indian-region': 'Indian, by region',
  'indian-community': 'Indian, by community and tradition',
  indian: 'Indian',
  'south-asian': 'South Asian',
  european: 'European',
  'east-asian': 'East Asian',
  'southeast-asian': 'Southeast Asian',
  'middle-eastern': 'Middle Eastern',
  americas: 'the Americas',
  african: 'African',
  oceania: 'Oceania',
  global: 'everyday and global',
  // staples
  'grains-flours': 'grains and flours',
  'pulses-legumes': 'pulses and legumes',
  proteins: 'proteins',
  'dairy-alternatives': 'dairy and alternatives',
  'oils-fats': 'oils and fats',
  'nuts-seeds': 'nuts and seeds',
  sweeteners: 'sweeteners',
  'everyday-produce': 'everyday vegetables',
  // pantry
  vegetables: 'vegetables',
  fruit: 'fruit',
  'dairy-cheese': 'dairy and cheese',
  'eggs-meat': 'eggs and meat',
  'fish-seafood': 'fish and seafood',
  'breads-bakery': 'breads and bakery',
  'condiments-sauces': 'condiments and sauces',
  'spices-masalas': 'spices and masalas',
  'pickles-chutneys': 'pickles and chutneys',
  beverages: 'drinks',
  'frozen-ready': 'frozen and ready',
  baking: 'baking',
  'herbs-fresh': 'fresh herbs',
};

export const groupLabel = (g: string): string => GROUP_LABEL[g] ?? g.replace(/-/g, ' ');

/**
 * Indian cuisines that name a place (top level, or a parent that is itself regional) go in "by region"; those tied to
 * a community, a religion or a practice (Parsi, Bohri, Jain, sattvic, vrat, Anglo-Indian, Irani café …) in "by
 * community". Ids are from the seed; a cuisine not listed here falls into "by region".
 */
const COMMUNITY = new Set([
  'cu.parsi',
  'cu.irani_cafe',
  'cu.sindhi',
  'cu.bohri',
  'cu.anglo_indian',
  'cu.indo_chinese',
  'cu.tibetan_indian',
  'cu.jain',
  'cu.sattvic',
  'cu.vrat',
  'cu.indian_street',
  'cu.delhi_street',
  'cu.mumbai_street',
  'cu.kashmiri_pandit',
  'cu.wazwan',
  'cu.goan_catholic',
  'cu.goan_hindu',
  'cu.syrian_christian',
  'cu.east_indian_bombay',
  'cu.tamil_brahmin',
  'cu.kerala_sadya',
  'cu.marwari',
]);

function cuisineGroup(c: SeedCuisine): string {
  if (c.group !== 'indian') return c.group;
  return COMMUNITY.has(c.id) ? 'indian-community' : 'indian-region';
}

export function createKitchenCatalogue(seed: KitchenSeed): KitchenCatalogue {
  const byId = new Map<string, KitchenItem>();
  const kind = new Map<string, KitchenKind>();
  for (const k of KITCHEN_KINDS) {
    for (const it of seed[k] as readonly KitchenItem[]) {
      byId.set(it.id, it);
      kind.set(it.id, k);
    }
  }
  const regions = new Map(seed.regions.map((r) => [r.id, r]));
  const groupCache = new Map<KitchenKind, KitchenGroup[]>();
  const groups = (k: KitchenKind): KitchenGroup[] => {
    const hit = groupCache.get(k);
    if (hit) return hit;
    const order: string[] = [];
    const map = new Map<string, KitchenItem[]>();
    for (const it of seed[k] as readonly KitchenItem[]) {
      const g = k === 'cuisines' ? cuisineGroup(it as SeedCuisine) : it.group;
      if (!map.has(g)) {
        map.set(g, []);
        order.push(g);
      }
      map.get(g)!.push(it);
    }
    if (k === 'cuisines') order.sort((a, b) => (a === 'indian-region' ? -1 : b === 'indian-region' ? 1 : a === 'indian-community' ? -1 : b === 'indian-community' ? 1 : 0));
    const out = order.map((g) => ({ id: g, label: groupLabel(g), items: map.get(g)! }));
    groupCache.set(k, out);
    return out;
  };
  return {
    seed,
    get: (id) => byId.get(id),
    kindOf: (id) => kind.get(id) ?? null,
    list: (k) => seed[k] as readonly KitchenItem[],
    groups,
    region: (id) => regions.get(id),
    regions: () => seed.regions,
  };
}

/**
 * Problems with the seed (empty = valid): unique ids, prefixes, region references, preTick ⊆ defaults, parents, fixtures.
 * Perishable pantry items in a region's `preTick` are not an error: the R12 seed has 13 of them (parmesan, avocado …);
 * `regionDefaults` leaves them unticked, as R12 §4.2 says ("perishable pantry items are never pre-ticked").
 */
export function validateKitchenSeed(seed: KitchenSeed, fixtureIds?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const regionIds = new Set(seed.regions.map((r) => r.id));
  const ids = new Map<KitchenKind, Set<string>>();
  for (const k of KITCHEN_KINDS) {
    const set = new Set<string>();
    ids.set(k, set);
    for (const it of seed[k] as readonly KitchenItem[]) {
      if (seen.has(it.id)) errors.push(`duplicate id ${it.id}`);
      seen.add(it.id);
      set.add(it.id);
      if (!it.id.startsWith(KIND_PREFIX[k])) errors.push(`${it.id}: ${k} ids start with ${KIND_PREFIX[k]}`);
      if (!it.label.trim()) errors.push(`${it.id}: empty label`);
      if (!it.group) errors.push(`${it.id}: no group`);
      if (!Array.isArray(it.aliases)) errors.push(`${it.id}: aliases is not a list`);
      const regs = k === 'cuisines' ? (it as SeedCuisine).regions : (it as SeedEquipment | SeedStaple | SeedPantry).regionDefault;
      for (const r of regs ?? []) if (!regionIds.has(r)) errors.push(`${it.id}: unknown region ${r}`);
      const ref = (it as SeedStaple).foodRef;
      if (ref) {
        if (ref.usdaFdcId !== undefined && (!Number.isInteger(ref.usdaFdcId) || ref.usdaFdcId <= 0)) errors.push(`${it.id}: bad usdaFdcId`);
        if (ref.usdaFdcId !== undefined && !ref.usdaDescription) errors.push(`${it.id}: usdaFdcId without its description`);
        if (ref.fixtureId && fixtureIds && !fixtureIds.has(ref.fixtureId)) errors.push(`${it.id}: unknown fixture food ${ref.fixtureId}`);
        if (ref.usdaFdcId === undefined && !ref.fixtureId && !ref.ifctPending) errors.push(`${it.id}: empty food link`);
      }
    }
  }
  for (const c of seed.cuisines) if (c.parent && !ids.get('cuisines')!.has(c.parent)) errors.push(`${c.id}: unknown parent ${c.parent}`);
  for (const r of seed.regions) {
    for (const k of KITCHEN_KINDS) {
      const defaults = new Set(r.defaults[k] ?? []);
      for (const id of r.defaults[k] ?? []) if (!ids.get(k)!.has(id)) errors.push(`${r.id}: default ${id} is not a ${k} id`);
      for (const id of r.preTick[k] ?? []) {
        if (!ids.get(k)!.has(id)) errors.push(`${r.id}: preTick ${id} is not a ${k} id`);
        if (!defaults.has(id)) errors.push(`${r.id}: preTick ${id} is not in its defaults`);
      }
    }
  }
  return errors;
}
