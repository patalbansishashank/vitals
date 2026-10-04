/**
 * Hard food filters and meal targets (R4 §1.1, §3.1, §3.5): which foods are allowed on a date and slot, and what each
 * meal slot asks for. Pure: the executors pass the person's rules, the day's prescription and the food table.
 */
import { netCarbPer100g } from '@/catalogues';
import type { FoodRecord, FoodTable } from '@/catalogues/types';
import { matchScore } from '@/catalogues/text';
import { weekdayOf, type PrescribedDaySnapshot } from '@/living';
import type { DietRules, FoodSetup } from './context';

/** The Food screen's `MealSlotTarget` (src/features/living/food/recipes.ts) plus the day rule. */
export interface MealSlotTarget {
  slot: string;
  name: string;
  clockH: number;
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG?: number;
  /** Low-carbohydrate day: net carbohydrate ≤ target + 5 g is a hard ceiling (R4 §3.5). */
  lowCarbDay?: boolean;
}

/** Low-carbohydrate (keto, PSMF) day: the prescription's carbohydrate ≤ 50 g, or the day type says so. */
export function isLowCarbDay(rx: PrescribedDaySnapshot | null): boolean {
  if (!rx) return false;
  return rx.macros.carbG <= 50 || /psmf|keto|low.?carb/i.test(rx.dayType);
}

/** PSMF day (protein-sparing modified fast): low carbohydrate and low fat. */
export function isPsmfDay(rx: PrescribedDaySnapshot | null): boolean {
  if (!rx) return false;
  return /psmf/i.test(rx.dayType) || (rx.macros.carbG <= 50 && rx.macros.fatG <= 40 && rx.energyKcal <= 1200);
}

function mealName(clockH: number): string {
  if (clockH < 11) return 'breakfast';
  if (clockH < 15.5) return 'lunch';
  if (clockH < 18.5) return 'snack';
  return 'dinner';
}

function inWindow(h: number, w: { startH: number; endH: number }): boolean {
  return w.endH > w.startH ? h >= w.startH && h < w.endH : h >= w.startH || h < w.endH;
}

/** Per-meal targets of a prescription (slots outside a fast day's eating window are dropped). */
export function slotTargets(rx: PrescribedDaySnapshot | null): MealSlotTarget[] {
  if (!rx) return [];
  const low = isLowCarbDay(rx);
  const totalE = rx.meals.reduce((s, m) => s + m.energyKcal, 0);
  return rx.meals
    .filter((m) => !(rx.fast && rx.window) || inWindow(m.clockH, rx.window!))
    .map((m) => ({
      slot: m.slot,
      name: mealName(m.clockH),
      clockH: m.clockH,
      energyKcal: m.energyKcal,
      proteinG: m.proteinG,
      carbG: m.carbG,
      fatG: m.fatG,
      ...(rx.macros.fibreG > 0 && totalE > 0 ? { fibreG: Math.round(((rx.macros.fibreG * m.energyKcal) / totalE) * 10) / 10 } : {}),
      ...(low ? { lowCarbDay: true } : {}),
    }));
}

const ALLERGEN_TAGS: Readonly<Record<string, readonly string[]>> = {
  milk: ['dairy', 'milk'],
  egg: ['egg'],
  'gluten-cereals': ['gluten'],
  fish: ['fish'],
  crustacean: ['shellfish', 'crustacean'],
  mollusc: ['shellfish', 'mollusc'],
  peanut: ['peanut'],
  'tree-nut': ['tree_nut', 'tree-nut', 'nut'],
  soy: ['soy'],
  sesame: ['sesame'],
  mustard: ['mustard'],
  celery: ['celery'],
  lupin: ['lupin'],
  sulphite: ['sulphite'],
};
const MEAT_TAGS = ['meat', 'chicken', 'mutton', 'beef', 'pork', 'fish', 'shellfish', 'seafood'];

/** Why a food is not allowed under the rules (null = allowed). */
export function excludedBy(f: FoodRecord, o: { diet: DietRules | null; date: string; rx: PrescribedDaySnapshot | null }): string | null {
  const tags = new Set(f.tags);
  const has = (...t: string[]) => t.some((x) => tags.has(x));
  const d = o.diet;
  if (d) {
    const a = d.animalFoods;
    if (a.meat === 'none' && has('meat', 'chicken', 'mutton', 'beef', 'pork')) return 'diet: no meat';
    if (!a.chicken && has('chicken')) return 'diet: no chicken';
    if (!a.mutton && has('mutton')) return 'diet: no mutton';
    if (!a.beef && has('beef')) return 'diet: no beef';
    if (!a.pork && has('pork')) return 'diet: no pork';
    if (!a.fish && has('fish')) return 'diet: no fish';
    if (!a.shellfish && has('shellfish', 'crustacean', 'mollusc')) return 'diet: no shellfish';
    if (a.eggs !== 'yes' && has('egg')) return 'diet: no eggs';
    if (a.dairy === 'none' && has('dairy')) return 'diet: no dairy';
    if (a.dairy === 'ghee_only' && has('dairy') && f.id !== 'ghee' && !f.aliases.includes('ghee')) return 'diet: dairy only as ghee';
    if (!a.honey && has('honey')) return 'diet: no honey';
    for (const al of d.allergies) if (has(al, ...(ALLERGEN_TAGS[al] ?? []))) return `allergy: ${al}`;
    for (const al of d.allergiesOther) if (al.trim() && matchScore(al, [f.name, ...f.aliases]) >= 0.5) return `allergy: ${al}`;
    if (d.medicalDiet.includes('coeliac') && has('gluten')) return 'medical diet: coeliac';
    if ((d.noOnionGarlic || d.jain?.noOnionGarlic) && has('onion_garlic', 'onion', 'garlic')) return 'rule: no onion or garlic';
    if (d.jain?.noRootVeg && has('root', 'root_veg')) return 'Jain: no root vegetables';
    if (d.jain?.noHoney && has('honey')) return 'Jain: no honey';
    if (d.jain?.noFermented && has('fermented')) return 'Jain: no fermented food';
    if (d.jain?.noMushroom && has('mushroom')) return 'Jain: no mushroom';
    if ((d.halal || d.kosher) && has('pork')) return d.halal ? 'halal' : 'kosher';
    const wd = (weekdayOf(o.date) + 1) % 7; // intake weekdays: 0 = Sunday (catalogues `Weekday`)
    if (d.jain?.greensRestrictedDays.includes(wd) && (has('leafy', 'greens') || f.group === 'leafy_vegetables')) return 'Jain: no greens today';
    for (const r of d.dayRules) {
      if (!r.weekdays.includes(wd)) continue;
      if (r.rule === 'no_meat' && has(...MEAT_TAGS)) return 'day rule: no meat today';
      if (r.rule === 'no_eggs' && has('egg')) return 'day rule: no eggs today';
      if (r.rule === 'vrat' && !has('vrat', 'vrat_ok')) return 'day rule: vrat foods only';
    }
  }
  if (isLowCarbDay(o.rx) && netCarbPer100g(f.per100g) > 10) return 'day rule: low-carbohydrate day';
  if (isPsmfDay(o.rx) && f.per100g.fatG > 15) return 'day rule: PSMF day (lean foods)';
  return null;
}

export interface Candidate {
  id: string;
  name: string;
  aliases: readonly string[];
  group: string;
  per100g: { energyKcal: number; proteinG: number; netCarbG: number; fatG: number; fibreG: number };
  portions: ReadonlyArray<{ label: string; g: number }>;
  verified: boolean;
  /** In the person's kitchen (pantry "have"). */
  inKitchen: boolean;
  /** Soft: the person dislikes it (kept, ranked last). */
  disliked?: boolean;
}

/** Allowed foods for a date and slot: hard filters applied, kitchen first, dislikes last. */
export function allowedFoods(table: FoodTable, o: { setup: FoodSetup; date: string; slot?: string; rx: PrescribedDaySnapshot | null }): Candidate[] {
  if (o.slot && o.rx && o.rx.fast && o.rx.window) {
    const m = o.rx.meals.find((x) => x.slot === o.slot);
    if (m && !inWindow(m.clockH, o.rx.window)) return [];
  }
  const have = new Set(o.setup.pantry.filter((p) => p.have).map((p) => p.foodId));
  const dislikes = o.setup.diet?.dislikes ?? [];
  const out: Candidate[] = [];
  for (const f of table.all()) {
    if (excludedBy(f, { diet: o.setup.diet, date: o.date, rx: o.rx })) continue;
    const disliked = dislikes.some((x) => x.trim() && matchScore(x, [f.name, ...f.aliases]) >= 0.5);
    const n = f.per100g;
    out.push({
      id: f.id,
      name: f.name,
      aliases: f.aliases,
      group: f.group,
      per100g: { energyKcal: n.energyKcal, proteinG: n.proteinG, netCarbG: netCarbPer100g(n), fatG: n.fatG, fibreG: n.fibreG ?? 0 },
      portions: f.portions,
      verified: f.verified,
      inKitchen: have.has(f.id),
      ...(disliked ? { disliked: true } : {}),
    });
  }
  const rank = (c: Candidate) => (c.inKitchen ? 0 : 1) + (c.disliked ? 2 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
