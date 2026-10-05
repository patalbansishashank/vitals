/**
 * E9b executors for the `food.*` stubs (`../defs/catalogue.ts`) and the meal-logging stubs `log.meal`,
 * `log.mealFromPhoto`, `log.bulk` (`../defs/living.ts`), replaced through `implement()` (`../implement.ts`); ids,
 * schemas, permissions, undo and idempotency stay as declared.
 *
 * The app computes every nutrient (grams × the food table, `./estimate.ts`); models only name foods and estimate grams.
 * Pure parts: `./parse.ts` (catalogue text parser), `./rules.ts` (hard filters, slot targets), `./portionFit.ts`
 * (portion-fit solver, day tolerances), `./extras.ts` (groceries, supplements line), `./estimate.ts` (bands).
 */
import type { FoodTable } from '@/catalogues/types';
import { matchScore } from '@/catalogues/text';
import type { EntrySource, LogEntry } from '@/living';
import { bodyOf } from '@/store';
import { getBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { aiPorts, type PhotoRecognition } from '../aiPorts';
import { implement } from '../implement';
import { CommandFailure, fail } from '../registry';
import type { CommandContext } from '../types';
import { clockHourOf, readDay, readFoodSetup, type DayView } from './context';
import { estimateMeal, per100OfFood, per100OfLabel, per100OfRecipe, toMealComponents, toNutrientEstimate, type BandKind, type BandedTotals, type MealEstimate, type ResolvedComponent } from './estimate';
import { groceryList, supplementLine, type MealPlanLike, type SupplementLine } from './extras';
import { GRAM_SPREAD, gramsOfPortion, matchFood, parseMeal, type AmountKind } from './parse';
import { checkDay, fitMeal, repairHints, type MealFit, type PlanItem } from './portionFit';
import { allowedFoods, slotTargets, type MealSlotTarget } from './rules';
import { foodTable } from './table';

export { foodTable, setFoodTable } from './table';
export { parseMeal, parsePhrase, matchFood, gramsOfPortion, type ParsedComponent, type AmountKind } from './parse';
export { estimateMeal, toMealComponents, toNutrientEstimate, per100OfFood, per100OfLabel, per100OfRecipe, BAND_FLOORS, type MealEstimate, type ResolvedComponent, type BandedTotals, type Banded, type BandKind } from './estimate';
export { allowedFoods, slotTargets, excludedBy, isLowCarbDay, isPsmfDay, type Candidate, type MealSlotTarget } from './rules';
export { fitMeal, checkDay, repairHints, type MealFit, type PlanItem, type Deviation } from './portionFit';
export { groceryList, supplementLine, aisleOfGroup, DEFAULT_GOAL_TAGS, type GroceryItem, type SupplementLine } from './extras';
export { readFoodSetup, type FoodSetup, type DietRules } from './context';

const BY = 'E9b';
/** Confidence at or above which a meal commits without asking; below `ASK_BELOW` nothing is written. */
export const CONFIRM_AT = 0.7;
export const ASK_BELOW = 0.4;

async function ready(): Promise<void> {
  await getDocumentStore().ready;
}

function sourceOf(ctx: CommandContext, method: EntrySource['method']): EntrySource {
  const k = ctx.actor.kind;
  const by: EntrySource['by'] = k === 'user' ? 'user' : k === 'system' ? 'system' : k === 'companion' ? 'import' : 'ai';
  return {
    by,
    method: by === 'ai' && method === 'typed' ? 'aiText' : method,
    ...(ctx.actor.conversationId ? { conversationId: ctx.actor.conversationId } : {}),
    ...(ctx.actor.toolCallId ? { toolCallId: ctx.actor.toolCallId } : {}),
    actorId: ctx.actor.id,
  };
}

// ------------------------------------------------------------------------------------------- resolving components
export interface MealComponentIn {
  name: string;
  localName?: string;
  foodId?: string;
  recipeId?: string;
  grams?: number;
  gramsLow?: number;
  gramsHigh?: number;
  portion?: { unit: string; count: number };
  cookingMethod?: string;
  visibleFatCue?: 'none' | 'some' | 'glossy' | 'pooled';
  labelPer100g?: Record<string, unknown>;
}

type Method = EntrySource['method'];

function bandFor(method: Method, amount: AmountKind | 'label'): BandKind {
  if (method === 'label' || amount === 'label') return 'weighed';
  if (method === 'aiPhoto') return 'photoOnly';
  if (method === 'aiPhotoUserGrams') return 'userGrams';
  return amount === 'weighed' ? 'userGrams' : amount === 'default' ? 'text' : 'household';
}

interface RecipeDocBody {
  title: string;
  servings: number;
  ingredients: Array<{ foodId: string; gramsRaw: number }>;
}

function readRecipe(id: string): RecipeDocBody | null {
  const d = getDocumentStore().peek<RecipeDocBody>('recipes', id);
  return d && !d._deleted ? bodyOf<RecipeDocBody>(d) : null;
}

/** Typed components (from the person, the Coach or `food.parse`) → resolved components (no nutrients from the caller). */
export function resolveComponents(components: readonly MealComponentIn[], method: Method, table: FoodTable): ResolvedComponent[] {
  return components.map((c, i) => {
    let per100: ResolvedComponent['per100'];
    let nutrientSource: ResolvedComponent['nutrientSource'] = 'table';
    let foodId: string | undefined;
    let recipeId: string | undefined;
    let idConfidence = 0;
    let name = c.name;
    let defaultG: number | undefined;
    if (c.labelPer100g) {
      const l = per100OfLabel(c.labelPer100g);
      if (!l) fail('invalid_input', `The label values for "${c.name}" need energyKcal, proteinG, fatG and carbG per 100 g.`, { path: `/components/${i}/labelPer100g` });
      per100 = l;
      nutrientSource = method === 'label' || isPhotoMethod(method) ? 'label' : 'user';
      idConfidence = 1;
      if (c.foodId && table.get(c.foodId)) foodId = c.foodId;
    } else if (c.recipeId) {
      const r = readRecipe(c.recipeId);
      const p = r ? per100OfRecipe(r.ingredients, table) : undefined;
      if (r && p) {
        per100 = p;
        recipeId = c.recipeId;
        idConfidence = 1;
        name = c.name || r.title;
        defaultG = r.ingredients.reduce((s, x) => s + x.gramsRaw, 0) / Math.max(1, r.servings);
      }
    }
    if (!per100 && c.foodId && table.get(c.foodId)) {
      foodId = c.foodId;
      per100 = per100OfFood(c.foodId, table);
      idConfidence = 1;
    }
    if (!per100) {
      const m = matchFood(c.localName ?? c.name, table) ?? (c.localName ? matchFood(c.name, table) : null);
      if (m && m.score >= 0.3) {
        foodId = m.food.id;
        per100 = per100OfFood(m.food.id, table);
        idConfidence = m.score;
      }
    }
    const food = foodId ? table.get(foodId) : undefined;
    let grams: number;
    let amount: AmountKind | 'label';
    if (c.grams !== undefined) {
      grams = c.grams;
      amount = 'weighed';
    } else if (c.portion) {
      const g = gramsOfPortion(c.portion, food);
      grams = g.grams;
      amount = g.amount;
    } else if (c.gramsLow !== undefined && c.gramsHigh !== undefined) {
      grams = (c.gramsLow + c.gramsHigh) / 2;
      amount = 'household';
    } else {
      grams = defaultG ?? food?.portions[0]?.g ?? 100;
      amount = 'default';
    }
    const spread = amount === 'weighed' ? 0.1 : GRAM_SPREAD[amount];
    const lowG = c.gramsLow ?? grams * (1 - spread);
    const highG = c.gramsHigh ?? grams * (1 + spread);
    if (c.labelPer100g && amount === 'weighed') amount = 'label';
    return {
      name,
      ...(c.localName ? { localName: c.localName } : {}),
      ...(foodId ? { foodId } : {}),
      ...(recipeId ? { recipeId } : {}),
      grams,
      gramsLow: Math.min(lowG, grams),
      gramsHigh: Math.max(highG, grams),
      ...(c.portion ? { portion: c.portion } : {}),
      amount,
      ...(c.cookingMethod ? { cookingMethod: c.cookingMethod } : {}),
      ...(c.visibleFatCue ? { visibleFatCue: c.visibleFatCue } : {}),
      ...(per100 ? { per100 } : {}),
      nutrientSource,
      idConfidence,
      band: bandFor(method, amount),
    };
  });
}

function isPhotoMethod(m: Method): boolean {
  return m === 'aiPhoto' || m === 'aiPhotoUserGrams';
}

// ------------------------------------------------------------------------------------------- meal results
export interface ComponentView {
  name: string;
  localName?: string;
  foodId?: string;
  foodName?: string;
  recipeId?: string;
  grams: number;
  gramsLow: number;
  gramsHigh: number;
  portion?: { unit: string; count: number };
  /** Identification × amount confidence, 0–1. */
  confidence: number;
  nutrients?: BandedTotals;
  nutrientSource?: string;
}

/** `log.meal` / `log.mealFromPhoto` / per-entry `log.bulk` results. */
export type MealLogResult =
  | {
      status: 'logged';
      entryId: string;
      date: string;
      totals: BandedTotals;
      components: ComponentView[];
      confidence: number;
      /** 0.4 ≤ confidence < 0.7: logged, but the low-confidence components should be confirmed (one chip). */
      needsConfirmation: boolean;
      lowConfidence: ComponentView[];
      undo: { command: 'log.retract'; input: { entryId: string } };
      /** Photo only: "what I saw". */
      saw?: string;
      attachmentIds?: string[];
    }
  | {
      status: 'ask';
      /** Nothing was written: an agent must not tell the person the meal is logged. */
      saved: false;
      question: string;
      components: ComponentView[];
      confidence: number;
      /** Table foods that nearly match the components that need a choice (empty: the table has nothing close). */
      candidates: FoodChoice[];
      saw?: string;
    };

/** A table food to pick for a component: pass `foodId` in that component and log again. */
export interface FoodChoice {
  component: string;
  foodId: string;
  name: string;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

function viewOf(e: MealEstimate, table: FoodTable): ComponentView[] {
  return e.components.map((c) => ({
    name: c.name,
    ...(c.localName ? { localName: c.localName } : {}),
    ...(c.foodId ? { foodId: c.foodId, foodName: table.get(c.foodId)?.name ?? c.foodId } : {}),
    ...(c.recipeId ? { recipeId: c.recipeId } : {}),
    grams: Math.round(c.grams * 10) / 10,
    gramsLow: Math.round(c.gramsLow * 10) / 10,
    gramsHigh: Math.round(c.gramsHigh * 10) / 10,
    ...(c.portion ? { portion: c.portion } : {}),
    confidence: r2(c.confidence),
    ...(c.nutrients ? { nutrients: c.nutrients, nutrientSource: c.nutrientSource ?? 'table' } : {}),
  }));
}

function questionFor(e: MealEstimate): string {
  const un = e.unresolved.map((i) => e.components[i]!.name);
  if (un.length > 0) return `I couldn't find ${un.map((n) => `"${n}"`).join(' and ')} in the food table. What is it, or what does the label say per 100 g?`;
  const weakest = [...e.components].sort((a, b) => a.confidence - b.confidence)[0];
  if (!weakest) return 'What did you eat, and roughly how much?';
  return weakest.idConfidence < 0.7 ? `Was "${weakest.name}" what you had, and roughly how much (grams, katori or pieces)?` : `Roughly how much ${weakest.name} was it (grams, katori or pieces)?`;
}

const CHOICES_PER_COMPONENT = 4;

/** The table's near matches for each component that was not placed with confidence (best first), for a caller to pick from. */
function choicesFor(e: MealEstimate, table: FoodTable): FoodChoice[] {
  const out: FoodChoice[] = [];
  e.components.forEach((c, i) => {
    if (c.idConfidence >= CONFIRM_AT && !e.unresolved.includes(i)) return;
    const ids = new Set<string>();
    for (const q of [c.localName, c.name]) {
      for (const f of q ? table.search(q, CHOICES_PER_COMPONENT) : []) {
        if (ids.size < CHOICES_PER_COMPONENT && !ids.has(f.id)) {
          ids.add(f.id);
          out.push({ component: c.name, foodId: f.id, name: f.name });
        }
      }
    }
  });
  return out;
}

interface WriteMeal {
  date: string;
  clockH?: number;
  slot?: string;
  text?: string;
  method: Method;
  itemId?: string;
  attachmentIds?: string[];
  complete?: boolean;
  /** The caller's own confidence (an AI's identification confidence); the lower of it and the app's is used. */
  confidence?: number;
  saw?: string;
}

/** Thresholds, then (when confident enough) one meal entry through the command's transaction. */
async function commitMeal(ctx: CommandContext, e: MealEstimate, w: WriteMeal, table: FoodTable): Promise<MealLogResult> {
  const confidence = r2(Math.min(e.confidence, w.confidence ?? 1));
  const components = viewOf(e, table);
  if (confidence < ASK_BELOW || e.unresolved.length > 0 || e.components.length === 0) {
    return { status: 'ask', saved: false, question: questionFor(e), components, confidence, candidates: choicesFor(e, table), ...(w.saw ? { saw: w.saw } : {}) };
  }
  const day: DayView = await readDay(ctx, w.date);
  const rx = day.prescription;
  const slotClock = w.slot ? rx?.meals.find((m) => m.slot === w.slot)?.clockH : undefined;
  const clockH = w.clockH ?? slotClock ?? (w.date === ctx.today ? clockHourOf(ctx.now, ctx.tz) : 12);
  const id = ctx.newId();
  const entry = {
    date: w.date,
    tz: ctx.tz,
    at: ctx.now,
    source: sourceOf(ctx, w.method),
    confidence,
    ...(rx ? { planId: rx.planId, planDay: day.planDay ?? rx.planDay } : {}),
    ...(w.itemId ? { itemId: w.itemId } : {}),
    ...(w.text ? { text: w.text } : {}),
    ...(w.attachmentIds?.length ? { attachmentIds: w.attachmentIds } : {}),
    kind: 'meal' as const,
    clockH,
    ...(w.slot ? { slot: w.slot } : {}),
    ...(w.complete !== undefined ? { complete: w.complete } : {}),
    components: toMealComponents(e),
    totals: toNutrientEstimate(e.totals),
  } satisfies Omit<Extract<LogEntry, { kind: 'meal' }>, 'id'>;
  await ctx.docs.append('dailyLogs', { ...entry, _id: id });
  return {
    status: 'logged',
    entryId: id,
    date: w.date,
    totals: e.totals,
    components,
    confidence,
    needsConfirmation: confidence < CONFIRM_AT,
    lowConfidence: components.filter((c) => c.confidence < CONFIRM_AT),
    undo: { command: 'log.retract', input: { entryId: id } },
    ...(w.saw ? { saw: w.saw } : {}),
    ...(w.attachmentIds?.length ? { attachmentIds: w.attachmentIds } : {}),
  };
}

interface LogMealIn {
  date?: string;
  clockH?: number;
  slot?: string;
  text?: string;
  components: MealComponentIn[];
  method: Method;
  confidence?: number;
  itemId?: string;
  attachmentIds?: string[];
  complete?: boolean;
}

/** Nutrient-looking keys a caller might try to pass instead of grams (only `labelPer100g` carries numbers). */
const NUTRIENT_KEYS = ['energyKcal', 'kcal', 'calories', 'proteinG', 'carbG', 'fatG', 'fibreG', 'nutrients', 'totals', 'per100g'];

async function logMeal(ctx: CommandContext, input: LogMealIn): Promise<MealLogResult> {
  await ready();
  input.components.forEach((c, i) => {
    const bad = NUTRIENT_KEYS.find((k) => k in (c as unknown as Record<string, unknown>));
    if (bad) fail('invalid_input', 'Nutrient numbers are computed by the app from grams; pass labelPer100g only for a label or numbers the person typed.', { path: `/components/${i}/${bad}` });
  });
  const table = foodTable();
  // "As planned" with nothing named (a tick on Today): the meal is the slot's prescription, by its planned nutrients.
  if (input.components.length === 0 && !input.text && input.method === 'asPlanned') {
    const date = input.date ?? ctx.today;
    const planned = input.slot ? (await readDay(ctx, date)).prescription?.meals.find((m) => m.slot === input.slot) : undefined;
    if (!planned) fail('invalid_input', 'There is no planned meal to log for this slot. Say what was eaten instead.', { path: '/slot' });
    const label = { energyKcal: planned.energyKcal, proteinG: planned.proteinG, carbG: planned.carbG, fatG: planned.fatG };
    const e = estimateMeal(resolveComponents([{ name: 'as planned', grams: 100, labelPer100g: label }], 'asPlanned', table));
    return commitMeal(ctx, e, { date, method: 'asPlanned', clockH: input.clockH ?? planned.clockH, ...pick(input, ['slot', 'itemId', 'complete', 'confidence']) }, table);
  }
  const comps: MealComponentIn[] = input.components.length > 0 ? input.components : input.text ? parseMeal(input.text, table).map((p) => ({ name: p.name, ...(p.localName ? { localName: p.localName } : {}), ...(p.foodId ? { foodId: p.foodId } : {}), ...(p.amount !== 'default' ? { grams: p.grams, gramsLow: p.gramsLow, gramsHigh: p.gramsHigh } : {}), ...(p.portion ? { portion: p.portion } : {}) })) : [];
  if (comps.length === 0) fail('invalid_input', 'Say what was eaten: components with grams or portions, or a text description.', { path: '/components' });
  const resolved = resolveComponents(comps, input.method, table);
  // parsed text: keep the parser's own match score and amount kind
  if (input.components.length === 0 && input.text) {
    const parsed = parseMeal(input.text, table);
    resolved.forEach((r, i) => {
      const p = parsed[i]!;
      if (p.foodId) r.idConfidence = Math.min(r.idConfidence, p.matchScore);
      r.amount = p.amount;
      r.band = bandFor(input.method, p.amount);
    });
  }
  const e = estimateMeal(resolved);
  return commitMeal(ctx, e, { date: input.date ?? ctx.today, method: input.method, ...pick(input, ['clockH', 'slot', 'text', 'itemId', 'attachmentIds', 'complete', 'confidence']) }, table);
}

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

implement('log.meal', (ctx, input: LogMealIn) => logMeal(ctx, input), BY);

// ------------------------------------------------------------------------------------------- photo
/** Photo recognition → resolved components (grams from the model, nutrients from the table). Exported for the Coach UI. */
export function resolvePhoto(rec: PhotoRecognition, table: FoodTable, withText: boolean): ResolvedComponent[] {
  const band: BandKind = withText ? 'photoText' : 'photoOnly';
  const label = rec.labelPer100g && rec.components.length === 1 ? per100OfLabel(rec.labelPer100g) : null;
  return rec.components.map((c) => {
    let foodId: string | undefined;
    let match = 0;
    if (c.foodId && table.get(c.foodId)) {
      foodId = c.foodId;
      match = 1;
    } else {
      const m = matchFood(c.localName ?? c.name, table) ?? (c.localName ? matchFood(c.name, table) : null);
      if (m && m.score >= 0.3) {
        foodId = m.food.id;
        match = m.score;
      }
    }
    // large single components are under-estimated from photos (R8 §6.3): raise 10 %, widen the upper band only
    const big = c.grams > 400;
    const grams = big ? c.grams * 1.1 : c.grams;
    const per100 = label ?? (foodId ? per100OfFood(foodId, table) : undefined);
    return {
      name: c.name,
      ...(c.localName ? { localName: c.localName } : {}),
      ...(foodId ? { foodId } : {}),
      grams,
      gramsLow: Math.min(c.gramsLow, grams),
      gramsHigh: Math.max(big ? c.gramsHigh * 1.2 : c.gramsHigh, grams),
      amount: 'weighed' as const,
      ...(c.cookingMethod ? { cookingMethod: c.cookingMethod } : {}),
      ...(c.visibleFatCue ? { visibleFatCue: c.visibleFatCue } : {}),
      ...(per100 ? { per100 } : {}),
      nutrientSource: label ? ('label' as const) : ('table' as const),
      idConfidence: Math.max(0, Math.min(1, c.confidence)) * (label ? 1 : match),
      band,
    };
  });
}

implement(
  'log.mealFromPhoto',
  async (ctx, input: { attachmentId: string; text?: string; slot?: string; clockH?: number }) => {
    await ready();
    const recognize = aiPorts().recognizePhoto;
    if (!recognize) fail('precondition_failed', 'Logging a meal from a photo needs a vision-capable model. Connect one in Settings, or describe the meal in words.', { retryable: false });
    let bytes: Uint8Array;
    try {
      bytes = await (await getBlobStore()).get(input.attachmentId);
    } catch {
      fail('not_found', 'That photo is not on this device.', { path: '/attachmentId' });
    }
    const rec = await recognize!({ attachmentId: input.attachmentId, image: new Blob([new Uint8Array(bytes!)]), ...(input.text ? { text: input.text } : {}) }, ctx.signal);
    const table = foodTable();
    const e = estimateMeal(resolvePhoto(rec, table, !!input.text));
    return commitMeal(ctx, e, { date: ctx.today, method: 'aiPhoto', confidence: rec.confidence, attachmentIds: [input.attachmentId], saw: rec.saw, ...pick(input, ['clockH', 'slot', 'text']) }, table);
  },
  BY,
);

// ------------------------------------------------------------------------------------------- bulk
type BulkResult = { date: string; index: number } & (MealLogResult | { status: 'skipped'; reason: string } | { status: 'error'; message: string } | { status: 'logged'; entryId: string; kind: string; undo: { command: 'log.retract'; input: { entryId: string } } });

implement(
  'log.bulk',
  async (ctx, input: { days: Array<{ date: string; entries: Array<Record<string, unknown>> }> }) => {
    await ready();
    const out: BulkResult[] = [];
    for (const d of input.days) {
      for (const [index, raw] of d.entries.entries()) {
        const kind = (raw.kind as string | undefined) ?? (raw.components || raw.text ? 'meal' : undefined);
        try {
          if (kind === 'meal') {
            const { kind: _k, date: _d, ...rest } = raw;
            void _k;
            void _d;
            const comps = Array.isArray(rest.components) ? (rest.components as MealComponentIn[]) : [];
            const r = await logMeal(ctx, { ...(rest as Partial<LogMealIn>), components: comps, method: (rest.method as Method | undefined) ?? 'backfill', date: d.date });
            out.push({ date: d.date, index, ...r });
          } else if (kind === 'note' && typeof raw.text === 'string') {
            const id = ctx.newId();
            await ctx.docs.append('dailyLogs', { date: d.date, tz: ctx.tz, at: ctx.now, source: sourceOf(ctx, 'backfill'), kind: 'note', text: raw.text, _id: id });
            out.push({ date: d.date, index, status: 'logged', entryId: id, kind: 'note', undo: { command: 'log.retract', input: { entryId: id } } });
          } else if (kind === 'steps' && typeof raw.steps === 'number' && raw.steps >= 0) {
            const id = ctx.newId();
            await ctx.docs.append('dailyLogs', { date: d.date, tz: ctx.tz, at: ctx.now, source: sourceOf(ctx, 'backfill'), kind: 'steps', steps: Math.round(raw.steps), _id: id });
            out.push({ date: d.date, index, status: 'logged', entryId: id, kind: 'steps', undo: { command: 'log.retract', input: { entryId: id } } });
          } else {
            out.push({ date: d.date, index, status: 'skipped', reason: `Entries of kind "${kind ?? 'unknown'}" are logged one by one (log.session, log.sleep …).` });
          }
        } catch (err) {
          if (!(err instanceof CommandFailure)) throw err;
          out.push({ date: d.date, index, status: 'error', message: err.error.message });
        }
      }
    }
    return out;
  },
  BY,
);

// ------------------------------------------------------------------------------------------- food.* reads
implement(
  'food.parse',
  (_ctx, input: { text: string }) => {
    const table = foodTable();
    const components = parseMeal(input.text, table).map((c) => ({ ...c, ...(c.foodId ? { foodName: table.get(c.foodId)?.name } : {}) }));
    return { components, unmatched: components.filter((c) => !c.foodId).map((c) => c.source) };
  },
  BY,
);

implement(
  'food.candidates',
  async (ctx, input: { date: string; slot?: string }) => {
    await ready();
    const { prescription } = await readDay(ctx, input.date);
    return allowedFoods(foodTable(), { setup: readFoodSetup(), date: input.date, rx: prescription, ...(input.slot ? { slot: input.slot } : {}) });
  },
  BY,
);

/** Per-meal targets for a date (empty without a prescription). */
export async function dayTargets(ctx: CommandContext, date: string): Promise<MealSlotTarget[]> {
  await ready();
  return slotTargets((await readDay(ctx, date)).prescription);
}

implement('food.dayTargets', (ctx, input: { date: string }) => dayTargets(ctx, input.date), BY);

/** The supplements line for a date: catalogue items serving the person's goals, only when they opted in. */
export async function daySupplementLine(ctx: CommandContext, date: string): Promise<SupplementLine> {
  await ready();
  const { prescription } = await readDay(ctx, date);
  return supplementLine({ setup: readFoodSetup(), prescribed: prescription?.supplements.map((s) => s.supplementId) ?? [] });
}

// ------------------------------------------------------------------------------------------- food.planDay
interface PlanMealIn {
  slot: string;
  items: PlanItem[];
  dish?: string;
  recipeId?: string;
  acceptClosest?: boolean;
}

function readPlanMeals(meals: ReadonlyArray<Record<string, unknown>>): PlanMealIn[] {
  return meals.map((m, i) => {
    if (typeof m.slot !== 'string' || !m.slot) fail('invalid_input', 'Each meal needs a slot.', { path: `/meals/${i}/slot` });
    if (!Array.isArray(m.items) || m.items.length === 0) fail('invalid_input', 'Each meal needs items: food ids with raw grams.', { path: `/meals/${i}/items` });
    const items = (m.items as Array<Record<string, unknown>>).map((it, j): PlanItem => {
      if (typeof it.foodId !== 'string' || typeof it.grams !== 'number' || !(it.grams > 0)) fail('invalid_input', 'Each item is { foodId, grams } with grams > 0.', { path: `/meals/${i}/items/${j}` });
      for (const k of NUTRIENT_KEYS) if (k in it) fail('invalid_input', 'Give foods and grams only; the app computes the nutrients.', { path: `/meals/${i}/items/${j}/${k}` });
      return { foodId: it.foodId as string, grams: it.grams as number, ...(it.flexible === false ? { flexible: false } : {}), ...(typeof it.role === 'string' ? { role: it.role } : {}) };
    });
    return { slot: m.slot as string, items, ...(typeof m.dish === 'string' ? { dish: m.dish } : {}), ...(typeof m.recipeId === 'string' ? { recipeId: m.recipeId } : {}), ...(m.acceptClosest === true ? { acceptClosest: true } : {}) };
  });
}

interface MealPlanDocBody extends MealPlanLike {
  meals: Array<{ slot: string; dish?: string; recipeId?: string; familyStyle: boolean; items: Array<PlanItem & { gramsProposed: number }>; fit: MealFit['fit'] & { status: 'fits' | 'closest' } }>;
  groceries: Array<{ foodId: string; grams: number }>;
  updatedAt: string;
}

implement(
  'food.planDay',
  async (ctx, input: { date: string; meals: Array<Record<string, unknown>> }) => {
    await ready();
    const meals = readPlanMeals(input.meals);
    const table = foodTable();
    const setup = readFoodSetup();
    const { prescription: rx } = await readDay(ctx, input.date);
    const targets = slotTargets(rx);
    if (!rx || targets.length === 0) fail('precondition_failed', `There are no meal targets for ${input.date}: start a plan first (or it is a fast day).`, { retryable: false });
    const seen = new Set<string>();
    const planned: Array<{ meal: PlanMealIn; target: MealSlotTarget }> = meals.map((m, i) => {
      const target = targets.find((t) => t.slot === m.slot);
      if (!target) fail('invalid_input', `There is no meal slot "${m.slot}" on ${input.date}; the slots are ${targets.map((t) => t.slot).join(', ')}.`, { path: `/meals/${i}/slot`, retryable: true });
      if (seen.has(m.slot)) fail('invalid_input', `The slot "${m.slot}" is planned twice.`, { path: `/meals/${i}/slot` });
      seen.add(m.slot);
      return { meal: m, target: target! };
    });
    // hard filters: every food must be allowed for its date and slot
    const problems: string[] = [];
    for (const { meal, target } of planned) {
      const allowed = new Set(allowedFoods(table, { setup, date: input.date, slot: target.slot, rx }).map((c) => c.id));
      for (const it of meal.items) {
        if (!table.get(it.foodId)) problems.push(`"${it.foodId}" is not in the food table`);
        else if (!allowed.has(it.foodId)) problems.push(`${table.get(it.foodId)!.name} is not allowed at ${meal.slot}`);
      }
    }
    if (problems.length > 0) fail('invalid_input', `${problems.join('; ')}. Choose foods from food.candidates for this date and slot.`, { rule: 'food.candidates', retryable: true });
    const fits = planned.map(({ meal, target }) => fitMeal(meal.items, target, table));
    const check = checkDay(fits, planned.map((p) => p.target));
    const hints = repairHints(check.deviations);
    const acceptClosest = meals.every((m) => m.acceptClosest);
    if (!check.ok && !acceptClosest) {
      const fitted = fits.map((f) => `${f.slot}: ${f.items.map((it) => `${table.get(it.foodId)!.name} ${it.grams} g`).join(', ')}`).join('; ');
      fail('invalid_input', `Off target after fitting portions (${fitted}). ${hints.join(' ')} Adjust the foods and call food.planDay again, or set acceptClosest: true on every meal to save the closest fit.`, { rule: 'tolerance', retryable: true });
    }
    const status: 'fits' | 'closest' = check.ok ? 'fits' : 'closest';
    const prev = getDocumentStore().peek<MealPlanDocBody>('mealPlans', input.date);
    const kept = prev && !prev._deleted ? bodyOf<MealPlanDocBody>(prev).meals.filter((m) => !seen.has(m.slot)) : [];
    const newMeals: MealPlanDocBody['meals'] = planned.map(({ meal }, i) => ({
      slot: meal.slot,
      ...(meal.dish ? { dish: meal.dish } : {}),
      ...(meal.recipeId ? { recipeId: meal.recipeId } : {}),
      familyStyle: !!setup.diet?.familyFoodMode,
      items: fits[i]!.items,
      fit: { ...fits[i]!.fit, withinTolerance: check.ok, status },
    }));
    const allMeals = [...kept, ...newMeals];
    const groceries = new Map<string, number>();
    for (const m of allMeals) for (const it of m.items) groceries.set(it.foodId, (groceries.get(it.foodId) ?? 0) + it.grams);
    const doc: MealPlanDocBody = { date: input.date, meals: allMeals, groceries: [...groceries].map(([foodId, grams]) => ({ foodId, grams })), updatedAt: ctx.now };
    await ctx.docs.put('mealPlans', { ...doc, _id: input.date });
    return {
      status,
      date: input.date,
      meals: fits.map((f, i) => ({
        slot: f.slot,
        ...(planned[i]!.meal.dish ? { dish: planned[i]!.meal.dish } : {}),
        items: f.items.map((it) => ({ foodId: it.foodId, name: table.get(it.foodId)!.name, grams: it.grams, gramsProposed: it.gramsProposed })),
        totals: f.fit.totals,
        target: planned[i]!.target,
        deltas: f.fit.deltas,
      })),
      deviations: check.deviations,
      repairHints: hints,
      saved: true,
    };
  },
  BY,
);

// ------------------------------------------------------------------------------------------- recipes
interface RecipeIn {
  id?: string;
  title?: string;
  cuisine?: string;
  servings?: number;
  ingredients?: Array<{ foodId?: string; gramsRaw?: number; grams?: number; role?: string; flexible?: boolean; unitHint?: string }>;
  steps?: string[];
  activeMin?: number;
  passiveMin?: number;
  equipment?: string[];
}

implement(
  'food.recipes',
  async (_ctx, input: { q?: string }) => {
    await ready();
    const all = getDocumentStore()
      .peekAll<Record<string, unknown>>('recipes')
      .map((d): Record<string, unknown> => ({ ...bodyOf<Record<string, unknown>>(d), id: d._id }));
    const q = input.q?.trim();
    if (!q) return all;
    return all
      .map((r) => ({ r, s: matchScore(q, [String(r.title ?? ''), String(r.cuisine ?? '')]) }))
      .filter((x) => x.s > 0.2)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
  },
  BY,
);

implement(
  'food.saveRecipe',
  async (ctx, input: { recipe: RecipeIn }) => {
    await ready();
    const r = input.recipe;
    const table = foodTable();
    if (typeof r.title !== 'string' || !r.title.trim()) fail('invalid_input', 'A recipe needs a title.', { path: '/recipe/title' });
    const servings = r.servings ?? 1;
    if (!Number.isInteger(servings) || servings < 1 || servings > 50) fail('invalid_input', 'Servings is a whole number from 1 to 50.', { path: '/recipe/servings' });
    if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) fail('invalid_input', 'A recipe needs ingredients: food ids with raw grams.', { path: '/recipe/ingredients' });
    const ingredients = r.ingredients!.map((it, i) => {
      const g = it.gramsRaw ?? it.grams;
      if (typeof it.foodId !== 'string' || !table.get(it.foodId)) fail('invalid_input', `Ingredient ${i + 1} needs a food id from the food table.`, { path: `/recipe/ingredients/${i}/foodId` });
      if (typeof g !== 'number' || !(g > 0)) fail('invalid_input', `Ingredient ${i + 1} needs raw grams > 0.`, { path: `/recipe/ingredients/${i}/gramsRaw` });
      return { foodId: it.foodId!, gramsRaw: g!, role: it.role ?? 'main', flexible: it.flexible ?? true, ...(it.unitHint ? { unitHint: it.unitHint } : {}) };
    });
    // the app computes the recipe's nutrients (any numbers in the input are ignored)
    const parts = estimateMeal(resolveComponents(ingredients.map((x) => ({ name: x.foodId, foodId: x.foodId, grams: x.gramsRaw / servings })), 'typed', table));
    const existing = r.id ? getDocumentStore().peek<{ createdAt?: string }>('recipes', r.id) : null;
    const id = existing ? r.id! : ctx.newId();
    await ctx.docs.put('recipes', {
      _id: id,
      title: r.title!.trim(),
      cuisine: r.cuisine ?? '',
      servings,
      ingredients,
      steps: Array.isArray(r.steps) ? r.steps.map(String) : [],
      activeMin: r.activeMin ?? 0,
      passiveMin: r.passiveMin ?? 0,
      equipment: Array.isArray(r.equipment) ? r.equipment.map(String) : [],
      generatedBy: ctx.actor.kind === 'user' ? 'user' : 'ai',
      perServing: toNutrientEstimate(parts.totals),
      createdAt: existing?.createdAt ?? ctx.now,
      updatedAt: ctx.now,
    });
    return { id };
  },
  BY,
);

implement(
  'food.deleteRecipe',
  async (ctx, input: { id: string }) => {
    await ready();
    const d = getDocumentStore().peek('recipes', input.id);
    if (!d || d._deleted) fail('not_found', 'There is no such recipe.', { path: '/id' });
    await ctx.docs.remove('recipes', input.id);
    return { id: input.id };
  },
  BY,
);

// ------------------------------------------------------------------------------------------- groceries
implement(
  'food.groceryList',
  async (_ctx, input: { from: string; to?: string }) => {
    await ready();
    const to = input.to ?? input.from;
    if (to < input.from) fail('invalid_input', 'The range ends before it starts.', { path: '/to' });
    const plans = getDocumentStore()
      .peekAll<MealPlanLike>('mealPlans')
      .map((d) => bodyOf<MealPlanLike>(d))
      .filter((p) => p.date >= input.from && p.date <= to);
    return { from: input.from, to, days: plans.map((p) => p.date).sort(), items: groceryList(plans, foodTable(), readFoodSetup()) };
  },
  BY,
);
