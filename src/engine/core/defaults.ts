/**
 * Engine-wide constants and input defaults (docs/MODEL_SPEC.md §0.4 and §5).
 *
 * Only unit conversions, definitional constants and *input defaults* live here. Every physiological coefficient is a
 * ParamDef owned by a module. Each default cites the dossier that justifies it.
 */

export const ENGINE_VERSION = '1.0.0-contract';

/** Unit conversions (definitional). */
export const KCAL_PER_KJ = 1 / 4.184;
export const KCAL_PER_MJ = 239.0057;
export const MMOL_NA_PER_G = 1000 / 22.99;
export const G_PROTEIN_PER_G_N = 6.25;
export const HOURS_PER_DAY = 24;

/**
 * Engine energy convention for intake (dossier 15 §4.2, aligned with 02 §4.4):
 * E = 4·protein + 9·fat + 4·(net carbohydrate) + 2·fibre + 7·alcohol  [kcal]. MCT counted at 8.3 (05 §4.17).
 */
export const ATWATER = { protein: 4, fat: 9, carb: 4, fibre: 2, alcohol: 7, mct: 8.3 } as const;

/** Tissue energy densities and costs (01 §4.7, 02 §4.11) — definitional within the Hall convention (MODEL_SPEC §2.1). */
export const RHO = {
  /** Fat, kcal/kg (39.5 MJ/kg). */
  fat: 9441,
  /** Glycogen, kcal/g (17.6 MJ/kg). */
  glycogenPerG: 4.207,
  /** Protein (tissue), kcal/g (Hall 2010 ρ_P). */
  proteinPerG: 4.7,
} as const;

/** 17 §2.5: zero-energy threshold for the fasting clock (kcal per intake event / per day). */
export const ZERO_INTAKE_KCAL = 50;

// ---------------------------------------------------------------- input defaults (MODEL_SPEC §5.2 table)

export const DEFAULTS = {
  /** Schedule energy reference (orchestrator ruling). */
  energyReference: 'baseline' as const,
  /** 03 §4.1 / 17 HC-M1 use g/kg; UI default protein when a preset gives none: 1.6 g/kg BW (03 §4.2 plateau ≈1.62). */
  proteinGPerKg: 1.6,
  /** 15 §1.1: 8 g fibre per 1000 kcal (typical Western). */
  fibreGPer1000Kcal: 8,
  /** 15 §3: viscous share of fibre 0.15. */
  viscousFibreShare: 0.15,
  /**
   * 06 §2.4 NHANES 2017-2020 habitual fatty acids (men): SFA 11.6, MUFA 12.4, PUFA 8.4 of 36.1 %E total fat
   * → shares 0.32 / 0.34 / 0.23 of fat (DERIVED; women 0.32 / 0.34 / 0.24). Remainder = trans + other.
   */
  satShare: 0.32,
  mufaShare: 0.34,
  pufaShare: 0.23,
  /** 06 §2.4 NHANES habitual total sugars, g/d (men / women); default sugars scale with carbohydrate (MODEL_SPEC §5.2.3). */
  habitualSugarsG: { male: 121, female: 94 },
  /** Engineering default (UNVERIFIED): sugars are mostly sucrose/HFCS ≈ half fructose. */
  fructoseShareOfSugars: 0.5,
  /** 06 §2.4 habitual EPA+DHA g/d (men 0.11 / women 0.08). */
  habitualOmega3G: { male: 0.11, female: 0.08 },
  /** 04 §4.16: mixed-meal glycaemic index (glucose scale) default 55. */
  glycaemicIndex: 55,
  /** 15 §1.1: ultra-processed energy share 0.55. */
  upfShare: 0.55,
  foodQuality: 2 as 1 | 2 | 3,
  /** 15 §1.1: sodium 3.0 g/d; potassium 2.8 g/d; magnesium 300 mg/d. */
  sodiumG: 3.0,
  potassiumG: 2.8,
  magnesiumMg: 300,
  /** 15 §1.1: caffeine 150 mg at 12:00. */
  caffeineMg: 150,
  caffeineClockH: 12,
  /** Meals and window (07 §4.8 habitual 3 meals; 12-h window 08:00-20:00). */
  mealsPerDay: 3,
  windowStartH: 8,
  windowLengthH: 12,
  mealSplit: 'even' as const,
  /** Sleep 23:00 → 07:00 (16 §4.1 reference 7-7.5 h; MODEL_SPEC ruling h_ref = 7.0 h). */
  bedTimeH: 23,
  wakeTimeH: 7,
  sleepQuality: 'good' as const,
  stress: 'low' as const,
  /** 10 §4.14 selector 'typical' ≈ 7000 steps (your-body.md reference tick). */
  steps: 7000,
  /**
   * Activity intake answers when skipped (plan/01-after-launch R1 §3.5, §5; MODEL_SPEC §5.5). Input defaults only — every
   * coefficient the answers map to is a ParamDef in `src/engine/intake/activity/params.ts`. Bounds are the R1 schema's
   * input ranges (values outside are clamped by `resolveActivity`).
   */
  activity: {
    work: 'unknown' as const,
    workDaysPerWeek: 5,
    workDaysPerWeekRange: [0, 7] as const,
    workHoursPerDay: 8,
    workHoursPerDayRange: [2, 14] as const,
    commuteMode: 'passive' as const,
    commuteActiveMinPerWorkday: 0,
    commuteActiveMinRange: [0, 240] as const,
    stepsSource: 'unknown' as const,
    stepsRange: [0, 60000] as const,
    offDay: 'mixed' as const,
    onFeetAtHome: 'some' as const,
    recreationMinPerWeekRange: [0, 2520] as const,
  },
  /** Resistance session defaults (09 §4.1, §4.13). */
  rtRir: 2,
  rtLoadPct1RM: 70,
  rtRestSec: 120,
  rtMinPerSet: 2.5,
  /**
   * Cardio default intensity by modality, fraction of VO2max = midpoints of 10 §4.8 moderate-equivalent bands (DERIVED):
   * walk 0.40-0.55 → 0.475; cycle/swim/row/other 0.55-0.70 → 0.625; run 0.70-0.85 → 0.775; hiit ≥ 0.85 → 0.875.
   */
  cardioPctVo2max: { walk: 0.475, run: 0.775, cycle: 0.625, swim: 0.625, row: 0.625, hiit: 0.875, other: 0.625 },
  /** Habitual diet when the profile gives none: 06 §2.4 NHANES protein 15.6 %E, carbohydrate 45.4 (M) / 46.3 (F) %E. */
  habitualProteinPctEnergy: 15.6,
  habitualCarbPctEnergy: { male: 45.4, female: 46.3 },
  habitualAlcoholDrinksPerWeek: 0,
  /** 15 §4.10 standard drink, g ethanol. */
  gramsPerDrink: 14,
  /** 17 §2.5: electrolytes assumed during fasts unless the user says otherwise. */
  fastElectrolytes: true,
} as const;

/** 09 §4.1 simple-descriptor presets: effective sets per major region per week and sessions per week. */
export const RT_PRESETS = {
  minimal: { setsPerRegionWeek: 2.5, sessionsPerWeek: 1 },
  light: { setsPerRegionWeek: 5, sessionsPerWeek: 2 },
  moderate: { setsPerRegionWeek: 11, sessionsPerWeek: 3 },
  high: { setsPerRegionWeek: 18, sessionsPerWeek: 4.5 },
  veryHigh: { setsPerRegionWeek: 27, sessionsPerWeek: 5.5 },
} as const;

/** 09 §4.13 Compendium METs by RT style. */
export const RT_STYLE_MET = { general: 3.5, heavyCompound: 5.0, bodybuilding: 6.0, circuit: 5.8, bodyweight: 3.0 } as const;

/** 03 §4.10 protein-quality table: Q_daily, Q_meal, digestion speed s. */
export const PROTEIN_QUALITY = {
  mixedOmnivore: { qDaily: 1.0, qMeal: 1.0, speed: 1.0 },
  mixedVegetarian: { qDaily: 0.95, qMeal: 0.93, speed: 1.0 },
  mixedVegan: { qDaily: 0.9, qMeal: 0.85, speed: 0.8 },
  whey: { qDaily: 1.0, qMeal: 1.15, speed: 1.6 },
  casein: { qDaily: 1.0, qMeal: 1.0, speed: 0.8 },
  milk: { qDaily: 1.0, qMeal: 1.06, speed: 1.0 },
  egg: { qDaily: 1.0, qMeal: 0.94, speed: 1.0 },
  meat: { qDaily: 1.0, qMeal: 0.97, speed: 1.0 },
  soy: { qDaily: 1.0, qMeal: 0.93, speed: 1.0 },
  pea: { qDaily: 0.82, qMeal: 0.86, speed: 1.0 },
  peaRiceBlend: { qDaily: 0.95, qMeal: 0.93, speed: 1.0 },
  rice: { qDaily: 0.56, qMeal: 0.72, speed: 1.0 },
  wheat: { qDaily: 0.57, qMeal: 0.66, speed: 1.0 },
  collagen: { qDaily: 0.3, qMeal: 0.25, speed: 1.0 },
} as const;

/** 04 §4.16 time-to-peak t_p by glycaemic class (h). */
export function timeToPeakH(gi: number, carbG: number, fatG: number): number {
  if (carbG > 150 || fatG > 30) return 1.5;
  if (gi >= 85) return 0.5;
  if (gi >= 70) return 0.75;
  if (gi >= 50) return 1.0;
  return 1.25;
}
