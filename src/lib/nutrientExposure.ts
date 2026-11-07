/**
 * The meal nutrient/energy exposure provider (C3, D6-02; consumers: food commands, the realised history, the compiler, the
 * engine intake, markers/safety and the Food screens). One normalised reading of an immutable meal entry:
 *
 *  - Reported metabolizable energy is preserved as observed, independently of macro completeness. A macro the source did
 *    not give is UNKNOWN (null), never zero, and no macro is invented by forcing 4/4/9 closure (`EnergyLedger`).
 *  - The convention ME (4P + 4C_available + 9(F − MCT) + 8.3·MCT + 2·fibre + 7·ethanol, kcal; `conventionEnergyKcal`) and the
 *    residual reported − convention are recorded beside it. A food-table/recipe residual is a source-reconciliation residual
 *    (specific vs general factors), never missing substrate; a typed/label residual beyond the declared tolerance, or known
 *    terms exceeding the reported total, is a source conflict. Both inputs are kept; nothing is rewritten.
 *  - Exposures carry identity, canonical unit, provenance, coverage and the known partial sum as a lower bound.
 *  - Legacy entries are read through `readMealIntake`: a typed kcal-only entry from the old manual path stored unknown
 *    carbohydrate/fat as 0; when those zeros cannot reproduce the reported energy they are read as unknown (legacy-unknown),
 *    while zeros consistent with the energy stay genuine zeros. Stored documents are never rewritten (C1/C7).
 *
 * The intake boundary is reported ME: urinary/fecal deductions already inside ME are never charged again (C7). Pure.
 *
 * Version 2 (W1, D6-03/D6-06/D7-04) adds the shared nutrient ledger: one unit/form-aware accumulator (`accumulateNutrient`)
 * returning the known sum, nutrient-specific completeness, unknown components and derivation for every nutrient a frozen
 * composition snapshot carries (sodium, saturated fat, calcium, vitamins…); explicit linked-event reconciliation of food
 * and separately logged caffeine/ethanol/supplement exposure (`reconcileLinkedExposures`: never by equal amount or time);
 * active-ingredient summaries with event peaks, daily totals and cumulative exposure, scoped food+supplement versus
 * supplemental-only (`ingredientExposureSummary`, `upperLimitCheck`); and deterministic shared-draw scenarios
 * (`scenarioTotals`). This module owns transport and arithmetic only: D8 interprets intake references, D7 safety rules.
 *
 * Version 3 (A1-023/A1-031/A1-042): a day sum is built over the union of identities of every meal (a meal that does not
 * analyse a nutrient is an unknown contribution, never zero); identified polyols keep their identities (breakdown
 * exposures, `polyolsOf`) and their unmodelled substrate route is separate from energy reconciliation; a recipe nutrient
 * with an unknown removal carries an upper bound (`upper:<key>` snapshot keys), never a lower bound.
 */
import {
  CONTRACT_VERSIONS,
  EXPOSURE_UNITS,
  GENERAL_ENERGY_FACTORS,
  activeExposureFromServing,
  buildEnergyLedger,
  convertMass,
  substrateRouteOf,
  normalizeSubstanceDose,
  type CanonicalUnit,
  type ChannelCoverage,
  type EnergyLedger,
  type EnergyLedgerStatus,
  type ExposureId,
  type ExposureQuantity,
  type MacroGrams,
  type OccurrenceTime,
  type OutputStatus,
  type IsoDate,
  type QuantityProvenance,
  type SafetyCheckStatus,
  type SupplementProduct,
  type SubstrateRoute,
  type SupplementSchedule,
  type UncertaintyGroup,
  type UncertaintyGroupKind,
} from './bodyContracts';
import type { Est, LogEntry, MealComponent, NutrientEstimate } from '@/living/types';

/** Version of this provider's interpretation of stored meal entries (bump on any semantic change; C7). */
export const NUTRIENT_EXPOSURE_VERSION = 3;

/** Nutrient fields of a meal estimate this provider reads, in canonical units (kcal, g, mg). */
export type NutrientField = 'energyKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fibreG' | 'satFatG' | 'sugarsG' | 'alcoholG' | 'sodiumMg';
export const NUTRIENT_FIELDS: readonly NutrientField[] = ['energyKcal', 'proteinG', 'carbG', 'fatG', 'fibreG', 'satFatG', 'sugarsG', 'alcoholG', 'sodiumMg'];

/** Exposure identity of each field (`carbG` is available carbohydrate, the engine convention). */
export const FIELD_EXPOSURE: Readonly<Record<NutrientField, ExposureId>> = {
  energyKcal: 'energy',
  proteinG: 'protein',
  carbG: 'carbAvailable',
  fatG: 'fat',
  fibreG: 'fibre',
  satFatG: 'satFat',
  sugarsG: 'sugars',
  alcoholG: 'ethanol',
  sodiumMg: 'sodium',
};

/**
 * Engineering reconciliation tolerance for numbers typed by the person or transcribed from a label (UNCALIBRATED display
 * rule, not physiology): label rounding (energy to 5–10 kcal, each macro to ±0.5 g) plus general-vs-specific factor
 * differences, max(15 kcal, 10 % of the reported energy). It only sets the `conflict` status; it never rewrites a value.
 */
export const RECONCILIATION_TOLERANCE = { absKcal: 15, relative: 0.1 } as const;

export function reconciliationToleranceKcal(reportedKcal: number): number {
  return Math.max(RECONCILIATION_TOLERANCE.absKcal, RECONCILIATION_TOLERANCE.relative * Math.max(0, reportedKcal));
}

/**
 * Where a component's composition came from. `table`/`recipe` = grams × a frozen source record; `label` = transcribed
 * label; `user` = numbers the person typed; `asPlanned` = the frozen prescription of the slot (an estimate, not a weighing).
 */
export type CompositionSource = 'table' | 'recipe' | 'label' | 'user' | 'asPlanned' | 'model';

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Value of a field in an estimate, or null when the field is absent or listed unknown. */
export function knownValue(t: NutrientEstimate, f: NutrientField): number | null {
  if (t.unknown?.includes(f)) return null;
  const e = t[f] as Est | undefined;
  return e && isNum(e.value) ? e.value : null;
}

/**
 * Macro grams of an estimate for the energy ledger. `ethanolAbsent` says what an absent `alcoholG` means: `zero` for
 * complete source records (food tables, recipes and labels giving every macro list alcohol only when present), `unknown`
 * for partial typed numbers. MCT is not tracked per meal yet: all fat is at the fat factor (`mctG` undefined).
 */
export function macroGramsOf(t: NutrientEstimate, ethanolAbsent: 'zero' | 'unknown'): MacroGrams {
  const alcohol = t.unknown?.includes('alcoholG') ? null : t.alcoholG && isNum(t.alcoholG.value) ? t.alcoholG.value : ethanolAbsent === 'zero' ? 0 : null;
  return { proteinG: knownValue(t, 'proteinG'), carbAvailableG: knownValue(t, 'carbG'), fatG: knownValue(t, 'fatG'), fibreG: knownValue(t, 'fibreG'), ethanolG: alcohol };
}

/** Σ of the KNOWN convention-energy terms (each ≥ 0), kcal: a lower bound of the energy the known grams imply. */
export function knownTermsKcal(m: MacroGrams, factors: Partial<Record<keyof typeof GENERAL_ENERGY_FACTORS, number>> = {}): number {
  const f = { ...GENERAL_ENERGY_FACTORS, ...factors };
  const mct = isNum(m.mctG) ? m.mctG : 0;
  let s = 0;
  if (isNum(m.proteinG)) s += f.protein * m.proteinG;
  if (isNum(m.carbAvailableG)) s += f.carbAvailable * m.carbAvailableG;
  if (isNum(m.fatG)) s += f.fat * Math.max(0, m.fatG - mct) + f.mct * Math.min(mct, m.fatG);
  if (isNum(m.fibreG)) s += f.fibre * m.fibreG;
  if (isNum(m.ethanolG)) s += f.ethanol * m.ethanolG;
  return s;
}

/**
 * Sources whose numbers were typed by the person, transcribed from a label or estimated by a model: only these can disagree
 * with themselves (a conflict). Food-table and recipe records and the plan's frozen numbers (`asPlanned`) come from the
 * app's own sources, so their residual against the general factors is source reconciliation (specific factors, rounding).
 */
const TYPED_SOURCES: ReadonlySet<CompositionSource> = new Set<CompositionSource>(['label', 'user', 'model']);

/**
 * Energy ledger of one composition (D6-02). Reported energy is kept; convention and residual are recorded when computable.
 *  - Typed/label/model numbers: a `conflict` when the known terms exceed the reported energy beyond the tolerance (no
 *    nonnegative unknown can fix that) or a complete set's |residual| exceeds it; within it, rounding (`energyOnly` with
 *    unknown macros, else `consistent`).
 *  - Table/recipe records and the plan's frozen numbers: the residual, of either sign, is source reconciliation, never a
 *    conflict (`consistent`, or `energyOnly` when a macro is unknown).
 *  - Identified polyols (D6-01) are outside available carbohydrate and their energy is inside the reported total at no
 *    universal factor: a positive residual up to 4 kcal/g of polyol (a first-principles bound) is reconciliation, not a
 *    conflict, and it stays energy only (never glucose). Energy reconciliation says nothing about their substrate route:
 *    `polyolIdentities` (g by identity) records it as unmodelled on the ledger (`substrateRoute`, A1-031).
 */
export function compositionLedger(input: { reportedKcal: number | null; macros: MacroGrams; source: CompositionSource; imputed?: ReadonlyArray<'protein' | 'carbohydrate' | 'fat' | 'fibre' | 'ethanol'>; polyolsG?: number | null; polyolIdentities?: Readonly<Record<string, number>> | null }): EnergyLedger {
  const typed = TYPED_SOURCES.has(input.source);
  const reported = isNum(input.reportedKcal) && input.reportedKcal >= 0 ? input.reportedKcal : null;
  const tol = typed && reported !== null ? reconciliationToleranceKcal(reported) : undefined;
  const ledger = buildEnergyLedger({ reportedMEKcal: reported, macros: input.macros, ...(input.imputed ? { imputed: input.imputed } : {}), ...(tol !== undefined ? { conflictToleranceKcal: tol } : {}), ...(input.polyolIdentities ? { polyolsG: input.polyolIdentities } : {}) });
  if (reported === null) return ledger;
  const partialStatus: EnergyLedgerStatus = ledger.conventionMEKcal === null ? 'energyOnly' : 'consistent';
  if (tol === undefined) return ledger.status === 'conflict' ? { ...ledger, status: partialStatus } : ledger;
  // known lower bound above the reported total beyond the tolerance: a conflict whatever the unknown terms are (all ≥ 0)
  const beyond = knownTermsKcal(input.macros) - reported > tol + 1e-9;
  if (ledger.conventionMEKcal === null) return { ...ledger, status: beyond ? 'conflict' : 'energyOnly' };
  const polyol = isNum(input.polyolsG) && input.polyolsG > 0 ? input.polyolsG : 0;
  if (polyol > 0 && ledger.residualKcal !== null && !beyond) {
    const r = ledger.residualKcal;
    return { ...ledger, status: r >= -tol - 1e-9 && r <= GENERAL_ENERGY_FACTORS.carbAvailable * polyol + tol + 1e-9 ? 'consistent' : 'conflict' };
  }
  return beyond && ledger.status !== 'conflict' ? { ...ledger, status: 'conflict' } : ledger;
}

/** Worst of several ledger statuses (conflict > energyUnknown > energyOnly > consistent). */
export function worstLedgerStatus(ss: readonly EnergyLedgerStatus[]): EnergyLedgerStatus {
  const rank: Record<EnergyLedgerStatus, number> = { consistent: 0, energyOnly: 1, energyUnknown: 2, conflict: 3 };
  let w: EnergyLedgerStatus = 'consistent';
  for (const s of ss) if (rank[s] > rank[w]) w = s;
  return w;
}

/**
 * C6 status of a SUBSTRATE-dependent readout (glucose/fat/amino-acid streams, ketones, glycogen, MPS) of a meal or day with
 * this ledger: complete composition → `estimated`; unknown macros → `unknown`, or `scenario` under a declared allocation;
 * a source conflict → `review` (a correction may be asked for). The energy itself stays the exact entry whatever this is.
 * An unmodelled substrate route (identified or identity-unknown polyols, A1-031) keeps a consistent ledger from certifying
 * the readout: `unknown`, or `scenario` when the zero-route computation is declared as a named conditional scenario.
 */
export function substrateOutputStatus(ledger: Pick<EnergyLedger, 'status'> & { substrateRoute?: SubstrateRoute }, scenarioDeclared = false): OutputStatus {
  switch (ledger.status) {
    case 'consistent':
      if (ledger.substrateRoute?.status === 'unmodelled') return scenarioDeclared ? 'scenario' : 'unknown';
      return 'estimated';
    case 'energyOnly':
      return scenarioDeclared ? 'scenario' : 'unknown';
    case 'conflict':
      return 'review';
    default:
      return 'unknown';
  }
}

/**
 * Composition source of a stored component: where its NUMBERS came from (it decides reconciliation vs conflict). How the
 * event was entered is separate (`provenanceOf`/coverage): a planned meal answered with a chosen recipe serving keeps its
 * recipe/table composition (a table residual stays source reconciliation); only the slot's own frozen prescription numbers
 * (typed into the entry) are `asPlanned`.
 */
export function sourceOfComponent(c: Pick<MealComponent, 'nutrientSource' | 'recipeId' | 'foodId' | 'snapshot'>, method?: string): CompositionSource {
  if (c.snapshot?.source === 'recipe' || (c.recipeId && c.nutrientSource === 'table')) return 'recipe';
  if (c.nutrientSource === 'label') return 'label';
  if (c.nutrientSource === 'user') return method === 'asPlanned' ? 'asPlanned' : 'user';
  if (c.nutrientSource === 'model') return 'model';
  return 'table';
}

/** Absent alcohol means zero for complete records (every macro known), unknown for partial typed numbers. */
function ethanolAbsentFor(t: NutrientEstimate, source: CompositionSource): 'zero' | 'unknown' {
  if (source === 'table' || source === 'recipe') return 'zero';
  const complete = knownValue(t, 'proteinG') !== null && knownValue(t, 'carbG') !== null && knownValue(t, 'fatG') !== null;
  return complete ? 'zero' : 'unknown';
}

/**
 * Meal energy ledger from its components (each with its own source) and totals: reported = Σ component energy, convention,
 * residual and macro mask from the totals; status = the worst component status (one conflicting component makes the meal a
 * conflict; one energy-only component makes it energy-only). Component tolerances apply per component, never to a sum
 * that mixes table reconciliation residuals with typed numbers.
 */
export function mealEnergyLedger(totals: NutrientEstimate, components: ReadonlyArray<{ nutrients: NutrientEstimate; source: CompositionSource; grams?: number; snapshot?: { per100g: Readonly<Record<string, number | null>> } | null }>): EnergyLedger {
  const statuses = components.map((c) => compositionLedger({ reportedKcal: knownValue(c.nutrients, 'energyKcal'), macros: macroGramsOf(c.nutrients, ethanolAbsentFor(c.nutrients, c.source)), source: c.source, polyolsG: snapshotAmount(c, 'polyolsG') }).status);
  const ethanolAbsent = components.length > 0 && components.every((c) => ethanolAbsentFor(c.nutrients, c.source) === 'zero') ? 'zero' : 'unknown';
  // (A1-031) the meal's polyols by identity: their route is recorded beside the energy status, never inside it
  const polyols = polyolsOf(components);
  const base = buildEnergyLedger({ reportedMEKcal: knownValue(totals, 'energyKcal'), macros: macroGramsOf(totals, ethanolAbsent), ...(polyols ? { polyolsG: polyols.byIdentity } : {}) });
  const status = base.status === 'energyUnknown' ? 'energyUnknown' : worstLedgerStatus(statuses.length > 0 ? statuses : [base.status]);
  return { ...base, status };
}

/* ------------------------------------------------------------------------------------------- polyol identities (A1-031) */

/** Snapshot key prefix of one identified polyol, g per 100 g (`polyolG:maltitol`); `polyolsG` is their total. */
export const POLYOL_IDENTITY_KEY_PREFIX = 'polyolG:';
/** Identity of a polyol amount whose identity the source does not give (same key as the engine's `POLYOL_IDENTITY_UNKNOWN`). */
export const POLYOL_UNIDENTIFIED = 'unidentified';
/** Named assumptions of the unmodelled polyol route (conditional; no calibrated probability). */
export const POLYOL_ROUTE_ASSUMPTIONS = { unmodelled: 'polyolRouteUnmodelled', zeroRouteScenario: 'polyolZeroGlucoseRouteScenario' } as const;

/** Snapshot key of one identified polyol (identity normalised to lower-case words). */
export function polyolIdentityKey(identity: string): string {
  return `${POLYOL_IDENTITY_KEY_PREFIX}${identity.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Polyols of a set of components from their frozen snapshots (A1-031): grams by identity (an identity-unknown remainder of
 * the printed total under `unidentified`), the total, and whether every component that reports polyols gave a number.
 * Null when no component's source mentions polyols (absence is not a statement).
 */
export interface PolyolExposure {
  byIdentity: Readonly<Record<string, number>>;
  totalG: number;
  /** False when some component's polyol total is given as unknown (null): the sums are then lower bounds. */
  complete: boolean;
}

export function polyolsOf(components: ReadonlyArray<{ grams?: number | null; snapshot?: { per100g: Readonly<Record<string, number | null | undefined>> } | null }>): PolyolExposure | null {
  const by: Record<string, number> = {};
  let total = 0;
  let any = false;
  let complete = true;
  for (const c of components) {
    const p = c.snapshot?.per100g;
    if (!p) continue;
    const g = isNum(c.grams) && c.grams >= 0 ? c.grams : null;
    const ids = Object.entries(p).filter(([k]) => k.startsWith(POLYOL_IDENTITY_KEY_PREFIX));
    if (!('polyolsG' in p) && ids.length === 0) continue;
    any = true;
    if (g === null) {
      complete = false;
      continue;
    }
    let named = 0;
    for (const [k, v] of ids) {
      if (!isNum(v) || v < 0) {
        complete = false;
        continue;
      }
      const amt = (v * g) / 100;
      const id = k.slice(POLYOL_IDENTITY_KEY_PREFIX.length);
      by[id] = (by[id] ?? 0) + amt;
      named += amt;
    }
    const t = p.polyolsG;
    if (t === null || (t !== undefined && !isNum(t))) complete = false;
    const tot = isNum(t) && t >= 0 ? (t * g) / 100 : named;
    const rest = tot - named;
    if (rest > 1e-9) by[POLYOL_UNIDENTIFIED] = (by[POLYOL_UNIDENTIFIED] ?? 0) + rest;
    total += Math.max(tot, named);
  }
  return any ? { byIdentity: by, totalG: total, complete } : null;
}

/** One composition source for a set of components (their common source, else `table` = mixed estimate). */
export function commonSource(components: ReadonlyArray<{ source: CompositionSource }>): CompositionSource {
  const first = components[0]?.source;
  return first !== undefined && components.every((c) => c.source === first) ? first : 'table';
}

/** Provenance of a meal's quantities by entry method and composition source (C1/C3). */
export function provenanceOf(method: string | undefined, source: CompositionSource): QuantityProvenance {
  if (method === 'asPlanned' || source === 'asPlanned') return 'asPlanned';
  if (source === 'label') return 'label';
  if (source === 'user') return 'reported';
  return 'estimated';
}

/** A component as the exposure functions read it; `grams` + `snapshot` add every other nutrient the snapshot carries. */
export interface ExposureComponent {
  nutrients: NutrientEstimate;
  source: CompositionSource;
  /** Edible grams eaten (for snapshot-derived nutrients). */
  grams?: number;
  /** Frozen per-100 g composition (C1/C3); null = analysed absent (unknown), a missing key = not analysed (unknown). */
  snapshot?: { per100g: Readonly<Record<string, number | null>> } | null;
  /** (D6-03) snapshot keys whose value the source imputed: they count, and the exposure stays marked `imputed`. */
  imputed?: readonly string[];
}

/** Snapshot key of each meal nutrient field (`carbG` of a meal is available carbohydrate, `netCarbG` in a snapshot). */
const FIELD_SNAPSHOT_KEY: Readonly<Record<NutrientField, string>> = {
  energyKcal: 'energyKcal',
  proteinG: 'proteinG',
  carbG: 'netCarbG',
  fatG: 'fatG',
  fibreG: 'fibreG',
  satFatG: 'satFatG',
  sugarsG: 'sugarsG',
  alcoholG: 'alcoholG',
  sodiumMg: 'sodiumMg',
};

/**
 * Normalised exposures of a meal (C3): one quantity per field the meal knows anything about. A field unknown in some
 * component is `value: null` with the known partial sum as `lowerBound` (coverage `partial`); a field unknown everywhere is
 * `value: null`, coverage `unknown`. As-planned meals carry `asPlannedEstimate` coverage. Components with a frozen
 * snapshot add every other nutrient it carries (D6-03: calcium, potassium, cholesterol, vitamins, reported carbohydrate,
 * polyols…) through the same accumulator. An unknown value gets an `upperBound` when every unknown component bounds it:
 * available carbohydrate by the reported total (available ≤ reported on any basis), a recipe nutrient with an unknown
 * removal by its `upper:<key>` snapshot bound (A1-042: the pre-discard total minus known removals, never a lower bound).
 * Identified polyols add one breakdown quantity per identity (`form: 'identity:<name>'`, A1-031) after the total; the
 * breakdown partitions the total and is never summed with it (`isExposureBreakdown`).
 */
export function mealExposures(
  components: ReadonlyArray<ExposureComponent>,
  meta: { method?: string; originEventId?: string; occurrence?: OccurrenceTime; sourceVersion?: string } = {},
): ExposureQuantity[] {
  const out: ExposureQuantity[] = [];
  const asPlanned = meta.method === 'asPlanned';
  const prov = provenanceOf(meta.method, commonSource(components));
  const tail = {
    ...(meta.originEventId ? { originEventId: meta.originEventId } : {}),
    ...(meta.occurrence ? { occurrence: meta.occurrence } : {}),
    ...(meta.sourceVersion ? { sourceVersion: meta.sourceVersion } : {}),
  };
  const coverageOf = (nKnown: number, nUnknown: number): ChannelCoverage => (asPlanned ? 'asPlannedEstimate' : nUnknown === 0 ? 'complete' : nKnown > 0 ? 'partial' : 'unknown');
  for (const f of NUTRIENT_FIELDS) {
    let known = 0;
    let nKnown = 0;
    let nUnknown = 0;
    let upper = 0;
    let upperOk = true;
    let imputed = false;
    for (const c of components) {
      const v = f === 'alcoholG' ? macroGramsOf(c.nutrients, ethanolAbsentFor(c.nutrients, c.source)).ethanolG : knownValue(c.nutrients, f);
      if (v !== null && c.imputed?.includes(FIELD_SNAPSHOT_KEY[f])) imputed = true;
      if (v === null) {
        nUnknown++;
        const rep = snapshotUpper(c, FIELD_SNAPSHOT_KEY[f]) ?? (f === 'carbG' ? snapshotAmount(c, 'carbG') : null);
        if (rep === null) upperOk = false;
        else upper += rep;
      } else {
        known += v;
        upper += v;
        nKnown++;
      }
    }
    // optional micronutrient-type fields that no component mentions are left out (absence is not a statement)
    if (nKnown === 0 && f !== 'energyKcal' && f !== 'proteinG' && f !== 'carbG' && f !== 'fatG' && f !== 'fibreG' && f !== 'alcoholG') continue;
    const id = FIELD_EXPOSURE[f];
    out.push({
      id,
      value: nUnknown === 0 ? known : null,
      ...(nUnknown > 0 && nKnown > 0 ? { lowerBound: known } : {}),
      ...(nUnknown > 0 && upperOk && components.length > 0 ? { upperBound: upper } : {}),
      unit: EXPOSURE_UNITS[id],
      ...(f === 'carbG' ? { form: 'availableCarbohydrate' } : {}),
      provenance: imputed && !asPlanned ? 'imputed' : prov,
      coverage: coverageOf(nKnown, nUnknown),
      ...tail,
    });
  }
  // every other nutrient of the frozen snapshots (D6-03), through the shared accumulator
  const done = new Set<ExposureId>(out.map((x) => x.id));
  const parts = components.map((c, i) => ({ componentId: String(i), per100: c.snapshot?.per100g ?? null, edibleG: c.grams ?? null, ...(c.imputed ? { imputed: c.imputed } : {}) }));
  for (const agg of Object.values(aggregateSnapshots(parts))) {
    if (!agg || done.has(agg.id)) continue;
    out.push({
      id: agg.id,
      value: agg.completeness === 'complete' ? agg.knownSum : null,
      ...(agg.completeness === 'partial' ? { lowerBound: agg.knownSum } : {}),
      ...(agg.upperBound !== undefined ? { upperBound: agg.upperBound } : {}),
      unit: agg.unit,
      ...(agg.form ? { form: agg.form } : {}),
      provenance: agg.imputedComponents && agg.imputedComponents.length > 0 && !asPlanned ? 'imputed' : prov,
      coverage: asPlanned ? 'asPlannedEstimate' : agg.completeness,
      ...tail,
    });
  }
  // (A1-031) the identities inside the polyol total: one breakdown quantity each (never summed with the total)
  const polyols = polyolsOf(components);
  if (polyols) {
    // an identity is as complete as the polyol total it partitions (a component without polyol analysis leaves both open)
    const total = out.find((x) => x.id === 'polyols');
    const complete = polyols.complete && total !== undefined && total.value !== null;
    for (const [identity, g] of Object.entries(polyols.byIdentity).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      out.push({
        id: 'polyols',
        value: complete ? g : null,
        ...(complete ? {} : { lowerBound: g }),
        unit: EXPOSURE_UNITS.polyols,
        form: `${EXPOSURE_BREAKDOWN_PREFIX}${identity}`,
        provenance: prov,
        coverage: asPlanned ? 'asPlannedEstimate' : complete ? 'complete' : 'partial',
        ...tail,
      });
    }
  }
  return out;
}

/** Form prefix of a breakdown quantity (a part of a total listed beside it, e.g. one identified polyol). */
export const EXPOSURE_BREAKDOWN_PREFIX = 'identity:';

/** True for a breakdown quantity: it partitions a total of the same identity and is never added to it. */
export function isExposureBreakdown(x: Pick<ExposureQuantity, 'form'>): boolean {
  return typeof x.form === 'string' && x.form.startsWith(EXPOSURE_BREAKDOWN_PREFIX);
}

/** Snapshot prefix of a per-100 g upper bound of an unknown value (`upper:energyKcal`; A1-042 unknown recipe removals). */
export const UPPER_BOUND_KEY_PREFIX = 'upper:';

/** Upper bound of one snapshot key in a component (upper per100 × grams / 100), or null. */
function snapshotUpper(c: ExposureComponent, key: string): number | null {
  const v = c.snapshot?.per100g?.[`${UPPER_BOUND_KEY_PREFIX}${key}`];
  return isNum(v) && v >= 0 && isNum(c.grams) && c.grams >= 0 ? (v * c.grams) / 100 : null;
}

/** Amount of one snapshot key in a component (per100 × grams / 100), or null when unknown. */
function snapshotAmount(c: ExposureComponent, key: string): number | null {
  const v = c.snapshot?.per100g?.[key];
  return isNum(v) && isNum(c.grams) ? (v * c.grams) / 100 : null;
}

/** Nutrient-specific coverage of a meal (C3/D6-03) from its exposures (breakdown quantities do not overwrite their total). */
export function nutrientCoverageOf(exposures: readonly ExposureQuantity[]): Partial<Record<ExposureId, ChannelCoverage>> {
  const out: Partial<Record<ExposureId, ChannelCoverage>> = {};
  for (const x of exposures) if (!isExposureBreakdown(x)) out[x.id] = x.coverage;
  return out;
}

/* ------------------------------------------------------------------------------------------- reading stored entries */

type MealEntry = Extract<LogEntry, { kind: 'meal' }>;

/** Known macro grams of a meal for the engine: absent keys are UNKNOWN (never zero). Energy is always present. */
export interface MealIntake {
  /** Energy the engine uses, kcal: the reconciled ME (reported when present, else convention). */
  energyKcal: number;
  /** Known grams only; a missing key is unknown. */
  macros: Partial<Record<'proteinG' | 'carbG' | 'fatG' | 'fibreG' | 'alcoholG', number>>;
  ledger: EnergyLedger;
  /**
   * Energy minus the convention energy of the known grams, kcal (signed). Positive with unknown macros: UNALLOCATED energy
   * (energy-only: never deposited in a named glucose/fat/amino-acid pool). With every macro known, or negative from a
   * source record: a source reconciliation residual (specific vs general factors, rounding), not missing substrate; the
   * engine applies it as a signed energy-only correction so the reported energy appears exactly. Negative beyond the
   * tolerance for typed numbers: a conflict (both kept).
   */
  unexplainedKcal: number;
  residualKind: 'unallocated' | 'reconciliation' | 'conflict' | 'none';
  /** True when the entry predates the ledger and was read through the legacy adapter. */
  legacy: boolean;
  /** Fields the legacy adapter reinterpreted from stored 0 to unknown. */
  legacyUnknown: readonly NutrientField[];
  provenance: QuantityProvenance;
  /**
   * (A1-031) Polyols of the meal by identity, g (`unidentified` = an identity-unknown total), when a source gives them:
   * outside `macros.carbG` (non-polyol available carbohydrate), their energy inside `energyKcal`. Absent = none reported.
   */
  polyolsG?: Readonly<Record<string, number>>;
  /** (A1-031) How those polyols relate to the source figures (inside the printed carbohydrate; energy inside the report). */
  polyolBasis?: { inPrintedCarb: boolean | 'unknown'; energyConvention: 'insideReportedME' };
  /**
   * (A1-031) Substrate-route availability, separate from the energy status: `unmodelled` when polyol grams have no
   * engine route (glucose/insulin/fuel/ketone readouts are then unknown or a named conditional scenario, never certified).
   */
  substrateRoute?: SubstrateRoute;
}

/**
 * Legacy typed kcal-only signature: a component of typed numbers ('user'/'model' source) whose stored zero macros cannot
 * reproduce its reported energy (energy − known terms > tolerance). Those zeros were the old manual path's placeholder for
 * "not given", so they read as unknown; zeros consistent with the energy stay genuine (D6-02 migration).
 */
export function legacyUnknownFields(c: Pick<MealComponent, 'nutrients' | 'nutrientSource'>): NutrientField[] {
  if (c.nutrientSource !== 'user' && c.nutrientSource !== 'model') return [];
  const n = c.nutrients;
  if (n.unknown) return [];
  const e = knownValue(n, 'energyKcal');
  if (e === null || e <= 0) return [];
  const zero = (['proteinG', 'carbG', 'fatG', 'fibreG'] as const).filter((f) => (n[f]?.value ?? 0) === 0);
  if (zero.length === 0) return [];
  const terms = knownTermsKcal({ proteinG: n.proteinG.value, carbAvailableG: n.carbG.value, fatG: n.fatG.value, fibreG: n.fibreG?.value ?? 0, ethanolG: n.alcoholG?.value ?? 0 });
  return e - terms > reconciliationToleranceKcal(e) ? [...zero] : [];
}

function withUnknown(n: NutrientEstimate, fields: readonly NutrientField[]): NutrientEstimate {
  if (fields.length === 0) return n;
  const prev = n.unknown ?? [];
  const set = new Set<NutrientField>([...(prev as NutrientField[]), ...fields]);
  return { ...n, unknown: [...set] as NonNullable<NutrientEstimate['unknown']> };
}

/**
 * The provider's reading of a stored meal entry (current or legacy). The realised history/compiler map it to
 * `MealSpec { energyKcal, macros }` so a 600 kcal entry with 30 g protein stays 600 kcal with C/F unknown.
 */
export function readMealIntake(entry: Pick<MealEntry, 'totals' | 'components' | 'energy' | 'source'> & { id?: string }): MealIntake {
  const method = entry.source?.method;
  const comps = entry.components.map((c) => {
    const legacyUnknown = entry.energy ? [] : legacyUnknownFields(c);
    return { nutrients: withUnknown(c.nutrients, legacyUnknown), source: sourceOfComponent(c, method), legacyUnknown };
  });
  const legacyUnknown = [...new Set(comps.flatMap((c) => c.legacyUnknown))];
  // totals: a field unknown in any component is unknown in the meal
  const unknownTotals = new Set<NutrientField>([...((entry.totals.unknown ?? []) as NutrientField[])]);
  for (const c of comps) for (const f of (c.nutrients.unknown ?? []) as NutrientField[]) unknownTotals.add(f);
  const totals = withUnknown(entry.totals, [...unknownTotals]);
  const ledger = entry.energy ?? mealEnergyLedger(totals, comps);
  const energy = ledger.reconciledMEKcal ?? knownValue(totals, 'energyKcal') ?? 0;
  const macros: MealIntake['macros'] = {};
  const ethanolAbsent = comps.length > 0 && comps.every((c) => ethanolAbsentFor(c.nutrients, c.source) === 'zero') ? 'zero' : 'unknown';
  const m = macroGramsOf(totals, ethanolAbsent);
  if (m.proteinG !== null) macros.proteinG = m.proteinG;
  if (m.carbAvailableG !== null) macros.carbG = m.carbAvailableG;
  if (m.fatG !== null) macros.fatG = m.fatG;
  if (m.fibreG !== null) macros.fibreG = m.fibreG;
  if (m.ethanolG !== null && m.ethanolG > 0) macros.alcoholG = m.ethanolG;
  const unexplained = energy - knownTermsKcal(m);
  const closes = ledger.conventionMEKcal !== null;
  // energy below what the known grams give cannot be unallocated substrate: it is reconciliation (or a conflict)
  const residualKind: MealIntake['residualKind'] = ledger.status === 'conflict' ? 'conflict' : Math.abs(unexplained) < 1e-9 ? 'none' : closes || unexplained < 0 ? 'reconciliation' : 'unallocated';
  // (A1-031) polyol identities from the frozen snapshots; the route is read from the ledger when it was assessed there
  const polyols = polyolsOf(entry.components.map((c) => ({ grams: c.grams?.value ?? null, snapshot: c.snapshot ?? null })));
  const withPolyols = polyols && polyols.totalG > 0;
  const route = ledger.substrateRoute ?? (polyols ? substrateRouteOf(polyols.byIdentity) : undefined);
  // polyols sit inside a printed carbohydrate total only on a declared basis; an undeclared or unknown basis leaves it open
  const basisKnown = entry.components.every((c) => !c.snapshot || !('polyolsG' in c.snapshot.per100g) || (c.carbBasis !== undefined && c.carbBasis !== 'unknown'));
  return {
    energyKcal: energy,
    macros,
    ledger,
    unexplainedKcal: unexplained,
    residualKind,
    legacy: !entry.energy,
    legacyUnknown,
    provenance: provenanceOf(method, commonSource(comps)),
    ...(withPolyols ? { polyolsG: polyols.byIdentity, polyolBasis: { inPrintedCarb: basisKnown ? true : ('unknown' as const), energyConvention: 'insideReportedME' as const } } : {}),
    ...(route ? { substrateRoute: route } : {}),
  };
}

/* ------------------------------------------------------------------------------------------- day sums */

/** A day's known sum of one exposure and its coverage (structurally `DayExposureSummary` of the engine inputs). */
export interface ExposureSum {
  knownSum: number;
  unit: string;
  coverage: ChannelCoverage;
}

/**
 * Σ of meal exposures per identity for a day (C3, A1-023). `dayEnergyCoverage` is the day-level coverage from the explicit
 * day report (`dayIntakeCoverage`, D5-01): meal completeness is never day completeness, and an energy-complete day never
 * establishes a nutrient nobody analysed. Identities are the UNION over every meal: a meal that does not carry an identity
 * is an unknown contribution of it (absence of analysis is not zero; a meal establishes zero only with an explicit 0).
 * Compatible units (g/mg/µg) are normalised to the identity's canonical unit before summing; an incompatible unit is an
 * unknown contribution. A nutrient is `complete` only on a complete day where every meal knows it; with an unknown
 * contribution it is `partial` when anything is known (the known sum is a lower bound), else `unknown`. As-planned
 * estimates and a confirmed zero-intake day keep their own coverage. Breakdown quantities are not summed.
 */
export function sumExposures(meals: ReadonlyArray<readonly ExposureQuantity[]>, dayEnergyCoverage: ChannelCoverage): Partial<Record<ExposureId, ExposureSum>> {
  type Acc = { knownSum: number; anyUnknown: boolean; anyKnown: boolean; anyPlanned: boolean };
  const out = new Map<ExposureId, Acc>();
  for (const xs of meals) for (const x of xs) if (!isExposureBreakdown(x) && !out.has(x.id)) out.set(x.id, { knownSum: 0, anyUnknown: false, anyKnown: false, anyPlanned: false });
  for (const [id, cur] of out) {
    const unit = EXPOSURE_UNITS[id];
    const inUnit = (v: number, from: string): number | null => (from === unit ? v : convertMass(v, from, unit));
    for (const xs of meals) {
      const mine = xs.filter((x) => x.id === id && !isExposureBreakdown(x));
      if (mine.length === 0) {
        // the meal did not analyse this identity: an unknown (≥ 0) contribution, never a zero
        cur.anyUnknown = true;
        continue;
      }
      for (const x of mine) {
        if (x.coverage === 'asPlannedEstimate') cur.anyPlanned = true;
        const v = isNum(x.value) && x.value >= 0 ? inUnit(x.value, x.unit) : null;
        if (v !== null) {
          cur.knownSum += v;
          cur.anyKnown = true;
          continue;
        }
        cur.anyUnknown = true;
        const lb = isNum(x.lowerBound) && x.lowerBound >= 0 ? inUnit(x.lowerBound, x.unit) : null;
        if (lb !== null) {
          cur.knownSum += lb;
          cur.anyKnown = true;
        }
      }
    }
  }
  const res: Partial<Record<ExposureId, ExposureSum>> = {};
  for (const [id, v] of out) {
    let coverage: ChannelCoverage;
    const incomplete: ChannelCoverage = v.anyKnown ? 'partial' : 'unknown';
    if (dayEnergyCoverage === 'confirmedZero') coverage = v.knownSum > 0 ? 'partial' : 'confirmedZero';
    else if (v.anyPlanned && dayEnergyCoverage !== 'complete') coverage = 'asPlannedEstimate';
    else if (dayEnergyCoverage === 'complete') coverage = v.anyUnknown ? incomplete : v.anyPlanned ? 'asPlannedEstimate' : 'complete';
    else coverage = v.anyUnknown ? incomplete : 'partial';
    res[id] = { knownSum: v.knownSum, unit: EXPOSURE_UNITS[id], coverage };
  }
  return res;
}

/** The exposure contract version this provider writes into entries (C7). */
export const EXPOSURE_CONTRACT_VERSION = CONTRACT_VERSIONS.exposure;

/* ------------------------------------------------------------------------------------------- shared nutrient ledger (D6-03) */

/**
 * Exposure identity (and chemical form) of every per-100 g key a frozen composition snapshot may carry: the catalogue's
 * nutrient keys (unit in the key name) plus the provider's own `netCarbG` (available carbohydrate). `carbG` in a snapshot
 * is the REPORTED carbohydrate on the source's basis (`carbReported`), never silently available carbohydrate. EPA and DHA
 * combine into `epaDha` only when both are known.
 */
export const NUTRIENT_KEY_EXPOSURE: Readonly<Record<string, { id: ExposureId; form?: string }>> = {
  energyKcal: { id: 'energy' },
  proteinG: { id: 'protein' },
  fatG: { id: 'fat' },
  netCarbG: { id: 'carbAvailable', form: 'availableCarbohydrate' },
  carbG: { id: 'carbReported' },
  fibreG: { id: 'fibre' },
  sugarsG: { id: 'sugars' },
  polyolsG: { id: 'polyols' },
  satFatG: { id: 'satFat' },
  mufaG: { id: 'mufa' },
  pufaG: { id: 'pufa' },
  alaG: { id: 'ala' },
  cholesterolMg: { id: 'cholesterol' },
  waterG: { id: 'water' },
  alcoholG: { id: 'ethanol' },
  caffeineMg: { id: 'caffeine' },
  sodiumMg: { id: 'sodium' },
  potassiumMg: { id: 'potassium' },
  calciumMg: { id: 'calcium' },
  ironMg: { id: 'iron' },
  magnesiumMg: { id: 'magnesium' },
  zincMg: { id: 'zinc' },
  b12Ug: { id: 'b12' },
  folateDfeUg: { id: 'folateDfe', form: 'DFE' },
  vitDUg: { id: 'vitD' },
  vitCMg: { id: 'vitC' },
  vitARaeUg: { id: 'vitARae', form: 'RAE' },
  leucineG: { id: 'leucine' },
};

/** Unit of a snapshot key from its suffix (Kcal, G, Mg, Ug), or null. */
function unitOfKey(key: string): string | null {
  if (key.endsWith('Kcal')) return 'kcal';
  if (key.endsWith('Ug')) return 'ug';
  if (key.endsWith('Mg')) return 'mg';
  if (key.endsWith('G')) return 'g';
  return null;
}

/**
 * One nutrient's aggregate (C3/D6-03): the known sum in the canonical unit, nutrient-specific completeness (never a
 * known-mass percentage), the components whose value is unknown, the contributing components and the derivation. A
 * partial `knownSum` is a lower bound, never a complete total; unknown never becomes zero.
 */
export interface NutrientAggregate {
  id: ExposureId;
  unit: CanonicalUnit;
  form?: string;
  knownSum: number;
  completeness: 'complete' | 'partial' | 'unknown';
  unknownComponents: readonly string[];
  contributingIds: readonly string[];
  derivation: 'sum' | 'partialSum' | 'none';
  /** (D6-03) contributing components whose value the source imputed (absent = none): the sum stays marked imputed. */
  imputedComponents?: readonly string[];
  /** (A1-042) Upper bound of an incomplete sum when every unknown component carries one (`upper:<key>`). */
  upperBound?: number;
}

/**
 * Accumulate one nutrient over contributions in any supported unit (g/mg/µg converted exactly; kcal and mmol only as is).
 * An amount that is null, non-finite, negative or in an unsupported unit is an unknown component, never zero.
 */
export function accumulateNutrient(
  id: ExposureId,
  contributions: ReadonlyArray<{ componentId: string; amount: number | null | undefined; unit?: string }>,
  form?: string,
): NutrientAggregate {
  const unit = EXPOSURE_UNITS[id];
  let sum = 0;
  const unknown: string[] = [];
  const contributing: string[] = [];
  for (const c of contributions) {
    const raw = c.amount;
    let v: number | null = null;
    if (isNum(raw) && raw >= 0) {
      const from = c.unit ?? unit;
      // g/mg/µg convert exactly; kcal, mmol and mL only as is (convertMass returns null for them)
      v = from === unit ? raw : convertMass(raw, from, unit);
    }
    if (v === null) unknown.push(c.componentId);
    else {
      sum += v;
      contributing.push(c.componentId);
    }
  }
  const completeness = unknown.length === 0 && contributing.length > 0 ? 'complete' : contributing.length > 0 ? 'partial' : 'unknown';
  return { id, unit, ...(form ? { form } : {}), knownSum: sum, completeness, unknownComponents: unknown, contributingIds: contributing, derivation: completeness === 'complete' ? 'sum' : completeness === 'partial' ? 'partialSum' : 'none' };
}

/**
 * Every nutrient of a set of frozen per-100 g snapshots eaten at `edibleG` grams: N = Σ edibleG/100 × concentration. A
 * component without a snapshot, without grams, or whose snapshot lacks (or nulls) a key another component carries is an
 * unknown component of that nutrient. Nutrients no snapshot mentions are absent (not a statement).
 */
export function aggregateSnapshots(parts: ReadonlyArray<{ componentId: string; per100: Readonly<Record<string, number | null | undefined>> | null; edibleG: number | null | undefined; imputed?: readonly string[] }>): Partial<Record<ExposureId, NutrientAggregate>> {
  const keys = new Set<string>();
  for (const p of parts) for (const k of Object.keys(p.per100 ?? {})) if (NUTRIENT_KEY_EXPOSURE[k] || k === 'epaG' || k === 'dhaG') keys.add(k);
  const out: Partial<Record<ExposureId, NutrientAggregate>> = {};
  const amount = (p: (typeof parts)[number], k: string): number | null => {
    const v = p.per100?.[k];
    return isNum(v) && v >= 0 && isNum(p.edibleG) && p.edibleG >= 0 ? (v * p.edibleG) / 100 : null;
  };
  const withImputed = (agg: NutrientAggregate, isImputed: (p: (typeof parts)[number]) => boolean): NutrientAggregate => {
    const ids = parts.filter((p) => agg.contributingIds.includes(p.componentId) && isImputed(p)).map((p) => p.componentId);
    return ids.length > 0 ? { ...agg, imputedComponents: ids } : agg;
  };
  // (A1-042) an unknown component may still bound its amount from above (a recipe nutrient with an unknown removal)
  const withUpper = (agg: NutrientAggregate, k: string): NutrientAggregate => {
    if (agg.completeness === 'complete') return agg;
    let upper = agg.knownSum;
    for (const p of parts) {
      if (!agg.unknownComponents.includes(p.componentId)) continue;
      const u = p.per100?.[`${UPPER_BOUND_KEY_PREFIX}${k}`];
      if (!isNum(u) || u < 0 || !isNum(p.edibleG) || p.edibleG < 0) return agg;
      const raw = (u * p.edibleG) / 100;
      const from = unitOfKey(k) ?? agg.unit;
      const v = from === agg.unit ? raw : convertMass(raw, from, agg.unit);
      if (v === null) return agg;
      upper += v;
    }
    return { ...agg, upperBound: upper };
  };
  for (const k of keys) {
    const map = NUTRIENT_KEY_EXPOSURE[k];
    if (!map) continue;
    const agg = accumulateNutrient(map.id, parts.map((p) => ({ componentId: p.componentId, amount: amount(p, k), unit: unitOfKey(k) ?? EXPOSURE_UNITS[map.id] })), map.form);
    out[map.id] = withUpper(withImputed(agg, (p) => p.imputed?.includes(k) === true), k);
  }
  if (keys.has('epaG') || keys.has('dhaG')) {
    const agg = accumulateNutrient('epaDha', parts.map((p) => {
      const e = amount(p, 'epaG');
      const d = amount(p, 'dhaG');
      return { componentId: p.componentId, amount: e !== null && d !== null ? e + d : null, unit: 'g' };
    }));
    out.epaDha = withImputed(agg, (p) => p.imputed?.includes('epaG') === true || p.imputed?.includes('dhaG') === true);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- linked events (D6-03, D7-04) */

/** One event's exposures for day-level reconciliation (a meal, a substance log or a supplement log). */
export interface ExposureEvent {
  eventId: string;
  kind: 'meal' | 'substance' | 'supplement';
  date?: IsoDate;
  exposures: readonly ExposureQuantity[];
  occurrence?: OccurrenceTime;
}

/**
 * An explicit reconciliation (user choice or a link the person confirmed): the two events describe the SAME intake of the
 * listed exposures, so they are counted once, from `keep`. Equal amounts or times are never a link.
 */
export interface ExposureLink {
  eventIds: readonly [string, string];
  exposureIds: readonly ExposureId[];
  keep: string;
  source: 'user' | 'confirmedSuggestion';
}

/**
 * Apply explicit links: in each linked pair the non-kept event loses the linked exposure identities (reported in
 * `dropped`); every other exposure, and every unlinked event, is kept as is — two independent drinks at the same time with
 * the same amount count twice. A link naming an event not present is ignored (reported in `unmatched`).
 */
export function reconcileLinkedExposures(events: readonly ExposureEvent[], links: readonly ExposureLink[]): { events: ExposureEvent[]; dropped: Array<{ eventId: string; exposureId: ExposureId; duplicateOf: string }>; unmatched: ExposureLink[] } {
  const byId = new Map(events.map((e) => [e.eventId, e] as const));
  const drop = new Map<string, Map<ExposureId, string>>();
  const unmatched: ExposureLink[] = [];
  for (const l of links) {
    const [a, b] = l.eventIds;
    if (!byId.has(a) || !byId.has(b) || (l.keep !== a && l.keep !== b) || a === b) {
      unmatched.push(l);
      continue;
    }
    const other = l.keep === a ? b : a;
    const m = drop.get(other) ?? new Map<ExposureId, string>();
    for (const id of l.exposureIds) m.set(id, l.keep);
    drop.set(other, m);
  }
  const dropped: Array<{ eventId: string; exposureId: ExposureId; duplicateOf: string }> = [];
  const out = events.map((e) => {
    const m = drop.get(e.eventId);
    if (!m) return e;
    const kept = e.exposures.filter((x) => {
      const dup = m.get(x.id);
      if (dup !== undefined) dropped.push({ eventId: e.eventId, exposureId: x.id, duplicateOf: dup });
      return dup === undefined;
    });
    return { ...e, exposures: kept };
  });
  return { events: out, dropped, unmatched };
}

/** Canonical exposure of a substance log (caffeine mg, ethanol g, creatine g, BHB g) from its validated dose (D5-01). */
export function substanceEventExposures(entry: Extract<LogEntry, { kind: 'substance' }>): ExposureQuantity[] {
  const id: ExposureId = entry.substance === 'alcohol' ? 'ethanol' : entry.substance === 'exogenousKetones' ? 'exogenousBhb' : entry.substance;
  const n = entry.normalized ?? (() => {
    const r = normalizeSubstanceDose(entry.substance, entry.amount, entry.unit);
    return r.ok ? { value: r.value, unit: r.unit } : null;
  })();
  const base = { id, unit: EXPOSURE_UNITS[id], provenance: 'reported' as const, originEventId: entry.id, original: { value: entry.amount, unit: entry.unit }, ...(entry.occurrence ? { occurrence: entry.occurrence } : {}) };
  return [n ? { ...base, value: n.value, coverage: 'complete' as const } : { ...base, value: null, coverage: 'unknown' as const }];
}

/**
 * Active exposure of a supplement log (D7-04): its stored exposures when present, else from its label snapshot
 * (`servings` of the product, or the recorded dose in a compatible unit). Without a label the actives are not known: no
 * exposure is returned and `potency` says `unknown` (a valid record whose safety stays unchecked, never zero issues).
 */
export function supplementEventExposures(entry: Extract<LogEntry, { kind: 'supplement' }>): { exposures: ExposureQuantity[]; potency: 'known' | 'partial' | 'unknown' } {
  let xs: ExposureQuantity[] | null = entry.exposures ? [...entry.exposures] : null;
  if (!xs && entry.product) {
    const recorded = isNum(entry.servings) ? { amount: entry.servings * (entry.product.servingAmount ?? 1), unit: entry.product.servingUnit } : { amount: entry.dose, unit: entry.unit };
    xs = activeExposureFromServing(recorded, entry.product, { originEventId: entry.id, ...(entry.occurrence ? { occurrence: entry.occurrence } : {}) }).map(({ reason: _r, ...x }) => x);
  }
  if (!xs || xs.length === 0) return { exposures: [], potency: 'unknown' };
  const unknown = xs.filter((x) => x.value === null).length;
  return { exposures: xs, potency: unknown === 0 ? 'known' : unknown === xs.length ? 'unknown' : 'partial' };
}

/* ------------------------------------------------------------------------------------------- active-ingredient summaries (D7-04) */

/** A known or unknown dose of one ingredient from one event. */
export interface IngredientDoseEvent {
  eventId: string;
  date: IsoDate;
  origin: 'food' | 'supplement';
  value: number | null;
}

interface ScopedSum {
  knownSum: number;
  complete: boolean;
}

/**
 * Exposure of one ingredient over a window (D7-04): every event dose (bolus/peak preserved), per-day totals scoped
 * food+supplement and supplemental-only, the largest single supplemental event and day, cumulative exposure, and the mean
 * daily value — the mean is informational only and never replaces the peaks (weekly vitamin D is not divided by seven).
 */
export interface IngredientExposureSummary {
  ingredient: ExposureId;
  unit: CanonicalUnit;
  window: { from: IsoDate; to: IsoDate };
  events: IngredientDoseEvent[];
  daily: Array<{ date: IsoDate; total: ScopedSum; supplementalOnly: ScopedSum }>;
  peakSupplementEvent: { eventId: string; date: IsoDate; value: number } | null;
  peakDay: { date: IsoDate; total: ScopedSum; supplementalOnly: ScopedSum } | null;
  cumulative: { total: ScopedSum; supplementalOnly: ScopedSum };
  meanDaily: { total: ScopedSum; supplementalOnly: ScopedSum; days: number };
  unknownEventIds: string[];
}

function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(end.getTime())) return out;
  for (let i = 0; d <= end && i < 3700; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Summarise one ingredient over `[from, to]` from dated events (food and supplement) carrying exposures. */
export function ingredientExposureSummary(
  events: ReadonlyArray<{ eventId: string; date: IsoDate; origin: 'food' | 'supplement'; exposures: readonly ExposureQuantity[] }>,
  ingredient: ExposureId,
  window: { from: IsoDate; to: IsoDate },
): IngredientExposureSummary {
  const unit = EXPOSURE_UNITS[ingredient];
  const doses: IngredientDoseEvent[] = [];
  for (const e of events) {
    if (e.date < window.from || e.date > window.to) continue;
    for (const x of e.exposures) {
      if (x.id !== ingredient || isExposureBreakdown(x)) continue;
      let v: number | null = x.value;
      if (v !== null && x.unit !== unit) v = convertMass(v, x.unit, unit);
      doses.push({ eventId: e.eventId, date: e.date, origin: e.origin, value: v !== null && Number.isFinite(v) && v >= 0 ? v : null });
    }
  }
  const empty = (): ScopedSum => ({ knownSum: 0, complete: true });
  const add = (s: ScopedSum, v: number | null): void => {
    if (v === null) s.complete = false;
    else s.knownSum += v;
  };
  const days = datesBetween(window.from, window.to);
  const daily = days.map((date) => {
    const total = empty();
    const supp = empty();
    for (const d of doses) {
      if (d.date !== date) continue;
      add(total, d.value);
      if (d.origin === 'supplement') add(supp, d.value);
    }
    return { date, total, supplementalOnly: supp };
  });
  const cumulative = { total: empty(), supplementalOnly: empty() };
  for (const d of doses) {
    add(cumulative.total, d.value);
    if (d.origin === 'supplement') add(cumulative.supplementalOnly, d.value);
  }
  let peakEvent: IngredientExposureSummary['peakSupplementEvent'] = null;
  for (const d of doses) if (d.origin === 'supplement' && d.value !== null && (!peakEvent || d.value > peakEvent.value)) peakEvent = { eventId: d.eventId, date: d.date, value: d.value };
  let peakDay: IngredientExposureSummary['peakDay'] = null;
  for (const d of daily) if (!peakDay || d.total.knownSum > peakDay.total.knownSum) peakDay = d;
  const n = Math.max(1, days.length);
  return {
    ingredient,
    unit,
    window,
    events: doses,
    daily,
    peakSupplementEvent: peakEvent,
    peakDay: doses.length > 0 ? peakDay : null,
    cumulative,
    meanDaily: {
      total: { knownSum: cumulative.total.knownSum / n, complete: cumulative.total.complete },
      supplementalOnly: { knownSum: cumulative.supplementalOnly.knownSum / n, complete: cumulative.supplementalOnly.complete },
      days: days.length,
    },
    unknownEventIds: [...new Set(doses.filter((d) => d.value === null).map((d) => d.eventId))],
  };
}

/**
 * Arithmetic side of an upper-limit check (D7-04; the limit, its population and scope come from D7's rules). Per day in
 * the requested scope: a KNOWN part above the limit is a `violation` for daily use, but a bolus regimen (weekly,
 * alternate-day) above a daily limit on its dose day is `unchecked` for clinician-style regimen review — never passed by
 * averaging and never auto-toxic. Any unknown dose in scope (unknown potency), or an incomplete food record for a total
 * scope, is `unchecked`. No dose in scope is `notApplicable`. Only a complete known record within the limit is `passed`.
 */
export function upperLimitCheck(
  summary: IngredientExposureSummary,
  limit: { amount: number; unit: string; scope: 'supplementalOnly' | 'total' },
  opts: { regimen?: 'daily' | 'bolus'; foodRecordComplete?: boolean } = {},
): { check: SafetyCheckStatus; reasonCode: string; worstDay?: { date: IsoDate; knownSum: number } } {
  const lim = limit.unit === summary.unit ? limit.amount : convertMass(limit.amount, limit.unit, summary.unit);
  if (lim === null || !Number.isFinite(lim) || lim < 0) return { check: 'unchecked', reasonCode: 'limitUnitIncompatible' };
  const inScope = summary.events.filter((e) => limit.scope === 'total' || e.origin === 'supplement');
  if (inScope.length === 0) return { check: 'notApplicable', reasonCode: 'noExposureInScope' };
  let worst: { date: IsoDate; knownSum: number } | undefined;
  for (const d of summary.daily) {
    const s = limit.scope === 'total' ? d.total : d.supplementalOnly;
    if (!worst || s.knownSum > worst.knownSum) worst = { date: d.date, knownSum: s.knownSum };
  }
  if (worst && worst.knownSum > lim) return opts.regimen === 'bolus' ? { check: 'unchecked', reasonCode: 'bolusRegimenReview', worstDay: worst } : { check: 'violation', reasonCode: 'knownAboveLimit', worstDay: worst };
  if (inScope.some((e) => e.value === null)) return { check: 'unchecked', reasonCode: 'potencyUnknown', ...(worst ? { worstDay: worst } : {}) };
  if (limit.scope === 'total' && opts.foodRecordComplete !== true) return { check: 'unchecked', reasonCode: 'foodIntakeIncomplete', ...(worst ? { worstDay: worst } : {}) };
  return { check: 'passed', reasonCode: 'withinLimit', ...(worst ? { worstDay: worst } : {}) };
}

/**
 * Planned doses of a product over a window from its schedule (D7-04): daily, weekly on `daysOfWeek` (0 = Sunday), every
 * other day from the schedule start, or explicit dates; `asNeeded`/`unknown` schedules give no planned events (their
 * exposure is unknown, not zero). Each occasion is `servingsPerOccasion` (default 1) label servings; unknown potency gives
 * null values. The bolus of a weekly dose stays on its own date.
 */
export function scheduledSupplementDoses(
  product: SupplementProduct,
  schedule: SupplementSchedule,
  window: { from: IsoDate; to: IsoDate },
  eventIdPrefix = 'planned',
): Array<{ eventId: string; date: IsoDate; origin: 'supplement'; exposures: ExposureQuantity[] }> {
  const from = schedule.from && schedule.from > window.from ? schedule.from : window.from;
  const to = schedule.to && schedule.to < window.to ? schedule.to : window.to;
  const all = datesBetween(from, to);
  const anchor = schedule.from ?? window.from;
  const dayIndex = (d: IsoDate): number => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000);
  let dates: IsoDate[];
  switch (schedule.kind) {
    case 'daily':
      dates = all;
      break;
    case 'weekly': {
      const dow = new Set(schedule.daysOfWeek ?? []);
      dates = all.filter((d) => dow.has(new Date(`${d}T00:00:00Z`).getUTCDay()));
      break;
    }
    case 'alternateDay':
      dates = all.filter((d) => dayIndex(d) % 2 === 0);
      break;
    case 'dates':
      dates = (schedule.dates ?? []).filter((d) => d >= from && d <= to);
      break;
    default:
      dates = [];
  }
  const servings = isNum(schedule.servingsPerOccasion) && schedule.servingsPerOccasion > 0 ? schedule.servingsPerOccasion : 1;
  const times = Math.max(1, schedule.timesOfDay?.length ?? 1);
  return dates.map((date) => {
    const eventId = `${eventIdPrefix}:${date}`;
    const amount = (product.servingAmount ?? 1) * servings * times;
    const exposures = activeExposureFromServing({ amount, unit: product.servingUnit }, product, { originEventId: eventId }).map(({ reason: _r, ...x }) => ({ ...x, provenance: 'asPlanned' as const, coverage: x.value === null ? ('unknown' as const) : ('asPlannedEstimate' as const) }));
    return { eventId, date, origin: 'supplement' as const, exposures };
  });
}

/* ------------------------------------------------------------------------------------------- correlated scenarios (D6-06) */

/** Shared-error group kind of a component group id (`<kind>:…`), or null. */
export function groupKindOf(id: string): UncertaintyGroupKind | null {
  const k = id.split(':', 1)[0] as UncertaintyGroupKind;
  const kinds: readonly UncertaintyGroupKind[] = ['portionMass', 'sourceComposition', 'batchYield', 'retainedOil', 'reportingBias', 'occurrenceTime', 'deviceBias', 'identityAmbiguity'];
  return kinds.includes(k) ? k : null;
}

/**
 * Uncertainty groups of stored meal components (C3/D6-06): one group per id, members `<entryId>:<componentIndex>`. Ids
 * repeat across entries for a shared source record/recipe version or a person's reporting bias, so a merged set keeps
 * systematic errors shared (they never shrink like independent noise with repeated logging).
 */
export function uncertaintyGroupsOf(entries: ReadonlyArray<{ id: string; components: ReadonlyArray<Pick<MealComponent, 'uncertaintyGroupIds'>> }>): UncertaintyGroup[] {
  const by = new Map<string, { kind: UncertaintyGroupKind; members: string[] }>();
  for (const e of entries)
    e.components.forEach((c, i) => {
      for (const g of c.uncertaintyGroupIds ?? []) {
        const kind = groupKindOf(g);
        if (!kind) continue;
        const cur = by.get(g) ?? { kind, members: [] };
        cur.members.push(`${e.id}:${i}`);
        by.set(g, cur);
      }
    });
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, v]) => ({ id, kind: v.kind, memberIds: v.members }));
}

/**
 * Totals of one deterministic scenario (D6-06): every component's grams are scaled by the product of its mass-group factors
 * (portion mass, batch yield, reporting bias) and its composition by its source-composition/retained-oil factors; ALL
 * nutrients of a component use the same scaled mass, so energy and every nutrient move together. Factors are scenario
 * inputs (bounds or candidate sources), never fitted probabilities; a group without a factor is 1. Same inputs ⇒ same output.
 */
export function scenarioTotals(
  components: ReadonlyArray<{ componentId: string; grams: number; per100: Readonly<Record<string, number | null | undefined>> | null; uncertaintyGroupIds?: readonly string[] }>,
  factors: Readonly<Record<string, number>>,
): Partial<Record<ExposureId, NutrientAggregate>> {
  const parts = components.map((c) => {
    let mass = 1;
    let comp = 1;
    for (const g of c.uncertaintyGroupIds ?? []) {
      const f = factors[g];
      if (!isNum(f) || f < 0) continue;
      const kind = groupKindOf(g);
      if (kind === 'sourceComposition' || kind === 'retainedOil') comp *= f;
      else mass *= f;
    }
    return { componentId: c.componentId, per100: c.per100, edibleG: isNum(c.grams) ? c.grams * mass * comp : null };
  });
  return aggregateSnapshots(parts);
}
