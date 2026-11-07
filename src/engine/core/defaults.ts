/**
 * Engine-wide constants and input defaults (docs/MODEL_SPEC.md §0.4 and §5).
 *
 * Only unit conversions, definitional constants and *input defaults* live here. Every physiological coefficient is a
 * ParamDef owned by a module. Each default cites the dossier that justifies it.
 */

/**
 * Engine semantics version. It is part of every snapshot key, the registry hash, planner checkpoint keys and stored run
 * metadata, so a change invalidates derived projections, snapshots and caches (C7; observations are never rewritten).
 * 1.1.0 (2026-10-18 contracts, W0): planned fast length/label is policy metadata only, observed fasts end at the first
 * verified intake and refeed ramps never rescale observed days (D2-01); set groups compile per group (D3-01); reported meal
 * energy with unknown macros is preserved as unallocated energy (D6-02); resolved per-day exposure summaries (D4-01);
 * measured t = 0 lab anchors and series status sidecars (D7-02); contract fingerprint in registry/snapshot keys (D4-03).
 * Stored results with a former ASI objective are not reused under it (D2-02).
 * 1.2.0 (2026-10-18, W1 conserved physiology, exposure and measurement foundations): daily TEE uses the recorded hourly
 * costs (D1-01); one VAT transition for every recording mask (D1-02, D8-01); body-fat evidence deduplicated by lineage
 * (D1-03); no universal fat-type lean multipliers and explicit protein-deficient-surplus abstention (D1-04/D1-05);
 * hydration/cycle proxies separated from tissue kg (D1-06); exercise compensation as a sensitivity structure (D1-07); a
 * tissue floor ends the run at a model limit (D1-08); ketone provenance, nitrogen ledger, hunger calibration, endocrine
 * and measured-ketone semantics (D2-03, D2-05…D2-08); task-specific training dose, public-health minutes, growth state,
 * history-based detraining, one exercise energy ledger, production post-RT REE 0 and dose provenance (D3-02…D3-09); the
 * applied intake correction is booked per day (D5-03); nutrient classes, carbohydrate mixture/appearance, nut ME only for a
 * stated form and normalised active-ingredient exposure (D6-03, D6-07, D6-08, D7-04); transient vs sustained hepatic
 * response (D7-08); sensitivity bands from stochastic members only with a uniform latent selector (D8-02); observed sleep
 * mapped to its wake date (D8-06); hook-aware signal declarations and inactive moderator pathways (D8-07). Derived
 * snapshots, caches, worker results and forecasts are invalidated; observations and adopted prescriptions are not rewritten.
 * 1.3.0 (2026-10-18, W2 planner policy and the living loop): SafetyTrace fields for the legacy eating-day EA under its
 * explicit name, the daily exposure ledger (EI, net session EEE, FFM_act, unclipped daily EA), calendar EA_7/EA_28 over
 * every calendar day (fast and refeed days included) with their day coverage, and end-of-day fat mass (D4-04, D4-05);
 * day-stamped snapshots key on the trace layout, so older safety snapshots are recomputed, never continued. Stored legacy
 * `ea7` values keep their original version (no retrospective recalculation).
 * 1.4.0 (2026-10-19, re-audit stage 1, waves 0-1): per-nutrient known/unknown masks seed conditional statuses from the
 * first affected day, and induced statuses keep their root's onset, reason and uncertainty kind (A1-013/A1-014); reported
 * meal energy is kept for every ledger status (A1-025); food ethanol and standalone drinks both count, linked once by event
 * (A1-029); polyols travel by identity with an unmodelled substrate route (A1-031); physical-bout keys, unknown hard-set
 * doses and effort-scale identities reach the training models (A1-020/A1-022/A1-062); total sleep is separate from
 * main-episode timing with explicit unrated quality (A1-053); out-of-domain lab baselines are unsupported from daily index 0
 * (A1-052); bands are finite with per-day availability, member envelopes and explicit structural modes (A1-049/A1-065);
 * the step-overlap reference is disclosed on both operands (A1-040). Derived snapshots, caches, bands, worker results and
 * certificates are invalidated; observations and adopted prescriptions are not rewritten.
 */
/**
 * 1.5.0 (2026-10-19, re-audit stage 2): endpoint operator identity and all-member goal availability, capability-driven
 * bounded objectives, current clinician guidance scope, explicit execution scenarios, complete-horizon route witnesses,
 * and independent intake/exercise exposure coverage. Derived caches/snapshots/checkpoints are invalidated; immutable logs,
 * adopted schedules and original forecasts retain their historical identities.
 */
export const ENGINE_VERSION = '1.5.0-reaudit';

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

/**
 * 17 §2.5: zero-energy tolerance for the adherence/safety clocks (kcal per intake event / per day; hours since intake,
 * fast tiers). Not the literal zero-calorie fast clock: the compiler ends an observed zero-calorie fast at the first
 * verified intake with positive energy (D2-01/D5-05, `ADHERENCE_ZERO_DAY_TOLERANCE_KCAL` in the contracts).
 */
export const ZERO_INTAKE_KCAL = 50;

/**
 * Reconciliation tolerance of a reported meal energy against its known grams (D6-02): each known macro may be rounded to
 * the whole gram on a label or log, so a convention energy above the reported value by at most Σ 0.5 g × factor is
 * rounding, not a source conflict. An accounting convention, not a physiological coefficient.
 */
export const MEAL_GRAM_ROUNDING_G = 0.5;

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
  /**
   * Resistance session defaults (09 §4.1, §4.13): assumptions applied when a field is not reported, never a known hard
   * intensity. Set groups (D3-01) keep an unknown load/RIR/rest as NaN with `assumed = 1`, so the muscle module applies
   * these values as flagged assumptions; legacy sessions without groups keep the resolved defaults (legacy merged dose).
   * The f_RIR/f_load/f_rest dose maps behind them are versioned sensitivity priors, not personal validated biology.
   */
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
