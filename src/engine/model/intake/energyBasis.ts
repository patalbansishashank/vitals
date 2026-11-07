/**
 * Energy basis of the intake module (C3/C7, D6-02): what its appearing energy means, the ingestion-to-appearance audit,
 * and the optional, explicitly named macro scenarios for energy-only meals.
 *
 *  - Boundary: the engine's intake is reported metabolizable energy (food-table/label ME already excludes fecal and
 *    urinary energy). `eAbsKcalH` is the MODELED APPEARING ME of that intake; TEF and modeled storage costs are
 *    expenditure. Nothing downstream may charge excretion of food energy again (`INTAKE_ENERGY_BASIS`).
 *  - Audit: registered intake = raw appearance + retained gut stores/tails + declared pre-appearance losses, exactly,
 *    from the first hour of the run; it starts at ingestion, so a meal whose energy never reached the gut is visible as
 *    `submitted − registered` (the compiler's hourly kcal vs what intake registered), not hidden behind eAbs identities.
 *  - Scenarios: an energy-only meal keeps its reported energy and known grams. A macro-dependent run may replace the
 *    unknown carbohydrate/fat by a DECLARED scenario (`carbFatScenario`: the restricted C/F family R = E − Σ known, with
 *    ΔC = qR/4 g, ΔF = (1 − q)R/9 g for an explicitly chosen q ∈ [0, 1]; or q from the person's habitual mix). These are
 *    conditional algebraic paths, not probability bounds, and q has NO default (q = 0.5 is not assumed). The scenario is a
 *    separate typed object; its grams are never written back into observations.
 */
import { ATWATER } from '../../core/defaults';
import type { MealSpec } from '../../types/schedule';
import { KF, KETONE_FIELDS, KETONE_SLOTS, MEAL_FIELDS, MEAL_SLOTS, MF, type IntakeConst, type IntakeState } from './index';

/** What the intake module's energy signals mean (C7 labels; shown in details, never as an operating-screen paragraph). */
export const INTAKE_ENERGY_BASIS = {
  boundary: 'reportedME',
  appearanceSignal: 'eAbsKcalH',
  appearanceMeaning: 'modeled appearing metabolizable energy (engine convention 4/4/9/2/7 kcal/g, MCT 8.3) plus energy-only intake, times the 15 §4.2 ME-correction ratio',
  energyOnly: 'energy not explained by known grams appears as energy only; never a named glucose/amino-acid/fat stream',
  excretion: 'already inside ME: never charged again',
  tef: 'expenditure (not subtracted from intake)',
  version: 1,
} as const;

/** Ingestion-to-appearance audit of one run so far, kcal (cumulative since the module's init). */
export interface IntakeEnergyAudit {
  /** Energy registered into the gut/pools (substrates at engine factors, energy-only intake, alcohol, ketone doses). */
  registeredKcal: number;
  /** Raw appearance (before the 15 §4.2 ME-correction ratio). */
  appearedKcal: number;
  /** Energy still in the gut and pools now (carbohydrate kernel, protein, gut fat/MCT/energy-only, intestinal queues,
   *  ethanol, ketone doses) minus any unapplied negative reconciliation; the horizon tail at the end of a run. */
  storedKcal: number;
  /** Declared pre-appearance losses (fed exogenous-ketone bioavailability, a dropped ketone dose). */
  lossKcal: number;
  /** registered − appeared − stored − losses: 0 up to floating-point error when nothing is lost. */
  imbalanceKcal: number;
  /** Hourly kcal the compiler submitted (+ exercise carbohydrate). Ketone doses are outside that convention. */
  submittedKcal: number;
  /** kcal added (negative: removed) by the 15 §4.2 ME-correction ratio on top of raw appearance. */
  meCorrectionKcal: number;
}

/** Energy retained in the module's pools now, kcal (see `IntakeEnergyAudit.storedKcal`). */
export function intakeStoredKcal(s: IntakeState, k: IntakeConst): number {
  const m = s.meals;
  let e = 0;
  for (let i = 0; i < MEAL_SLOTS; i++) {
    if (s.mealActive[i] === 0) continue;
    const b = i * MEAL_FIELDS;
    const rem = 1 - m[b + MF.CDF]!;
    if (rem > 0) e += rem * (ATWATER.carb * (m[b + MF.C0]! + m[b + MF.FG0]!) + ATWATER.fibre * m[b + MF.FIB0]!);
    e += ATWATER.protein * m[b + MF.PROT]!;
    const g = m[b + MF.GUT]!;
    if (g > 0) e += g * (ATWATER.fat * m[b + MF.FATK]! - (ATWATER.fat - ATWATER.mct) * m[b + MF.MCTK]! + s.mealUK[i]!);
  }
  e += ATWATER.carb * (s.glcQueueG + s.fruQueueG) + ATWATER.alcohol * s.etohG;
  for (let i = 0; i < KETONE_SLOTS; i++) {
    if (s.ketoneActive[i] === 0) continue;
    const b = i * KETONE_FIELDS;
    e += (1 - s.ketones[b + KF.CDF]!) * ((s.ketones[b + KF.MMOL]! * k.ketoneMw) / 1000) * k.ketoneKcalPerG;
  }
  return e + s.reconDebtKcal;
}

/** The audit of a run so far (pure read of the module state). */
export function intakeEnergyAudit(s: IntakeState, k: IntakeConst): IntakeEnergyAudit {
  const stored = intakeStoredKcal(s, k);
  return {
    registeredKcal: s.auditInKcal,
    appearedKcal: s.auditOutKcal,
    storedKcal: stored,
    lossKcal: s.auditLossKcal,
    imbalanceKcal: s.auditInKcal - s.auditOutKcal - stored - s.auditLossKcal,
    submittedKcal: s.auditSubmittedKcal,
    meCorrectionKcal: s.auditMeKcal,
  };
}

/* ------------------------------------------------------------------------------------------- declared macro scenarios */

/** A declared allocation of a meal's unknown carbohydrate/fat (never an observation). */
export type MacroScenario =
  | { kind: 'carbFatFamily'; q: number }
  /** q from a habitual (or prescription) composition: q = 4C/(4C + 9F) of that mix, frozen with its version. */
  | { kind: 'habitualMix'; carbG: number; fatG: number; version: string };

export type MacroScenarioResult =
  | {
      status: 'allocated';
      /** The meal with the scenario grams filled in; energy and every known gram unchanged. */
      meal: MealSpec;
      /** Scenario grams added (provenance 'imputed'), g. */
      imputed: { carbG: number; fatG: number };
      q: number;
      residualKcal: number;
      scenario: MacroScenario;
    }
  /** Nothing to allocate: the meal has no reported energy, or carbohydrate and fat are both known. */
  | { status: 'notNeeded'; meal: MealSpec }
  /** Unknown protein, fibre or alcohol: the C/F family cannot close the ledger uniquely; no allocation. */
  | { status: 'notUnique'; meal: MealSpec; unknown: readonly string[] }
  /** Known grams exceed the reported energy (R < 0): a source conflict; never negative grams. */
  | { status: 'conflict'; meal: MealSpec; residualKcal: number };

const finite = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);

/** q of a habitual/prescription mix (carbohydrate share of C+F energy at 4/9 kcal/g); null without C+F energy. */
export function qOfMix(carbG: number, fatG: number): number | null {
  const c = ATWATER.carb * Math.max(0, carbG);
  const f = ATWATER.fat * Math.max(0, fatG);
  return c + f > 0 ? c / (c + f) : null;
}

/**
 * Apply a declared C/F scenario to an energy-only meal (`MealSpec.energyKcal` with only the known grams in `macros`).
 * Restricted family: protein, fibre and alcohol must be known (absent alcohol/fibre on such a spec is unknown); exactly
 * one of C/F unknown closes uniquely (q is then irrelevant); both unknown use the scenario's q. MCT is not split here.
 */
export function carbFatScenario(meal: MealSpec, scenario: MacroScenario, opts: { fibreKnownZero?: boolean; alcoholKnownZero?: boolean } = {}): MacroScenarioResult {
  const e = meal.energyKcal;
  const m = meal.macros ?? {};
  if (!finite(e) || e < 0) return { status: 'notNeeded', meal };
  const cKnown = finite(m.carbG);
  const fKnown = finite(m.fatG);
  if (cKnown && fKnown) return { status: 'notNeeded', meal };
  const unknown: string[] = [];
  if (!finite(m.proteinG)) unknown.push('protein');
  if (!finite(m.fibreG) && !opts.fibreKnownZero) unknown.push('fibre');
  if (!finite(m.alcoholG) && !opts.alcoholKnownZero) unknown.push('alcohol');
  if (unknown.length > 0) return { status: 'notUnique', meal, unknown };
  let known = ATWATER.protein * m.proteinG! + ATWATER.fibre * (m.fibreG ?? 0) + ATWATER.alcohol * (m.alcoholG ?? 0);
  if (cKnown) known += ATWATER.carb * m.carbG!;
  if (fKnown) known += ATWATER.fat * m.fatG!;
  const R = e - known;
  if (R < -1e-9) return { status: 'conflict', meal, residualKcal: R };
  const r = R > 0 ? R : 0;
  let q: number;
  if (cKnown) q = 0;
  else if (fKnown) q = 1;
  else if (scenario.kind === 'carbFatFamily') q = Number.isFinite(scenario.q) ? Math.min(1, Math.max(0, scenario.q)) : NaN;
  else q = qOfMix(scenario.carbG, scenario.fatG) ?? NaN;
  if (!Number.isFinite(q)) return { status: 'notUnique', meal, unknown: ['carbFatSplit'] };
  const dC = cKnown ? 0 : (q * r) / ATWATER.carb;
  const dF = fKnown ? 0 : ((1 - q) * r) / ATWATER.fat;
  const macros = { ...m, carbG: cKnown ? m.carbG! : dC, fatG: fKnown ? m.fatG! : dF };
  return { status: 'allocated', meal: { ...meal, macros }, imputed: { carbG: dC, fatG: dF }, q, residualKcal: r, scenario };
}
