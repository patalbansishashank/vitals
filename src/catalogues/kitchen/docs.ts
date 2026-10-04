/**
 * The kitchen and pantry documents (SUITE_SPEC §13.3), pure: empty values, sanitising a stored body, the list edits the
 * commands apply, the "still have it?" rule and the one-time migration from the v0.2 intake answers.
 *
 * No automatic expiry: nothing is removed by time. `staleItems` only names items the Coach may ask about.
 */
import { customId } from './parse';
import type { EquipmentUse, KitchenCuisineEntry, KitchenDoc, KitchenEquipmentEntry, KitchenSource, KitchenStapleEntry, PantryDoc, PantryEntry } from './types';

export const EMPTY_KITCHEN: KitchenDoc = Object.freeze({ _schema: 1, equipment: [], cuisines: [], staples: [] }) as KitchenDoc;
export const EMPTY_PANTRY: PantryDoc = Object.freeze({ _schema: 1, items: [] }) as PantryDoc;
/** "Still have it?" after this many days without a confirmation. */
export const STALE_DAYS = 14;
export const NOTE_MAX = 80;
export const MAX_ITEMS = 1000;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 120): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const SOURCES: readonly KitchenSource[] = ['picker', 'coach', 'paste'];
const source = (v: unknown): KitchenSource => (SOURCES.includes(v as KitchenSource) ? (v as KitchenSource) : 'picker');
const ID = /^(?:(?:eq|cu|st|pa)\.[a-z0-9_]+|custom:[a-z0-9-]+)$/;
export const isKitchenId = (id: unknown): id is string => typeof id === 'string' && id.length <= 64 && ID.test(id);

/* ------------------------------------------------------------------------------------------- sanitising */

export function toKitchenDoc(raw: unknown): KitchenDoc {
  if (!isRec(raw)) return { ...EMPTY_KITCHEN, equipment: [], cuisines: [], staples: [] };
  const equipment: KitchenEquipmentEntry[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(raw.equipment) ? raw.equipment : []) {
    if (!isRec(e) || !isKitchenId(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    const label = str(e.label);
    const note = str(e.note, NOTE_MAX);
    equipment.push({ id: e.id, ...(label ? { label } : {}), ...(note ? { note } : {}), use: e.use === 'ownNotUsed' ? 'ownNotUsed' : 'use', addedAt: str(e.addedAt, 40) ?? '1970-01-01T00:00:00.000Z', source: source(e.source) });
  }
  const cuisines = rankCuisines((Array.isArray(raw.cuisines) ? raw.cuisines : []).filter((c): c is KitchenCuisineEntry => isRec(c) && isKitchenId(c.id)));
  const staples: KitchenStapleEntry[] = [];
  seen.clear();
  for (const s of Array.isArray(raw.staples) ? raw.staples : []) {
    if (!isRec(s) || !isKitchenId(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    const label = str(s.label);
    staples.push({ id: s.id, source: source(s.source), ...(label ? { label } : {}) });
  }
  const regions = Array.isArray(raw.regions) ? raw.regions.filter((r): r is string => typeof r === 'string' && r.length <= 40).slice(0, 4) : undefined;
  return { _schema: 1, equipment, cuisines, staples, ...(regions?.length ? { regions } : {}) };
}

export function toPantryDoc(raw: unknown): PantryDoc {
  if (!isRec(raw)) return { _schema: 1, items: [] };
  const items: PantryEntry[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(raw.items) ? raw.items : []) {
    if (!isRec(p) || !isKitchenId(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    const label = str(p.label);
    const qty = str(p.qtyApprox, 40);
    const conf = str(p.lastConfirmedAt, 40);
    items.push({ id: p.id, ...(label ? { label } : {}), ...(qty ? { qtyApprox: qty } : {}), source: source(p.source), addedAt: str(p.addedAt, 40) ?? '1970-01-01T00:00:00.000Z', ...(conf ? { lastConfirmedAt: conf } : {}) });
  }
  return { _schema: 1, items: items.slice(0, MAX_ITEMS) };
}

/** Ranks 1..n in the given order (ties keep input order). */
function rankCuisines(list: ReadonlyArray<{ id: string; rank?: number; label?: string }>): KitchenCuisineEntry[] {
  const seen = new Set<string>();
  return [...list]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.rank ?? a.i + 1) - (b.c.rank ?? b.i + 1) || a.i - b.i)
    .filter(({ c }) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map(({ c }, i) => ({ id: c.id, rank: i + 1, ...(str(c.label) ? { label: str(c.label)! } : {}) }));
}

/* -------------------------------------------------------------------------------------------- list edits */

export interface EquipmentInput {
  id: string;
  label?: string;
  note?: string;
  use?: EquipmentUse;
  source?: KitchenSource;
}

/** Replace whole lists (the picker); entries already present keep `addedAt` unless the input changes them. */
export function setKitchenLists(
  doc: KitchenDoc,
  input: { equipment?: readonly EquipmentInput[]; cuisines?: ReadonlyArray<{ id: string; rank?: number; label?: string }>; staples?: ReadonlyArray<{ id: string; label?: string; source?: KitchenSource }>; regions?: readonly string[] },
  now: string,
): KitchenDoc {
  const next: KitchenDoc = { ...doc };
  if (input.equipment) {
    const before = new Map(doc.equipment.map((e) => [e.id, e]));
    const seen = new Set<string>();
    next.equipment = [];
    for (const e of input.equipment) {
      if (!isKitchenId(e.id) || seen.has(e.id)) continue;
      seen.add(e.id);
      const old = before.get(e.id);
      const label = str(e.label) ?? old?.label;
      const note = e.note !== undefined ? str(e.note, NOTE_MAX) : old?.note;
      next.equipment.push({ id: e.id, ...(label ? { label } : {}), ...(note ? { note } : {}), use: e.use ?? old?.use ?? 'use', addedAt: old?.addedAt ?? now, source: e.source ?? old?.source ?? 'picker' });
    }
  }
  if (input.cuisines) next.cuisines = rankCuisines(input.cuisines.filter((c) => isKitchenId(c.id)));
  if (input.staples) {
    const before = new Map(doc.staples.map((s) => [s.id, s]));
    const seen = new Set<string>();
    next.staples = [];
    for (const s of input.staples) {
      if (!isKitchenId(s.id) || seen.has(s.id)) continue;
      seen.add(s.id);
      const old = before.get(s.id);
      const label = str(s.label) ?? old?.label;
      next.staples.push({ id: s.id, source: s.source ?? old?.source ?? 'picker', ...(label ? { label } : {}) });
    }
  }
  if (input.regions) {
    const regions = [...new Set(input.regions.filter((r) => typeof r === 'string' && r.length <= 40))].slice(0, 4);
    if (regions.length) next.regions = regions;
    else delete next.regions;
  }
  return next;
}

/** Add equipment (the Coach's "I also have a soda maker"): new ids are appended, known ones get the note/use given. */
export function addEquipment(doc: KitchenDoc, items: readonly EquipmentInput[], now: string): KitchenDoc {
  const list = doc.equipment.map((e) => ({ ...e }));
  const at = new Map(list.map((e, i) => [e.id, i]));
  for (const it of items) {
    if (!isKitchenId(it.id)) continue;
    const i = at.get(it.id);
    const note = it.note !== undefined ? str(it.note, NOTE_MAX) : undefined;
    if (i !== undefined) {
      const cur = list[i]!;
      list[i] = { ...cur, ...(note ? { note } : {}), ...(it.use ? { use: it.use } : {}), ...(str(it.label) && !cur.label ? { label: str(it.label)! } : {}) };
      continue;
    }
    const label = str(it.label);
    at.set(it.id, list.length);
    list.push({ id: it.id, ...(label ? { label } : {}), ...(note ? { note } : {}), use: it.use ?? 'use', addedAt: now, source: it.source ?? 'picker' });
  }
  return { ...doc, equipment: list.slice(0, MAX_ITEMS) };
}

export interface PantryInput {
  id: string;
  label?: string;
  qtyApprox?: string;
  source?: KitchenSource;
}

/**
 * Add pantry items; an item already there is confirmed again (`lastConfirmedAt = now`) and its quantity text updated,
 * so the Coach's "I have X at home" and the picker converge on one entry per id.
 */
export function addPantry(doc: PantryDoc, items: readonly PantryInput[], now: string): PantryDoc {
  const list = doc.items.map((p) => ({ ...p }));
  const at = new Map(list.map((p, i) => [p.id, i]));
  for (const it of items) {
    if (!isKitchenId(it.id)) continue;
    const qty = str(it.qtyApprox, 40);
    const i = at.get(it.id);
    if (i !== undefined) {
      list[i] = { ...list[i]!, lastConfirmedAt: now, ...(qty ? { qtyApprox: qty } : {}) };
      continue;
    }
    const label = str(it.label);
    at.set(it.id, list.length);
    list.push({ id: it.id, ...(label ? { label } : {}), ...(qty ? { qtyApprox: qty } : {}), source: it.source ?? 'picker', addedAt: now });
  }
  return { _schema: 1, items: list.slice(0, MAX_ITEMS) };
}

export function removePantry(doc: PantryDoc, ids: readonly string[]): PantryDoc {
  const drop = new Set(ids);
  return { _schema: 1, items: doc.items.filter((p) => !drop.has(p.id)) };
}

/** Replace the pantry with exactly these ids (the picker), keeping the stamps of items that stay. */
export function setPantry(doc: PantryDoc, items: readonly PantryInput[], now: string): PantryDoc {
  const keep = new Set(items.map((i) => i.id));
  return addPantry({ _schema: 1, items: doc.items.filter((p) => keep.has(p.id)) }, items.filter((i) => !doc.items.some((p) => p.id === i.id)), now);
}

/** Items the Coach may ask "still have it?" about (never removed): last confirmation (or addition) older than `days`. */
export function staleItems(doc: PantryDoc, now: string, opts: { days?: number; only?: (id: string) => boolean } = {}): PantryEntry[] {
  const limit = Date.parse(now) - (opts.days ?? STALE_DAYS) * 86_400_000;
  return doc.items.filter((p) => Date.parse(p.lastConfirmedAt ?? p.addedAt) < limit && (opts.only ? opts.only(p.id) : true));
}

/** A label typed by the person → its entry id: the catalogue id when given, else `custom:<slug>`. */
export const entryId = (label: string, id?: string | null): string => (id && isKitchenId(id) ? id : customId(label));

/* ----------------------------------------------------------------------------- migration from intake v0.2 */

/** v0.2 intake option ids → R12 ids (R12 §3 "Mapping from today's intake ids"). */
export const LEGACY_IDS = {
  cuisine: {
    north_indian: 'cu.north_indian',
    south_indian: 'cu.south_indian',
    gujarati: 'cu.gujarati',
    bengali: 'cu.bengali',
    maharashtrian: 'cu.maharashtrian',
    punjabi: 'cu.punjabi',
    kerala: 'cu.kerala',
    goan: 'cu.goan',
    indo_chinese: 'cu.indo_chinese',
    mediterranean: 'cu.mediterranean',
    american: 'cu.american',
    british: 'cu.british',
    mexican: 'cu.mexican',
    east_asian: 'cu.east_asian',
    middle_eastern: 'cu.middle_eastern',
  } as Record<string, string>,
  kitchen: {
    pressure_cooker: 'eq.pressure_cooker_medium',
    tawa: 'eq.tawa',
    kadhai: 'eq.kadhai',
    gas_2burner: 'eq.gas_stove_2',
    induction: 'eq.induction',
    mixer_grinder: 'eq.mixer_grinder',
    idli_steamer: 'eq.idli_steamer',
    microwave: 'eq.microwave',
    otg_oven: 'eq.otg',
    oven: 'eq.oven_builtin',
    air_fryer: 'eq.air_fryer',
    rice_cooker: 'eq.rice_cooker',
    instant_pot: 'eq.instant_pot',
    slow_cooker: 'eq.slow_cooker',
    blender: 'eq.blender',
    grill: 'eq.grill_bbq',
    fridge: 'eq.fridge_single',
    freezer: 'eq.chest_freezer',
    kitchen_scale: 'eq.kitchen_scale',
  } as Record<string, string>,
  grain: { rice: 'st.rice_white_generic', wheat_roti: 'st.atta', millet: 'st.jowar', bread: 'st.bread_white', pasta: 'st.pasta_dry', oats: 'st.oats_rolled' } as Record<string, string>,
  fat: { mustard: 'st.mustard_oil', groundnut: 'st.groundnut_oil', coconut: 'st.coconut_oil', ghee: 'st.ghee', olive: 'st.olive_oil', sunflower: 'st.sunflower_oil', butter: 'st.butter' } as Record<string, string>,
  pantry: {
    atta: 'st.atta',
    rice: 'st.rice_white_generic',
    poha: 'st.poha',
    rava: 'st.rava_sooji',
    besan: 'st.chickpea_flour',
    dal: 'st.toor_dal',
    rajma: 'st.rajma',
    chole: 'st.kabuli_chana',
    oats: 'st.oats_rolled',
    bread: 'pa.bread_white',
    pasta: 'st.pasta_dry',
    eggs: 'pa.eggs',
    milk: 'pa.milk_full',
    curd: 'pa.curd',
    paneer: 'pa.paneer',
  } as Record<string, string>,
};

const legacy = (table: Record<string, string>, v: unknown): string | null => (typeof v === 'string' ? (table[v] ?? (isKitchenId(v) ? v : null)) : null);

/**
 * `intake/me.kitchen` and `diet.cuisines` / `diet.staples` (v0.2) → the two documents. Unknown values are dropped
 * (`other` cuisine is free text in v0.2 and had no content). Returns null for a kind with nothing to migrate.
 */
export function migrateFromIntake(intake: unknown, now: string): { kitchen: KitchenDoc | null; pantry: PantryDoc | null } {
  if (!isRec(intake)) return { kitchen: null, pantry: null };
  const diet = isRec(intake.diet) ? intake.diet : {};
  const kit = isRec(intake.kitchen) ? intake.kitchen : {};
  const equipment = (Array.isArray(kit.equipment) ? kit.equipment : []).map((v) => legacy(LEGACY_IDS.kitchen, v)).filter((x): x is string => !!x);
  const cuisines = (Array.isArray(diet.cuisines) ? diet.cuisines : []).map((v) => legacy(LEGACY_IDS.cuisine, v)).filter((x): x is string => !!x);
  const st = isRec(diet.staples) ? diet.staples : {};
  const staples = [
    ...(Array.isArray(st.grain) ? st.grain : []).map((v) => legacy(LEGACY_IDS.grain, v)),
    ...(Array.isArray(st.fat) ? st.fat : []).map((v) => legacy(LEGACY_IDS.fat, v)),
  ].filter((x): x is string => !!x);
  const pantryItems: PantryInput[] = [];
  for (const p of Array.isArray(kit.pantry) ? kit.pantry : []) {
    if (!isRec(p) || p.have === false) continue;
    const id = legacy(LEGACY_IDS.pantry, p.foodId);
    if (id) pantryItems.push({ id, ...(str(p.qtyApprox, 40) ? { qtyApprox: str(p.qtyApprox, 40)! } : {}) });
  }
  const kitchen = equipment.length || cuisines.length || staples.length ? setKitchenLists(EMPTY_KITCHEN, { equipment: equipment.map((id) => ({ id })), cuisines: cuisines.map((id) => ({ id })), staples: staples.map((id) => ({ id })) }, now) : null;
  const confirmed = new Map<string, string>();
  for (const p of Array.isArray(kit.pantry) ? kit.pantry : []) if (isRec(p) && typeof p.confirmedAt === 'string') confirmed.set(legacy(LEGACY_IDS.pantry, p.foodId) ?? '', p.confirmedAt);
  const pantry = pantryItems.length
    ? { _schema: 1 as const, items: addPantry(EMPTY_PANTRY, pantryItems, now).items.map((p) => ({ ...p, addedAt: confirmed.get(p.id) ?? now })) }
    : null;
  return { kitchen, pantry };
}
