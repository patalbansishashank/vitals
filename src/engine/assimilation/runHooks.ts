/**
 * Engine-run hooks of the living plan, called by the core loop (`core/loop.ts`) at day boundaries:
 *  - CR-L2 `applyTissueAnchor`: move the tissue mass FM + FFM_act to a target, allocating the residual by the composition
 *    module's own partition (never all to fat), or to a measured whole-body fat fraction (DXA);
 *  - CR-L3 `offsetDayIntake`: the balance correction δ as an absorbed intake offset at the day's macro mix.
 * Both are pure functions of their arguments (the anchor mutates the state objects it is handed, exactly like a module
 * hook); neither allocates on the hot path except `offsetDayIntake`'s first use of the caller's scratch day.
 *
 * D5-03: the correction's application law is versioned (`CORRECTION_MECHANISM`, `CORRECTION_LAW_VERSION`). It is an
 * imputed-intake scenario (an inferred ledger correction, not a physiological intervention and not an expenditure offset):
 * meals are scaled at their own mix, a zero-energy or meal-free day applies nothing, and the scaling clips at zero intake.
 * `offsetAppliedOn` states what one day actually received, so estimators use the realised application history. Raw logged
 * foods and the intake echoes are never changed.
 * D1-02: an anchor moves VAT by the same allometric transition as the composition module (VAT·(FM_new/FM_old)^k, bounded
 * to [0, FM]), and the other fat depots take the rest, so VAT ≤ FM and the depot sum hold across every anchor.
 * D3-06: an anchor corrects composition only; training history (peaks, low-dose clocks, region histories) lives in the
 * muscle module's state and is never touched, so a re-anchored or resumed run keeps the same detraining history.
 *
 * Coupling note (documented in docs/LIVING_PLAN.md): the anchor reads and writes the composition module's state fields
 * (`fmKg`, `ltKg`, `smKg`, depots, day-start accumulators). It checks their presence and throws a clear error when a
 * module list without that state shape is used. If the engine owner later adds a `reanchor` hook to composition, this
 * function becomes a call to it.
 */
import { VAT_ALLOMETRY, vatTransition } from '../body/regional';
import type { CompositionState } from '../model/composition';
import type { DayInput, MealResolved } from '../types/inputs';
import type { AnchorApplied, AnchorSpec, OffsetApplied } from '../types/result';

/** D5-03: the only implemented correction application law (absent `IntakeOffset.mechanism` means the same). */
export const CORRECTION_MECHANISM = 'absorbedMacroImputation' as const;
/** D5-03: version of that law's semantics (meal scaling at the day's mix, zero-energy days skipped, clip at zero intake). */
export const CORRECTION_LAW_VERSION = 1;

/** The bus signals an anchor reads and rewrites (subset of `SignalBus`). */
export interface AnchorBusView {
  fatMassKg: number;
  leanTissueKg: number;
  ffmActKg: number;
  tissueMassKg: number;
  skeletalMuscleKg: number;
  vatKg: number;
  labileWaterKg: number;
  scaleWeightKg: number;
}

export interface AnchorConstants {
  /** Hall densities, kcal/kg (composition.rhoF, composition.rhoL). */
  rhoF: number;
  rhoL: number;
  /** Skeletal-muscle share of a non-training lean change (composition.smLossShare). */
  smLossShare: number;
  /**
   * D1-02 VAT allometry exponents (dimensionless): loss = empirical population prior, gain = labelled symmetric
   * hypothesis. Default: the body module's `VAT_ALLOMETRY`.
   */
  vatKLoss?: number;
  vatKGain?: number;
}

/**
 * D1-02: the VAT transition of an exogenous fat jump is the composition module's own daily law (`vatTransition`, one
 * implementation): VAT_new = clamp(VAT·(FM_new/FM_old)^k, 0, FM_new), k = kLoss on loss (empirical population prior),
 * kGain on gain (labelled symmetric hypothesis); FM_old ≤ 0, FM_new ≤ 0 or no VAT is the model limit VAT = 0.
 */
export function anchorVatKg(vatKg: number, fmOldKg: number, fmNewKg: number, kLoss: number = VAT_ALLOMETRY.kLoss, kGain: number = VAT_ALLOMETRY.kGain): number {
  return vatTransition(vatKg, fmOldKg, fmNewKg, kLoss, kGain);
}

/**
 * Move a regional fat record to a new total: VAT takes `vatNew`, the other depots share the rest in proportion to their
 * current masses (sum = fmNew exactly). A record whose total is not the model's fat mass (regional geometry not live)
 * is scaled proportionally as before.
 */
function moveFatDepots(fat: object, fmOld: number, fmNew: number, vatNew: number): void {
  const r = fat as Record<string, unknown>;
  const keys = Object.keys(r).filter((k) => typeof r[k] === 'number');
  const total = keys.reduce((a, k) => a + (r[k] as number), 0);
  const live = keys.includes('vatKg') && Math.abs(total - fmOld) <= 1e-6 * Math.max(1, Math.abs(fmOld));
  if (!live) {
    const f = fmOld > 0 ? fmNew / fmOld : 1;
    for (const k of keys) r[k] = (r[k] as number) * f;
    return;
  }
  const others = keys.filter((k) => k !== 'vatKg');
  const otherOld = others.reduce((a, k) => a + (r[k] as number), 0);
  const otherNew = Math.max(0, fmNew - vatNew);
  if (otherOld > 0) for (const k of others) r[k] = ((r[k] as number) * otherNew) / otherOld;
  else if (others.length > 0) for (const k of others) r[k] = otherNew / others.length;
  r.vatKg = vatNew;
}

/** Forbes' lean/fat ratio constant (dL/dF = C/FM), kg — the fallback when the module's shares are not finite. */
const FORBES_C_KG = 10.4;

function isCompositionState(x: unknown): x is CompositionState {
  const s = x as Partial<CompositionState> | null;
  return !!s && typeof s.fmKg === 'number' && typeof s.ltKg === 'number' && typeof s.lt0Kg === 'number' && typeof s.ffm0Kg === 'number';
}

/** Lean-MASS share of a tissue residual from an energy share p (fraction of stored energy going to lean). */
export function leanMassShare(pEnergy: number, rhoF: number, rhoL: number): number {
  const p = pEnergy < 0 ? 0 : pEnergy > 1 ? 1 : pEnergy;
  const l = p / rhoL;
  const f = (1 - p) / rhoF;
  return l + f > 0 ? l / (l + f) : 0;
}

function scaleNumeric(o: object, f: number): void {
  const r = o as Record<string, unknown>;
  for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] = (r[k] as number) * f;
}

/**
 * Apply one anchor to the composition state and the bus (start of `spec.day`). Returns the ledger entry.
 * `comp` must be the composition module's state object; throws otherwise.
 */
export function applyTissueAnchor(comp: unknown, bus: AnchorBusView, spec: AnchorSpec, c: AnchorConstants): AnchorApplied {
  if (!isCompositionState(comp)) throw new Error('anchors need the composition module state (fmKg, ltKg, lt0Kg, ffm0Kg)');
  if (!Number.isFinite(spec.tissueMassKg) || spec.tissueMassKg <= 0) throw new Error(`anchor on day ${spec.day}: tissueMassKg must be > 0`);
  const s = comp;
  const ffmAct = s.ffm0Kg + (s.ltKg - s.lt0Kg);
  const before = s.fmKg + ffmAct;
  const target = spec.tissueMassKg;
  const resid = target - before;
  let dF: number;
  let dL: number;
  if (spec.split && typeof spec.split === 'object') {
    const ff = Math.min(0.7, Math.max(0.02, spec.split.fatFrac));
    dF = ff * target - s.fmKg;
    dL = resid - dF;
  } else {
    const p = resid < 0 ? s.pDef : s.pSur;
    const share = Number.isFinite(p) ? leanMassShare(p, c.rhoF, c.rhoL) : FORBES_C_KG / (FORBES_C_KG + Math.max(1, s.fmKg));
    dL = share * resid;
    dF = resid - dL;
  }
  // keep the module's own floors (fat floor FM_min; lean guard 0.3·LT0): the excess moves to the other compartment
  const fmMin = Number.isFinite(s.fmMinKg) ? s.fmMinKg : 0;
  if (s.fmKg + dF < fmMin) {
    dL += s.fmKg + dF - fmMin;
    dF = fmMin - s.fmKg;
  }
  const ltMin = 0.3 * s.lt0Kg;
  if (s.ltKg + dL < ltMin) {
    dF += s.ltKg + dL - ltMin;
    dL = ltMin - s.ltKg;
  }
  const fmOld = s.fmKg;
  const smOld = s.smKg;
  s.fmKg += dF;
  s.ltKg += dL;
  s.fmDayStart += dF;
  s.ltDayStart += dL;
  s.smKg = Math.max(0, s.smKg + c.smLossShare * dL);
  // D1-02: VAT by the common allometric transition (bounded to [0, FM]); the other depots take the rest of the fat; muscle
  // regions follow skeletal muscle proportionally (the day's allocation refines them from tomorrow on)
  const vatNew = anchorVatKg(s.vatKg, fmOld, s.fmKg, c.vatKLoss, c.vatKGain);
  const fSm = smOld > 0 ? s.smKg / smOld : 1;
  if (s.regional) {
    moveFatDepots(s.regional.fat, fmOld, s.fmKg, vatNew);
    scaleNumeric(s.regional.muscle, fSm);
  }
  s.vatKg = vatNew;
  const ffmNew = s.ffm0Kg + (s.ltKg - s.lt0Kg);
  if (s.body) {
    s.body.fatMassKg = s.fmKg;
    s.body.fatFreeMassKg = ffmNew;
    s.body.weightKg = s.fmKg + ffmNew;
    s.body.skeletalMuscleKg = s.smKg;
    // body.fat / body.muscle alias the regional depots in the module (already moved); move only when they are copies
    if (s.regional && s.body.fat !== s.regional.fat) moveFatDepots(s.body.fat, fmOld, s.fmKg, vatNew);
    if (s.regional && s.body.muscle !== s.regional.muscle) scaleNumeric(s.body.muscle, fSm);
  }
  bus.fatMassKg = s.fmKg;
  bus.leanTissueKg = s.ltKg;
  bus.ffmActKg = ffmNew;
  bus.tissueMassKg = s.fmKg + ffmNew;
  bus.skeletalMuscleKg = s.smKg;
  bus.vatKg = s.vatKg;
  bus.scaleWeightKg = bus.tissueMassKg + bus.labileWaterKg;
  return {
    day: spec.day,
    tissueBeforeKg: before,
    tissueAfterKg: s.fmKg + ffmNew,
    dFatKg: dF,
    dLeanKg: dL,
    leanShare: resid !== 0 ? dL / resid : 0,
    storedEnergyKcal: c.rhoF * dF + c.rhoL * dL,
  };
}

/** Per-day offset array (kcal/d, 0 = none) from the step list, or null when every offset is 0. */
export function intakeOffsetArray(offsets: ReadonlyArray<{ fromDay: number; kcal: number }> | undefined, nDays: number): Float64Array | null {
  if (!offsets || offsets.length === 0) return null;
  const sorted = [...offsets].filter((o) => Number.isFinite(o.kcal) && Number.isFinite(o.fromDay)).sort((a, b) => a.fromDay - b.fromDay);
  const out = new Float64Array(nDays);
  let any = false;
  for (let i = 0; i < sorted.length; i++) {
    const from = Math.max(0, Math.floor(sorted[i]!.fromDay));
    const to = i + 1 < sorted.length ? Math.min(nDays, Math.floor(sorted[i + 1]!.fromDay)) : nDays;
    for (let d = from; d < to; d++) {
      out[d] = sorted[i]!.kcal;
      if (sorted[i]!.kcal !== 0) any = true;
    }
  }
  return any ? out : null;
}

/**
 * D5-03: what the correction law actually applies on one day for a requested δ (kcal/d), without building the day: the
 * meal energy changes by (f − 1)·E with f = max(0, (E + δ)/E); a zero-intake, meal-free or ≤ 1 kcal day applies 0
 * (`skippedReason 'zeroEnergyDay'`), and a large negative δ clips at zero meal energy. Matches `offsetDayIntake` exactly.
 */
export function offsetAppliedOn(day: DayInput, kcal: number): { appliedKcal: number; skippedReason?: 'zeroEnergyDay' } {
  if (kcal === 0 || !Number.isFinite(kcal)) return { appliedKcal: 0 };
  if (day.zeroIntake || day.nMeals === 0) return { appliedKcal: 0, skippedReason: 'zeroEnergyDay' };
  let mealKcal = 0;
  for (let i = 0; i < day.nMeals; i++) mealKcal += day.meals[i]!.kcal;
  if (!(mealKcal > 1)) return { appliedKcal: 0, skippedReason: 'zeroEnergyDay' };
  const f = Math.max(0, (mealKcal + kcal) / mealKcal);
  return { appliedKcal: (f - 1) * mealKcal };
}

/**
 * D5-03: per-day ledger (requested vs actually applied) for days [from, to) of resolved days and a per-day request array
 * (`intakeOffsetArray`); days without a request are omitted. Used when a run did not report `meta.offsetsApplied`.
 */
export function offsetLedger(days: readonly DayInput[], perDay: Float64Array | null, from: number, to: number): OffsetApplied[] {
  const out: OffsetApplied[] = [];
  if (perDay === null) return out;
  for (let d = Math.max(0, from); d < Math.min(to, days.length, perDay.length); d++) {
    const req = perDay[d]!;
    if (req === 0) continue;
    const a = offsetAppliedOn(days[d]!, req);
    out.push({ day: d, requestedKcal: req, appliedKcal: a.appliedKcal, ...(a.skippedReason ? { skippedReason: a.skippedReason } : {}) });
  }
  return out;
}

/** Scratch day for `offsetDayIntake` (created once per run, outside the day loop). */
export interface OffsetScratch {
  day: DayInput | null;
  meals: MealResolved[];
}

export function newOffsetScratch(): OffsetScratch {
  return { day: null, meals: [] };
}

const MEAL_SCALED: ReadonlyArray<keyof MealResolved> = [
  'proteinG', 'carbG', 'glucoseEqG', 'fructoseG', 'galactoseG', 'fatG', 'satFatG', 'mctG', 'fibreG', 'viscousFibreG', 'kcal',
];
const DAY_SCALED: ReadonlyArray<keyof DayInput> = [
  'proteinG', 'carbG', 'glucoseEqG', 'fructoseG', 'galactoseG', 'sugarsG', 'fibreG', 'viscousFibreG', 'fatG', 'satFatG', 'mufaG', 'pufaG', 'mctG',
];

/**
 * The day as the modules see it with the correction (law `CORRECTION_MECHANISM` v`CORRECTION_LAW_VERSION`): every meal (and
 * the day's totals) scaled by f = max(0, (E + δ)/E) with E the day's meal energy (alcohol and carbohydrate during exercise
 * unchanged). Returns `day` itself when nothing applies (δ = 0, no meals, a zero-intake day). Writes into `scratch` (reused
 * every day; the first use allocates its copies); the input day — the logged or prescribed intake — is never mutated.
 */
export function offsetDayIntake(day: DayInput, kcal: number, scratch: OffsetScratch): DayInput {
  if (kcal === 0 || day.zeroIntake || day.nMeals === 0) return day;
  let mealKcal = 0;
  for (let i = 0; i < day.nMeals; i++) mealKcal += day.meals[i]!.kcal;
  if (!(mealKcal > 1)) return day;
  const f = Math.max(0, (mealKcal + kcal) / mealKcal);
  if (scratch.day === null) scratch.day = { ...day };
  const out = Object.assign(scratch.day, day) as DayInput;
  while (scratch.meals.length < day.nMeals) scratch.meals.push({ ...day.meals[0]! });
  for (let i = 0; i < day.nMeals; i++) {
    const m = Object.assign(scratch.meals[i]!, day.meals[i]!) as MealResolved;
    for (const k of MEAL_SCALED) (m[k] as number) = (day.meals[i]![k] as number) * f;
    // D6-02: energy-only intake is part of the meal's kcal, so it scales with it (optional field: never undefined × f)
    const un = day.meals[i]!.unallocatedKcal;
    if (un !== undefined) m.unallocatedKcal = un * f;
  }
  (out as { meals: MealResolved[] }).meals = scratch.meals;
  const mut = out as unknown as Record<string, number>;
  for (const k of DAY_SCALED) mut[k as string] = (day[k] as number) * f;
  // carbohydrate during exercise is part of the day's carbG / glucoseEqG but is not a meal: keep it unscaled
  const exG = day.exerciseCarbG > 0 ? day.exerciseCarbG : 0;
  out.carbG = (day.carbG - exG) * f + exG;
  out.glucoseEqG = (day.glucoseEqG - exG) * f + exG;
  out.energyKcal = day.energyKcal + (f - 1) * mealKcal;
  if (day.unallocatedKcal !== undefined) out.unallocatedKcal = day.unallocatedKcal * f;
  return out;
}
