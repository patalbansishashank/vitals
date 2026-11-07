/**
 * Dietary Reference Intakes for interpreting KNOWN nutrient exposure (D8-08; NASEM DRI reports 1997-2011, adults).
 *
 * Typed references, not adequacy verdicts: every row names its kind (EAR / RDA / AI / UL), sex and life-stage group, unit
 * and form/basis, and what intake the value applies to (total intake, supplemental sources only, synthetic folic acid
 * only, preformed retinol only). Interpretation (`interpretNutrientIntake`) follows the NASEM assessment rules:
 *  - an observed mean over logged days is not usual intake, and intake alone never diagnoses deficiency;
 *  - below an AI is "adequacy undetermined" (never an inadequacy probability);
 *  - an EAR comparison is reported as a position (below EAR / between EAR and RDA / at or above RDA) without a probability;
 *  - a UL applies only to the intake scope it was set for; a known lower bound above a total-intake UL proves exceedance,
 *    a partial record never clears it (C5 monotone rule with non-negative unknown additions);
 *  - menstrual status is used only when stated (or post-menopause); otherwise the age-group reference is applied with
 *    applicability `unresolved`.
 * No new clinical cut-off is introduced: the numbers below are the published reference values.
 */
import type { ChannelCoverage } from '@/lib/bodyContracts';
import { N_TRACKED, NUT_COV, type TrackedNutrient } from './microTables';

export type DriKind = 'EAR' | 'RDA' | 'AI' | 'UL';
/** Which intake a reference value applies to. */
export type DriScope = 'totalIntake' | 'supplementalOnly' | 'syntheticFolicAcid' | 'preformedRetinol' | 'supplementalAlphaTocopherol';
export type DriNutrient = TrackedNutrient | 'thiamin' | 'vitK' | 'vitE';

export interface DriRow {
  readonly nutrient: DriNutrient;
  readonly kind: DriKind;
  readonly sex: 'female' | 'male';
  /** Life-stage age band, years (inclusive lower, exclusive upper). */
  readonly ageMin: number;
  readonly ageMax: number;
  readonly value: number;
  /** Canonical unit of the exposure ledger (`EXPOSURE_UNITS`). */
  readonly unit: 'mg' | 'ug' | 'g';
  /** Chemical form / basis (RAE, DFE, elemental, α-tocopherol…). */
  readonly basis?: string;
  readonly scope: DriScope;
  /** Physiological basis the value assumes (iron: menstrual losses) — matched to the person's STATED status only. */
  readonly lifeStage?: 'menstruating' | 'nonMenstruating';
  readonly source: string;
}

const CA = 'NASEM 2011 DRI calcium and vitamin D';
const MG = 'NASEM 1997 DRI Ca, P, Mg, vitamin D, fluoride';
const AZ = 'NASEM 2001 DRI vitamin A, K, arsenic, boron, chromium, copper, iodine, iron, manganese, molybdenum, nickel, silicon, vanadium, zinc';
const CE = 'NASEM 2000 DRI vitamin C, vitamin E, selenium, carotenoids';
const B = 'NASEM 1998 DRI thiamin, riboflavin, niacin, B6, folate, B12, pantothenic acid, biotin, choline';
const MAC = 'NASEM 2002/2005 DRI energy and macronutrients';

const AGE_MAX = 200;
type RowSpec = [DriNutrient, DriKind, 'female' | 'male', number, number, number, DriRow['unit'], DriScope, string | undefined, DriRow['lifeStage'] | undefined, string];
const row = ([nutrient, kind, sex, ageMin, ageMax, value, unit, scope, basis, lifeStage, source]: RowSpec): DriRow => ({
  nutrient, kind, sex, ageMin, ageMax, value, unit, scope, source, ...(basis ? { basis } : {}), ...(lifeStage ? { lifeStage } : {}),
});
const both = (spec: [DriNutrient, DriKind, number, number, number, DriRow['unit'], DriScope, string | undefined, string]): DriRow[] => {
  const [n, k, a0, a1, v, u, sc, b, src] = spec;
  return [row([n, k, 'female', a0, a1, v, u, sc, b, undefined, src]), row([n, k, 'male', a0, a1, v, u, sc, b, undefined, src])];
};

/** Adult (≥ 19 y) reference rows. Pregnancy/lactation and < 19 y are outside the table (applicability unresolved). */
export const DRI_TABLE: readonly DriRow[] = [
  // calcium (elemental, total intake)
  ...both(['calcium', 'EAR', 19, 51, 800, 'mg', 'totalIntake', 'elemental', CA]),
  row(['calcium', 'EAR', 'male', 51, 71, 800, 'mg', 'totalIntake', 'elemental', undefined, CA]),
  row(['calcium', 'EAR', 'female', 51, 71, 1000, 'mg', 'totalIntake', 'elemental', undefined, CA]),
  ...both(['calcium', 'EAR', 71, AGE_MAX, 1000, 'mg', 'totalIntake', 'elemental', CA]),
  ...both(['calcium', 'RDA', 19, 51, 1000, 'mg', 'totalIntake', 'elemental', CA]),
  row(['calcium', 'RDA', 'male', 51, 71, 1000, 'mg', 'totalIntake', 'elemental', undefined, CA]),
  row(['calcium', 'RDA', 'female', 51, 71, 1200, 'mg', 'totalIntake', 'elemental', undefined, CA]),
  ...both(['calcium', 'RDA', 71, AGE_MAX, 1200, 'mg', 'totalIntake', 'elemental', CA]),
  ...both(['calcium', 'UL', 19, 51, 2500, 'mg', 'totalIntake', 'elemental', CA]),
  ...both(['calcium', 'UL', 51, AGE_MAX, 2000, 'mg', 'totalIntake', 'elemental', CA]),
  // magnesium (UL from supplemental/pharmacological sources only)
  row(['magnesium', 'EAR', 'female', 19, 31, 255, 'mg', 'totalIntake', 'elemental', undefined, MG]),
  row(['magnesium', 'EAR', 'female', 31, AGE_MAX, 265, 'mg', 'totalIntake', 'elemental', undefined, MG]),
  row(['magnesium', 'EAR', 'male', 19, 31, 330, 'mg', 'totalIntake', 'elemental', undefined, MG]),
  row(['magnesium', 'EAR', 'male', 31, AGE_MAX, 350, 'mg', 'totalIntake', 'elemental', undefined, MG]),
  row(['magnesium', 'RDA', 'female', 19, 31, 310, 'mg', 'totalIntake', 'elemental', undefined, MG]),
  row(['magnesium', 'RDA', 'female', 31, AGE_MAX, 320, 'mg', 'totalIntake', 'elemental', undefined, MG]),
  row(['magnesium', 'RDA', 'male', 19, 31, 400, 'mg', 'totalIntake', 'elemental', undefined, MG]),
  row(['magnesium', 'RDA', 'male', 31, AGE_MAX, 420, 'mg', 'totalIntake', 'elemental', undefined, MG]),
  ...both(['magnesium', 'UL', 19, AGE_MAX, 350, 'mg', 'supplementalOnly', 'elemental', MG]),
  // iron (EAR/RDA of women 19-50 assume menstrual losses; women 51+ do not)
  row(['iron', 'EAR', 'female', 19, 51, 8.1, 'mg', 'totalIntake', 'elemental', 'menstruating', AZ]),
  row(['iron', 'RDA', 'female', 19, 51, 18, 'mg', 'totalIntake', 'elemental', 'menstruating', AZ]),
  row(['iron', 'EAR', 'female', 51, AGE_MAX, 5, 'mg', 'totalIntake', 'elemental', 'nonMenstruating', AZ]),
  row(['iron', 'RDA', 'female', 51, AGE_MAX, 8, 'mg', 'totalIntake', 'elemental', 'nonMenstruating', AZ]),
  row(['iron', 'EAR', 'male', 19, AGE_MAX, 6, 'mg', 'totalIntake', 'elemental', undefined, AZ]),
  row(['iron', 'RDA', 'male', 19, AGE_MAX, 8, 'mg', 'totalIntake', 'elemental', undefined, AZ]),
  ...both(['iron', 'UL', 19, AGE_MAX, 45, 'mg', 'totalIntake', 'elemental', AZ]),
  // zinc
  row(['zinc', 'EAR', 'female', 19, AGE_MAX, 6.8, 'mg', 'totalIntake', 'elemental', undefined, AZ]),
  row(['zinc', 'EAR', 'male', 19, AGE_MAX, 9.4, 'mg', 'totalIntake', 'elemental', undefined, AZ]),
  row(['zinc', 'RDA', 'female', 19, AGE_MAX, 8, 'mg', 'totalIntake', 'elemental', undefined, AZ]),
  row(['zinc', 'RDA', 'male', 19, AGE_MAX, 11, 'mg', 'totalIntake', 'elemental', undefined, AZ]),
  ...both(['zinc', 'UL', 19, AGE_MAX, 40, 'mg', 'totalIntake', 'elemental', AZ]),
  // iodine
  ...both(['iodine', 'EAR', 19, AGE_MAX, 95, 'ug', 'totalIntake', undefined, AZ]),
  ...both(['iodine', 'RDA', 19, AGE_MAX, 150, 'ug', 'totalIntake', undefined, AZ]),
  ...both(['iodine', 'UL', 19, AGE_MAX, 1100, 'ug', 'totalIntake', undefined, AZ]),
  // vitamin D
  ...both(['vitD', 'EAR', 19, AGE_MAX, 10, 'ug', 'totalIntake', 'cholecalciferol/ergocalciferol', CA]),
  ...both(['vitD', 'RDA', 19, 71, 15, 'ug', 'totalIntake', 'cholecalciferol/ergocalciferol', CA]),
  ...both(['vitD', 'RDA', 71, AGE_MAX, 20, 'ug', 'totalIntake', 'cholecalciferol/ergocalciferol', CA]),
  ...both(['vitD', 'UL', 19, AGE_MAX, 100, 'ug', 'totalIntake', 'cholecalciferol/ergocalciferol', CA]),
  // vitamin B12 (no UL)
  ...both(['b12', 'EAR', 19, AGE_MAX, 2.0, 'ug', 'totalIntake', undefined, B]),
  ...both(['b12', 'RDA', 19, AGE_MAX, 2.4, 'ug', 'totalIntake', undefined, B]),
  // folate (EAR/RDA in DFE; UL for synthetic folic acid from fortified foods and supplements only)
  ...both(['folateDfe', 'EAR', 19, AGE_MAX, 320, 'ug', 'totalIntake', 'DFE', B]),
  ...both(['folateDfe', 'RDA', 19, AGE_MAX, 400, 'ug', 'totalIntake', 'DFE', B]),
  ...both(['folateDfe', 'UL', 19, AGE_MAX, 1000, 'ug', 'syntheticFolicAcid', 'folic acid', B]),
  // vitamin A (EAR/RDA in RAE; UL for preformed retinol only)
  row(['vitARae', 'EAR', 'female', 19, AGE_MAX, 500, 'ug', 'totalIntake', 'RAE', undefined, AZ]),
  row(['vitARae', 'EAR', 'male', 19, AGE_MAX, 625, 'ug', 'totalIntake', 'RAE', undefined, AZ]),
  row(['vitARae', 'RDA', 'female', 19, AGE_MAX, 700, 'ug', 'totalIntake', 'RAE', undefined, AZ]),
  row(['vitARae', 'RDA', 'male', 19, AGE_MAX, 900, 'ug', 'totalIntake', 'RAE', undefined, AZ]),
  ...both(['vitARae', 'UL', 19, AGE_MAX, 3000, 'ug', 'preformedRetinol', 'retinol', AZ]),
  // vitamin C
  row(['vitC', 'EAR', 'female', 19, AGE_MAX, 60, 'mg', 'totalIntake', undefined, undefined, CE]),
  row(['vitC', 'EAR', 'male', 19, AGE_MAX, 75, 'mg', 'totalIntake', undefined, undefined, CE]),
  row(['vitC', 'RDA', 'female', 19, AGE_MAX, 75, 'mg', 'totalIntake', undefined, undefined, CE]),
  row(['vitC', 'RDA', 'male', 19, AGE_MAX, 90, 'mg', 'totalIntake', undefined, undefined, CE]),
  ...both(['vitC', 'UL', 19, AGE_MAX, 2000, 'mg', 'totalIntake', undefined, CE]),
  // essential fatty acids (AI only; total fat is not an EFA assay)
  row(['ala', 'AI', 'female', 19, AGE_MAX, 1.1, 'g', 'totalIntake', 'α-linolenic acid', undefined, MAC]),
  row(['ala', 'AI', 'male', 19, AGE_MAX, 1.6, 'g', 'totalIntake', 'α-linolenic acid', undefined, MAC]),
  row(['linoleic', 'AI', 'female', 19, 51, 12, 'g', 'totalIntake', 'linoleic acid', undefined, MAC]),
  row(['linoleic', 'AI', 'female', 51, AGE_MAX, 11, 'g', 'totalIntake', 'linoleic acid', undefined, MAC]),
  row(['linoleic', 'AI', 'male', 19, 51, 17, 'g', 'totalIntake', 'linoleic acid', undefined, MAC]),
  row(['linoleic', 'AI', 'male', 51, AGE_MAX, 14, 'g', 'totalIntake', 'linoleic acid', undefined, MAC]),
  // nutrients without a ledger identity yet (heuristic only)
  row(['thiamin', 'EAR', 'female', 19, AGE_MAX, 0.9, 'mg', 'totalIntake', undefined, undefined, B]),
  row(['thiamin', 'EAR', 'male', 19, AGE_MAX, 1.0, 'mg', 'totalIntake', undefined, undefined, B]),
  row(['thiamin', 'RDA', 'female', 19, AGE_MAX, 1.1, 'mg', 'totalIntake', undefined, undefined, B]),
  row(['thiamin', 'RDA', 'male', 19, AGE_MAX, 1.2, 'mg', 'totalIntake', undefined, undefined, B]),
  row(['vitK', 'AI', 'female', 19, AGE_MAX, 90, 'ug', 'totalIntake', 'phylloquinone', undefined, AZ]),
  row(['vitK', 'AI', 'male', 19, AGE_MAX, 120, 'ug', 'totalIntake', 'phylloquinone', undefined, AZ]),
  ...both(['vitE', 'EAR', 19, AGE_MAX, 12, 'mg', 'totalIntake', 'α-tocopherol', CE]),
  ...both(['vitE', 'RDA', 19, AGE_MAX, 15, 'mg', 'totalIntake', 'α-tocopherol', CE]),
  ...both(['vitE', 'UL', 19, AGE_MAX, 1000, 'mg', 'supplementalAlphaTocopherol', 'any form of supplemental α-tocopherol', CE]),
];

/** The person facts a reference selection may use. Menstrual status is never inferred from sex or age. */
export interface DriPerson {
  sex: 'female' | 'male' | 'unspecified';
  ageYears: number;
  /** Stated status (`CycleProfile.menstruating`); post-menopause counts as a stated "no". */
  menstruating: 'yes' | 'no' | 'unknown';
}

export interface DriSelection {
  ear?: DriRow;
  rda?: DriRow;
  ai?: DriRow;
  ul?: DriRow;
  /**
   * `applicable` when the rows match the person's life stage; `unresolved` when sex is unspecified, the age lies outside
   * the adult table, or a reference assumes a physiological status (menstruation) the person has not stated.
   */
  applicability: 'applicable' | 'unresolved';
  reasonCode: string;
}

function pick(nutrient: DriNutrient, kind: DriKind, sex: 'female' | 'male', age: number, stage: DriPerson['menstruating']): DriRow | undefined {
  const rows = DRI_TABLE.filter((r) => r.nutrient === nutrient && r.kind === kind && r.sex === sex);
  if (rows.length === 0) return undefined;
  // a stated menstrual status selects the rows whose physiological basis matches it (iron), whatever the age band
  if (stage !== 'unknown') {
    const want = stage === 'yes' ? 'menstruating' : 'nonMenstruating';
    const staged = rows.filter((r) => r.lifeStage === want);
    if (staged.length > 0) return staged.find((r) => age >= r.ageMin && age < r.ageMax) ?? staged[0];
  }
  return rows.find((r) => age >= r.ageMin && age < r.ageMax);
}

/** Reference rows for a nutrient and person (pure). */
export function driReferences(nutrient: DriNutrient, person: DriPerson): DriSelection {
  const sex = person.sex === 'unspecified' ? 'female' : person.sex;
  const age = person.ageYears;
  const sel: DriSelection = { applicability: 'applicable', reasonCode: 'lifeStageMatched' };
  const ear = pick(nutrient, 'EAR', sex, age, person.menstruating);
  const rda = pick(nutrient, 'RDA', sex, age, person.menstruating);
  const ai = pick(nutrient, 'AI', sex, age, person.menstruating);
  const ul = pick(nutrient, 'UL', sex, age, person.menstruating);
  if (ear) sel.ear = ear;
  if (rda) sel.rda = rda;
  if (ai) sel.ai = ai;
  if (ul) sel.ul = ul;
  if (person.sex === 'unspecified') return { ...sel, applicability: 'unresolved', reasonCode: 'sexUnspecified' };
  if (!(age >= 19)) return { ...sel, applicability: 'unresolved', reasonCode: 'outsideAdultTable' };
  const staged = [ear, rda].find((r) => r?.lifeStage !== undefined);
  if (staged) {
    if (person.menstruating === 'unknown') return { ...sel, applicability: 'unresolved', reasonCode: 'menstrualStatusUnknown' };
    // a stated status matched by basis but outside the band the table defines it for (e.g. non-menstruating at 35)
    if (!(age >= staged.ageMin && age < staged.ageMax)) return { ...sel, applicability: 'unresolved', reasonCode: 'statusOutsideAgeBand' };
  }
  return sel;
}

// ------------------------------------------------------------------------------------------- known exposure summary

/** Summary of the KNOWN daily amounts of one tracked nutrient over the observation window (canonical unit). */
export interface KnownNutrientSummary {
  /** Days of the window inspected (≤ the configured window and the days simulated so far). */
  windowDays: number;
  /** Logged days with complete coverage (incl. confirmed zero) and with partial coverage. */
  completeDays: number;
  partialDays: number;
  /** Planned (prescribed) and as-planned days: scenario inputs, never observed intake. */
  plannedDays: number;
  /** Mean over completely covered days, or null when there are none (unknown is never zero). */
  meanComplete: number | null;
  /** Mean known amount over all logged days (complete + partial): a lower bound of the observed-day mean. */
  lowerBoundMean: number | null;
  /** Mean over planned days (the prescription's scenario value), or null. */
  plannedMean: number | null;
  /** Share of the window with complete coverage: a DATA-coverage fraction with a defined denominator, not adequacy. */
  coverageFraction: number;
}

/**
 * Summarise a nutrient-major ring pair (`nutKnownRing`/`nutCovRing` of `WellbeingState`) for nutrient `n` over the newest
 * `window` of `days` pushed days, newest at `head`. Pure; allocates the result only.
 */
export function summariseKnownNutrient(known: Float64Array, cov: Int8Array, n: number, head: number, days: number, window: number): KnownNutrientSummary {
  const cap = cov.length / N_TRACKED; // ring capacity (nutrient-major layout)
  const w = Math.max(0, Math.min(days, window, cap));
  let complete = 0;
  let partial = 0;
  let planned = 0;
  let sumComplete = 0;
  let sumPartial = 0;
  let sumPlanned = 0;
  let i = head;
  for (let j = 0; j < w; j++) {
    const slot = n * cap + i;
    const c = cov[slot]!;
    const v = known[slot]!;
    if (c === NUT_COV.complete || c === NUT_COV.confirmedZero) {
      complete++;
      sumComplete += v;
    } else if (c === NUT_COV.partial) {
      partial++;
      sumPartial += v;
    } else if (c === NUT_COV.planned || c === NUT_COV.asPlanned) {
      planned++;
      sumPlanned += v;
    }
    i = i === 0 ? cap - 1 : i - 1;
  }
  return {
    windowDays: w,
    completeDays: complete,
    partialDays: partial,
    plannedDays: planned,
    meanComplete: complete > 0 ? sumComplete / complete : null,
    lowerBoundMean: complete + partial > 0 ? (sumComplete + sumPartial) / (complete + partial) : null,
    plannedMean: planned > 0 ? sumPlanned / planned : null,
    coverageFraction: w > 0 ? complete / w : 0,
  };
}

/** Coverage code of a day's ledger entry (`NUT_COV`); `planned` when the day is a prescription (no realised coverage map). */
export function nutrientCoverageCode(coverage: ChannelCoverage | undefined, realisedDay: boolean): number {
  if (!realisedDay) return coverage === undefined || coverage === 'unknown' ? NUT_COV.unknown : NUT_COV.planned;
  switch (coverage) {
    case 'complete':
      return NUT_COV.complete;
    case 'confirmedZero':
      return NUT_COV.confirmedZero;
    case 'partial':
      return NUT_COV.partial;
    case 'asPlannedEstimate':
      return NUT_COV.asPlanned;
    default:
      return NUT_COV.unknown;
  }
}

// ------------------------------------------------------------------------------------------- interpretation

/** Position of the observed intake against the reference type (no probability, no deficiency verdict). */
export type NutrientIntakePosition =
  | 'unknown'
  | 'partialLowerBound'
  | 'belowEar'
  | 'betweenEarAndRda'
  | 'atOrAboveRda'
  | 'belowAiUndetermined'
  | 'atOrAboveAi'
  | 'noReference';
export type NutrientUlPosition = 'noUl' | 'notAssessed' | 'belowUl' | 'aboveUl' | 'unchecked' | 'scopeMismatch';

export interface NutrientInterpretation {
  position: NutrientIntakePosition;
  ul: NutrientUlPosition;
  /** Reference compared against (kind and value), when any. */
  reference?: { kind: DriKind; value: number; unit: string };
  applicability: DriSelection['applicability'];
  /** Logged-day counts behind the statement: an observed mean is not usual intake. */
  completeDays: number;
  partialDays: number;
  windowDays: number;
  reasonCode: string;
}

/**
 * Interpret a known-intake summary against the selected references (NASEM assessment semantics). The amount compared is
 * the mean over completely covered logged days; with only partial days the known mean is a lower bound: it can prove a
 * total-intake UL exceeded or an RDA/AI met, never clear a UL or establish a shortfall.
 */
export function interpretNutrientIntake(summary: KnownNutrientSummary, refs: DriSelection): NutrientInterpretation {
  const base = { applicability: refs.applicability, completeDays: summary.completeDays, partialDays: summary.partialDays, windowDays: summary.windowDays };
  const ul = refs.ul;
  const ulOf = (amount: number | null, lowerBound: boolean): NutrientUlPosition => {
    if (!ul) return 'noUl';
    if (ul.scope !== 'totalIntake') return 'scopeMismatch';
    if (amount === null) return 'notAssessed';
    if (amount > ul.value) return 'aboveUl';
    return lowerBound ? 'unchecked' : 'belowUl';
  };
  if (summary.meanComplete === null) {
    if (summary.lowerBoundMean === null) return { ...base, position: 'unknown', ul: ul ? (ul.scope === 'totalIntake' ? 'notAssessed' : 'scopeMismatch') : 'noUl', reasonCode: 'noLoggedIntake' };
    const lb = summary.lowerBoundMean;
    const met = refs.rda ?? refs.ai;
    if (met && lb >= met.value) {
      return { ...base, position: refs.rda ? 'atOrAboveRda' : 'atOrAboveAi', ul: ulOf(lb, true), reference: { kind: met.kind, value: met.value, unit: met.unit }, reasonCode: 'knownLowerBoundMeetsReference' };
    }
    return { ...base, position: 'partialLowerBound', ul: ulOf(lb, true), reasonCode: 'partialCoverage' };
  }
  const x = summary.meanComplete;
  const partialToo = summary.partialDays > 0;
  const ulPos = ulOf(x, false);
  if (refs.ear) {
    const rda = refs.rda;
    if (x < refs.ear.value) return { ...base, position: 'belowEar', ul: ulPos, reference: { kind: 'EAR', value: refs.ear.value, unit: refs.ear.unit }, reasonCode: partialToo ? 'observedMeanCompleteDaysOnly' : 'observedMean' };
    if (rda && x < rda.value) return { ...base, position: 'betweenEarAndRda', ul: ulPos, reference: { kind: 'RDA', value: rda.value, unit: rda.unit }, reasonCode: 'observedMean' };
    const r = rda ?? refs.ear;
    return { ...base, position: 'atOrAboveRda', ul: ulPos, reference: { kind: r.kind, value: r.value, unit: r.unit }, reasonCode: 'observedMean' };
  }
  if (refs.ai) {
    const below = x < refs.ai.value;
    return { ...base, position: below ? 'belowAiUndetermined' : 'atOrAboveAi', ul: ulPos, reference: { kind: 'AI', value: refs.ai.value, unit: refs.ai.unit }, reasonCode: below ? 'belowAiAdequacyUndetermined' : 'observedMean' };
  }
  return { ...base, position: 'noReference', ul: ulPos, reasonCode: 'noReference' };
}
