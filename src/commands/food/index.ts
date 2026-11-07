/**
 * E9b executors for the `food.*` stubs (`../defs/catalogue.ts`) and the meal-logging stubs `log.meal`,
 * `log.mealFromPhoto`, `log.bulk` (`../defs/living.ts`), replaced through `implement()` (`../implement.ts`); ids,
 * schemas, permissions, undo and idempotency stay as declared.
 *
 * The app computes every nutrient (grams × the food table, `./estimate.ts`); models only name foods and estimate grams.
 * Pure parts: `./parse.ts` (catalogue text parser), `./rules.ts` (hard filters, slot targets), `./portionFit.ts`
 * (portion-fit solver, day tolerances), `./extras.ts` (groceries, supplements line), `./estimate.ts` (bands).
 */
import { asEatenFormOf, carbBasisOf, fortificationCompatible, fortificationOfText, stateCompatible, stateOfText, type AsEatenForm, type SourceEnergy } from '@/catalogues/foods';
import type { FoodRecord, FoodTable } from '@/catalogues/types';
import { matchScore, normName } from '@/catalogues/text';
import type { AmountMethod, EntrySource, LogEntry, MealComponent } from '@/living';
import { CONTRACT_VERSIONS, contentHash, type CarbohydrateBasis, type EnergyLedger, type OccurrenceTime } from '@/lib/bodyContracts';
import { commonSource, legacyUnknownFields, mealEnergyLedger, mealExposures, nutrientCoverageOf, provenanceOf, sourceOfComponent } from '@/lib/nutrientExposure';
import { bodyOf } from '@/store';
import { getBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { aiPorts, type PhotoRecognition } from '../aiPorts';
import { implement } from '../implement';
import { CommandFailure, fail } from '../registry';
import type { CommandContext } from '../types';
import { clockHourOf, readDay, readFoodSetup, type DayView } from './context';
import { bandOfAmountMethod, estimateMeal, LABEL_CARB_BASIS_DEFAULT, labelExtraOf, labelFieldsOf, nominalPer100, normalizeRecipe, per100OfFood, per100OfLabel, per100Record, recipeComposition, toMealComponents, toNutrientEstimate, validateRecipe, type BandKind, type BandedTotals, type EnergySourceSnapshot, type MealEstimate, type Per100, type RecipeServingSnapshot, type RecipeSpec, type ResolvedComponent, type MealComponentOut } from './estimate';
import { UPPER_BOUND_KEY_PREFIX } from '@/lib/nutrientExposure';
import { groceryList, supplementLine, type MealPlanLike, type SupplementLine, type SupplementPolicy } from './extras';
import { mealOccurrence } from './occurrence';
import { foodSupplementPolicy } from './suggestionSafety';
import { GRAM_SPREAD, gramsOfPortion, matchFood, parseMeal, type AmountKind } from './parse';
import { checkDay, fitMeal, repairHints, type MealFit, type PlanItem } from './portionFit';
import { allowedFoods, slotTargets, type MealSlotTarget } from './rules';
import { foodTable } from './table';

export { foodTable, setFoodTable } from './table';
export { parseMeal, parsePhrase, matchFood, gramsOfPortion, type ParsedComponent, type AmountKind } from './parse';
export { estimateMeal, toMealComponents, toNutrientEstimate, per100OfFood, per100OfLabel, per100OfRecipe, labelFieldsOf, recipeComposition, normalizeRecipe, nominalPer100, validateRecipe, energyOfFood, energySourceSnapshotOf, bandOfAmountMethod, BAND_FLOORS, BAND_SEMANTICS, LABEL_CARB_BASIS_DEFAULT, type MealEstimate, type ResolvedComponent, type BandedTotals, type BandedKey, type Banded, type BandKind, type Per100, type RecipeSpec, type RecipeComposition, type RecipeServingSnapshot, type MealComponentOut, type EnergySourceSnapshot, type RecipeEnergySource, type RecipeAdditionIn } from './estimate';
export { foodTableIssues, referenceFoodTable } from './table';
export { allowedFoods, slotTargets, excludedBy, isLowCarbDay, isPsmfDay, type Candidate, type MealSlotTarget } from './rules';
export { fitMeal, checkDay, repairHints, type MealFit, type PlanItem, type Deviation } from './portionFit';
export { groceryList, supplementLine, aisleOfGroup, DEFAULT_GOAL_TAGS, type GroceryItem, type SupplementLine, type SupplementLineItem, type SupplementPolicy, type WithheldSupplement } from './extras';
export { mealOccurrence, wallInstants } from './occurrence';
export { currentSuggestionSafety, foodSupplementPolicy } from './suggestionSafety';
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
  /** (D6-06) how the amount was obtained, kept as given. */
  amountMethod?: AmountMethod;
  /** (D6-01, A1-024) what `labelPer100g.carbG` means (absent = unknown: a new label's basis is never guessed). */
  carbBasis?: CarbohydrateBasis;
  /** (D6-04) share of a recipe's batch eaten; without a known final edible mass a serving is always a batch fraction. */
  batchFraction?: number;
  /**
   * (D6-05) relog only: the stored component's frozen composition, cloned as is ("same as yesterday" never re-reads today's
   * table): a table/recipe snapshot with its energy method, or (A1-024) a label/typed snapshot with the carbohydrate basis
   * it was read under — `legacyTotalByDifference` is the explicit adapter of label entries stored before the unknown
   * default. Not part of the agent-facing schema yet (`relogSnapshotComponents`, `relogComponents`).
   */
  fromSnapshot?: {
    source: 'food' | 'recipe' | 'label' | 'user';
    id?: string;
    version?: string;
    per100g: Readonly<Record<string, number | null>>;
    recipeServing?: RecipeServingSnapshot;
    imputed?: readonly string[];
    energySource?: EnergySourceSnapshot;
    carbBasis?: CarbohydrateBasis;
  };
}

type Method = EntrySource['method'];

/** Display band of a component: its explicit amount method when given (D6-06), else how the amount was given. */
function bandOf(method: Method, amount: AmountKind | 'label', amountMethod: AmountMethod | undefined): BandKind {
  return bandOfAmountMethod(amountMethod) ?? bandFor(method, amount);
}

function bandFor(method: Method, amount: AmountKind | 'label'): BandKind {
  if (method === 'label' || amount === 'label') return 'weighed';
  if (method === 'aiPhoto') return 'photoOnly';
  if (method === 'aiPhotoUserGrams') return 'userGrams';
  return amount === 'weighed' ? 'userGrams' : amount === 'default' ? 'text' : 'household';
}

interface RecipeDocBody {
  title: string;
  servings: number;
  /** Legacy: `gramsRaw` (legacy mass basis). Schema 2 adds `massG`, `massBasis`, `state`, `preparation`, `retention`. */
  ingredients: Array<{ foodId: string; gramsRaw: number } & Record<string, unknown>>;
  schemaVersion?: 2;
  finalEdibleMassG?: number;
  yieldSource?: 'measured' | 'sourcedEstimate' | 'unknown';
  additions?: unknown;
  discards?: unknown;
  waterAddedG?: number;
  evaporationG?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Frozen per-100 g composition of a component (C1/C3/D6-03): every nutrient its source gives (null = unknown), with the
 * source version; an entry never re-reads today's table or recipe.
 */
function snapshotOf(source: NonNullable<MealComponent['snapshot']>['source'], per100: Per100, id?: string, version?: string): NonNullable<MealComponent['snapshot']> {
  return { source, ...(id ? { id } : {}), ...(version ? { version } : {}), per100g: per100Record(per100) };
}

/**
 * Version of ONE record's composition (D6-05): its frozen dataset version for reference rows, a content hash for the
 * person's own records — so a snapshot (and its shared source-composition group) changes only when that record does.
 */
function recordVersion(foodId: string, table: FoodTable): string {
  const f = table.get(foodId);
  if (!f) return table.version;
  if (f.provenance?.datasetVersion) return f.provenance.datasetVersion;
  return f.source === 'user' ? `user:${contentHash(f)}` : table.version;
}

/**
 * Per-100 g values of a frozen snapshot (null fields unknown — energy included, A1-042: an unknown recipe energy stays
 * unknown on relog, never 0; the reported carbohydrate, extras and `upper:` bounds kept).
 */
function per100OfSnapshot(per100g: Readonly<Record<string, number | null>>): Per100 {
  const unknown: Array<'energyKcal' | 'proteinG' | 'netCarbG' | 'fatG' | 'fibreG' | 'satFatG'> = [];
  const num = (k: 'energyKcal' | 'proteinG' | 'netCarbG' | 'fatG' | 'fibreG' | 'satFatG'): number => {
    const v = per100g[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    unknown.push(k);
    return 0;
  };
  const extra: Record<string, number | null> = {};
  const upper: Record<string, number> = {};
  for (const [k, v] of Object.entries(per100g)) {
    if (k.startsWith(UPPER_BOUND_KEY_PREFIX)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) upper[k.slice(UPPER_BOUND_KEY_PREFIX.length)] = v;
    } else if (!['energyKcal', 'proteinG', 'netCarbG', 'fatG', 'fibreG', 'satFatG', 'alcoholG', 'caffeineMg', 'sourceEnergyKcal'].includes(k)) extra[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  const alc = per100g.alcoholG;
  const caf = per100g.caffeineMg;
  const src = per100g.sourceEnergyKcal;
  return {
    energyKcal: num('energyKcal'), proteinG: num('proteinG'), netCarbG: num('netCarbG'), fatG: num('fatG'), fibreG: num('fibreG'), satFatG: num('satFatG'),
    ...(unknown.length > 0 ? { unknown } : {}),
    ...(typeof alc === 'number' && Number.isFinite(alc) && alc >= 0 ? { alcoholG: alc } : {}),
    ...(typeof caf === 'number' && Number.isFinite(caf) && caf >= 0 ? { caffeineMg: caf } : {}),
    extra,
    ...(typeof src === 'number' && Number.isFinite(src) ? { energyBasis: 'measuredME' as const, sourceEnergyKcal: src } : {}),
    ...(Object.keys(upper).length > 0 ? { upper } : {}),
  };
}

/** The frozen energy method of a stored component back as the resolver's choice (a relog keeps it: no second discount). */
function sourceEnergyOfSnapshot(e: EnergySourceSnapshot, kcal: number): SourceEnergy {
  return { kcal, basis: e.method === 'measuredME' ? 'measuredME' : 'source', sourceKcal: e.sourceEnergyKcal, method: e.method, form: e.form, status: e.status, ...(e.sourceRef ? { sourceRef: e.sourceRef } : {}), matrixUncertain: e.matrixUncertain === true };
}

/**
 * The as-eaten form of a table component (A1-030) from its stated cooking/preparation method, its name and the household
 * portion it names ("1 cup, ground" is ground; "1 cup, whole" is whole).
 */
function asEatenOfComponent(c: Pick<MealComponentIn, 'name' | 'localName' | 'cookingMethod' | 'portion'>, food: FoodRecord | undefined): AsEatenForm {
  const unit = c.portion ? normName(c.portion.unit) : '';
  const label = unit && food ? food.portions.find((p) => normName(p.label).includes(unit))?.label : undefined;
  return asEatenFormOf({ preparation: c.cookingMethod ?? null, describe: [c.name, c.localName, c.portion?.unit, label] });
}

function readRecipe(id: string): RecipeDocBody | null {
  const d = getDocumentStore().peek<RecipeDocBody>('recipes', id);
  return d && !d._deleted ? bodyOf<RecipeDocBody>(d) : null;
}

/**
 * Relog components that clone each stored table/recipe component's frozen composition (D6-05: "same as yesterday" logs
 * the serving snapshot, never today's table); typed/label components as in `relogComponents`. Internal input field
 * `fromSnapshot`: until the agent schema carries it, the UI keeps `relogComponents`.
 */
export function relogSnapshotComponents(entry: Pick<Extract<LogEntry, { kind: 'meal' }>, 'components' | 'energy'>): MealComponentIn[] {
  const plain = relogComponents(entry);
  return entry.components.map((c, i) => {
    const snap = c.snapshot;
    if (c.nutrientSource !== 'table' || !snap || (snap.source !== 'food' && snap.source !== 'recipe')) return plain[i]!;
    const id = snap.id ?? c.recipeId ?? c.foodId;
    if (!id) return plain[i]!;
    const { recipeServing: serving, imputedNutrients: imputed, energySource } = c as MealComponentOut;
    return {
      ...plain[i]!,
      grams: c.grams.value,
      fromSnapshot: { source: snap.source, id, ...(snap.version ? { version: snap.version } : {}), per100g: snap.per100g, ...(serving ? { recipeServing: serving } : {}), ...(imputed && imputed.length > 0 ? { imputed } : {}), ...(energySource ? { energySource } : {}) },
    };
  });
}

/** Carbohydrate bases `log.meal` accepts from a caller (the agent schema); any other stored basis relogs via its snapshot. */
const CALLER_CARB_BASES: ReadonlySet<CarbohydrateBasis> = new Set<CarbohydrateBasis>(['totalByDifference', 'available', 'monosaccharideEquivalent', 'unknown']);

const FORM_WORD: Readonly<Record<string, string>> = { ground: 'ground', pieces: 'sliced', whole: 'whole' };

/**
 * (A1-030) The as-eaten form words of a stored table component whose energy depended on its form (e.g. a ground portion of
 * a whole-natural record), so logging it again by id re-resolves the same form: its stated cooking method, plus the frozen
 * matrix of its energy method when the stated words do not already say it.
 */
function relogCookingMethod(c: MealComponentOut): string | undefined {
  const es = c.energySource;
  const word = es?.status === 'formIncompatible' && es.form ? FORM_WORD[es.form] : undefined;
  if (!word || asEatenFormOf({ preparation: c.cookingMethod ?? null, describe: [c.name, c.localName] }).matrix === es!.form) return c.cookingMethod;
  return [c.cookingMethod, word].filter(Boolean).join(', ');
}

/**
 * `log.meal` components that log a stored meal again ("same as yesterday", recents; D6-02/C3): table and recipe components
 * by id and grams; typed or label numbers through the entry's frozen per-100 g values with every field it did not know
 * left out (never 0) and its carbohydrate basis. A legacy entry is read through the provider's adapter (its placeholder
 * zeros stay unknown). The new entry is a new observation; the stored one is never rewritten.
 */
export function relogComponents(entry: Pick<Extract<LogEntry, { kind: 'meal' }>, 'components' | 'energy'>): MealComponentIn[] {
  return entry.components.map((c): MealComponentIn => {
    const grams = c.grams.value;
    const base = { name: c.name, ...(c.localName ? { localName: c.localName } : {}), ...(c.amountMethod ? { amountMethod: c.amountMethod } : {}) };
    // a recipe serving logged as a share of its batch is logged again as the same share (its grams may be ingredient-mass
    // bookkeeping without a known cooked weight, D6-04)
    const serving = (c as MealComponent & { recipeServing?: RecipeServingSnapshot }).recipeServing;
    if (c.nutrientSource === 'table' && c.recipeId && serving) return { ...base, recipeId: c.recipeId, batchFraction: serving.fractionOfBatch };
    if (c.nutrientSource === 'table' && c.recipeId) return { ...base, recipeId: c.recipeId, grams };
    if (c.nutrientSource === 'table' && c.foodId) {
      const cooking = relogCookingMethod(c as MealComponentOut);
      return { ...base, foodId: c.foodId, grams, ...(cooking ? { cookingMethod: cooking } : {}) };
    }
    const snap = c.snapshot;
    if (snap && (snap.source === 'label' || snap.source === 'user')) {
      // (A1-024) a stored label component keeps the basis it was read under: a declared one as given; none = an entry from
      // before the unknown default, read through the explicit legacy adapter (never reinterpreted as unknown)
      if (!c.carbBasis || !CALLER_CARB_BASES.has(c.carbBasis)) {
        return { ...base, grams, fromSnapshot: { source: snap.source, per100g: snap.per100g, carbBasis: c.carbBasis ?? 'legacyTotalByDifference' } };
      }
      const label: Record<string, number> = {};
      for (const [k, v] of Object.entries(snap.per100g)) if (typeof v === 'number' && Number.isFinite(v)) label[k] = v;
      return { ...base, grams, labelPer100g: label, carbBasis: c.carbBasis };
    }
    // no label snapshot (legacy or model numbers): the stored nutrients per 100 g, available carbohydrate as stored
    const unknown = new Set<string>([...(c.nutrients.unknown ?? []), ...(entry.energy ? [] : legacyUnknownFields(c))]);
    const k = grams > 0 ? 100 / grams : 0;
    const label: Record<string, number> = {};
    for (const f of ['energyKcal', 'proteinG', 'carbG', 'fatG', 'fibreG', 'satFatG'] as const) {
      const v = c.nutrients[f]?.value;
      if (!unknown.has(f) && typeof v === 'number' && Number.isFinite(v)) label[f] = v * k;
    }
    return { ...base, grams, labelPer100g: label, carbBasis: 'available' };
  });
}

/** Recipe servings a portion names (`{ unit: 'serving' | 'servings', count }`), else null. */
function servingsOf(portion: MealComponentIn['portion']): number | null {
  if (!portion) return null;
  const u = portion.unit.trim().toLowerCase();
  return (u === 'serving' || u === 'servings' || u === 'portion' || u === 'portions') && Number.isFinite(portion.count) && portion.count > 0 ? portion.count : null;
}

/**
 * Typed components (from the person, the Coach or `food.parse`) → resolved components (no nutrients from the caller).
 *
 * Recipes (D6-04): a recipe with a known final edible mass (measured, sourced, mass balance, or the legacy dish weight) takes
 * grams of the cooked dish; one without takes only a share of the batch (`batchFraction`, or a portion in servings, default
 * one serving) — a cooked-gram amount is refused rather than given a fabricated density. Name matching prefers a record
 * whose preparation state matches the words used ("boiled chickpeas" never selects the raw row, D6-05); a near tie between
 * records is kept as an identity-ambiguity group (no probabilities, D6-06).
 */
export function resolveComponents(components: readonly MealComponentIn[], method: Method, table: FoodTable): ResolvedComponent[] {
  return components.map((c, i) => {
    let per100: ResolvedComponent['per100'];
    let nutrientSource: ResolvedComponent['nutrientSource'] = 'table';
    let foodId: string | undefined;
    let recipeId: string | undefined;
    let idConfidence = 0;
    let name = c.name;
    let defaultG: number | undefined;
    let snapshot: MealComponent['snapshot'];
    let recipeServing: RecipeServingSnapshot | undefined;
    let fractionGrams: number | undefined;
    let candidates: string[] | undefined;
    const groupIds: string[] = [];
    // (A1-024) the carbohydrate basis a label is read under: as stated, else unknown (never a guessed legacy subtraction)
    let labelBasis: CarbohydrateBasis | undefined;
    if (c.fromSnapshot && (c.fromSnapshot.source === 'label' || c.fromSnapshot.source === 'user')) {
      // relog of label/typed numbers under the basis they were read with (the explicit legacy adapter for old entries)
      labelBasis = c.fromSnapshot.carbBasis ?? 'legacyTotalByDifference';
      const l = per100OfLabel(c.fromSnapshot.per100g as Record<string, unknown>, labelBasis);
      if (!l) fail('invalid_input', `The stored values of "${c.name}" can no longer be read; give the label values again.`, { path: `/components/${i}/fromSnapshot` });
      per100 = l;
      nutrientSource = c.fromSnapshot.source;
      idConfidence = 1;
      if (c.foodId && table.get(c.foodId)) foodId = c.foodId;
      snapshot = { source: c.fromSnapshot.source, per100g: { ...c.fromSnapshot.per100g } };
    } else if (c.fromSnapshot) {
      // relog: the stored composition, cloned (same source version, same energy method)
      per100 = per100OfSnapshot(c.fromSnapshot.per100g);
      if (c.fromSnapshot.imputed && c.fromSnapshot.imputed.length > 0) per100 = { ...per100, imputed: [...c.fromSnapshot.imputed] };
      if (c.fromSnapshot.energySource) per100 = { ...per100, energySource: sourceEnergyOfSnapshot(c.fromSnapshot.energySource, per100.energyKcal) };
      idConfidence = 1;
      if (c.fromSnapshot.source === 'recipe') recipeId = c.fromSnapshot.id;
      else foodId = c.fromSnapshot.id;
      snapshot = { source: c.fromSnapshot.source, ...(c.fromSnapshot.id ? { id: c.fromSnapshot.id } : {}), ...(c.fromSnapshot.version ? { version: c.fromSnapshot.version } : {}), per100g: { ...c.fromSnapshot.per100g } };
      if (c.fromSnapshot.recipeServing) recipeServing = c.fromSnapshot.recipeServing;
    } else if (c.labelPer100g) {
      labelBasis = c.carbBasis ?? LABEL_CARB_BASIS_DEFAULT.basis;
      const l = per100OfLabel(c.labelPer100g, labelBasis);
      if (!l) fail('invalid_input', `The label values for "${c.name}" need energyKcal per 100 g (or proteinG, fatG and carbG with their carbBasis); leave out values the label does not give, and give only numbers ≥ 0.`, { path: `/components/${i}/labelPer100g` });
      per100 = l;
      nutrientSource = method === 'label' || isPhotoMethod(method) ? 'label' : 'user';
      idConfidence = 1;
      if (c.foodId && table.get(c.foodId)) foodId = c.foodId;
      // the label exactly as given (null = not given), never a zero for a missing field
      snapshot = { source: nutrientSource === 'label' ? 'label' : 'user', per100g: { ...labelFieldsOf(c.labelPer100g)!, ...labelExtraOf(c.labelPer100g)! } };
    } else if (c.recipeId) {
      const r = readRecipe(c.recipeId);
      const spec = r ? normalizeRecipe(r) : null;
      const comp = spec ? recipeComposition(spec, table) : null;
      // (A1-043) a stored recipe that needs review (e.g. cooked grams read against a raw record) is never logged as if it
      // were consistent, and never silently replaced by a food that matches its name
      if (r && comp && comp.issues.length > 0) fail('invalid_input', `The recipe "${r.title}" needs review before it can be logged: ${comp.issues.join('; ')}.`, { path: `/components/${i}/recipeId`, retryable: false });
      if (r && spec && comp && comp.issues.length === 0) {
        recipeId = c.recipeId;
        idConfidence = 1;
        name = c.name || r.title;
        const version = r.updatedAt ?? r.createdAt ?? table.version;
        const servings = Math.max(1, r.servings || 1);
        const portionServings = servingsOf(c.portion);
        // a share of the batch: explicit fraction, servings, or nothing said (one serving); grams or a household portion
        // (katori, cup) are cooked amounts and need a known final mass
        const wantsFraction = c.batchFraction !== undefined || portionServings !== null || (c.grams === undefined && c.gramsLow === undefined && !c.portion);
        if (!wantsFraction && !comp.per100) {
          fail('invalid_input', `The cooked weight of "${r.title}" is not known, so grams of it cannot be counted precisely. Log a share of the batch (batchFraction) or servings, or save the recipe with its final weight.`, { path: `/components/${i}/grams` });
        }
        if (wantsFraction) {
          const fraction = c.batchFraction ?? (portionServings !== null ? portionServings / servings : 1 / servings);
          const basisMass = comp.finalEdibleMassG ?? comp.nominalMassG;
          per100 = comp.per100 ?? nominalPer100(comp);
          fractionGrams = basisMass * fraction;
          recipeServing = {
            recipeVersion: version, fractionOfBatch: fraction, finalEdibleMassG: comp.finalEdibleMassG, massBasis: comp.massBasis, batch: { ...comp.batch },
            ...(Object.keys(comp.batchUpper).length > 0 ? { batchUpper: { ...comp.batchUpper } } : {}),
            ...(comp.energySources.length > 0 ? { energySources: comp.energySources } : {}),
            ...(comp.assumptions.length > 0 ? { assumptions: [...comp.assumptions] } : {}),
          };
        } else per100 = comp.per100;
        defaultG = (comp.finalEdibleMassG ?? comp.nominalMassG) / servings;
        if (per100) snapshot = snapshotOf('recipe', per100, c.recipeId, version);
        const spec2 = spec as RecipeSpec;
        if ((spec2.discards ?? []).some((d) => d.kind === 'oil') || spec2.ingredients.some((x) => ['fats', 'oils'].includes(table.get(x.foodId)?.group ?? ''))) groupIds.push(`retainedOil:recipe:${c.recipeId}@${version}`);
      }
    }
    if (!per100 && c.foodId && table.get(c.foodId)) {
      foodId = c.foodId;
      per100 = per100OfFood(c.foodId, table, asEatenOfComponent(c, table.get(c.foodId)));
      idConfidence = 1;
    }
    if (!per100) {
      const q = c.localName ?? c.name;
      const words = `${c.name} ${c.localName ?? ''} ${c.cookingMethod ?? ''}`;
      const state = stateOfText(words);
      const fort = fortificationOfText(words);
      const m = matchFood(q, table, state, fort) ?? (c.localName ? matchFood(c.name, table, state, fort) : null);
      if (m && m.score >= 0.3) {
        foodId = m.food.id;
        per100 = per100OfFood(m.food.id, table, asEatenOfComponent(c, m.food));
        idConfidence = m.score;
        // a near tie between different records is an identity-ambiguity candidate set (no inferred probabilities)
        const near = table.search(q, 5).filter((f) => f.id !== m.food.id && stateCompatible(f, state) && fortificationCompatible(f, fort) && matchScore(q, [f.name, ...f.aliases]) >= m.score - 0.05);
        if (near.length > 0) candidates = [m.food.id, ...near.map((f) => f.id)];
      }
    }
    if (per100 && !snapshot && foodId) snapshot = snapshotOf('food', per100, foodId, recordVersion(foodId, table));
    const food = foodId ? table.get(foodId) : undefined;
    let grams: number;
    let amount: AmountKind | 'label';
    if (fractionGrams !== undefined) {
      grams = fractionGrams;
      amount = 'household';
    } else if (c.grams !== undefined) {
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
    const lowG = fractionGrams !== undefined ? grams * (1 - spread) : (c.gramsLow ?? grams * (1 - spread));
    const highG = fractionGrams !== undefined ? grams * (1 + spread) : (c.gramsHigh ?? grams * (1 + spread));
    if (c.labelPer100g && amount === 'weighed') amount = 'label';
    const amountMethod: AmountMethod | undefined = c.amountMethod ?? (isPhotoMethod(method) ? 'photoEstimated' : undefined);
    const basis = labelBasis ?? (food && food.carbBasis ? carbBasisOf(food) : undefined);
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
      band: bandOf(method, amount, amountMethod),
      ...(amountMethod ? { amountMethod } : {}),
      ...(basis ? { carbBasis: basis } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(recipeServing ? { recipeServing } : {}),
      ...(candidates ? { identityCandidates: candidates } : {}),
      ...(groupIds.length > 0 ? { groupIds } : {}),
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
      /**
       * (C3/D6-02) energy ledger of the entry: reported energy kept as given, convention energy and residual, which macros
       * are known. `status` 'energyOnly' = some macros unknown (energy still counts in full); 'conflict' = the numbers
       * disagree (both kept; a correction may be asked for, nothing was rewritten).
       */
      energy: EnergyLedger;
      /** Known partial sums of the fields listed in `totals.unknown` (lower bounds). */
      lowerBounds?: Partial<Record<'energyKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fibreG', number>>;
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
  /** An explicit clock hour (an occurrence on `date`). */
  clockH?: number;
  /** (C1) an explicit instant of the meal. */
  occurredAt?: string;
  /** Who stated the time: the person/agent ('user') or the photo's capture metadata ('device'). */
  occurrenceSource?: OccurrenceTime['source'];
  /** A clock used only to fill the legacy `clockH` (a planned slot clock): never an occurrence. */
  assumedClockH?: number;
  slot?: string;
  text?: string;
  method: Method;
  itemId?: string;
  attachmentIds?: string[];
  complete?: boolean;
  /** The caller's own confidence (an AI's identification confidence); the lower of it and the app's is used. */
  confidence?: number;
  saw?: string;
  /** (C2) an explicit extra occurrence beside the planned meals. */
  extra?: boolean;
  /** (D6-07) eating duration, h, and physical form, kept as given. */
  intakeDurationH?: number;
  form?: 'solid' | 'liquid' | 'mixed' | 'unknown';
  /** (D6-07) the event's carbohydrate mixture when stated (g glucose-eq / fructose / galactose; the rest unknown, never glucose). */
  carbComposition?: CarbCompositionIn;
}

/** (D6-07) A stated carbohydrate mixture of one meal, g; absent components are unknown. */
export interface CarbCompositionIn {
  glucoseEqG?: number;
  fructoseG?: number;
  galactoseG?: number;
  unknownG?: number;
}

/** A stated mixture kept as given when every value is a finite number ≥ 0 (else rejected). */
function carbCompositionOf(c: CarbCompositionIn | undefined): CarbCompositionIn | undefined {
  if (!c) return undefined;
  const out: CarbCompositionIn = {};
  for (const k of ['glucoseEqG', 'fructoseG', 'galactoseG', 'unknownG'] as const) {
    const v = c[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail('invalid_input', 'Carbohydrate mixture values are grams ≥ 0.', { path: `/carbComposition/${k}` });
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  // (C1/D5-01) occurrence only from an explicit instant/clock/capture time; the slot's planned clock, the command time and
  // the noon default only fill the legacy clockH of a date-only occurrence (never a guessed time). An "as planned" tick
  // replays the prescription, so its clock is the plan's (an occurrence only with an explicit instant).
  const statedClock = w.method === 'asPlanned' ? undefined : w.clockH;
  const occ = mealOccurrence({ date: w.date, tz: ctx.tz, ...(w.occurredAt !== undefined ? { occurredAt: w.occurredAt } : {}), ...(statedClock !== undefined ? { clockH: statedClock } : {}), source: w.occurrenceSource ?? occurrenceSourceOf(ctx) });
  const clockH = w.clockH ?? occ.clockH ?? w.assumedClockH ?? slotClock ?? (w.date === ctx.today ? clockHourOf(ctx.now, ctx.tz) : 12);
  const id = ctx.newId();
  const mealComponents = toMealComponents(e);
  const totals = toNutrientEstimate(e.totals);
  const comps = mealComponents.map((c) => ({ nutrients: c.nutrients, source: sourceOfComponent(c, w.method), grams: c.grams.value, snapshot: c.snapshot ?? null, ...(c.imputedNutrients ? { imputed: c.imputedNutrients } : {}) }));
  const energy = mealEnergyLedger(totals, comps);
  const exposures = mealExposures(comps, { method: w.method, originEventId: id, sourceVersion: table.version });
  // (C3/D5-01) food-derived caffeine joins the shared exposure ledger when a source lists it (absent = not analysed). It
  // replaces the snapshot aggregate of the same identity (one caffeine exposure per meal, never two), keeping an imputed mark.
  if (e.caffeineMg) {
    const at = exposures.findIndex((x) => x.id === 'caffeine');
    const imputed = at >= 0 && exposures[at]!.provenance === 'imputed';
    if (at >= 0) exposures.splice(at, 1);
    exposures.push({
      id: 'caffeine', value: e.caffeineMg.complete ? e.caffeineMg.knownSum : null, ...(e.caffeineMg.complete ? {} : { lowerBound: e.caffeineMg.knownSum }), unit: 'mg',
      provenance: imputed ? 'imputed' : provenanceOf(w.method, commonSource(comps)), coverage: w.method === 'asPlanned' ? 'asPlannedEstimate' : e.caffeineMg.complete ? 'complete' : 'partial', originEventId: id, sourceVersion: table.version,
    });
  }
  // (C3/D6-06) shared-error groups: one portion mass per component; one composition per source record version (shared
  // across events, so a joint draw moves every meal of that food together); one yield (and retained oil) per recipe
  // version; one persistent reporting bias per non-weighed amount method of the person (it never averages away over
  // repeated logs, unlike independent scale noise); an identity-ambiguity group when records tied for the name
  const resolvedComps = e.components.filter((c) => c.nutrients);
  mealComponents.forEach((c, i) => {
    const r = resolvedComps[i];
    const groups = [`portionMass:${id}:${i}`];
    const snap = c.snapshot;
    if (snap?.source === 'food' || snap?.source === 'recipe') groups.push(`sourceComposition:${snap.source}:${snap.id ?? c.name}@${snap.version ?? table.version}`);
    else groups.push(`sourceComposition:${snap?.source ?? 'entry'}:${id}:${i}`);
    if (snap?.source === 'recipe') groups.push(`batchYield:recipe:${snap.id}@${snap.version ?? table.version}`);
    for (const g of r?.groupIds ?? []) groups.push(g);
    const am = c.amountMethod ?? 'unknown';
    if (am !== 'weighed' && am !== 'labelServing') groups.push(`reportingBias:person:${am}`);
    if (r?.identityCandidates && r.identityCandidates.length > 1) groups.push(`identityAmbiguity:${id}:${i}:${r.identityCandidates.join('|')}`);
    c.uncertaintyGroupIds = groups;
  });
  const entry = {
    date: w.date,
    tz: ctx.tz,
    at: ctx.now,
    recordedAt: ctx.now,
    occurrence: occ.occurrence,
    contract: CONTRACT_VERSIONS.observation,
    provenance: provenanceOf(w.method, commonSource(comps)),
    sourceVersion: table.version,
    source: sourceOf(ctx, w.method),
    confidence,
    ...(rx ? { planId: rx.planId, planDay: day.planDay ?? rx.planDay } : {}),
    ...(w.itemId ? { itemId: w.itemId } : {}),
    ...(w.itemId && rx ? { link: { planId: rx.planId, version: rx.version, itemId: w.itemId } } : {}),
    ...(w.extra ? { extra: true } : {}),
    ...(w.text ? { text: w.text } : {}),
    ...(w.attachmentIds?.length ? { attachmentIds: w.attachmentIds } : {}),
    kind: 'meal' as const,
    clockH,
    ...(w.slot ? { slot: w.slot } : {}),
    ...(w.complete !== undefined ? { complete: w.complete } : {}),
    components: mealComponents,
    totals,
    energy,
    exposures,
    nutrientCoverage: nutrientCoverageOf(exposures),
    ...(w.intakeDurationH !== undefined ? { intakeDurationH: w.intakeDurationH } : {}),
    ...(w.form ? { form: w.form } : {}),
    ...(carbCompositionOf(w.carbComposition) ? { carbComposition: carbCompositionOf(w.carbComposition)! } : {}),
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
    energy,
    ...(e.lowerBounds ? { lowerBounds: e.lowerBounds } : {}),
  };
}

/** Who states an occurrence: the person or an agent relaying them ('user'), an import ('import'). */
function occurrenceSourceOf(ctx: CommandContext): OccurrenceTime['source'] {
  return ctx.actor.kind === 'companion' ? 'import' : ctx.actor.kind === 'system' ? 'derived' : 'user';
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
  occurredAt?: string;
  extra?: boolean;
  intakeDurationH?: number;
  form?: 'solid' | 'liquid' | 'mixed' | 'unknown';
  carbComposition?: CarbCompositionIn;
}

const WRITE_KEYS = ['clockH', 'occurredAt', 'slot', 'text', 'itemId', 'attachmentIds', 'complete', 'confidence', 'extra', 'intakeDurationH', 'form', 'carbComposition'] as const;

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
    // the frozen prescription of the slot (planned carbohydrate is already net); its clock is the plan's, not an occurrence
    const label = { energyKcal: planned.energyKcal, proteinG: planned.proteinG, carbG: planned.carbG, fatG: planned.fatG };
    const e = estimateMeal(resolveComponents([{ name: 'as planned', grams: 100, labelPer100g: label, carbBasis: 'available' }], 'asPlanned', table));
    return commitMeal(ctx, e, { date, method: 'asPlanned', assumedClockH: planned.clockH, ...pick(input, WRITE_KEYS) }, table);
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
      r.band = bandOf(input.method, p.amount, r.amountMethod);
    });
  }
  const e = estimateMeal(resolved);
  return commitMeal(ctx, e, { date: input.date ?? ctx.today, method: input.method, ...pick(input, WRITE_KEYS) }, table);
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
  // (D6-01) a label read from a photo is a newly imported label: without a stated basis its carbohydrate basis is unknown
  // (available carbohydrate unresolved, energy and the printed value kept), never guessed from the label's look or locale
  const photoBasis: CarbohydrateBasis = rec.labelCarbBasis ?? 'unknown';
  const label = rec.labelPer100g && rec.components.length === 1 ? per100OfLabel(rec.labelPer100g, photoBasis) : null;
  return rec.components.map((c) => {
    let foodId: string | undefined;
    let match = 0;
    if (c.foodId && table.get(c.foodId)) {
      foodId = c.foodId;
      match = 1;
    } else {
      const words = `${c.name} ${c.localName ?? ''} ${c.cookingMethod ?? ''}`;
      const state = stateOfText(words);
      const fort = fortificationOfText(words);
      const m = matchFood(c.localName ?? c.name, table, state, fort) ?? (c.localName ? matchFood(c.name, table, state, fort) : null);
      if (m && m.score >= 0.3) {
        foodId = m.food.id;
        match = m.score;
      }
    }
    // large single components are under-estimated from photos (R8 §6.3): raise 10 %, widen the upper band only
    const big = c.grams > 400;
    const grams = big ? c.grams * 1.1 : c.grams;
    const per100 = label ?? (foodId ? per100OfFood(foodId, table, asEatenFormOf({ preparation: c.cookingMethod ?? null, describe: [c.name, c.localName] })) : undefined);
    const snapshot: MealComponent['snapshot'] = label ? { source: 'label', per100g: { ...labelFieldsOf(rec.labelPer100g!)!, ...labelExtraOf(rec.labelPer100g!)! } } : per100 && foodId ? snapshotOf('food', per100, foodId, recordVersion(foodId, table)) : undefined;
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
      amountMethod: 'photoEstimated' as const,
      ...(label ? { carbBasis: photoBasis } : !label && foodId && table.get(foodId)?.carbBasis ? { carbBasis: carbBasisOf(table.get(foodId)!) } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(!label && foodId && c.alternatives && c.alternatives.some((a) => a !== foodId && table.get(a)) ? { identityCandidates: [foodId, ...c.alternatives.filter((a) => a !== foodId && table.get(a))] } : {}),
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
    // (C1/D5-01) the photo's capture time is device evidence of when the meal happened; the upload time is not
    const captured = input.clockH === undefined && rec.capturedAt !== undefined && Number.isFinite(Date.parse(rec.capturedAt)) ? { occurredAt: rec.capturedAt, occurrenceSource: 'device' as const } : {};
    return commitMeal(ctx, e, { date: ctx.today, method: 'aiPhoto', confidence: rec.confidence, attachmentIds: [input.attachmentId], saw: rec.saw, ...captured, ...pick(input, ['clockH', 'slot', 'text']) }, table);
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

/**
 * The supplements line for a date: catalogue items serving the person's goals, only when they opted in. Each item's
 * suggestion goes through the shared policy evaluator (D7-03) built from the CURRENT screening, marker evaluation, food
 * allergies, refusals and clinician stops (`foodSupplementPolicy`), the same input Coach, `supplements.*` and the planner
 * use; a caller may pass its own evaluator (`policy`). Unreadable safety facts stay `unchecked`, never a negative screen.
 */
export async function daySupplementLine(ctx: CommandContext, date: string, policy?: SupplementPolicy): Promise<SupplementLine> {
  await ready();
  const { prescription } = await readDay(ctx, date);
  const decide = policy ?? (await foodSupplementPolicy(ctx));
  return supplementLine({ setup: readFoodSetup(), prescribed: prescription?.supplements.map((s) => s.supplementId) ?? [], policy: decide });
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
        ...(f.fit.carbStatus === 'bounded' ? { carbStatus: f.fit.carbStatus, carbRange: f.fit.carbRange } : {}),
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
interface RecipeIngredientInput {
  foodId?: string;
  gramsRaw?: number;
  grams?: number;
  massG?: number;
  massBasis?: 'asPurchased' | 'edible';
  state?: 'raw' | 'cooked' | 'asEaten' | 'unknown';
  preparation?: string;
  retention?: Record<string, number>;
  role?: string;
  flexible?: boolean;
  unitHint?: string;
}

interface RecipeIn {
  id?: string;
  title?: string;
  cuisine?: string;
  servings?: number;
  ingredients?: RecipeIngredientInput[];
  steps?: string[];
  activeMin?: number;
  passiveMin?: number;
  equipment?: string[];
  /** (D6-04) schema 2: the final edible batch mass and where it comes from; added/discarded components; water. */
  finalEdibleMassG?: number;
  yieldSource?: 'measured' | 'sourcedEstimate' | 'unknown';
  /** (A1-044) `massG`: the addition's own material mass (edible g); `foodId`: its identity, never also an ingredient. */
  additions?: Array<{ name: string; nutrients: Record<string, number>; massG?: number; foodId?: string }>;
  discards?: Array<{ kind: 'oil' | 'liquid' | 'other'; massG?: number; nutrients?: Record<string, number> }>;
  waterAddedG?: number;
  evaporationG?: number;
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

const V2_FIELDS = ['finalEdibleMassG', 'yieldSource', 'additions', 'discards', 'waterAddedG', 'evaporationG'] as const;

/**
 * `food.saveRecipe`. Legacy input (ingredients with `gramsRaw`/`grams` only) keeps the legacy arithmetic (dish weight = Σ
 * ingredient grams, legacy mass basis). Schema 2 (D6-04) — any ingredient `massBasis`/`state` or a recipe-level yield,
 * additions, discards or water — needs each ingredient's mass basis confirmed (as purchased or edible), validates every
 * mass as finite and positive (Infinity/NaN rejected), and stores the immutable batch composition at save. Without a final
 * edible mass the recipe has no cooked-gram density and is logged as a share of its batch. `gramsRaw` stays on each
 * ingredient for legacy readers.
 */
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
    const v2 = r.ingredients!.some((it) => it.massBasis !== undefined || it.state !== undefined || it.massG !== undefined) || V2_FIELDS.some((k) => r[k] !== undefined);
    const ingredients = r.ingredients!.map((it, i) => {
      const g = it.massG ?? it.gramsRaw ?? it.grams;
      if (typeof it.foodId !== 'string' || !table.get(it.foodId)) fail('invalid_input', `Ingredient ${i + 1} needs a food id from the food table.`, { path: `/recipe/ingredients/${i}/foodId` });
      if (typeof g !== 'number' || !Number.isFinite(g) || !(g > 0)) fail('invalid_input', `Ingredient ${i + 1} needs grams: a finite number > 0.`, { path: `/recipe/ingredients/${i}/gramsRaw` });
      if (v2 && it.massBasis !== 'asPurchased' && it.massBasis !== 'edible') fail('invalid_input', `Ingredient ${i + 1}: say whether its grams are as purchased (with peel, bones…) or edible.`, { path: `/recipe/ingredients/${i}/massBasis` });
      return {
        foodId: it.foodId!,
        gramsRaw: g!,
        ...(v2 ? { massG: g!, massBasis: it.massBasis!, ...(it.state ? { state: it.state } : {}), ...(it.preparation ? { preparation: it.preparation } : {}), ...(it.retention ? { retention: it.retention } : {}) } : {}),
        role: it.role ?? 'main',
        flexible: it.flexible ?? true,
        ...(it.unitHint ? { unitHint: it.unitHint } : {}),
      };
    });
    const yieldSource = r.yieldSource ?? (r.finalEdibleMassG !== undefined ? 'measured' : 'unknown');
    const v2Fields = v2
      ? {
          schemaVersion: 2 as const,
          yieldSource,
          ...(r.finalEdibleMassG !== undefined ? { finalEdibleMassG: r.finalEdibleMassG } : {}),
          ...(r.additions ? { additions: r.additions } : {}),
          ...(r.discards ? { discards: r.discards } : {}),
          ...(r.waterAddedG !== undefined ? { waterAddedG: r.waterAddedG } : {}),
          ...(r.evaporationG !== undefined ? { evaporationG: r.evaporationG } : {}),
        }
      : {};
    const spec = normalizeRecipe({ ...v2Fields, servings, ingredients: ingredients as unknown as Array<Record<string, unknown>> });
    const problems = validateRecipe(spec);
    if (problems.length > 0) fail('invalid_input', `${problems.join('; ')}.`, { path: '/recipe' });
    // the app computes the recipe's nutrients (any numbers in the input are ignored): one serving = 1/servings of the batch
    const comp = recipeComposition(spec, table);
    if (comp.issues.length > 0) fail('invalid_input', `${comp.issues.join('; ')}.`, { path: '/recipe/ingredients' });
    const per100 = comp.per100 ?? nominalPer100(comp);
    const basisMass = comp.finalEdibleMassG ?? comp.nominalMassG;
    const parts = per100 ? estimateMeal([{ name: r.title!, grams: basisMass / servings, gramsLow: basisMass / servings, gramsHigh: basisMass / servings, amount: 'weighed', per100, nutrientSource: 'table', idConfidence: 1, band: 'household' }]) : null;
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
      ...(parts ? { perServing: toNutrientEstimate(parts.totals) } : {}),
      ...v2Fields,
      ...(v2
        ? {
            composition: {
              recipeVersion: ctx.now, batch: comp.batch, finalEdibleMassG: comp.finalEdibleMassG, massBasis: comp.massBasis, per100g: comp.per100 ? per100Record(comp.per100) : null,
              ...(Object.keys(comp.batchUpper).length > 0 ? { batchUpper: comp.batchUpper } : {}),
              ...(comp.energySources.length > 0 ? { energySources: comp.energySources } : {}),
              ...(comp.assumptions.length > 0 ? { assumptions: comp.assumptions } : {}),
            },
          }
        : {}),
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
