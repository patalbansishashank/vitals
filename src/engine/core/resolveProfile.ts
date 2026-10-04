/**
 * PersonProfile → ResolvedProfile (docs/MODEL_SPEC.md §5.1.3). Runs once per simulation, outside the step loop.
 *
 * Baselines needed by several modules are derived here exactly once:
 *  - body composition & regional state: src/engine/body `estimateInitialState` (dossier 14);
 *  - RMR0 by the 02 §4.1 selection rule (measured > FFM-based when BF is measured > Mifflin–St Jeor);
 *  - TDEE0 = EI0 by 02 §4.13 init step 2 (steps-based form) with 10 §4.1 step cost and 10 §4.14 selector;
 *  - habitual diet (06 §2.4 NHANES defaults unless the user states otherwise).
 */
import { estimateInitialState } from '../body/estimateBody'; // the module, not the index: this file is in the app's initial bundle
import { ACTIVITY_INTAKE_K, activityTerms, assembleActivity, cappedNumerator } from '../intake/activity';
import type { ActivityBase, PersonProfile, ResolvedHabits, ResolvedProfile } from '../types/profile';
import { ATWATER, DEFAULTS, KCAL_PER_MJ } from './defaults';

/** 10 §4.14 selector table: default steps → PAL (used for NEAT0 calibration and the VO2max prior). */
export const ACTIVITY_SELECTOR = [
  { steps: 4000, pal: 1.45 },
  { steps: 6500, pal: 1.6 },
  { steps: 8500, pal: 1.75 },
  { steps: 11000, pal: 1.9 },
  { steps: 15000, pal: 2.2 },
] as const;

/** 10 §4.1.4 net step cost, kcal per kg per 1000 steps (range 0.36-0.50) = ParamDef `activityIntake.stepKcalPerKgPer1000`. */
export const STEP_NET_KCAL_PER_KG_PER_1000 = 0.44;
/** 10 §4.1 default resistance session: 4.0 MET for 60 min incl. rest; generic cardio session: Compendium elliptical moderate 5.0 MET. */
export const HABIT_RT_MET = 4.0;
export const HABIT_CARDIO_MET = 5.0;

function mifflin(sex: 'male' | 'female', w: number, hCm: number, age: number): number {
  return 10 * w + 6.25 * hCm - 5 * age + (sex === 'male' ? 5 : -161);
}

/** 02 §4.1 selection rule. Visual/slider body fat counts as "unknown" → Mifflin. */
export function selectRmr0(p: PersonProfile, ffm: number, fm: number, trainedOrHighFfmi: boolean): number {
  if (p.labs?.measuredRmrKcal && p.labs.measuredRmrKcal > 0) return p.labs.measuredRmrKcal;
  const b = p.body;
  const measuredBf = b.knownBodyFatPct !== undefined && (b.knownBodyFatSource === 'dxa' || b.knownBodyFatSource === 'bia');
  const eq = (sex: 'male' | 'female'): number => {
    if (measuredBf) {
      if (trainedOrHighFfmi) return 500 + 22 * ffm; // Cunningham 1980
      return (0.05192 * ffm + 0.04036 * fm + 0.869 * (sex === 'male' ? 1 : 0) - 0.01181 * b.ageYears + 2.992) * KCAL_PER_MJ; // Müller-FFM
    }
    return mifflin(sex, b.weightKg, b.heightCm, b.ageYears);
  };
  return p.sexUnspecified ? 0.5 * (eq('male') + eq('female')) : eq(b.sex);
}

/** TEF fraction of intake for a macro mix (02 §4.4 coefficients; alcohol 0.10 per MODEL_SPEC ruling R-ALC). */
export function tefFraction(pG: number, cG: number, fG: number, fibreG: number, alcG: number): number {
  const eP = ATWATER.protein * pG;
  const eC = ATWATER.carb * cG;
  const eF = ATWATER.fat * fG;
  const eFib = ATWATER.fibre * fibreG;
  const eA = ATWATER.alcohol * alcG;
  const e = eP + eC + eF + eFib + eA;
  if (e <= 0) return 0;
  return (0.25 * eP + 0.075 * eC + 0.025 * eF + 0.1 * eA + 0.3 * eFib) / e;
}

export function resolveHabits(p: PersonProfile): ResolvedHabits {
  const h = p.habits ?? {};
  const sex = p.body.sex;
  return {
    ...(h.activity ? { activity: h.activity } : {}),
    trainingHistory: h.trainingHistory ?? 'none',
    sessionsPerWeek: h.sessionsPerWeek ?? 0,
    lifingCardioMix: h.lifingCardioMix ?? 0.5,
    typicalSteps: h.typicalSteps ?? DEFAULTS.steps,
    bedTimeH: h.bedTimeH ?? DEFAULTS.bedTimeH,
    wakeTimeH: h.wakeTimeH ?? DEFAULTS.wakeTimeH,
    sleepQuality: h.sleepQuality ?? DEFAULTS.sleepQuality,
    stress: h.stress ?? DEFAULTS.stress,
    habitualProteinGPerKg: h.habitualProteinGPerKg ?? Number.NaN,
    habitualCarbPctEnergy: h.habitualCarbPctEnergy ?? DEFAULTS.habitualCarbPctEnergy[sex],
    habitualFibreGPer1000Kcal: h.habitualFibreGPer1000Kcal ?? DEFAULTS.fibreGPer1000Kcal,
    habitualSodiumG: h.habitualSodiumG ?? DEFAULTS.sodiumG,
    habitualCaffeineMg: h.habitualCaffeineMg ?? DEFAULTS.caffeineMg,
    habitualAlcoholDrinksPerWeek: h.habitualAlcoholDrinksPerWeek ?? DEFAULTS.habitualAlcoholDrinksPerWeek,
    habitualMealsPerDay: h.habitualMealsPerDay ?? DEFAULTS.mealsPerDay,
    habitualWindowStartH: h.habitualWindowStartH ?? DEFAULTS.windowStartH,
    habitualWindowLengthH: h.habitualWindowLengthH ?? DEFAULTS.windowLengthH,
    dietAnimalLevel: h.dietAnimalLevel ?? 'omnivore',
    upfShare: h.upfShare ?? DEFAULTS.upfShare,
    foodQuality: h.foodQuality ?? DEFAULTS.foodQuality,
    multivitamin: h.multivitamin ?? false,
    smoker: h.smoker ?? false,
    habitualLiquidKcal: h.habitualLiquidKcal ?? Number.NaN,
    habitualEnergyDensityKcalPerG: h.habitualEnergyDensityKcalPerG ?? Number.NaN,
  };
}

/**
 * Menopause status when the user gives none (16 §4.7: "< 50 y pre; 50–53 y peri; ≥ 54 y post", from the mean final
 * menstrual period at 52.2 y, SWAN). Men: 'pre' (unused).
 */
export function defaultMenopause(sex: 'male' | 'female', ageYears: number): 'pre' | 'peri' | 'post' {
  if (sex !== 'female') return 'pre';
  return ageYears >= 54 ? 'post' : ageYears >= 50 ? 'peri' : 'pre';
}

/** Nearest 10 §4.14 selector row by habitual steps. */
export function selectorFor(steps: number): (typeof ACTIVITY_SELECTOR)[number] {
  let best: (typeof ACTIVITY_SELECTOR)[number] = ACTIVITY_SELECTOR[0];
  for (const row of ACTIVITY_SELECTOR) if (Math.abs(row.steps - steps) < Math.abs(best.steps - steps)) best = row;
  return best;
}

/**
 * Index of the 10 §4.14 selector row for the VO2max prior (PA-R): nearest PAL row to PAL0 when the profile has an activity
 * intake (R1 §3.4: removes the 7 000 steps ↔ PAL 1.6 vs 1.44 inconsistency), else nearest steps row (pre-intake behaviour).
 */
export function selectorIndexFor(profile: Pick<ResolvedProfile, 'habits' | 'activity'>): number {
  const a = profile.activity;
  const byPal = a !== undefined && a.source === 'intake' && Number.isFinite(a.pal0);
  const x = byPal ? a.pal0 : profile.habits.typicalSteps;
  let bi = 0;
  let bd = Math.abs((byPal ? ACTIVITY_SELECTOR[0].pal : ACTIVITY_SELECTOR[0].steps) - x);
  for (let i = 1; i < ACTIVITY_SELECTOR.length; i++) {
    const row = ACTIVITY_SELECTOR[i]!;
    const dd = Math.abs((byPal ? row.pal : row.steps) - x);
    if (dd < bd) {
      bd = dd;
      bi = i;
    }
  }
  return bi;
}

/** RMR route of the 02 §4.1 selection rule (for the maintenance band floor, 02 §4.12 cv0). */
export function rmrRouteOf(p: PersonProfile): ActivityBase['rmrRoute'] {
  if (p.labs?.measuredRmrKcal && p.labs.measuredRmrKcal > 0) return 'measured';
  const b = p.body;
  return b.knownBodyFatPct !== undefined && (b.knownBodyFatSource === 'dxa' || b.knownBodyFatSource === 'bia') ? 'ffm' : 'equation';
}

export function resolveProfile(p: PersonProfile): ResolvedProfile {
  const body = estimateInitialState({ ...p.body });
  const habits0 = resolveHabits(p);
  const sex = p.body.sex;
  const w = p.body.weightKg;
  const ffm = body.fatFreeMassKg;
  const fm = body.fatMassKg;
  const ffmi = body.ffmi;
  const trained = habits0.trainingHistory === '1to3y' || habits0.trainingHistory === 'gt3y';
  const highFfmi = sex === 'male' ? ffmi >= 20 : ffmi >= 17; // 02 §4.1 PROPOSED threshold
  const rmr0 = selectRmr0(p, ffm, fm, trained || highFfmi);

  // Habitual exercise (net, kcal/d averaged over the week): sessions × 1 h × (MET − 1) × BW / 7 (10 §4.1, 09 §4.13).
  const metMix = HABIT_RT_MET * (1 - habits0.lifingCardioMix) + HABIT_CARDIO_MET * habits0.lifingCardioMix;
  const eat0 = (habits0.sessionsPerWeek * (metMix - 1) * w * 1) / 7;

  // Habitual activity (MODEL_SPEC §5.5, R1 §3): without an intake the steps tick (or 7 000) and nothing else — the
  // pre-intake TDEE0 bit for bit; with one, the weekly-mean steps S_hab become `typicalSteps` and the occupational, home,
  // commute and recreational energy enter the numerator (inside NEAT0).
  const k = ACTIVITY_INTAKE_K;
  const intake = p.habits?.activity;
  const typedSteps = p.habits?.typicalSteps;
  const base0: ActivityBase = {
    weightKg: w,
    rmr0Kcal: rmr0,
    eat0Kcal: eat0,
    tefFraction: 0.1,
    rmrRoute: rmrRouteOf(p),
    ...(typedSteps !== undefined ? { typicalSteps: typedSteps } : {}),
  };
  const terms = activityTerms(intake, base0, k);
  const habits: ResolvedHabits = intake ? { ...habits0, typicalSteps: terms.steps } : habits0;

  // Habitual diet shares at EI0 (06 §2.4 NHANES defaults).
  const alcG = (habits.habitualAlcoholDrinksPerWeek * DEFAULTS.gramsPerDrink) / 7;
  // 02 §4.13 init step 2 (steps form) + R1 §3.1 non-step terms:
  // TDEE0 = (RMR0·(1 + f_ns) + k_step·BW·steps0 + EAT0 + E_occ + E_home + E_cyc + E_rec)/(1 − α_mix0)
  // R1 §3.1: the intake's non-step answers may not push PAL0 above 2.5 (`cappedNumerator`; the pre-intake form is never capped)
  // α_mix0 depends on the macro grams, which depend on TDEE0 → solve by fixed point (3 iterations converge < 0.1 kcal).
  let tef = 0.1;
  let tdee0 = cappedNumerator(terms, base0, tef, k) / 0.9;
  let proteinG = 0;
  let carbG = 0;
  let fatG = 0;
  let fibreG = 0;
  for (let it = 0; it < 4; it++) {
    proteinG = Number.isFinite(habits.habitualProteinGPerKg)
      ? habits.habitualProteinGPerKg * w
      : (DEFAULTS.habitualProteinPctEnergy / 100) * tdee0 / ATWATER.protein;
    fibreG = (habits.habitualFibreGPer1000Kcal * tdee0) / 1000;
    carbG = ((habits.habitualCarbPctEnergy / 100) * tdee0) / ATWATER.carb;
    const rest = tdee0 - ATWATER.protein * proteinG - ATWATER.carb * carbG - ATWATER.fibre * fibreG - ATWATER.alcohol * alcG;
    fatG = Math.max(0, rest / ATWATER.fat);
    tef = tefFraction(proteinG, carbG, fatG, fibreG, alcG);
    tdee0 = cappedNumerator(terms, base0, tef, k) / (1 - tef);
  }
  const activity = assembleActivity(terms, { ...base0, tefFraction: tef }, tdee0, k);

  const startDate = p.startDate ?? '2026-01-05';
  const startWeekday = (new Date(`${startDate}T00:00:00Z`).getUTCDay() + 6) % 7;

  return {
    input: p,
    sex,
    ageYears: p.body.ageYears,
    heightM: p.body.heightCm / 100,
    weightKg: w,
    body,
    habits,
    cycle: p.cycle ?? { tracking: false },
    menopause:
      p.menopause ??
      (p.body.menopause === 'pre' || p.body.menopause === 'peri' || p.body.menopause === 'post'
        ? p.body.menopause
        : defaultMenopause(sex, p.body.ageYears)),
    safety: p.safety ?? { mode: 'M0', flags: {} },
    labs: p.labs ?? {},
    startWeekday,
    rmr0Kcal: rmr0,
    tdee0Kcal: tdee0,
    eat0Kcal: eat0,
    habitualProteinG: proteinG,
    habitualCarbG: carbG,
    habitualFatG: fatG,
    habitualFibreG: fibreG,
    habitualSodiumMg: habits.habitualSodiumG * 1000,
    ffm0Kg: ffm,
    fm0Kg: fm,
    activity,
  };
}

/**
 * Absolute lean tissue at t = 0 (review m6, MODEL_SPEC §1.8 init): LT0 = FFM0 − (1 + h)·G0/1000 — the Hall-convention
 * protein tissue excludes the glycogen and its bound water that the DXA-like FFM0 contains. `hGlyWater` is fuel's
 * registry value (`fuel.hGlyWater`, default 3.0 g/g); G0 = the body module's initial glycogen (14 M5).
 */
export function leanTissue0Kg(profile: ResolvedProfile, hGlyWater = 3.0): number {
  return profile.ffm0Kg - ((1 + hGlyWater) * profile.body.glycogen.totalG) / 1000;
}
