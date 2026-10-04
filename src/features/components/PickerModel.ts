/**
 * Pure helpers of the catalogue picker: region defaults applied to a value, chip text, which entries belong in
 * "added by you", and free-text results turned into entries.
 */
import { customId, isCustomId, regionDefaults, type KitchenCatalogue, type KitchenKind, type ParsedItem } from '@/catalogues/kitchen';
import type { PickerEntry, PickerValue } from './PickerTypes';

/** Longest chip text with a note ("OTG oven · small, 28 L"); the full text goes in the title and accessible name. */
export const CHIP_MAX = 32;

/** "North India (Punjab, …)" → "North India". */
export function shortRegion(label: string): string {
  const i = label.indexOf(' (');
  return i > 0 ? label.slice(0, i) : label;
}

export function truncate(text: string, max = CHIP_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The value with the region's pre-ticked items added as `assumed` (first view, or after "Use another region").
 * Earlier assumed entries are replaced; entries the person touched stay.
 */
export function withRegionDefaults(cat: KitchenCatalogue, kind: KitchenKind, regions: readonly string[], value: PickerValue): PickerEntry[] {
  const kept = value.filter((e) => !e.assumed);
  const have = new Set(kept.map((e) => e.id));
  const pre = regionDefaults(cat, regions, kind).preTick.filter((id) => !have.has(id));
  return [...kept, ...pre.map((id) => ({ id, assumed: true }))];
}

/** Ids of every catalogue item of a kind. */
export function kindIds(cat: KitchenCatalogue, kind: KitchenKind): Set<string> {
  return new Set(cat.groups(kind).flatMap((g) => g.items.map((i) => i.id)));
}

/** Entries shown in "added by you": the person's own words, Coach additions, and ids outside this kind's groups. */
export function isAdded(entry: PickerEntry, ids: ReadonlySet<string>): boolean {
  return isCustomId(entry.id) || entry.source === 'coach' || entry.label !== undefined || !ids.has(entry.id);
}

/** Parsed free text → entries (matched ids keep the person's words in `label`; pantry keeps the quantity as the note). */
export function entriesFromParsed(items: readonly ParsedItem[], kind: KitchenKind, source: 'picker' | 'paste'): PickerEntry[] {
  return items.map((p) => ({
    id: p.id ?? customId(p.label),
    label: p.label,
    source,
    ...(kind === 'pantry' && p.qty ? { note: p.qty.slice(0, 80) } : {}),
  }));
}

/** Append entries whose id is not in the value yet. */
export function addEntries(value: PickerValue, add: readonly PickerEntry[]): PickerEntry[] {
  const have = new Set(value.map((e) => e.id));
  const out = [...value];
  for (const e of add) {
    if (have.has(e.id)) continue;
    have.add(e.id);
    out.push(e);
  }
  return out;
}

/** Split a string around the (case-insensitive) query for the bold match. */
export function splitMatch(text: string, query: string): [string, string, string] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const at = text.toLowerCase().indexOf(q);
  if (at < 0) return null;
  return [text.slice(0, at), text.slice(at, at + q.length), text.slice(at + q.length)];
}
