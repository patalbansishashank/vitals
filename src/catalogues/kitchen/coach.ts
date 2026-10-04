/**
 * What the Coach gets from the kitchen and pantry (SUITE_SPEC §13.3), pure: the briefing's kitchen block (≤ 250 tokens)
 * and the recipe tool's constraints. Labels come from the catalogue (custom items keep the person's words); notes and
 * "owned, not used" are kept so an OTG size or an unused soda maker reaches the model.
 */
import type { KitchenCatalogue } from './catalogue';
import { foodKey } from './food';
import type { KitchenDoc, PantryDoc } from './types';

export interface RecipeConstraints {
  /** Equipment the person has (labels), used or not. */
  equipment: string[];
  /** label → note ("small, 28 L"; "owned, not used now"). */
  equipmentNotes: Record<string, string>;
  /** Ranked, most often first. */
  cuisines: string[];
  staples: string[];
  /** What is in the kitchen now (labels, de-duplicated against staples by food link). */
  pantry: string[];
  /** Recipes should mostly use pantry items (true when a pantry exists). */
  preferPantry: boolean;
  timeBudgetMin?: number;
  /** Cooking skill 1–5 when known. */
  skill?: number;
}

export const BRIEFING_PANTRY_MAX = 60;
/** ≈ 4 characters a token: the block stays ≤ 250 tokens. */
export const KITCHEN_BLOCK_MAX_CHARS = 1000;

export function labelOf(cat: KitchenCatalogue | null, id: string, label?: string): string {
  const item = cat?.get(id);
  if (item) return item.label;
  return label ?? id.replace(/^custom:/, '').replace(/-/g, ' ');
}

export function recipeConstraints(cat: KitchenCatalogue | null, kitchen: KitchenDoc, pantry: PantryDoc, extra: { timeBudgetMin?: number; skill?: number } = {}): RecipeConstraints {
  const equipment: string[] = [];
  const equipmentNotes: Record<string, string> = {};
  for (const e of kitchen.equipment) {
    const l = labelOf(cat, e.id, e.label);
    equipment.push(l);
    const notes = [e.note, e.use === 'ownNotUsed' ? 'owned, not used now' : undefined].filter(Boolean);
    if (notes.length) equipmentNotes[l] = notes.join('; ');
  }
  const cuisines = [...kitchen.cuisines].sort((a, b) => a.rank - b.rank).map((c) => labelOf(cat, c.id, c.label));
  const staples = kitchen.staples.map((s) => labelOf(cat, s.id, s.label));
  const seen = new Set<string>();
  const pantryLabels: string[] = [];
  for (const p of pantry.items) {
    const key = cat ? foodKey(cat, p.id) : p.id;
    if (seen.has(key)) continue;
    seen.add(key);
    pantryLabels.push(`${labelOf(cat, p.id, p.label)}${p.qtyApprox ? ` (${p.qtyApprox})` : ''}`);
  }
  return {
    equipment,
    equipmentNotes,
    cuisines,
    staples,
    pantry: pantryLabels,
    preferPantry: pantry.items.length > 0,
    ...(extra.timeBudgetMin !== undefined ? { timeBudgetMin: extra.timeBudgetMin } : {}),
    ...(extra.skill !== undefined ? { skill: extra.skill } : {}),
  };
}

/** The slice of the `kitchen.get` / `pantry.get` views the briefing block reads (labels already resolved). */
export interface KitchenBlockInput {
  equipment: ReadonlyArray<{ id: string; label: string; note?: string; use: 'use' | 'ownNotUsed'; custom?: boolean }>;
  cuisines: ReadonlyArray<{ label: string; rank: number }>;
  staples: ReadonlyArray<{ label: string }>;
}
export interface PantryBlockInput {
  items: ReadonlyArray<{ label: string; qtyApprox?: string }>;
}

/**
 * The briefing's kitchen block, or null when nothing is known: equipment as "label (id; note; not used)" so the Coach can
 * name it and pass the id to `kitchen_add`, the top 3 cuisines, staples, ≤ 60 pantry labels; ≤ 1000 characters
 * (≈ 250 tokens), longest lists cut first.
 */
export function kitchenBlockFromViews(k: KitchenBlockInput, p: PantryBlockInput): string | null {
  if (!k.equipment.length && !k.cuisines.length && !k.staples.length && !p.items.length) return null;
  const eq = k.equipment.map((e) => {
    const bits = [e.custom || e.id.startsWith('custom:') ? 'own item' : e.id, e.note, e.use === 'ownNotUsed' ? 'not used' : undefined].filter(Boolean);
    return `${e.label} (${bits.join('; ')})`;
  });
  const cu = [...k.cuisines].sort((a, b) => a.rank - b.rank).slice(0, 3).map((c) => c.label);
  const pa = p.items.slice(0, BRIEFING_PANTRY_MAX).map((i) => (i.qtyApprox ? `${i.label} (${i.qtyApprox})` : i.label));
  const lines = [
    'Kitchen (use it in recipes; ask before assuming anything else):',
    eq.length ? `Equipment: ${eq.join(', ')}.` : 'Equipment: not told.',
    cu.length ? `Cuisines, most often first: ${cu.join(', ')}.` : '',
    k.staples.length ? `Staples: ${k.staples.map((x) => x.label).join(', ')}.` : '',
    pa.length ? `In the kitchen now: ${pa.join(', ')}${p.items.length > pa.length ? ` (+${p.items.length - pa.length} more)` : ''}.` : '',
  ].filter(Boolean);
  return clip(lines, KITCHEN_BLOCK_MAX_CHARS);
}

/** `recipeConstraints` over the `kitchen.get` / `pantry.get` views (the Coach's recipe tool reads these). */
export function recipeConstraintsFromViews(k: KitchenBlockInput | null, p: PantryBlockInput | null, extra: { timeBudgetMin?: number; skill?: number } = {}): RecipeConstraints {
  const equipmentNotes: Record<string, string> = {};
  for (const e of k?.equipment ?? []) {
    const notes = [e.note, e.use === 'ownNotUsed' ? 'owned, not used now' : undefined].filter(Boolean);
    if (notes.length) equipmentNotes[e.label] = notes.join('; ');
  }
  const seen = new Set<string>();
  const pantry: string[] = [];
  for (const i of p?.items ?? []) {
    const key = i.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pantry.push(i.qtyApprox ? `${i.label} (${i.qtyApprox})` : i.label);
  }
  return {
    equipment: (k?.equipment ?? []).map((e) => e.label),
    equipmentNotes,
    cuisines: [...(k?.cuisines ?? [])].sort((a, b) => a.rank - b.rank).map((c) => c.label),
    staples: (k?.staples ?? []).map((x) => x.label),
    pantry,
    preferPantry: pantry.length > 0,
    ...(extra.timeBudgetMin !== undefined ? { timeBudgetMin: extra.timeBudgetMin } : {}),
    ...(extra.skill !== undefined ? { skill: extra.skill } : {}),
  };
}

/** `kitchenBlockFromViews` over the stored documents and the catalogue (labels from the catalogue). */
export function kitchenBriefingBlock(cat: KitchenCatalogue | null, kitchen: KitchenDoc, pantry: PantryDoc): string | null {
  return kitchenBlockFromViews(
    {
      equipment: kitchen.equipment.map((e) => ({ id: e.id, label: labelOf(cat, e.id, e.label), ...(e.note ? { note: e.note } : {}), use: e.use, custom: !cat?.get(e.id) })),
      cuisines: kitchen.cuisines.map((c) => ({ label: labelOf(cat, c.id, c.label), rank: c.rank })),
      staples: kitchen.staples.map((s) => ({ label: labelOf(cat, s.id, s.label) })),
    },
    { items: pantry.items.map((i) => ({ label: labelOf(cat, i.id, i.label), ...(i.qtyApprox ? { qtyApprox: i.qtyApprox } : {}) })) },
  );
}

/** Join lines and cut the longest list lines until the text fits (each cut line ends with "…"). */
function clip(lines: string[], max: number): string {
  let text = lines.join('\n');
  const out = [...lines];
  while (text.length > max) {
    let longest = 1;
    for (let i = 1; i < out.length; i++) if (out[i]!.length > out[longest]!.length) longest = i;
    const l = out[longest]!;
    const over = text.length - max;
    const keep = Math.max(20, l.length - over - 2);
    if (keep >= l.length - 1) break;
    out[longest] = `${l.slice(0, keep).replace(/,[^,]*$/, '')}, …`;
    text = out.join('\n');
  }
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
