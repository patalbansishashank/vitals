/**
 * The person's own catalogue items (SUITE_SPEC §2.3 `catalogueCustom`, §8.2 "never rejected"): exercises, equipment and
 * foods added by the person, the Coach or the intake ("something else"), merged over the seed with `createCatalogue`.
 * Pure (tier P): the command layer reads and writes the documents; this module validates inputs, builds records and
 * parses stored documents.
 *
 * One document per item (`catalogueCustom/<ULID>`, body `UserItemDoc`). `key` is the natural key (the normalised name):
 * one item per kind and name, so adding the same thing twice returns the first one (the add commands' idempotency on
 * top of the bus ledger). An equipment document with `ref` instead of `item` records that the person owns a seed item
 * they typed by name ("a kettlebell" under "something else").
 */
import { createCatalogue, validateExercise, USER_SOURCE, type CatalogueInput } from './catalogue';
import { draftToRecord, resolveUnknownEquipment, resolveUnknownSync, validateDraft } from './equivalence';
import { exerciseMapping } from './evidence';
import { equipmentIdFor } from './setup';
import { energyText, normName } from './text';
import {
  CARDIO_MODALITIES,
  CONTRA_TAGS,
  EQUIPMENT_CATEGORIES,
  EXERCISE_TAGS,
  INTENSITY_SCALES,
  LOAD_TYPES,
  PATTERNS,
  REGIONS,
  TRADITIONS,
  VOLUME_UNITS,
} from './vocab';
import type {
  Catalogue,
  DefaultDose,
  EquipmentItem,
  ExerciseDraft,
  ExerciseRecord,
  FoodRecord,
  MappingDef,
  MovementPattern,
  NutrientKey,
  Nutrients,
  UserCatalogue,
} from './types';

export type UserItemKind = 'exercise' | 'equipment' | 'food';
export const USER_ITEM_KINDS: readonly UserItemKind[] = ['exercise', 'equipment', 'food'];

/** Body of one `catalogueCustom` record (the stored body). */
export interface UserItemDoc {
  kind: UserItemKind;
  /** Natural key: the normalised name (one item per kind and name). */
  key: string;
  /** The record (absent on a seed reference). */
  item?: ExerciseRecord | EquipmentItem | FoodRecord;
  /** Equipment only: a seed item the person owns (typed by name). */
  ref?: string;
  /** Equipment only: the person has it (default true). */
  owned?: boolean;
  /** Who added it. */
  addedBy?: 'user' | 'ai' | 'agent' | 'system';
}

/** The person's items, parsed and checked (malformed documents are skipped, never thrown on). */
export interface ParsedUserItems {
  catalogue: UserCatalogue;
  /** Equipment ids the person owns through their own documents (custom items and owned seed references). */
  ownedEquipment: string[];
  /** `${kind}:${key}` → the item id (a user item, or the seed id of a reference) and its document id. */
  byKey: ReadonlyMap<string, { id: string; docId: string | null }>;
  /** Every user item id, all kinds. */
  ids: ReadonlySet<string>;
  /** Documents skipped as malformed. */
  skipped: Array<{ docId: string | null; reason: string }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every(isStr) ? (v as string[]) : null);

/** Natural key of an item name. */
export function userItemKey(name: string): string {
  return normName(name);
}

/** A fresh item id for a name (`user-wooden-wheel`, then `-2`, … when taken). */
export function userItemId(name: string, taken: (id: string) => boolean): string {
  const slug = normName(name).replace(/ /g, '-').slice(0, 48).replace(/-+$/, '') || 'item';
  let id = `user-${slug}`;
  for (let n = 2; taken(id); n++) id = `user-${slug}-${n}`;
  return id;
}

/* ------------------------------------------------------------------------------------------- parsing */

function equipmentOk(q: Record<string, unknown>): string | null {
  if (!isStr(q.id) || !/^[a-z0-9_.:-]+$/.test(q.id)) return 'equipment id';
  if (!isStr(q.name) || !q.name.trim()) return 'equipment name';
  if (!(EQUIPMENT_CATEGORIES as readonly unknown[]).includes(q.category)) return 'equipment category';
  if (!Array.isArray(q.enablesPatterns) || !q.enablesPatterns.every((p) => (PATTERNS as readonly unknown[]).includes(p))) return 'equipment patterns';
  if (!isNum(q.priceTier) || !strList(q.aliases) || !strList(q.sources)) return 'equipment fields';
  return null;
}

function foodOk(f: Record<string, unknown>): string | null {
  if (!isStr(f.id) || !isStr(f.name) || !f.name.trim()) return 'food id or name';
  const n = f.per100g;
  if (!isObj(n) || !['energyKcal', 'proteinG', 'fatG', 'carbG'].every((k) => isNum(n[k]) && (n[k] as number) >= 0)) return 'food nutrients';
  if (!strList(f.aliases) || !strList(f.tags) || !Array.isArray(f.portions)) return 'food fields';
  return null;
}

/**
 * Parse `catalogueCustom` bodies (document metadata may be present: `_id` is kept as the document id). Documents are
 * read in id order (ULIDs: oldest first), so when sync merges two items with the same key the first one wins.
 */
export function parseUserItems(docs: ReadonlyArray<Record<string, unknown>>, seed: Pick<Catalogue, 'equipment' | 'sources' | 'exercise' | 'equipmentItem'>): ParsedUserItems {
  const sorted = [...docs].sort((a, b) => String(a._id ?? '').localeCompare(String(b._id ?? '')));
  const byKey = new Map<string, { id: string; docId: string | null }>();
  const ids = new Set<string>();
  const skipped: ParsedUserItems['skipped'] = [];
  const equipment: EquipmentItem[] = [];
  const exercises: ExerciseRecord[] = [];
  const foods: FoodRecord[] = [];
  const owned: string[] = [];
  const pending: Array<{ doc: Record<string, unknown>; docId: string | null; key: string; item: Record<string, unknown> }> = [];
  for (const doc of sorted) {
    const docId = isStr(doc._id) ? doc._id : null;
    if (doc._deleted === true) continue;
    const kind = doc.kind;
    const key = isStr(doc.key) ? doc.key : '';
    if (!(USER_ITEM_KINDS as readonly unknown[]).includes(kind) || !key) {
      skipped.push({ docId, reason: 'kind or key' });
      continue;
    }
    const k = `${kind as string}:${key}`;
    if (byKey.has(k)) continue; // a later duplicate of the same name (merged from another device)
    if (kind === 'equipment' && isStr(doc.ref)) {
      if (!seed.equipmentItem(doc.ref)) {
        skipped.push({ docId, reason: `unknown equipment ${doc.ref}` });
        continue;
      }
      byKey.set(k, { id: doc.ref, docId });
      if (doc.owned !== false) owned.push(doc.ref);
      continue;
    }
    const item = doc.item;
    if (!isObj(item)) {
      skipped.push({ docId, reason: 'no item' });
      continue;
    }
    if (kind === 'equipment') {
      const bad = equipmentOk(item);
      if (bad || seed.equipmentItem(item.id as string) || ids.has(item.id as string)) {
        skipped.push({ docId, reason: bad ?? 'id taken' });
        continue;
      }
      equipment.push(item as unknown as EquipmentItem);
      ids.add(item.id as string);
      byKey.set(k, { id: item.id as string, docId });
      if (doc.owned !== false) owned.push(item.id as string);
    } else pending.push({ doc, docId, key: k, item });
  }
  // exercises and foods after all equipment (an exercise may use a custom item)
  const eqIds = new Set([...seed.equipment.map((q) => q.id), ...equipment.map((q) => q.id)]);
  const sources = new Set(Object.keys(seed.sources).concat(USER_SOURCE.key));
  for (const { doc, docId, key, item } of pending) {
    if (byKey.has(key)) continue;
    if (doc.kind === 'exercise') {
      const id = item.id;
      if (!isStr(id) || seed.exercise(id) || ids.has(id)) {
        skipped.push({ docId, reason: 'exercise id' });
        continue;
      }
      let errors: string[];
      try {
        errors = validateExercise(item as unknown as ExerciseRecord, { equipment: eqIds, sources })
          .filter((i) => i.severity === 'error')
          .map((i) => i.message);
      } catch {
        errors = ['malformed exercise'];
      }
      if (errors.length) {
        skipped.push({ docId, reason: errors[0]! });
        continue;
      }
      exercises.push(item as unknown as ExerciseRecord);
      ids.add(id);
      byKey.set(key, { id, docId });
    } else {
      const bad = foodOk(item);
      if (bad || ids.has(item.id as string)) {
        skipped.push({ docId, reason: bad ?? 'id taken' });
        continue;
      }
      foods.push(item as unknown as FoodRecord);
      ids.add(item.id as string);
      byKey.set(key, { id: item.id as string, docId });
    }
  }
  const mappings = exercises.map(exerciseMapping).filter((m): m is MappingDef => m !== null);
  return { catalogue: { exercises, equipment, foods, mappings }, ownedEquipment: [...new Set(owned)], byKey, ids, skipped };
}

/** The seed catalogue with the person's items merged over it (user entries cannot shadow seed ids: parsing drops them). */
export function personCatalogue(seed: CatalogueInput, user: ParsedUserItems): Catalogue {
  return createCatalogue(seed, user.catalogue);
}

/* ------------------------------------------------------------------------------------------- adding */

export type AddOutcome<T> =
  /** Already in the person's items (same kind and name): nothing to write. */
  | { kind: 'existing'; id: string; name: string }
  /** A seed item of that name: nothing new to define (equipment writes an ownership reference). */
  | { kind: 'seed'; id: string; name: string }
  | { kind: 'new'; key: string; item: T; warnings: string[] }
  | { kind: 'invalid'; issues: string[] };

function nameOf(input: Record<string, unknown>, what: string): string | { issues: string[] } {
  const n = input.name;
  if (!isStr(n) || !n.trim()) return { issues: [`${what}.name is required`] };
  const name = n.trim().replace(/\s+/g, ' ');
  if (name.length > 80) return { issues: [`${what}.name is longer than 80 characters`] };
  return name;
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/**
 * `catalogue.addEquipment`: `{ name, aliases?, category?, patterns? (movement patterns it enables), loadKg?, priceTier?,
 * space?, note?, owned? }`. A name the catalogue knows (seed or the person's own, by name or alias) resolves to that item.
 */
export function buildUserEquipment(input: Record<string, unknown>, o: { catalogue: Catalogue; user: ParsedUserItems }): AddOutcome<EquipmentItem> {
  const name = nameOf(input, 'equipment');
  if (typeof name !== 'string') return { kind: 'invalid', ...name };
  const key = userItemKey(name);
  const mine = o.user.byKey.get(`equipment:${key}`);
  if (mine) return { kind: 'existing', id: mine.id, name: o.catalogue.equipmentItem(mine.id)?.name ?? name };
  const hitId = equipmentIdFor(name, o.catalogue);
  const hit = hitId ? o.catalogue.equipmentItem(hitId) : undefined;
  if (hit) return o.user.ids.has(hit.id) ? { kind: 'existing', id: hit.id, name: hit.name } : { kind: 'seed', id: hit.id, name: hit.name };

  const issues: string[] = [];
  const patternsIn = input.patterns ?? input.enablesPatterns;
  let patterns: MovementPattern[] = [];
  if (patternsIn !== undefined) {
    const list = strList(patternsIn);
    if (!list) issues.push('equipment.patterns must be a list of movement patterns');
    else {
      const bad = list.filter((p) => !(PATTERNS as readonly string[]).includes(p));
      if (bad.length) issues.push(`unknown movement pattern ${bad.join(', ')}`);
      patterns = list.filter((p): p is MovementPattern => (PATTERNS as readonly string[]).includes(p));
    }
  }
  let loadKg: number | undefined;
  if (input.loadKg !== undefined) {
    if (!isNum(input.loadKg) || input.loadKg <= 0 || input.loadKg > 500) issues.push('equipment.loadKg must be a weight in kg');
    else loadKg = input.loadKg;
  }
  const aliases = input.aliases === undefined ? [] : strList(input.aliases);
  if (!aliases) issues.push('equipment.aliases must be a list of names');
  const category = input.category === undefined ? 'improvised' : input.category;
  if (!(EQUIPMENT_CATEGORIES as readonly unknown[]).includes(category)) issues.push(`unknown equipment category ${String(category)}`);
  const tier = input.priceTier === undefined ? 0 : input.priceTier;
  if (!(isNum(tier) && Number.isInteger(tier) && tier >= 0 && tier <= 5)) issues.push('equipment.priceTier must be 0..5');
  const space = input.space === undefined ? 'small' : input.space;
  if (!['none', 'tiny', 'small', 'medium', 'large'].includes(space as string)) issues.push('equipment.space must be none, tiny, small, medium or large');
  if (input.note !== undefined && !isStr(input.note)) issues.push('equipment.note must be text');
  if (input.owned !== undefined && typeof input.owned !== 'boolean') issues.push('equipment.owned must be true or false');
  if (issues.length) return { kind: 'invalid', issues };

  const id = userItemId(name, (x) => o.user.ids.has(x) || !!o.catalogue.equipmentItem(x));
  const base = resolveUnknownEquipment(name, o.catalogue, { id, patterns, ...(loadKg !== undefined ? { loadKg } : {}) });
  const item: EquipmentItem = {
    ...base,
    aliases: uniq((aliases ?? []).map((a) => a.trim()).filter(Boolean)),
    category: category as EquipmentItem['category'],
    priceTier: tier as EquipmentItem['priceTier'],
    space: space as EquipmentItem['space'],
    ...(isStr(input.note) && input.note.trim() ? { note: input.note.trim() } : {}),
  };
  return { kind: 'new', key, item, warnings: patterns.length ? [] : ['No movement patterns given: the item enables no exercise until one names it.'] };
}

const DOSE_KEYS: ReadonlyArray<keyof DefaultDose> = ['sets', 'reps', 'rir', 'restSec', 'holdSec', 'durationSec', 'durationMin', 'rounds', 'workSec', 'secPerRound'];

/**
 * `catalogue.addExercise`: `{ name, description?, …ExerciseDraft fields }`. A name the catalogue knows resolves to that
 * exercise; otherwise the heuristic resolver drafts it from the closest seed template (R3 §8.2: never rejected) and the
 * given fields override the draft. Wrongly typed fields are reported, not silently dropped.
 */
export function buildUserExercise(input: Record<string, unknown>, o: { catalogue: Catalogue; user: ParsedUserItems; origin: 'user' | 'ai-resolved' }): AddOutcome<ExerciseRecord> {
  const name = nameOf(input, 'exercise');
  if (typeof name !== 'string') return { kind: 'invalid', ...name };
  const key = userItemKey(name);
  const mine = o.user.byKey.get(`exercise:${key}`);
  if (mine) return { kind: 'existing', id: mine.id, name: o.catalogue.exercise(mine.id)?.name ?? name };
  if (input.description !== undefined && !isStr(input.description)) return { kind: 'invalid', issues: ['exercise.description must be text'] };
  const description = isStr(input.description) ? input.description.trim() : undefined;
  const resolved = resolveUnknownSync(name, description, o.catalogue);
  if (resolved.resolvedBy === 'catalogue' && resolved.basedOn) {
    const ex = o.catalogue.exercise(resolved.basedOn);
    if (ex) return o.user.ids.has(ex.id) ? { kind: 'existing', id: ex.id, name: ex.name } : { kind: 'seed', id: ex.id, name: ex.name };
  }

  const issues: string[] = [];
  const d: ExerciseDraft = { ...resolved, name, resolvedBy: o.origin === 'user' ? 'user' : 'ai' };
  const inList = (list: readonly string[], v: unknown): boolean => isStr(v) && list.includes(v);
  const field = (k: string, ok: (v: unknown) => boolean, msg: string, set: (v: never) => void): void => {
    if (input[k] === undefined) return;
    if (ok(input[k])) set(input[k] as never);
    else issues.push(`exercise.${k} ${msg}`);
  };
  field('pattern', (v) => inList(PATTERNS, v), 'is not a movement pattern', (v) => (d.pattern = v));
  field('loadType', (v) => inList(LOAD_TYPES, v), 'is not a load type', (v) => (d.loadType = v));
  field('intensityScale', (v) => inList(INTENSITY_SCALES, v), 'is not an intensity scale', (v) => (d.intensityScale = v));
  field('volumeUnit', (v) => inList(VOLUME_UNITS, v), 'is not a volume unit', (v) => (d.volumeUnit = v));
  field('cardioModality', (v) => v === null || inList(CARDIO_MODALITIES, v), 'is not a cardio modality', (v) => (d.cardioModality = v));
  field('metGross', (v) => isNum(v) && v > 0 && v < 25, 'must be a MET between 0 and 25', (v) => (d.metGross = v));
  field('metRange', (v) => Array.isArray(v) && v.length === 2 && v.every(isNum) && (v[0] as number) > 0 && (v[0] as number) <= (v[1] as number), 'must be [low, high] METs', (v) => (d.metRange = v));
  field('hybridCardioShare', (v) => isNum(v) && v >= 0 && v <= 1, 'must be 0..1', (v) => (d.hybridCardioShare = v));
  field('secPerRep', (v) => isNum(v) && v > 0 && v <= 120, 'must be seconds per repetition', (v) => (d.secPerRep = v));
  field('skill', (v) => isNum(v) && Number.isInteger(v) && v >= 1 && v <= 5, 'must be 1..5', (v) => (d.skill = v));
  field('injuryRisk', (v) => isNum(v) && Number.isInteger(v) && v >= 1 && v <= 5, 'must be 1..5', (v) => (d.injuryRisk = v));
  field('mechanism', (v) => isStr(v) && v.trim().length > 0, 'must be text', (v: string) => (d.mechanism = v.trim()));
  field('aliases', (v) => strList(v) !== null, 'must be a list of names', (v: string[]) => (d.aliases = uniq(v.map((a) => a.trim()).filter(Boolean))));
  field('mobilityTargets', (v) => strList(v) !== null, 'must be a list', (v: string[]) => (d.mobilityTargets = v));
  field('contraTags', (v) => strList(v) !== null && (v as string[]).every((t) => CONTRA_TAGS.includes(t as never)), 'has an unknown tag', (v) => (d.contraTags = v));
  field(
    'regions',
    (v) => isObj(v) && Object.entries(v).every(([r, w]) => REGIONS.includes(r as never) && isNum(w) && w > 0 && w <= 1),
    'must map training regions to 0.5 or 1',
    (v) => (d.regions = { ...(v as Record<string, number>) }),
  );
  field(
    'defaultDose',
    (v) => isObj(v) && Object.entries(v).every(([k, x]) => DOSE_KEYS.includes(k as keyof DefaultDose) && isNum(x) && x >= 0),
    'has an unknown field or a negative value',
    (v) => (d.defaultDose = { ...(v as DefaultDose) }),
  );
  if (input.equipmentAnyOf !== undefined) {
    const alts = Array.isArray(input.equipmentAnyOf) ? input.equipmentAnyOf.map(strList) : null;
    if (!alts || alts.some((a) => a === null)) issues.push('exercise.equipmentAnyOf must be a list of equipment-id lists');
    else {
      const unknown = uniq((alts as string[][]).flat().filter((q) => !o.catalogue.equipmentItem(q)));
      if (unknown.length) issues.push(`unknown equipment ${unknown.join(', ')} (add it with catalogue.addEquipment first)`);
      else d.equipmentAnyOf = (alts as string[][]).length ? (alts as string[][]) : [[]];
    }
  }
  const tradition = input.tradition;
  if (tradition !== undefined && !inList(TRADITIONS, tradition)) issues.push('exercise.tradition is not a training tradition');
  const tags = input.tags === undefined ? [] : strList(input.tags);
  if (!tags || !tags.every((t) => EXERCISE_TAGS.includes(t as never))) issues.push('exercise.tags has an unknown tag');
  if (d.loadType === 'cardio' && d.cardioModality === null) d.cardioModality = 'other';
  issues.push(...validateDraft(d));
  if (issues.length) return { kind: 'invalid', issues };

  const id = userItemId(name, (x) => o.user.ids.has(x) || !!o.catalogue.exercise(x));
  const rec0 = draftToRecord(d, { id, origin: o.origin });
  const record: ExerciseRecord = {
    ...rec0,
    ...(isStr(tradition) ? { tradition: tradition as ExerciseRecord['tradition'] } : {}),
    ...(tags && tags.length ? { tags: uniq(tags) as ExerciseRecord['tags'] } : {}),
  };
  const errors = validateExercise(record, { equipment: new Set(o.catalogue.equipment.map((q) => q.id)), sources: new Set(Object.keys(o.catalogue.sources)) })
    .filter((i) => i.severity === 'error')
    .map((i) => i.message);
  if (errors.length) return { kind: 'invalid', issues: errors };
  const warnings = resolved.resolvedBy === 'heuristic' && resolved.confidence < 0.5 ? [`Counted like ${resolved.basedOn ?? 'the closest exercise'} until you say more about it.`] : [];
  return { kind: 'new', key, item: record, warnings };
}

const NUTRIENT_KEYS: readonly NutrientKey[] = [
  'energyKcal', 'proteinG', 'fatG', 'carbG', 'fibreG', 'sugarsG', 'satFatG', 'mufaG', 'pufaG', 'epaG', 'dhaG', 'alaG', 'cholesterolMg', 'waterG',
  'alcoholG', 'caffeineMg', 'sodiumMg', 'potassiumMg', 'calciumMg', 'ironMg', 'magnesiumMg', 'zincMg', 'b12Ug', 'folateDfeUg', 'vitDUg', 'vitCMg',
  'vitARaeUg', 'leucineG', 'lysineG',
];

/**
 * `catalogue.addFood`: `{ name, per100g: { energyKcal, proteinG, fatG, carbG, fibreG?, … }, aliases?, group?, tags?,
 * portions?: [{ label, g }], state? }` (from a label or the person; stored unverified). Energy that disagrees with the
 * macros by more than 25 % is kept with a warning (labels round, and some count sugar alcohols).
 */
export function buildUserFood(input: Record<string, unknown>, o: { user: ParsedUserItems; foods: ReadonlyArray<Pick<FoodRecord, 'id' | 'name' | 'aliases'>> }): AddOutcome<FoodRecord> {
  const name = nameOf(input, 'food');
  if (typeof name !== 'string') return { kind: 'invalid', ...name };
  const key = userItemKey(name);
  const mine = o.user.byKey.get(`food:${key}`);
  if (mine) return { kind: 'existing', id: mine.id, name };
  const known = o.foods.find((f) => normName(f.name) === key || f.aliases.some((a) => normName(a) === key));
  if (known) return o.user.ids.has(known.id) ? { kind: 'existing', id: known.id, name: known.name } : { kind: 'seed', id: known.id, name: known.name };

  const issues: string[] = [];
  const n = input.per100g;
  const per100g: Partial<Nutrients> = {};
  if (!isObj(n)) issues.push('food.per100g is required (nutrients per 100 g)');
  else {
    for (const [k, v] of Object.entries(n)) {
      if (!NUTRIENT_KEYS.includes(k as NutrientKey)) issues.push(`unknown nutrient ${k}`);
      else if (!isNum(v) || v < 0) issues.push(`food.per100g.${k} must be a number ≥ 0`);
      else per100g[k as NutrientKey] = v;
    }
    for (const k of ['energyKcal', 'proteinG', 'fatG', 'carbG'] as const) if (per100g[k] === undefined && n[k] === undefined) issues.push(`food.per100g.${k} is required`);
  }
  const p = per100g as Nutrients;
  if (!issues.length) {
    if (p.proteinG + p.fatG + p.carbG + (p.alcoholG ?? 0) > 105) issues.push('protein, fat and carbohydrate add up to more than 100 g per 100 g');
    if (p.energyKcal > 902) issues.push('energy above 900 kcal (3 770 kJ) per 100 g');
    if ((p.fibreG ?? 0) > p.carbG + 0.5) issues.push('fibre is part of carbohydrate (carbohydrate by difference) and cannot exceed it');
  }
  const portions: Array<{ label: string; g: number }> = [];
  if (input.portions !== undefined) {
    if (!Array.isArray(input.portions) || !input.portions.every((x) => isObj(x) && isStr(x.label) && x.label.trim() && isNum(x.g) && x.g > 0 && x.g <= 5000))
      issues.push('food.portions must be [{ label, g }]');
    else for (const x of input.portions as Array<{ label: string; g: number }>) portions.push({ label: x.label.trim(), g: x.g });
  }
  const aliases = input.aliases === undefined ? [] : strList(input.aliases);
  if (!aliases) issues.push('food.aliases must be a list of names');
  const tags = input.tags === undefined ? [] : strList(input.tags);
  if (!tags) issues.push('food.tags must be a list');
  if (input.group !== undefined && !isStr(input.group)) issues.push('food.group must be text');
  const state = input.state === undefined ? 'as-eaten' : input.state;
  if (!['raw', 'cooked', 'as-eaten'].includes(state as string)) issues.push('food.state must be raw, cooked or as-eaten');
  if (issues.length) return { kind: 'invalid', issues };

  const fibre = p.fibreG ?? 0;
  const atwater = 4 * p.proteinG + 9 * p.fatG + 4 * Math.max(0, p.carbG - fibre) + 2 * fibre + 7 * (p.alcoholG ?? 0);
  const warnings = Math.abs(p.energyKcal - atwater) > Math.max(40, 0.25 * atwater) ? [`The energy (${energyText(p.energyKcal)}) does not match the macros (about ${energyText(atwater)}); kept as given.`] : [];
  const id = userItemId(name, (x) => o.user.ids.has(x) || o.foods.some((f) => f.id === x));
  const item: FoodRecord = {
    id,
    name,
    aliases: uniq((aliases ?? []).map((a) => a.trim()).filter(Boolean)),
    group: isStr(input.group) && input.group.trim() ? input.group.trim() : 'other',
    tags: uniq(tags ?? []),
    source: 'user',
    verified: false,
    state: state as FoodRecord['state'],
    portions,
    per100g: p,
    sources: [USER_SOURCE.key],
  };
  return { kind: 'new', key, item, warnings };
}
