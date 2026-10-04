/**
 * Engine-run hooks of the living plan, called by the core loop (`core/loop.ts`) at day boundaries:
 *  - CR-L2 `applyTissueAnchor`: move the tissue mass FM + FFM_act to a target, allocating the residual by the composition
 *    module's own partition (never all to fat), or to a measured whole-body fat fraction (DXA);
 *  - CR-L3 `offsetDayIntake`: the energy-balance bias δ as an absorbed intake offset at the day's macro mix.
 * Both are pure functions of their arguments (the anchor mutates the state objects it is handed, exactly like a module
 * hook); neither allocates on the hot path except `offsetDayIntake`'s first use of the caller's scratch day.
 *
 * Coupling note (documented in docs/LIVING_PLAN.md): the anchor reads and writes the composition module's state fields
 * (`fmKg`, `ltKg`, `smKg`, depots, day-start accumulators). It checks their presence and throws a clear error when a
 * module list without that state shape is used. If the engine owner later adds a `reanchor` hook to composition, this
 * function becomes a call to it.
 */
import type { CompositionState } from '../model/composition';
import type { DayInput, MealResolved } from '../types/inputs';
import type { AnchorApplied, AnchorSpec } from '../types/result';

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
  // depots follow their compartments proportionally (the day's allocation refines them from tomorrow on)
  const fFat = fmOld > 0 ? s.fmKg / fmOld : 1;
  const fSm = smOld > 0 ? s.smKg / smOld : 1;
  if (s.regional) {
    scaleNumeric(s.regional.fat, fFat);
    scaleNumeric(s.regional.muscle, fSm);
  }
  s.vatKg *= fFat;
  const ffmNew = s.ffm0Kg + (s.ltKg - s.lt0Kg);
  if (s.body) {
    s.body.fatMassKg = s.fmKg;
    s.body.fatFreeMassKg = ffmNew;
    s.body.weightKg = s.fmKg + ffmNew;
    s.body.skeletalMuscleKg = s.smKg;
    // body.fat / body.muscle alias the regional depots in the module (already scaled); scale only when they are copies
    if (s.regional && s.body.fat !== s.regional.fat) scaleNumeric(s.body.fat, fFat);
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
 * The day as eaten with the bias offset: every meal (and the day's totals) scaled by f = (E + δ)/E with E the day's meal
 * energy (alcohol and carbohydrate during exercise unchanged). Returns `day` itself when nothing applies (δ = 0, no meals,
 * a zero-intake day). Writes into `scratch` (reused every day; the first use allocates its copies).
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
  }
  (out as { meals: MealResolved[] }).meals = scratch.meals;
  const mut = out as unknown as Record<string, number>;
  for (const k of DAY_SCALED) mut[k as string] = (day[k] as number) * f;
  // carbohydrate during exercise is part of the day's carbG / glucoseEqG but is not a meal: keep it unscaled
  const exG = day.exerciseCarbG > 0 ? day.exerciseCarbG : 0;
  out.carbG = (day.carbG - exG) * f + exG;
  out.glucoseEqG = (day.glucoseEqG - exG) * f + exG;
  out.energyKcal = day.energyKcal + (f - 1) * mealKcal;
  return out;
}
